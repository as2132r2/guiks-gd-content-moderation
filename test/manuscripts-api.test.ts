import { describe, expect, it } from 'vitest';
import { app } from '../src/index.js';

const postJson = (path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('manuscript foundation API', () => {
  it('runs the persistent workflow from manuscript to trace', async () => {
    const createdResponse = await postJson('/api/manuscripts', {
      title: '县级融媒演示稿',
      sourceType: 'public-relations',
      sourceText: '模拟素材：某地举行山地文旅活动。',
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as { manuscript: { id: string } };
    const id = created.manuscript.id;

    expect(
      (
        await postJson(`/api/manuscripts/${id}/artifacts`, {
          kind: 'short-video-copy',
          content: '山地文旅活动今日启幕。',
          origin: 'ai',
          aiShare: 1,
          model: 'mock-model',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await postJson(`/api/manuscripts/${id}/reviews`, {
          stage: 'editor',
          decision: 'approved',
          actor: '编辑甲',
        })
      ).status,
    ).toBe(201);

    const statusResponse = await app.request(`/api/manuscripts/${id}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'first-review', actor: '编辑甲' }),
    });
    expect(statusResponse.status).toBe(200);

    expect(
      (
        await postJson(`/api/manuscripts/${id}/trace`, {
          kind: 'rule-hit',
          actorType: 'system',
          actor: 'preflight',
          data: { ruleId: 'demo-rule', result: 'pending-human-review' },
        })
      ).status,
    ).toBe(201);

    const aggregateResponse = await app.request(`/api/manuscripts/${id}`);
    const aggregate = (await aggregateResponse.json()) as {
      manuscript: { status: string };
      artifacts: unknown[];
      reviews: unknown[];
      trace: unknown[];
    };
    expect(aggregate.manuscript.status).toBe('first-review');
    expect(aggregate.artifacts).toHaveLength(1);
    expect(aggregate.reviews).toHaveLength(1);
    expect(aggregate.trace).toHaveLength(5);
  });

  it('returns stable validation and not-found errors', async () => {
    const invalid = await postJson('/api/manuscripts', {
      title: '',
      sourceType: 'video',
      sourceText: '',
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: 'invalid_request' });

    const missing = await app.request('/api/manuscripts/missing');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'manuscript_not_found' });
  });

  it('reports database and model readiness without exposing secrets', async () => {
    const response = await app.request('/readyz');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'ready',
      checks: { database: true, model: 'mock' },
    });

    const meta = await (await app.request('/api/meta')).text();
    expect(meta).not.toContain('UPSTREAM_KEY');
    expect(JSON.parse(meta)).toMatchObject({ persistence: 'sqlite', failClosed: true });
  });
});
