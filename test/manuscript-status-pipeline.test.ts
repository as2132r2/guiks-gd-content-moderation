import { beforeAll, describe, expect, it } from 'vitest';

import { app } from '../src/index.js';
import type { WorkflowRole } from '../src/domain/contracts.js';
import { authenticatedRequest, loginAs } from './helpers/auth.js';

let request: ReturnType<typeof authenticatedRequest>;

beforeAll(async () => {
  request = authenticatedRequest(app, await loginAs(app));
});

describe('foundation status API uses the canonical workflow pipeline', () => {
  it('cannot publish by skipping artifacts, preflight, and human approvals', async () => {
    const created = await request('/api/workbench', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '底层状态防绕过稿',
        sourceType: 'notice',
        sourceText: '模拟素材：县里召开工作推进会，各部门汇报阶段进展。',
      }),
    });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { manuscript: { id: string } }).manuscript.id;

    const move = async (status: string, role: WorkflowRole) => {
      const response = await request(`/api/manuscripts/${id}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status, role }),
      });
      expect(response.status, `${role} -> ${status}`).toBe(200);
    };

    await move('generated', 'editor');
    await move('preflight', 'editor');
    await move('first-review', 'editor');
    await move('second-review', 'editor');
    await move('final-review', 'department-head');
    await move('signed', 'supervising-leader');
    await move('published', 'supervising-leader');

    const aggregate = (await (await request(`/api/manuscripts/${id}`)).json()) as {
      manuscript: { status: string };
      artifacts: unknown[];
      reviews: Array<{ stage: string; actorUserId?: string }>;
      trace: Array<{ kind: string }>;
    };
    expect(aggregate.manuscript.status).toBe('published');
    expect(aggregate.artifacts.length).toBeGreaterThan(0);
    expect(aggregate.reviews.map((review) => review.stage)).toEqual([
      'preflight',
      'editor',
      'department-head',
      'supervising-leader',
    ]);
    const humanReviews = aggregate.reviews.filter((review) => review.stage !== 'preflight');
    expect(humanReviews.every((review) => review.actorUserId === 'user_demo_zhangmin')).toBe(true);
    expect(aggregate.trace.some((event) => event.kind === 'signed')).toBe(true);
  });

  it('accepts a direct review only while that human stage is active', async () => {
    const created = await request('/api/workbench', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '底层审核阶段约束稿',
        sourceType: 'notice',
        sourceText: '模拟素材：县里召开项目调度会。',
      }),
    });
    const id = ((await created.json()) as { manuscript: { id: string } }).manuscript.id;
    for (const status of ['generated', 'preflight', 'first-review']) {
      const response = await request(`/api/manuscripts/${id}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status, role: 'editor' }),
      });
      expect(response.status, status).toBe(200);
    }

    const review = await request(`/api/manuscripts/${id}/reviews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        stage: 'editor',
        decision: 'approved',
        actor: '伪造姓名',
      }),
    });
    expect(review.status).toBe(201);
    expect(await review.json()).toMatchObject({
      review: { actor: '编辑·张敏', actorUserId: 'user_demo_zhangmin' },
    });
  });
});
