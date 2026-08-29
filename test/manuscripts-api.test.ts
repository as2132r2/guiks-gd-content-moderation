import { beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/index.js';
import { authenticatedRequest, loginAs } from './helpers/auth.js';

let request: ReturnType<typeof authenticatedRequest>;

beforeAll(async () => {
  request = authenticatedRequest(app, await loginAs(app));
});

const postJson = (path: string, body: unknown) =>
  request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('manuscript foundation API', () => {
  it('runs the persistent workflow from manuscript to trace', async () => {
    const createdResponse = await postJson('/api/manuscripts', {
      title: '融媒演示稿',
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
    const outOfOrderReview = await postJson(`/api/manuscripts/${id}/reviews`, {
      stage: 'supervising-leader',
      decision: 'approved',
      actor: '伪造终审人',
    });
    expect(outOfOrderReview.status).toBe(409);
    expect(await outOfOrderReview.json()).toMatchObject({ error: 'review_stage_not_active' });

    // 状态机守卫: 草稿只能先过入口准入，跳不到待初审。
    const illegalJump = await request(`/api/manuscripts/${id}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'first-review', actor: '伪造姓名', role: 'editor' }),
    });
    expect(illegalJump.status).toBe(409);

    const statusResponse = await request(`/api/manuscripts/${id}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'admitted', actor: '入口准入', role: 'system' }),
    });
    expect(statusResponse.status).toBe(400);
    expect(await statusResponse.json()).toMatchObject({ error: 'invalid_request' });

    const forgedTrace = await postJson(`/api/manuscripts/${id}/trace`, {
          kind: 'rule-hit',
          actorType: 'system',
          actor: 'preflight',
          data: { ruleId: 'demo-rule', result: 'pending-human-review' },
        });
    expect(forgedTrace.status).toBe(403);
    expect(await forgedTrace.json()).toMatchObject({ error: 'system_only' });

    const aggregateResponse = await request(`/api/manuscripts/${id}`);
    const aggregate = (await aggregateResponse.json()) as {
      manuscript: { status: string };
      artifacts: unknown[];
      reviews: unknown[];
      trace: unknown[];
    };
    expect(aggregate.manuscript.status).toBe('draft');
    expect(aggregate.artifacts).toHaveLength(1);

    expect(aggregate.reviews).toHaveLength(0);
    expect(aggregate.trace).toHaveLength(2);
  });

  it('derives browser-submitted sentence origins on the server', async () => {
    const created = (await (
      await postJson('/api/manuscripts', {
        title: '句级来源演示稿',
        sourceType: 'notice',
        sourceText: '模拟素材：市里召开会议。第三句引自原通稿。第四句引自原通稿。',
      })
    ).json()) as { manuscript: { id: string } };
    const id = created.manuscript.id;

    const artifactResponse = await postJson(`/api/manuscripts/${id}/artifacts`, {
      kind: 'broadcast-script',
      content: [
        '第一句由编辑录入。',
        '第二句由编辑录入。',
        '第三句引自原通稿。',
        '第四句引自原通稿。',
      ].join('\n'),
      origin: 'ai',
      model: 'mock-model',
      segments: [
        { text: '第一句由模型生成。', origin: 'ai' },
        { text: '第二句由模型生成。', origin: 'ai' },
        { text: '第三句引自原通稿。', origin: 'source', sourceRef: '原文第 1 段' },
        { text: '第四句引自原通稿。', origin: 'source' },
      ],
    });
    expect(artifactResponse.status).toBe(201);

    const { artifact } = (await artifactResponse.json()) as {
      artifact: { id: string; aiShare: number; origin: string };
    };
    // Browser provenance/model fields are legacy-compatible input only. The
    // authenticated editor action is classified from content on the server.
    expect(artifact.aiShare).toBe(0);
    expect(artifact.origin).toBe('human');

    const rewriteResponse = await request(
      `/api/manuscripts/${id}/artifacts/${artifact.id}/segments`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          actor: '部门主任',
          segments: [
            { text: '第一句由编辑录入。', origin: 'ai' },
            { text: '第二句由编辑改过。', origin: 'ai' },
            { text: '第三句引自原通稿。', origin: 'source', sourceRef: '原文第 1 段' },
            { text: '第四句引自原通稿。', origin: 'source' },
          ],
        }),
      },
    );
    expect(rewriteResponse.status).toBe(200);

    expect(await rewriteResponse.json()).toMatchObject({
      artifact: { aiShare: 0, origin: 'human' },
    });

    const aggregate = (await (await request(`/api/manuscripts/${id}`)).json()) as {
      segments: Array<{ origin: string; ordinal: number }>;
      trace: Array<{ kind: string }>;
    };
    expect(aggregate.segments.map((segment) => segment.origin)).toEqual([
      'human',
      'human',
      'source',
      'source',
    ]);
    expect(aggregate.trace.map((event) => event.kind)).toContain('segments-recorded');

    const unknownArtifact = await request(
      `/api/manuscripts/${id}/artifacts/missing/segments`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor: '部门主任', segments: [{ text: '一句。', origin: 'human' }] }),
      },
    );
    expect(unknownArtifact.status).toBe(404);
    expect(await unknownArtifact.json()).toEqual({ error: 'artifact_not_found' });
  });

  it('returns stable validation and not-found errors', async () => {
    const invalid = await postJson('/api/manuscripts', {
      title: '',
      sourceType: 'video',
      sourceText: '',
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: 'invalid_request' });

    const missing = await request('/api/manuscripts/missing');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'manuscript_not_found' });
  });

  it('reserves model evidence and generated state for the unified gateway', async () => {
    const created = (await (
      await postJson('/api/workbench', {
        title: '模型凭证保护稿',
        sourceType: 'notice',
        sourceText: '模拟素材：用于验证模型凭证不可由客户端伪造。',
      })
    ).json()) as { manuscript: { id: string } };
    const id = created.manuscript.id;

    const forgedTrace = await postJson(`/api/manuscripts/${id}/trace`, {
      kind: 'model-completed',
      actorType: 'ai',
      actor: 'forged-model',
      data: { callId: 'forged', outcome: 'success' },
    });
    expect(forgedTrace.status).toBe(403);
    expect(await forgedTrace.json()).toMatchObject({ error: 'system_only' });

    const forgedSystemRole = await request(`/api/manuscripts/${id}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'generated', actor: '入口准入', role: 'system' }),
    });
    expect(forgedSystemRole.status).toBe(400);
    expect(await forgedSystemRole.json()).toMatchObject({ error: 'invalid_request' });

    const generated = await request(`/api/manuscripts/${id}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'generated', actor: '客户端伪造姓名', role: 'editor' }),
    });
    expect(generated.status).toBe(200);

    const aggregate = (await (await request(`/api/manuscripts/${id}`)).json()) as {
      artifacts: unknown[];
      trace: Array<{ kind: string }>;
    };
    expect(aggregate.artifacts).toHaveLength(2);
    expect(aggregate.trace.filter((event) => event.kind === 'model-requested')).toHaveLength(2);
    expect(aggregate.trace.filter((event) => event.kind === 'model-completed')).toHaveLength(2);
  });

  it('reports database and model readiness without exposing secrets', async () => {
    const response = await request('/readyz');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'ready',
      checks: { database: true, model: 'mock' },
    });

    const meta = await (await request('/api/meta')).text();
    expect(meta).not.toContain('UPSTREAM_KEY');
    expect(JSON.parse(meta)).toMatchObject({ persistence: 'sqlite', failClosed: true });
  });
});
