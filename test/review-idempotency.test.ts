import { beforeAll, describe, expect, it } from 'vitest';

import { app } from '../src/index.js';
import type { WorkflowRole } from '../src/domain/contracts.js';
import { authenticatedRequest, loginAs } from './helpers/auth.js';

type Request = ReturnType<typeof authenticatedRequest>;

interface Aggregate {
  manuscript: { status: string; reviewRound: number };
  reviews: Array<{
    id: string;
    stage: string;
    decision: string;
    actor: string;
    actorUserId?: string;
    reason?: string;
    round: number;
  }>;
  trace: Array<{ kind: string; data: Record<string, unknown> }>;
}

let zhangmin: Request;
let lijianguo: Request;

beforeAll(async () => {
  zhangmin = authenticatedRequest(app, await loginAs(app, 'zhangmin'));
  lijianguo = authenticatedRequest(app, await loginAs(app, 'lijianguo'));
});

async function move(
  request: Request,
  id: string,
  to: string,
  role: WorkflowRole,
  extra: Record<string, string> = {},
): Promise<Response> {
  return request(`/api/workbench/${id}/transition`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to, role, ...extra }),
  });
}

async function createAtFirstReview(): Promise<string> {
  const created = await zhangmin('/api/workbench', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: '审核决定幂等测试稿',
      sourceType: 'notice',
      sourceText: '模拟素材：县里召开项目推进会，各部门汇报阶段进展。',
    }),
  });
  expect(created.status).toBe(201);
  const id = ((await created.json()) as { manuscript: { id: string } }).manuscript.id;
  for (const status of ['generated', 'preflight', 'first-review']) {
    const response = await move(zhangmin, id, status, 'editor');
    expect(response.status, status).toBe(200);
  }
  return id;
}

async function review(
  request: Request,
  id: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return request(`/api/manuscripts/${id}/reviews`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function aggregate(id: string): Promise<Aggregate> {
  const response = await zhangmin(`/api/manuscripts/${id}`);
  expect(response.status).toBe(200);
  return (await response.json()) as Aggregate;
}

const stageReviews = (value: Aggregate, stage: string) =>
  value.reviews.filter((item) => item.stage === stage);

const stageTrace = (value: Aggregate, stage: string) =>
  value.trace.filter(
    (event) => event.kind === 'review-recorded' && event.data.stage === stage,
  );

describe('one human review decision per stage and round', () => {
  it('reuses an identical retry without appending review or trace records', async () => {
    const id = await createAtFirstReview();
    const input = { stage: 'editor', decision: 'approved', actor: '客户端伪造姓名' };

    const first = await review(zhangmin, id, input);
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as {
      review: { id: string; actor: string; actorUserId?: string };
      reused: boolean;
      idempotent: boolean;
    };
    expect(firstBody).toMatchObject({ reused: false, idempotent: false });
    expect(firstBody.review).toMatchObject({
      actor: '编辑·张敏',
      actorUserId: 'user_demo_zhangmin',
    });

    const retried = await review(zhangmin, id, input);
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({
      review: { id: firstBody.review.id },
      reused: true,
      idempotent: true,
    });

    const after = await aggregate(id);
    expect(stageReviews(after, 'editor')).toHaveLength(1);
    expect(stageTrace(after, 'editor')).toHaveLength(1);
  });

  it('serializes concurrent identical writes at the repository boundary', async () => {
    const id = await createAtFirstReview();
    const input = { stage: 'editor', decision: 'approved' };
    const responses = await Promise.all([
      review(zhangmin, id, input),
      review(zhangmin, id, input),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);

    const after = await aggregate(id);
    expect(stageReviews(after, 'editor')).toHaveLength(1);
    expect(stageTrace(after, 'editor')).toHaveLength(1);
  });

  it('rejects a contradictory decision and leaves the active state unchanged', async () => {
    const id = await createAtFirstReview();
    const returned = await review(zhangmin, id, {
      stage: 'editor',
      decision: 'changes-requested',
      reason: '数字需要重新核对。',
    });
    expect(returned.status).toBe(201);

    const conflictingDirect = await review(zhangmin, id, {
      stage: 'editor',
      decision: 'approved',
    });
    expect(conflictingDirect.status).toBe(409);
    expect(await conflictingDirect.json()).toMatchObject({ error: 'review_decision_conflict' });

    const conflictingTransition = await move(zhangmin, id, 'second-review', 'editor');
    expect(conflictingTransition.status).toBe(409);
    expect(await conflictingTransition.json()).toMatchObject({
      error: 'review_decision_conflict',
    });

    const after = await aggregate(id);
    expect(after.manuscript.status).toBe('first-review');
    expect(stageReviews(after, 'editor')).toEqual([
      expect.objectContaining({
        decision: 'changes-requested',
        reason: '数字需要重新核对。',
        actorUserId: 'user_demo_zhangmin',
        round: 1,
      }),
    ]);
    expect(stageTrace(after, 'editor')).toHaveLength(1);
  });

  it('lets the canonical transition reuse a pre-recorded approval', async () => {
    const id = await createAtFirstReview();
    const saved = await review(zhangmin, id, { stage: 'editor', decision: 'approved' });
    expect(saved.status).toBe(201);

    const advanced = await move(zhangmin, id, 'second-review', 'editor');
    expect(advanced.status).toBe(200);

    const after = await aggregate(id);
    expect(after.manuscript.status).toBe('second-review');
    expect(stageReviews(after, 'editor')).toHaveLength(1);
    expect(stageReviews(after, 'editor')[0]).toMatchObject({
      decision: 'approved',
      actorUserId: 'user_demo_zhangmin',
    });
    expect(stageTrace(after, 'editor')).toHaveLength(1);
  });

  it('treats a different stable account as a conflicting actor', async () => {
    const id = await createAtFirstReview();
    expect((await move(zhangmin, id, 'second-review', 'editor')).status).toBe(200);
    const saved = await review(lijianguo, id, {
      stage: 'department-head',
      decision: 'approved',
    });
    expect(saved.status).toBe(201);

    const impersonatedRetry = await move(zhangmin, id, 'final-review', 'department-head');
    expect(impersonatedRetry.status).toBe(409);
    expect(await impersonatedRetry.json()).toMatchObject({
      error: 'review_decision_conflict',
    });

    const after = await aggregate(id);
    expect(after.manuscript.status).toBe('second-review');
    expect(stageReviews(after, 'department-head')).toEqual([
      expect.objectContaining({
        actor: '部门主任·李建国',
        actorUserId: 'user_demo_lijianguo',
      }),
    ]);
  });

  it('requires a return reason and rejects changes to substantive fields', async () => {
    const id = await createAtFirstReview();
    const missingReason = await review(zhangmin, id, {
      stage: 'editor',
      decision: 'changes-requested',
    });
    expect(missingReason.status).toBe(400);
    expect(await missingReason.json()).toMatchObject({ error: 'reason_required' });

    expect(
      (
        await review(zhangmin, id, {
          stage: 'editor',
          decision: 'changes-requested',
          reason: '请核对数据。',
        })
      ).status,
    ).toBe(201);
    const changedReason = await review(zhangmin, id, {
      stage: 'editor',
      decision: 'changes-requested',
      reason: '请核对姓名。',
    });
    expect(changedReason.status).toBe(409);
    expect(await changedReason.json()).toMatchObject({ error: 'review_decision_conflict' });
  });

  it('allows a new decision after revision increments the review round', async () => {
    const id = await createAtFirstReview();
    expect(
      (
        await move(zhangmin, id, 'revision', 'editor', {
          reason: '请修改后重新走三审。',
        })
      ).status,
    ).toBe(200);

    const workbench = (await (await zhangmin(`/api/workbench/${id}`)).json()) as {
      artifacts: Array<{
        artifact: { id: string };
        segments: Array<{ text: string }>;
      }>;
    };
    const artifact = workbench.artifacts[0]!;
    const revisedContent = artifact.segments
      .map((segment, index) =>
        index === 0 ? `${segment.text}（已按退回意见复核）` : segment.text,
      )
      .join('\n');
    expect(
      (
        await zhangmin(`/api/workbench/${id}/artifacts/${artifact.artifact.id}/revise`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ role: 'editor', content: revisedContent }),
        })
      ).status,
    ).toBe(200);

    expect((await move(zhangmin, id, 'preflight', 'editor')).status).toBe(200);
    expect((await move(zhangmin, id, 'first-review', 'editor')).status).toBe(200);

    const secondRound = await review(zhangmin, id, {
      stage: 'editor',
      decision: 'approved',
    });
    expect(secondRound.status).toBe(201);

    const after = await aggregate(id);
    expect(after.manuscript.reviewRound).toBe(2);
    expect(stageReviews(after, 'editor').map((item) => [item.round, item.decision])).toEqual([
      [1, 'changes-requested'],
      [2, 'approved'],
    ]);
  });

  it('fails closed for direct countersign records that would omit audit details', async () => {
    const id = await createAtFirstReview();
    expect((await move(zhangmin, id, 'second-review', 'editor')).status).toBe(200);
    expect((await move(zhangmin, id, 'countersign', 'department-head')).status).toBe(200);

    const direct = await review(zhangmin, id, {
      stage: 'countersign',
      decision: 'approved',
    });
    expect(direct.status).toBe(409);
    expect(await direct.json()).toMatchObject({ error: 'countersign_transition_required' });

    const after = await aggregate(id);
    expect(after.manuscript.status).toBe('countersign');
    expect(stageReviews(after, 'countersign')).toHaveLength(0);
  });
});
