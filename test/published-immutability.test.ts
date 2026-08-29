import { beforeAll, describe, expect, it } from 'vitest';

import { getWorkflowRepository } from '../src/db/repository.js';
import type { ManuscriptStatus, TraceEvent } from '../src/domain/contracts.js';
import {
  manuscriptContentMutationStatuses,
  mayMutateManuscriptContent,
} from '../src/domain/mutation-policy.js';
import { app } from '../src/index.js';
import type { WorkbenchView } from '../src/routes/workbench.js';
import { authenticatedRequest, loginAs } from './helpers/auth.js';

let request: ReturnType<typeof authenticatedRequest>;

beforeAll(async () => {
  request = authenticatedRequest(app, await loginAs(app));
});

const jsonRequest = (path: string, method: 'POST' | 'PUT' | 'PATCH', body: unknown) =>
  request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const move = (id: string, to: ManuscriptStatus, role: string) =>
  jsonRequest(`/api/workbench/${id}/transition`, 'POST', { to, role });

const readView = async (id: string): Promise<WorkbenchView> =>
  (await (await request(`/api/workbench/${id}`)).json()) as WorkbenchView;

describe('稿件内容写入策略', () => {
  it('uses explicit operation-specific allow-lists with no status fallback', () => {
    expect(manuscriptContentMutationStatuses).toEqual({
      'foundation-artifact-create': ['draft'],
      'foundation-segments-replace': ['draft', 'generated', 'revision'],
      'workbench-artifact-revise': ['generated', 'revision'],
    });

    for (const status of [
      'admission-blocked',
      'admission-reason-required',
      'admitted',
      'preflight',
      'first-review',
      'second-review',
      'countersign',
      'final-review',
      'signed',
      'published',
    ] as const) {
      expect(mayMutateManuscriptContent(status, 'foundation-artifact-create')).toBe(false);
      expect(mayMutateManuscriptContent(status, 'foundation-segments-replace')).toBe(false);
      expect(mayMutateManuscriptContent(status, 'workbench-artifact-revise')).toBe(false);
    }
  });

  it('freezes all public content writes after a real-cookie workflow is published', async () => {
    const created = await jsonRequest('/api/workbench', 'POST', {
      title: '发布后不可改写回归稿',
      sourceType: 'notice',
      sourceText: '模拟素材：县里召开项目推进会，各责任单位汇报阶段进展。',
    });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { manuscript: { id: string } }).manuscript.id;

    expect((await move(id, 'generated', 'editor')).status).toBe(200);
    const generated = await readView(id);
    const script = generated.artifacts[0]!;
    const revisedSentences = script.segments.map((segment) => segment.text);
    revisedSentences[0] = `${revisedSentences[0]}（编辑已核改）`;
    expect(
      (
        await jsonRequest(
          `/api/workbench/${id}/artifacts/${script.artifact.id}/revise`,
          'POST',
          { role: 'editor', content: revisedSentences.join('\n') },
        )
      ).status,
    ).toBe(200);

    for (const [to, role] of [
      ['preflight', 'editor'],
      ['first-review', 'editor'],
      ['second-review', 'editor'],
      ['final-review', 'department-head'],
      ['signed', 'supervising-leader'],
    ] as const) {
      const response = await move(id, to, role);
      expect(response.status, `${role} -> ${to}`).toBe(200);
    }

    const signedView = await readView(id);
    expect(signedView.manuscript.status).toBe('signed');
    expect(signedView.contentEditable).toBe(false);
    expect(signedView.signOff?.aiShare).toBeLessThan(1);

    type AggregateSnapshot = {
      artifacts: Array<{ id: string; content: string }>;
      segments: Array<{ artifactId: string; ordinal: number; text: string; origin: string }>;
      trace: TraceEvent[];
    };
    const readAggregate = async () =>
      (await (await request(`/api/manuscripts/${id}`)).json()) as AggregateSnapshot;
    const assertFrozen = async (before: AggregateSnapshot) => {
      const attempts = [
        await jsonRequest(
          `/api/workbench/${id}/artifacts/${script.artifact.id}/revise`,
          'POST',
          { role: 'editor', content: '签发后伪造改稿。' },
        ),
        await jsonRequest(`/api/manuscripts/${id}/artifacts`, 'POST', {
          kind: 'short-video-copy',
          content: '签发后伪造新增产物。',
          origin: 'human',
        }),
        await jsonRequest(
          `/api/manuscripts/${id}/artifacts/${script.artifact.id}/segments`,
          'PUT',
          { segments: [{ text: '签发后伪造替换正文。', origin: 'human' }] },
        ),
      ];

      for (const response of attempts) {
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({
          error: 'manuscript_not_editable',
          message: '稿件当前状态不允许修改内容。',
        });
      }

      const after = await readAggregate();
      expect(after.artifacts).toEqual(before.artifacts);
      expect(after.segments).toEqual(before.segments);
      expect(after.trace).toEqual(before.trace);
    };

    const signedAggregate = await readAggregate();
    const signedEvent = signedAggregate.trace.find((event) => event.kind === 'signed')!;
    expect(signedEvent.data.aiShare).toBe(signedView.signOff?.aiShare);
    expect(signedEvent.data.segmentCount).toBe(signedAggregate.segments.length);
    await assertFrozen(signedAggregate);

    expect((await move(id, 'published', 'supervising-leader')).status).toBe(200);
    const publishedView = await readView(id);
    expect(publishedView.manuscript.status).toBe('published');
    expect(publishedView.contentEditable).toBe(false);
    expect(publishedView.signOff).toEqual(signedView.signOff);

    const publishedAggregate = await readAggregate();
    await assertFrozen(publishedAggregate);

    const afterView = await readView(id);
    expect(afterView.aiShare).toBe(publishedView.aiShare);
    expect(afterView.signOff).toEqual(publishedView.signOff);
  });

  it('reads the sign-off AI share from the signed trace snapshot, not live content', async () => {
    const created = await jsonRequest('/api/manuscripts', 'POST', {
      title: '签发快照读取夹具',
      sourceType: 'notice',
      sourceText: '模拟素材：用于验证签发快照读取。',
    });
    const id = ((await created.json()) as { manuscript: { id: string } }).manuscript.id;
    const artifactResponse = await jsonRequest(`/api/manuscripts/${id}/artifacts`, 'POST', {
      kind: 'broadcast-script',
      content: '第一句。\n第二句。',
      origin: 'ai',
      segments: [
        { text: '第一句。', origin: 'ai' },
        { text: '第二句。', origin: 'ai' },
      ],
    });
    const artifactId = ((await artifactResponse.json()) as { artifact: { id: string } }).artifact.id;

    getWorkflowRepository().appendTrace(id, {
      kind: 'signed',
      actorType: 'human',
      actor: '分管领导·快照夹具',
      data: { from: 'final-review', to: 'signed', round: 1, aiShare: 0.25, segmentCount: 2 },
    });

    const replacement = await jsonRequest(
      `/api/manuscripts/${id}/artifacts/${artifactId}/segments`,
      'PUT',
      { segments: [{ text: '现在正文完全由人工改写。', origin: 'human' }] },
    );
    expect(replacement.status).toBe(200);

    const view = await readView(id);
    expect(view.aiShare).toBe(0);
    expect(view.signOff).toMatchObject({
      actor: '分管领导·快照夹具',
      aiShare: 0.25,
    });
  });
});
