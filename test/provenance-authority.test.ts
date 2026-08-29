import { beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/index.js';
import { authenticatedRequest, loginAs } from './helpers/auth.js';

let request: ReturnType<typeof authenticatedRequest>;

beforeAll(async () => {
  request = authenticatedRequest(app, await loginAs(app));
});

const jsonRequest = (path: string, method: 'POST' | 'PUT', body: unknown) =>
  request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('server-owned artifact provenance', () => {
  it('ignores browser sentence labels and derives unchanged, edited, and new sentence origins', async () => {
    const createdResponse = await jsonRequest('/api/workbench', 'POST', {
      title: '来源真源回归稿',
      sourceType: 'notice',
      sourceText: '模拟素材：市里召开工作推进会，项目总投资 3.2亿元。',
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as { manuscript: { id: string } };
    const manuscriptId = created.manuscript.id;

    const generatedResponse = await jsonRequest(
      `/api/workbench/${manuscriptId}/transition`,
      'POST',
      { to: 'generated', role: 'editor' },
    );
    expect(generatedResponse.status).toBe(200);

    const generated = (await (await request(`/api/manuscripts/${manuscriptId}`)).json()) as {
      artifacts: Array<{ id: string; kind: string; aiShare?: number; model?: string }>;
      segments: Array<{ artifactId: string; text: string; origin: string }>;
      trace: Array<{
        kind: string;
        actorType: string;
        actor: string;
        actorUserId?: string;
        data: { artifactId?: string };
      }>;
    };
    const artifact = generated.artifacts.find((item) => item.kind === 'broadcast-script')!;
    const original = generated.segments.filter((segment) => segment.artifactId === artifact.id);
    expect(artifact.aiShare).toBe(1);
    expect(original.length).toBeGreaterThan(0);
    expect(original.every((segment) => segment.origin === 'ai')).toBe(true);

    const canonicalCreated = generated.trace.find(
      (event) => event.kind === 'artifact-created' && event.data.artifactId === artifact.id,
    );
    expect(canonicalCreated).toMatchObject({
      actorType: 'ai',
      actor: artifact.model,
    });
    expect(canonicalCreated?.actorUserId).toBeUndefined();

    const forgedUnchanged = await jsonRequest(
      `/api/manuscripts/${manuscriptId}/artifacts/${artifact.id}/segments`,
      'PUT',
      {
        actor: 'browser-claimed-system',
        segments: original.map((segment) => ({
          text: segment.text,
          origin: 'human',
          sourceRef: 'browser-claimed-source',
        })),
      },
    );
    expect(forgedUnchanged.status).toBe(200);
    expect(await forgedUnchanged.json()).toMatchObject({ artifact: { aiShare: 1, origin: 'ai' } });

    const afterUnchanged = (await (
      await request(`/api/manuscripts/${manuscriptId}`)
    ).json()) as typeof generated;
    const unchangedView = (await (
      await request(`/api/workbench/${manuscriptId}`)
    ).json()) as { aiShare: number };
    expect(unchangedView.aiShare).toBe(1);
    const unchanged = afterUnchanged.segments.filter(
      (segment) => segment.artifactId === artifact.id,
    );
    expect(unchanged.map((segment) => segment.origin)).toEqual(original.map(() => 'ai'));
    const unchangedTrace = afterUnchanged.trace
      .filter(
        (event) => event.kind === 'segments-recorded' && event.data.artifactId === artifact.id,
      )
      .at(-1);
    expect(unchangedTrace).toMatchObject({
      actorType: 'human',
      actor: '编辑·张敏',
      actorUserId: 'user_demo_zhangmin',
    });

    const revisedTexts = unchanged.map((segment) => segment.text);
    revisedTexts[0] = `${revisedTexts[0]}经编辑核对。`;
    revisedTexts.push('这是编辑全新补写的一句话。');
    const forgedRevision = await jsonRequest(
      `/api/manuscripts/${manuscriptId}/artifacts/${artifact.id}/segments`,
      'PUT',
      {
        segments: revisedTexts.map((text) => ({
          text,
          origin: 'ai',
          sourceRef: 'browser-claimed-ai',
        })),
      },
    );
    expect(forgedRevision.status).toBe(200);

    const revised = (await forgedRevision.json()) as {
      artifact: { aiShare?: number; origin: string };
      segments: Array<{ origin: string; sourceRef?: string }>;
    };
    expect(revised.segments[0]?.origin).toBe('ai-edited');
    expect(revised.segments.at(-1)).toMatchObject({ origin: 'human' });
    expect(revised.segments.at(-1)?.sourceRef).toBeUndefined();
    expect(revised.artifact.aiShare).toBeLessThan(1);
    expect(revised.artifact.origin).toBe('mixed');
    const revisedView = (await (
      await request(`/api/workbench/${manuscriptId}`)
    ).json()) as { aiShare: number };
    expect(revisedView.aiShare).toBeLessThan(1);
  });

  it('treats browser artifact creation as a stable authenticated human action', async () => {
    const createdResponse = await jsonRequest('/api/manuscripts', 'POST', {
      title: '浏览器产物来源回归稿',
      sourceType: 'notice',
      sourceText: '原通稿原句。',
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as { manuscript: { id: string } };

    const artifactResponse = await jsonRequest(
      `/api/manuscripts/${created.manuscript.id}/artifacts`,
      'POST',
      {
        kind: 'broadcast-script',
        content: '原通稿原句。\n编辑补写一句。',
        origin: 'ai',
        aiShare: 1,
        model: 'browser-claimed-system',
        actorType: 'system',
        segments: [
          { text: '原通稿原句。', origin: 'ai', sourceRef: 'browser-claimed-ai' },
          { text: '编辑补写一句。', origin: 'ai', sourceRef: 'browser-claimed-ai' },
        ],
      },
    );
    expect(artifactResponse.status).toBe(201);
    const { artifact } = (await artifactResponse.json()) as {
      artifact: { id: string; origin: string; aiShare?: number; model?: string };
    };
    expect(artifact).toMatchObject({ origin: 'human', aiShare: 0 });
    expect(artifact.model).toBeUndefined();

    const aggregate = (await (
      await request(`/api/manuscripts/${created.manuscript.id}`)
    ).json()) as {
      segments: Array<{ artifactId: string; origin: string; sourceRef?: string }>;
      trace: Array<{
        kind: string;
        actorType: string;
        actor: string;
        actorUserId?: string;
        data: Record<string, unknown>;
      }>;
    };
    expect(
      aggregate.segments
        .filter((segment) => segment.artifactId === artifact.id)
        .map((segment) => ({ origin: segment.origin, sourceRef: segment.sourceRef })),
    ).toEqual([
      { origin: 'source', sourceRef: '原通稿' },
      { origin: 'human', sourceRef: undefined },
    ]);

    const createdTrace = aggregate.trace.find(
      (event) => event.kind === 'artifact-created' && event.data.artifactId === artifact.id,
    );
    expect(createdTrace).toMatchObject({
      actorType: 'human',
      actor: '编辑·张敏',
      actorUserId: 'user_demo_zhangmin',
      data: { origin: 'human', aiShare: 0 },
    });
    expect(createdTrace?.actor).not.toContain('browser-claimed-system');
    expect(JSON.stringify(createdTrace?.data)).not.toContain('browser-claimed-system');
  });
});
