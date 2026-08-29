/**
 * 判定依据管理 —— 词表的增删改、启停、档位与改动史。
 *
 * 这是工作台**真正在用**的那份词表。⚠️ 别和 `/policy` 搞混：那一套作用在
 * [lib/detectors.ts](../lib/detectors.ts) 的遗留规格上，是内存态，进程重启即失，
 * 且不作用于入口准入与输出预检。
 *
 * ————————————————————————————————————————————————————————————————
 * **三条不肯让步的规矩：**
 *
 * 1. **出处必填。** 说不出出处的判定依据不该存在——这是这套词表在评委面前唯一
 *    站得住的地方，落库之后必须由服务端校验，不能只是前端提示。
 * 2. **理由必填。** 不拦你改，但你得说得清为什么改。和「要理由」那一档同一个道理。
 * 3. **内置基线删不掉、词面与出处改不了**，只能停用或改档位，而且停用也留痕。
 */
import { Hono } from 'hono';
import { z } from 'zod';

import { getWorkflowRepository } from '../db/repository.js';
import { annotationCategories, preflightActions } from '../domain/gatekeeping.js';
import { hasPermission } from '../domain/permissions.js';
import {
  admissionBuckets,
  ruleScopes,
  type ManagedRule,
  type RuleScope,
} from '../domain/ruleset.js';
import { readSessionUser } from '../lib/session.js';
import { requireAuth, type AuthEnv } from '../middleware/auth.js';
import { assessBlockBucket, builtinEngineRules } from '../rules/ruleset.js';
import { renderRules } from '../views/rules-view.js';

export const rulesRoutes = new Hono<AuthEnv>();

const trimmed = (max: number) => z.string().trim().min(1).max(max);

/** 理由与出处的下限刻意不是 1：一个字的「改」等于没说。 */
const reason = z.string().trim().min(4).max(500);
const source = z.string().trim().min(4).max(300);

const createSchema = z
  .object({
    scope: z.enum(ruleScopes),
    term: trimmed(60),
    source,
    reason,
    acknowledge: z.boolean().optional(),
    admissionBucket: z.enum(admissionBuckets).optional(),
    category: z.enum(annotationCategories).optional(),
    action: z.enum(preflightActions).optional(),
    title: trimmed(120).optional(),
    detail: trimmed(500).optional(),
    suggestion: trimmed(120).optional(),
  })
  .superRefine((value, context) => {
    if (value.scope === 'admission' && !value.admissionBucket) {
      context.addIssue({ code: 'custom', path: ['admissionBucket'], message: '入口准入词条必须指定档位。' });
    }
    if (value.scope === 'preflight' && (!value.category || !value.action)) {
      context.addIssue({ code: 'custom', path: ['category'], message: '输出预检词条必须指定类目与动作。' });
    }
  });

const updateSchema = z.object({
  reason,
  acknowledge: z.boolean().optional(),
  term: trimmed(60).optional(),
  source: source.optional(),
  admissionBucket: z.enum(admissionBuckets).optional(),
  category: z.enum(annotationCategories).optional(),
  action: z.enum(preflightActions).optional(),
  title: trimmed(120).optional(),
  detail: trimmed(500).optional(),
  suggestion: trimmed(120).optional(),
  enabled: z.boolean().optional(),
});

const deleteSchema = z.object({ reason });

const badRequest = (issues: z.core.$ZodIssue[]) => ({
  error: 'invalid_request',
  issues: issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
});

async function readJson(request: { json: () => Promise<unknown> }): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

rulesRoutes.use('/api/rules', requireAuth);
rulesRoutes.use('/api/rules/*', requireAuth);

/** 写操作只给台领导。判定依据谁都能改，就等于谁都不负责。 */
const requireRulesWrite = (c: { get: (key: 'currentUser') => Parameters<typeof hasPermission>[0] }) =>
  hasPermission(c.get('currentUser'), 'rules:write');

const writeDenied = {
  error: 'role_not_allowed',
  message: '只有台领导可以改判定依据，其余角色为只读。',
} as const;

// 页面本身也先认人再渲染，和 /console、/monitor 一个写法。
rulesRoutes.get('/rules', async (c) => {
  const user = await readSessionUser(c);
  if (!user) return c.redirect('/login?next=/rules');
  if (!hasPermission(user, 'rules:read')) return c.json({ error: 'role_not_allowed' }, 403);
  return c.html(renderRules());
});

rulesRoutes.get('/api/rules', (c) => {
  const user = c.get('currentUser');
  if (!hasPermission(user, 'rules:read')) return c.json({ error: 'role_not_allowed' }, 403);
  const snapshot = getWorkflowRepository().ruleset.snapshot();
  return c.json({
    ...snapshot,
    // 不落库的那部分也要列全，否则管理员会以为词表就是判定的全部。
    engineRules: builtinEngineRules(),
    canWrite: hasPermission(user, 'rules:write'),
  });
});

rulesRoutes.get('/api/rules/changes', (c) => {
  if (!hasPermission(c.get('currentUser'), 'rules:read')) {
    return c.json({ error: 'role_not_allowed' }, 403);
  }
  const ruleId = c.req.query('ruleId');
  const changes = getWorkflowRepository().ruleset.listChanges(100, ruleId || undefined);
  return c.json({ changes });
});

/**
 * 硬拦档自检。
 *
 * 命中警示且未显式确认就 409——**不禁止，但留下知情的证据**。误拦一条是编辑
 * 当场没法工作，漏拦一条最多是留痕里多一条记录。
 */
function blockBucketGate(
  term: string,
  bucket: string | undefined,
  acknowledged: boolean,
): { blocked: true; message: string } | { blocked: false; acknowledgedWarning?: string } {
  if (bucket !== 'block') return { blocked: false };
  const reasonLane = getWorkflowRepository().ruleset.termsInAdmissionBucket('reason');
  const warning = assessBlockBucket(term, reasonLane);
  if (!warning) return { blocked: false };
  if (!acknowledged) return { blocked: true, message: warning.message };
  return { blocked: false, acknowledgedWarning: warning.message };
}

rulesRoutes.post('/api/rules', async (c) => {
  if (!requireRulesWrite(c)) return c.json(writeDenied, 403);
  const parsed = createSchema.safeParse(await readJson(c.req));
  if (!parsed.success) return c.json(badRequest(parsed.error.issues), 400);

  const store = getWorkflowRepository().ruleset;
  const { reason: why, acknowledge, ...input } = parsed.data;

  const duplicate = store
    .snapshot()
    .rules.find((rule) => rule.scope === input.scope && rule.term === input.term);
  if (duplicate) {
    return c.json(
      {
        error: 'rule_already_exists',
        message: `「${input.term}」已存在（${duplicate.ruleId}）。请改那一条，别加重复的。`,
        ruleId: duplicate.ruleId,
      },
      409,
    );
  }

  const gate = blockBucketGate(input.term, input.admissionBucket, acknowledge === true);
  if (gate.blocked) {
    return c.json({ error: 'block_bucket_confirmation_required', message: gate.message }, 409);
  }

  const user = c.get('currentUser');
  const created = store.create(store.nextCustomRuleId(input.scope), input, {
    userId: user.id,
    actor: user.displayName,
    reason: why,
    ...(gate.blocked === false && gate.acknowledgedWarning
      ? { acknowledgedWarning: gate.acknowledgedWarning }
      : {}),
  });
  return c.json(created, 201);
});

rulesRoutes.patch('/api/rules/:ruleId', async (c) => {
  if (!requireRulesWrite(c)) return c.json(writeDenied, 403);
  const parsed = updateSchema.safeParse(await readJson(c.req));
  if (!parsed.success) return c.json(badRequest(parsed.error.issues), 400);

  const store = getWorkflowRepository().ruleset;
  const before = store.findRule(c.req.param('ruleId'));
  if (!before) return c.json({ error: 'rule_not_found' }, 404);

  const { reason: why, acknowledge, ...patch } = parsed.data;

  // 基线是「说得出出处」的那份底。改了词面或出处，它就不是那条基线了。
  if (before.origin === 'builtin' && (patch.term !== undefined || patch.source !== undefined)) {
    return c.json(
      {
        error: 'builtin_rule_immutable',
        message: '内置基线的词面与出处不可修改——改了它就不是那条基线了。可以停用，或改档位。',
      },
      409,
    );
  }

  const gate = blockBucketGate(
    patch.term ?? before.term,
    patch.admissionBucket ?? before.admissionBucket,
    acknowledge === true,
  );
  // 只是停用一条硬拦词不该被自检拦住——自检守的是「往硬拦档塞题材词」这个方向。
  const tighteningIntoBlock = patch.admissionBucket === 'block' || patch.term !== undefined;
  if (gate.blocked && tighteningIntoBlock) {
    return c.json({ error: 'block_bucket_confirmation_required', message: gate.message }, 409);
  }

  const user = c.get('currentUser');
  const updated = store.update(before, patch, {
    userId: user.id,
    actor: user.displayName,
    reason: why,
    ...(gate.blocked === false && gate.acknowledgedWarning
      ? { acknowledgedWarning: gate.acknowledgedWarning }
      : {}),
  });
  return c.json(updated);
});

rulesRoutes.delete('/api/rules/:ruleId', async (c) => {
  if (!requireRulesWrite(c)) return c.json(writeDenied, 403);
  const parsed = deleteSchema.safeParse(await readJson(c.req));
  if (!parsed.success) return c.json(badRequest(parsed.error.issues), 400);

  const store = getWorkflowRepository().ruleset;
  const before = store.findRule(c.req.param('ruleId'));
  if (!before) return c.json({ error: 'rule_not_found' }, 404);
  if (before.origin === 'builtin') {
    return c.json(
      {
        error: 'builtin_rule_immutable',
        message:
          '内置基线不可删除——「基线是什么」必须永远查得回去。不想让它生效请停用，停用也留痕。',
      },
      409,
    );
  }

  const user = c.get('currentUser');
  const result = store.remove(before, {
    userId: user.id,
    actor: user.displayName,
    reason: parsed.data.reason,
  });
  return c.json(result);
});

/** 界面分组用。词条的 scope 决定它归哪一屏。 */
export const scopeOf = (rule: ManagedRule): RuleScope => rule.scope;
