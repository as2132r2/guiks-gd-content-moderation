/**
 * 演示夹具：重置与播种。
 *
 * ⚠️ **只在 `APP_MODE=demo` 下挂载**（见 [index.ts](../index.ts)）。
 * 清空整库的端点不该存在于生产构建里。
 *
 * 为什么不在这里播种一篇「已签发」的样例：走完整条链需要生成、预检与六次
 * 流转，那套副作用内联在 [workbench.ts](workbench.ts) 的 transition handler
 * 里。把它抽出来复用会和轨道 A 正在进行的状态机改造撞车，而重复实现一份
 * 迟早跟真链路走偏——**演示夹具一旦和真实流程不一致，就失去了它的全部意义**。
 * 所以主通稿在台上现场走一遍，这里只准备那些「创建即终局」的样例。
 */
import { Hono } from 'hono';
import { getWorkflowRepository } from '../db/repository.js';
import type { ContentSourceType } from '../domain/contracts.js';
import { mayPerformAs, workflowActorLabel } from '../domain/permissions.js';
import { requireAuth, type AuthEnv } from '../middleware/auth.js';
import { runAdmission } from '../rules/index.js';
import { DEMO_FIXTURES, MAIN_NOTICE, type DemoFixture } from './demo-fixtures.js';
import { admissionStatusOf } from './workbench.js';

export const demoRoutes = new Hono<AuthEnv>();

demoRoutes.use('/api/demo/*', requireAuth);

function createFixture(
  fixture: DemoFixture,
  actor: { label: string; userId: string },
) {
  const repository = getWorkflowRepository();
  const admission = runAdmission(fixture);
  const manuscript = repository.createManuscript(
    {
      title: fixture.title,
      sourceType: fixture.sourceType as ContentSourceType,
      sourceText: fixture.sourceText,
    },
    actor,
  );

  repository.appendTrace(manuscript.id, {
    kind: 'rule-hit',
    actorType: 'system',
    actor: '入口准入',
    data: {
      decision: admission.decision,
      reasonCode: admission.reasonCode,
      hits: admission.hits.map((hit) => hit.ruleId),
      offDutyUse: admission.offDutyUse ?? false,
      modelInvoked: admission.decision !== 'blocked',
    },
  });

  const updated = repository.updateStatus(manuscript.id, admissionStatusOf(admission), '入口准入');

  return {
    id: manuscript.id,
    label: fixture.label,
    title: fixture.title,
    status: (updated ?? manuscript).status,
    decision: admission.decision,
    reasonCode: admission.reasonCode,
  };
}

/** 清空全部稿件。彩排要反复重来。 */
demoRoutes.post('/api/demo/reset', (c) => {
  if (!mayPerformAs(c.get('currentUser'), 'editor', 'manuscript:create')) {
    return c.json({ error: 'role_not_allowed' }, 403);
  }
  const deleted = getWorkflowRepository().deleteAllManuscripts();
  return c.json({ deleted });
});

/** 重置后建好三组准入样例。主通稿留给台上现场投料。 */
demoRoutes.post('/api/demo/seed', (c) => {
  const user = c.get('currentUser');
  if (!mayPerformAs(user, 'editor', 'manuscript:create')) {
    return c.json({ error: 'role_not_allowed' }, 403);
  }
  const deleted = getWorkflowRepository().deleteAllManuscripts();
  // 倒序建立：列表按 updatedAt 倒序，倒着建才能让「要理由」排在最上面，
  // 和演示脚本 0:25 的讲解顺序一致。
  const actor = { label: workflowActorLabel(user, 'editor'), userId: user.id };
  const created = [...DEMO_FIXTURES]
    .reverse()
    .map((fixture) => createFixture(fixture, actor))
    .reverse();
  return c.json({ deleted, created });
});

/** 表单「填入示例」按钮取主通稿正文，免去现场粘贴 200 字。 */
demoRoutes.get('/api/demo/fixtures', (c) =>
  c.json({ mainNotice: MAIN_NOTICE, cases: DEMO_FIXTURES }),
);
