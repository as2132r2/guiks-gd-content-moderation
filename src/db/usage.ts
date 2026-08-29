/**
 * 使用限制的持久层。
 *
 * 放在 repository.ts 外面，理由和 [oversight.ts](oversight.ts)、
 * [ruleset.ts](ruleset.ts) 一样：那个文件已经太长。
 *
 * ————————————————————————————————————————————————————————————————
 * **为什么计数一定要落库。**
 *
 * `/api/usage`（[lib/store.ts](../lib/store.ts)）是内存环形缓冲，进程重启即清零。
 * 配额建在它上面，**重启就是一次免费续杯**——那不叫限制，叫摆设。所以这里另开
 * 一张 `usage_counters`，主键是（日期，账号）。
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';

import type {
  QuotaKind,
  UsageCounter,
  UsageLimitEvent,
  UsageLimits,
  UsageQuotaVerdict,
  UpdateUsageLimitsInput,
} from '../domain/usage-limit.js';
import type { DatabaseHandle } from './client.js';
import { usageCounters, usageLimitEvents, usageLimits, users } from './schema.js';

/**
 * 本地日期。
 *
 * 用本地时区而不是 UTC：额度是给编辑部按「今天」用的，跨了本地零点才该重置。
 * 用 UTC 的话北京时间早上八点就换了一天，谁都说不清额度什么时候归零。
 */
export function localDay(at = Date.now()): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export class UsageLimitStore {
  constructor(private readonly database: DatabaseHandle) {}

  limits(): UsageLimits {
    const row = this.database.orm
      .select()
      .from(usageLimits)
      .where(eq(usageLimits.id, 1))
      .get();
    return {
      ...(row?.dailyCalls === null || row?.dailyCalls === undefined
        ? {}
        : { dailyCalls: row.dailyCalls }),
      ...(row?.dailyTokens === null || row?.dailyTokens === undefined
        ? {}
        : { dailyTokens: row.dailyTokens }),
      updatedAt: row?.updatedAt ?? 0,
      ...(row?.updatedBy ? { updatedBy: row.updatedBy } : {}),
    };
  }

  setLimits(input: UpdateUsageLimitsInput, actor: string): UsageLimits {
    const current = this.limits();
    const next = {
      dailyCalls:
        input.dailyCalls === undefined ? (current.dailyCalls ?? null) : input.dailyCalls,
      dailyTokens:
        input.dailyTokens === undefined ? (current.dailyTokens ?? null) : input.dailyTokens,
      updatedAt: Date.now(),
      updatedBy: actor,
    };
    this.database.orm.update(usageLimits).set(next).where(eq(usageLimits.id, 1)).run();
    return this.limits();
  }

  counter(userId: string, day = localDay()): UsageCounter {
    const row = this.database.orm
      .select()
      .from(usageCounters)
      .where(and(eq(usageCounters.day, day), eq(usageCounters.userId, userId)))
      .get();
    return (
      row ?? { day, userId, calls: 0, tokensIn: 0, tokensOut: 0, updatedAt: 0 }
    );
  }

  /**
   * 这个账号现在还能不能调。
   *
   * 上限为空即不限——出厂默认就是两项都空，所以装上这一版之后行为一个字没变。
   */
  check(userId: string, day = localDay()): UsageQuotaVerdict {
    const limits = this.limits();
    const used = this.counter(userId, day);

    if (limits.dailyCalls !== undefined && used.calls >= limits.dailyCalls) {
      return { allowed: false, kind: 'calls', used: used.calls, limit: limits.dailyCalls, day };
    }
    const tokens = used.tokensIn + used.tokensOut;
    if (limits.dailyTokens !== undefined && tokens >= limits.dailyTokens) {
      return { allowed: false, kind: 'tokens', used: tokens, limit: limits.dailyTokens, day };
    }
    return { allowed: true, used: used.calls, day };
  }

  /**
   * 记一次已经完成的调用。
   *
   * **只记成功的**：上游 429 / 502 没产出任何东西，让它吃掉额度等于因为供应商
   * 出问题而惩罚编辑。
   */
  record(userId: string, tokensIn: number, tokensOut: number, day = localDay()): UsageCounter {
    const now = Date.now();
    this.database.sqlite
      .prepare(
        `INSERT INTO usage_counters (day, user_id, calls, tokens_in, tokens_out, updated_at)
         VALUES (?, ?, 1, ?, ?, ?)
         ON CONFLICT(day, user_id) DO UPDATE SET
           calls = calls + 1,
           tokens_in = tokens_in + excluded.tokens_in,
           tokens_out = tokens_out + excluded.tokens_out,
           updated_at = excluded.updated_at`,
      )
      .run(day, userId, Math.max(0, tokensIn), Math.max(0, tokensOut), now);
    return this.counter(userId, day);
  }

  recordBlocked(input: {
    userId?: string;
    actor: string;
    manuscriptId?: string;
    kind: QuotaKind;
    used: number;
    limit: number;
    day: string;
  }): UsageLimitEvent {
    const event: UsageLimitEvent = {
      id: randomUUID(),
      ...(input.userId ? { userId: input.userId } : {}),
      actor: input.actor,
      ...(input.manuscriptId ? { manuscriptId: input.manuscriptId } : {}),
      kind: input.kind,
      used: input.used,
      limit: input.limit,
      day: input.day,
      createdAt: Date.now(),
    };
    this.database.orm
      .insert(usageLimitEvents)
      .values({
        id: event.id,
        userId: input.userId ?? null,
        actor: event.actor,
        manuscriptId: input.manuscriptId ?? null,
        kind: event.kind,
        used: event.used,
        limitValue: event.limit,
        day: event.day,
        createdAt: event.createdAt,
      })
      .run();
    return event;
  }

  /** 今日各账号用量，带上显示名——台领导要看的是人，不是一串 id。 */
  today(day = localDay()): UsageCounter[] {
    return this.database.orm
      .select({
        day: usageCounters.day,
        userId: usageCounters.userId,
        calls: usageCounters.calls,
        tokensIn: usageCounters.tokensIn,
        tokensOut: usageCounters.tokensOut,
        updatedAt: usageCounters.updatedAt,
        displayName: users.displayName,
        username: users.username,
      })
      .from(usageCounters)
      .leftJoin(users, eq(users.id, usageCounters.userId))
      .where(eq(usageCounters.day, day))
      .all()
      .map((row) => ({
        day: row.day,
        userId: row.userId,
        calls: row.calls,
        tokensIn: row.tokensIn,
        tokensOut: row.tokensOut,
        updatedAt: row.updatedAt,
        ...(row.displayName ? { displayName: row.displayName } : {}),
        ...(row.username ? { username: row.username } : {}),
      }));
  }

  listBlocked(limit = 50): UsageLimitEvent[] {
    return this.database.orm
      .select()
      .from(usageLimitEvents)
      .orderBy(desc(usageLimitEvents.createdAt), desc(usageLimitEvents.id))
      .limit(limit)
      .all()
      .map((row) => ({
        id: row.id,
        ...(row.userId ? { userId: row.userId } : {}),
        actor: row.actor,
        ...(row.manuscriptId ? { manuscriptId: row.manuscriptId } : {}),
        kind: row.kind as QuotaKind,
        used: row.used,
        limit: row.limitValue,
        day: row.day,
        createdAt: row.createdAt,
      }));
  }
}
