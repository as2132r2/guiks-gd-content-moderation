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

    // 状态机守卫: 草稿只能先过入口准入，跳不到待初审。
    const illegalJump = await app.request(`/api/manuscripts/${id}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'first-review', actor: '编辑甲' }),
    });
    expect(illegalJump.status).toBe(409);

    const statusResponse = await app.request(`/api/manuscripts/${id}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'admitted', actor: '入口准入', role: 'system' }),
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
    expect(aggregate.manuscript.status).toBe('admitted');
    expect(aggregate.artifacts).toHaveLength(1);

    expect(aggregate.reviews).toHaveLength(1);
    expect(aggregate.trace).toHaveLength(5);
  });

  it('stores sentence origins and recomputes AI 参与度 on a rewrite', async () => {
    const created = (await (
      await postJson('/api/manuscripts', {
        title: '句级来源演示稿',
        sourceType: 'notice',
        sourceText: '模拟素材：县里召开会议。',
      })
    ).json()) as { manuscript: { id: string } };
    const id = created.manuscript.id;

    const artifactResponse = await postJson(`/api/manuscripts/${id}/artifacts`, {
      kind: 'broadcast-script',
      content: '两句生成，两句来自原文。',
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
    expect(artifact.aiShare).toBe(0.5);
    expect(artifact.origin).toBe('mixed');

    const rewriteResponse = await app.request(
      `/api/manuscripts/${id}/artifacts/${artifact.id}/segments`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          actor: '部门主任',
          segments: [
            { text: '第一句主任改过。', origin: 'ai-edited' },
            { text: '第二句主任重写。', origin: 'human' },
            { text: '第三句引自原通稿。', origin: 'source', sourceRef: '原文第 1 段' },
            { text: '第四句引自原通稿。', origin: 'source' },
          ],
        }),
      },
    );
    expect(rewriteResponse.status).toBe(200);

    expect(await rewriteResponse.json()).toMatchObject({
      artifact: { aiShare: 0.125, origin: 'mixed' },
    });

    const aggregate = (await (await app.request(`/api/manuscripts/${id}`)).json()) as {
      segments: Array<{ origin: string; ordinal: number }>;
      trace: Array<{ kind: string }>;
    };
    expect(aggregate.segments.map((segment) => segment.origin)).toEqual([
      'ai-edited',
      'human',
      'source',
      'source',
    ]);
    expect(aggregate.trace.map((event) => event.kind)).toContain('segments-recorded');

    const unknownArtifact = await app.request(
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
