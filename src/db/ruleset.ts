/**
 * 判定依据（词表）的持久层。
 *
 * 放在 repository.ts 外面，理由和 [oversight.ts](oversight.ts) 一样：那个文件
 * 已经一千五百行，再往里塞就没人读得完了。仓储只留薄方法转发到这里。
 *
 * ————————————————————————————————————————————————————————————————
 * **这一层守两条不变量，别在别处再实现一遍：**
 *
 * 1. **每一次写操作都在同一个事务里做三件事**——改词条、把 `ruleset_meta.version`
 *    加一、往 `rule_change_log` 写一行。少任何一件，「判定依据被谁改过查得到」
 *    这句就不成立了。
 * 2. **内置基线删不掉、词面与出处改不了。** 基线是「说得出出处」的那份底，
 *    改了就不是那条基线了。要停用可以——停用也留痕。
 */
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';

import type {
  CreateRuleInput,
  ManagedRule,
  RuleChangeAction,
  RuleChangeEntry,
  RulesetSnapshot,
  UpdateRuleInput,
} from '../domain/ruleset.js';
import type { DatabaseHandle } from './client.js';
import { ruleChangeLog, ruleTerms, rulesetMeta } from './schema.js';

type RuleRow = typeof ruleTerms.$inferSelect;
type ChangeRow = typeof ruleChangeLog.$inferSelect;

const toRule = (row: RuleRow): ManagedRule => ({
  ruleId: row.ruleId,
  scope: row.scope as ManagedRule['scope'],
  term: row.term,
  source: row.source,
  origin: row.origin as ManagedRule['origin'],
  enabled: row.enabled,
  ...(row.admissionBucket
    ? { admissionBucket: row.admissionBucket as NonNullable<ManagedRule['admissionBucket']> }
    : {}),
  ...(row.category ? { category: row.category as NonNullable<ManagedRule['category']> } : {}),
  ...(row.action ? { action: row.action as NonNullable<ManagedRule['action']> } : {}),
  ...(row.title ? { title: row.title } : {}),
  ...(row.detail ? { detail: row.detail } : {}),
  ...(row.suggestion ? { suggestion: row.suggestion } : {}),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const parseRule = (value: string | null): ManagedRule | undefined => {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as ManagedRule;
  } catch {
    // 一条读不出来的历史快照不该让整页改动史打不开。
    return undefined;
  }
};

const toChange = (row: ChangeRow): RuleChangeEntry => {
  const before = parseRule(row.beforeJson);
  const after = parseRule(row.afterJson);
  return {
    id: row.id,
    rulesetVersion: row.rulesetVersion,
    ruleId: row.ruleId,
    action: row.action as RuleChangeAction,
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
    reason: row.reason,
    ...(row.acknowledgedWarning ? { acknowledgedWarning: row.acknowledgedWarning } : {}),
    ...(row.actorUserId ? { actorUserId: row.actorUserId } : {}),
    actor: row.actor,
    createdAt: row.createdAt,
  };
};

const toRow = (rule: ManagedRule) => ({
  ruleId: rule.ruleId,
  scope: rule.scope,
  term: rule.term,
  source: rule.source,
  origin: rule.origin,
  enabled: rule.enabled,
  admissionBucket: rule.admissionBucket ?? null,
  category: rule.category ?? null,
  action: rule.action ?? null,
  title: rule.title ?? null,
  detail: rule.detail ?? null,
  suggestion: rule.suggestion ?? null,
  createdAt: rule.createdAt,
  updatedAt: rule.updatedAt,
});

/** 一次写操作的署名。`actor` 是显示名快照，账号删了也查得到。 */
export interface RuleActor {
  userId: string;
  actor: string;
}

export interface RuleMutationContext extends RuleActor {
  reason: string;
  acknowledgedWarning?: string;
}

export class RulesetStore {
  constructor(private readonly database: DatabaseHandle) {}

  /**
   * 幂等灌入内置基线。
   *
   * **只 INSERT 缺失的 ruleId，绝不覆盖已有行**——否则台领导停用过的条目会被
   * 下一次重启悄悄冲回来，而他不会收到任何提示。基线定义变了要落到已装机的库
   * 上，那是一次明确的运维动作，不是启动时的副作用。
   *
   * 灌基线不算「人工改动」，所以不动版本号、不写改动日志：第 0 版的含义正是
   * 「未经任何人工改动」。
   */
  ensureBuiltins(builtins: readonly ManagedRule[]): void {
    const insert = this.database.sqlite.prepare(
      `INSERT OR IGNORE INTO rule_terms
        (rule_id, scope, term, source, origin, enabled, admission_bucket,
         category, action, title, detail, suggestion, created_at, updated_at)
       VALUES (@ruleId, @scope, @term, @source, @origin, @enabled, @admissionBucket,
               @category, @action, @title, @detail, @suggestion, @createdAt, @updatedAt)`,
    );
    const run = this.database.sqlite.transaction((rules: readonly ManagedRule[]) => {
      for (const rule of rules) insert.run({ ...toRow(rule), enabled: rule.enabled ? 1 : 0 });
    });
    run(builtins);
  }

  version(): number {
    const row = this.database.orm
      .select({ version: rulesetMeta.version })
      .from(rulesetMeta)
      .where(eq(rulesetMeta.id, 1))
      .get();
    return row?.version ?? 0;
  }

  snapshot(): RulesetSnapshot {
    // 版本号和词条必须一起读出来，否则并发写会让引擎拿到「第 6 版的号 + 第 7 版
    // 的词」，留痕里的版本就指不回真正用过的那一份。
    const read = this.database.sqlite.transaction((): RulesetSnapshot => {
      const version = this.version();
      const rules = this.database.orm
        .select()
        .from(ruleTerms)
        .orderBy(asc(ruleTerms.scope), asc(ruleTerms.ruleId))
        .all()
        .map(toRule);
      return { version, rules };
    });
    return read();
  }

  findRule(ruleId: string): ManagedRule | undefined {
    const row = this.database.orm
      .select()
      .from(ruleTerms)
      .where(eq(ruleTerms.ruleId, ruleId))
      .get();
    return row ? toRule(row) : undefined;
  }

  /** 某一档现有的词面，供硬拦档自检比对。 */
  termsInAdmissionBucket(bucket: string): string[] {
    return this.database.orm
      .select({ term: ruleTerms.term })
      .from(ruleTerms)
      .where(and(eq(ruleTerms.scope, 'admission'), eq(ruleTerms.admissionBucket, bucket)))
      .all()
      .map((row) => row.term);
  }

  listChanges(limit = 100, ruleId?: string): RuleChangeEntry[] {
    const query = this.database.orm.select().from(ruleChangeLog);
    const rows = (ruleId ? query.where(eq(ruleChangeLog.ruleId, ruleId)) : query)
      .orderBy(desc(ruleChangeLog.createdAt), desc(ruleChangeLog.id))
      .limit(limit)
      .all();
    return rows.map(toChange);
  }

  /**
   * 改词条 + 版本号 +1 + 写改动日志，一个事务。
   *
   * 三件事绑在一起是这一层存在的全部理由：任何一件单独发生，留痕都会开始说谎。
   */
  private commit(
    ruleId: string,
    action: RuleChangeAction,
    context: RuleMutationContext,
    before: ManagedRule | undefined,
    after: ManagedRule | undefined,
    write: () => void,
  ): { version: number; rule?: ManagedRule } {
    const now = Date.now();
    const run = this.database.sqlite.transaction(() => {
      write();
      const version = this.version() + 1;
      this.database.orm
        .update(rulesetMeta)
        .set({ version, updatedAt: now })
        .where(eq(rulesetMeta.id, 1))
        .run();
      this.database.orm
        .insert(ruleChangeLog)
        .values({
          id: randomUUID(),
          rulesetVersion: version,
          ruleId,
          action,
          beforeJson: before ? JSON.stringify(before) : null,
          afterJson: after ? JSON.stringify(after) : null,
          reason: context.reason,
          acknowledgedWarning: context.acknowledgedWarning ?? null,
          actorUserId: context.userId,
          actor: context.actor,
          createdAt: now,
        })
        .run();
      return version;
    });
    const version = run();
    return { version, ...(after ? { rule: after } : {}) };
  }

  create(
    ruleId: string,
    input: CreateRuleInput,
    context: RuleMutationContext,
  ): { version: number; rule: ManagedRule } {
    const now = Date.now();
    const rule: ManagedRule = {
      ruleId,
      scope: input.scope,
      term: input.term,
      source: input.source,
      origin: 'custom',
      enabled: true,
      ...(input.admissionBucket ? { admissionBucket: input.admissionBucket } : {}),
      ...(input.category ? { category: input.category } : {}),
      ...(input.action ? { action: input.action } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.detail ? { detail: input.detail } : {}),
      ...(input.suggestion ? { suggestion: input.suggestion } : {}),
      createdAt: now,
      updatedAt: now,
    };
    const result = this.commit(ruleId, 'created', context, undefined, rule, () => {
      this.database.orm.insert(ruleTerms).values(toRow(rule)).run();
    });
    return { version: result.version, rule };
  }

  update(
    before: ManagedRule,
    patch: UpdateRuleInput,
    context: RuleMutationContext,
  ): { version: number; rule: ManagedRule } {
    const after: ManagedRule = {
      ...before,
      ...(patch.term === undefined ? {} : { term: patch.term }),
      ...(patch.source === undefined ? {} : { source: patch.source }),
      ...(patch.admissionBucket === undefined ? {} : { admissionBucket: patch.admissionBucket }),
      ...(patch.category === undefined ? {} : { category: patch.category }),
      ...(patch.action === undefined ? {} : { action: patch.action }),
      ...(patch.title === undefined ? {} : { title: patch.title }),
      ...(patch.detail === undefined ? {} : { detail: patch.detail }),
      ...(patch.suggestion === undefined ? {} : { suggestion: patch.suggestion }),
      ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
      updatedAt: Date.now(),
    };
    // 只切换启停时，改动日志记 enabled/disabled 而不是笼统的 updated——回看
    // 「这条词什么时候被关掉的」是最常问的一个问题。
    const onlyToggled =
      patch.enabled !== undefined && Object.keys(patch).filter((key) => key !== 'enabled').length === 0;
    const action: RuleChangeAction = onlyToggled
      ? patch.enabled
        ? 'enabled'
        : 'disabled'
      : 'updated';

    const result = this.commit(before.ruleId, action, context, before, after, () => {
      this.database.orm.update(ruleTerms).set(toRow(after)).where(eq(ruleTerms.ruleId, before.ruleId)).run();
    });
    return { version: result.version, rule: after };
  }

  remove(before: ManagedRule, context: RuleMutationContext): { version: number } {
    const result = this.commit(before.ruleId, 'deleted', context, before, undefined, () => {
      this.database.orm.delete(ruleTerms).where(eq(ruleTerms.ruleId, before.ruleId)).run();
    });
    return { version: result.version };
  }

  /** 自定义词条的 ruleId。前缀与基线区分开，一眼看得出哪些是本台自己加的。 */
  nextCustomRuleId(scope: string): string {
    const prefix = scope === 'admission' ? 'AD-C' : 'PF-C';
    const existing = this.database.orm
      .select({ ruleId: ruleTerms.ruleId })
      .from(ruleTerms)
      .where(eq(ruleTerms.origin, 'custom'))
      .all()
      .map((row) => row.ruleId);
    let next = 1;
    // 从不复用已删除的号：改动日志里那个号指的是历史上的另一条词。
    const used = new Set(
      this.database.orm
        .select({ ruleId: ruleChangeLog.ruleId })
        .from(ruleChangeLog)
        .all()
        .map((row) => row.ruleId)
        .concat(existing),
    );
    while (used.has(`${prefix}-${String(next).padStart(2, '0')}`)) next += 1;
    return `${prefix}-${String(next).padStart(2, '0')}`;
  }
}
