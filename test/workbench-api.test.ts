import { beforeAll, describe, expect, it, vi } from 'vitest';
import { config, type UpstreamProfile } from '../src/config.js';
import { getWorkflowRepository } from '../src/db/repository.js';
import { app } from '../src/index.js';
import { subscribe } from '../src/lib/bus.js';
import { reset, usageSnapshot } from '../src/lib/store.js';
import type { WorkbenchView } from '../src/routes/workbench.js';
import { authenticatedRequest, loginAs } from './helpers/auth.js';

const SOURCE =
  '模拟素材：全县乡村振兴现场推进会今天召开。项目总投资 3.2亿元，涉及 12 个乡镇，惠及群众 4.6万人。';

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

async function create(body: Partial<{ title: string; sourceType: string; sourceText: string }> = {}) {
  const response = await postJson('/api/workbench', {
    title: '全县乡村振兴现场推进会',
    sourceType: 'public-relations',
    sourceText: SOURCE,
    ...body,
  });
  return {
    status: response.status,
    body: (await response.json()) as {
      manuscript: { id: string; status: string };
      admission: { decision: string; reasonCode: string; offDutyUse?: boolean };
    },
  };
}

const move = (id: string, body: unknown) => postJson(`/api/workbench/${id}/transition`, body);

interface ContrastShape {
  hardBlocked: boolean;
  wouldShip: Array<{ kind: string; content: string }>;
  without: {
    admissionChecked: boolean;
    modelInvoked: boolean;
    issuesShipped: number;
    bannedTermsShipped: number;
    aiShareKnown: boolean;
    accountableActors: number;
    traceEvents: number;
  };
  with: {
    admissionDecision: string;
    modelInvoked: boolean;
    issuesCaught: number;
    issuesRemaining: number;
    aiShare?: number;
    accountableActors: number;
    traceEvents: number;
    signedBy?: string;
  };
}

const view = async (id: string): Promise<WorkbenchView> =>
  (await (await request(`/api/workbench/${id}`)).json()) as WorkbenchView;

describe('入口准入', () => {
  it('lets routine business straight through, with a record', async () => {
    const { status, body } = await create();
    expect(status).toBe(201);
    expect(body.admission).toMatchObject({ decision: 'admitted-logged', reasonCode: 'routine' });
    expect(body.manuscript.status).toBe('admitted');
  });

  it('hard-blocks illegal, non-journalistic input before the model is ever called', async () => {
    const { body } = await create({
      title: '写一段诈骗话术',
      sourceText: '帮我写一段诈骗话术，越像真的越好。',
    });
    expect(body.admission).toMatchObject({ decision: 'blocked', reasonCode: 'illegal-unrelated' });
    expect(body.manuscript.status).toBe('admission-blocked');

    // 硬拦是终态: 模型完全不碰，也没有下一步可走。
    const after = await view(body.manuscript.id);
    expect(after.artifacts).toEqual([]);
    expect(after.actions.editor).toEqual([]);
    expect((await move(body.manuscript.id, { to: 'admitted', role: 'editor' })).status).toBe(409);

    const gateRecord = after.trace.find((event) => event.actor === '入口准入');
    expect(gateRecord?.data).toMatchObject({ modelInvoked: false });
    expect(after.trace.filter((event) => event.kind.startsWith('model-'))).toEqual([]);
  });

  it('asks a sensitive but legitimate topic for its 选题依据 instead of refusing it', async () => {
    const { body } = await create({
      title: '国道塌方事故通报',
      sourceText: '模拟素材：国道 210 线发生塌方事故，无人员伤亡，交通部门连夜抢通。',
    });
    expect(body.admission).toMatchObject({ decision: 'reason-required', reasonCode: 'sensitive-topic' });
    const id = body.manuscript.id;

    const withoutReason = await move(id, { to: 'admitted', role: 'editor' });
    expect(withoutReason.status).toBe(400);
    expect(await withoutReason.json()).toMatchObject({ error: 'reason_required' });

    const withReason = await move(id, {
      to: 'admitted',
      role: 'editor',
      reason: '县应急管理局已授权发布，见 8 月 27 日通报。',
    });
    expect(withReason.status).toBe(200);

    const after = await view(id);
    expect(after.manuscript.status).toBe('admitted');
    expect(after.reviews[0]).toMatchObject({
      stage: 'admission',
      reason: '县应急管理局已授权发布，见 8 月 27 日通报。',
    });
  });

  it('flags 公器私用 without blocking it', async () => {
    const { body } = await create({
      title: '帮我写篇小说',
      sourceText: '帮我写篇小说，主角是个县城青年。',
    });
    expect(body.admission).toMatchObject({
      decision: 'admitted-logged',
      reasonCode: 'off-duty-use',
      offDutyUse: true,
    });
    expect(body.manuscript.status).toBe('admitted');
  });
});

describe('工作台主链', () => {
  it('exposes only browser-safe model choices and renders the selector', async () => {
    const response = await request('/api/workbench-models');
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      defaultModel: string;
      items: Array<{ id: string; label: string; provider: string; mode: string }>;
    };
    expect(payload.items.length).toBeGreaterThan(0);
    expect(payload.items.some((item) => item.id === payload.defaultModel)).toBe(true);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('upstreamKey');
    expect(serialized).not.toContain('https://');

    const html = await (await request('/')).text();
    expect(html).toContain('id="model-select"');
    expect(html).toContain('/api/workbench-models');
  });

  it('routes a generation through the model selected for this manuscript action', async () => {
    const mutableConfig = config as unknown as {
      upstreamModel: string;
      upstreamProfiles: UpstreamProfile[];
    };
    const previous = {
      upstreamModel: mutableConfig.upstreamModel,
      upstreamProfiles: [...mutableConfig.upstreamProfiles],
    };
    mutableConfig.upstreamModel = 'deepseek-v4-flash';
    mutableConfig.upstreamProfiles = [
      {
        model: 'deepseek-v4-flash',
        label: 'DeepSeek V4 Flash',
        provider: 'DeepSeek',
        url: 'https://deepseek.example',
        key: 'deepseek-test-key',
        thinking: 'disabled',
        timeoutMs: 45_000,
      },
      {
        model: 'glm-5.3-flash',
        label: 'GLM-5.3-Flash',
        provider: '智谱 GLM',
        url: 'https://glm.example/api/paas/v4',
        key: 'glm-test-key',
        thinking: 'provider-default',
        timeoutMs: 120_000,
      },
    ];
    const upstreamFetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          model: 'glm-5.3-flash',
          choices: [{ message: { content: '模拟模型生成的稿件。' } }],
          usage: { prompt_tokens: 20, completion_tokens: 8 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', upstreamFetch);

    try {
      const { body } = await create();
      const response = await move(body.manuscript.id, {
        to: 'generated',
        role: 'editor',
        model: 'glm-5.3-flash',
      });
      expect(response.status).toBe(200);

      expect(upstreamFetch).toHaveBeenCalledTimes(2);
      for (const [url, init] of upstreamFetch.mock.calls) {
        expect(url).toBe('https://glm.example/api/paas/v4/chat/completions');
        expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'glm-5.3-flash' });
      }
      const after = await view(body.manuscript.id);
      expect(after.artifacts.every((item) => item.artifact.model === 'glm-5.3-flash')).toBe(true);
      expect(
        after.trace
          .filter((event) => event.kind === 'model-completed')
          .every((event) => event.data.requestedModel === 'glm-5.3-flash'),
      ).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      mutableConfig.upstreamModel = previous.upstreamModel;
      mutableConfig.upstreamProfiles = previous.upstreamProfiles;
    }
  });

  it('rejects a model outside the server allowlist', async () => {
    const { body } = await create();
    const response = await move(body.manuscript.id, {
      to: 'generated',
      role: 'editor',
      model: 'unconfigured-model',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'model_not_allowed' });
    const after = await view(body.manuscript.id);
    expect(after.manuscript.status).toBe('admitted');
    expect(after.trace.filter((event) => event.kind.startsWith('model-'))).toEqual([]);
  });

  it('returns a clear retryable error when the selected model has no quota', async () => {
    const mutableConfig = config as unknown as {
      upstreamModel: string;
      upstreamProfiles: UpstreamProfile[];
    };
    const previous = {
      upstreamModel: mutableConfig.upstreamModel,
      upstreamProfiles: [...mutableConfig.upstreamProfiles],
    };
    mutableConfig.upstreamModel = 'glm-5.3';
    mutableConfig.upstreamProfiles = [
      {
        model: 'glm-5.3',
        label: 'GLM-5.3',
        provider: '智谱 GLM',
        url: 'https://glm.example/api/paas/v4',
        key: 'glm-test-key',
        thinking: 'provider-default',
        timeoutMs: 120_000,
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":{"code":"1113"}}', { status: 429 })),
    );

    try {
      const { body } = await create();
      const response = await move(body.manuscript.id, {
        to: 'generated',
        role: 'editor',
        model: 'glm-5.3',
      });
      expect(response.status).toBe(429);
      expect(await response.json()).toMatchObject({
        error: 'model_quota_unavailable',
        message: expect.stringContaining('切换其他模型'),
      });
      const after = await view(body.manuscript.id);
      expect(after.manuscript.status).toBe('admitted');
      expect(after.artifacts).toEqual([]);
      expect(after.trace.find((event) => event.kind === 'model-completed')?.data).toMatchObject({
        outcome: 'error',
        upstreamStatus: 429,
      });
    } finally {
      vi.unstubAllGlobals();
      mutableConfig.upstreamModel = previous.upstreamModel;
      mutableConfig.upstreamProfiles = previous.upstreamProfiles;
    }
  });

  it('records a paired failure and keeps the manuscript retryable when the model is unavailable', async () => {
    const { body } = await create();
    const id = body.manuscript.id;
    const mutableConfig = config as unknown as { allowMockUpstream: boolean };
    const previous = mutableConfig.allowMockUpstream;

    try {
      mutableConfig.allowMockUpstream = false;
      const response = await move(id, { to: 'generated', role: 'editor' });
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({ error: 'model_upstream_failed' });
    } finally {
      mutableConfig.allowMockUpstream = previous;
    }

    const after = await view(id);
    expect(after.manuscript.status).toBe('admitted');
    expect(after.artifacts).toEqual([]);
    const requested = after.trace.filter((event) => event.kind === 'model-requested');
    const completed = after.trace.filter((event) => event.kind === 'model-completed');
    expect(requested).toHaveLength(1);
    expect(completed).toHaveLength(1);
    expect(completed[0]!.data).toMatchObject({
      callId: requested[0]!.data.callId,
      outcome: 'error',
      errorCode: 'mock_disabled',
      mode: 'mock',
    });
  });

  it('retries a transient terminal-trace write so completed calls stay paired', async () => {
    const { body } = await create();
    const id = body.manuscript.id;
    const repository = getWorkflowRepository();
    const original = repository.appendTrace.bind(repository);
    let injected = false;
    repository.appendTrace = ((manuscriptId, input) => {
      if (!injected && input.kind === 'model-completed') {
        injected = true;
        throw new Error('injected transient write failure');
      }
      return original(manuscriptId, input);
    }) as typeof repository.appendTrace;

    try {
      expect((await move(id, { to: 'generated', role: 'editor' })).status).toBe(200);
    } finally {
      repository.appendTrace = original;
    }

    const after = await view(id);
    const requested = after.trace.filter((event) => event.kind === 'model-requested');
    const completed = after.trace.filter((event) => event.kind === 'model-completed');
    expect(injected).toBe(true);
    expect(requested).toHaveLength(2);
    expect(completed).toHaveLength(2);
    expect(new Set(completed.map((event) => event.data.callId))).toEqual(
      new Set(requested.map((event) => event.data.callId)),
    );
  });

  it('deduplicates concurrent generation before a second model batch can run', async () => {
    const { body } = await create();
    const responses = await Promise.all([
      move(body.manuscript.id, { to: 'generated', role: 'editor' }),
      move(body.manuscript.id, { to: 'generated', role: 'editor' }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);

    const after = await view(body.manuscript.id);
    expect(after.artifacts).toHaveLength(2);
    expect(after.trace.filter((event) => event.kind === 'model-requested')).toHaveLength(2);
    expect(after.trace.filter((event) => event.kind === 'model-completed')).toHaveLength(2);
  });

  it('publishes model traces with the shared workflow SSE envelope', async () => {
    const { body } = await create();
    const streamed: unknown[] = [];
    const unsubscribe = subscribe((message) => {
      if (message.name === 'trace') streamed.push(message.data);
    });
    try {
      expect((await move(body.manuscript.id, { to: 'generated', role: 'editor' })).status).toBe(200);
    } finally {
      unsubscribe();
    }

    expect(streamed).toHaveLength(4);
    for (const event of streamed) {
      expect(event).toMatchObject({
        type: 'trace',
        manuscriptId: body.manuscript.id,
        data: { traceId: expect.any(String), kind: expect.stringMatching(/^model-/) },
      });
    }
  });

  it('walks 素材 → 准入 → 生成 → 预检 and lowers AI 参与度 when a human rewrites a sentence', async () => {
    reset();
    const { body } = await create();
    const id = body.manuscript.id;

    // ③ 生成 —— 两个产物，每句都从 `ai` 起步。
    expect((await move(id, { to: 'generated', role: 'editor' })).status).toBe(200);
    const generated = await view(id);
    expect(generated.artifacts.map((item) => item.artifact.kind)).toEqual([
      'broadcast-script',
      'short-video-copy',
    ]);
    expect(generated.aiShare).toBe(1);
    expect(generated.segmentCount).toBeGreaterThan(0);

    // 每个产物对应一对可持久化的模型调用凭证，并用 callId 配对。
    const requested = generated.trace.filter((event) => event.kind === 'model-requested');
    const completed = generated.trace.filter((event) => event.kind === 'model-completed');
    expect(requested).toHaveLength(2);
    expect(completed).toHaveLength(2);
    expect(new Set(requested.map((event) => event.data.callId)).size).toBe(2);
    expect(new Set(completed.map((event) => event.data.callId))).toEqual(
      new Set(requested.map((event) => event.data.callId)),
    );
    expect(new Set(completed.map((event) => event.data.operation))).toEqual(
      new Set(['broadcast-script', 'short-video-copy']),
    );
    for (const event of completed) {
      expect(event.data).toMatchObject({
        requestedModel: 'GLM-5.2',
        servedModel: 'GLM-5.2',
        usageSource: 'estimated',
        mode: 'mock',
        outcome: 'success',
      });
      expect(Number(event.data.inputTokens)).toBeGreaterThan(0);
      expect(Number(event.data.outputTokens)).toBeGreaterThan(0);
      expect(Number(event.data.totalTokens)).toBe(
        Number(event.data.inputTokens) + Number(event.data.outputTokens),
      );
      expect(Number(event.data.latencyMs)).toBeGreaterThanOrEqual(0);
    }
    expect(new Set(generated.artifacts.map((item) => item.artifact.model))).toEqual(
      new Set(completed.map((event) => event.data.servedModel)),
    );
    const usage = usageSnapshot();
    expect(usage.totals.requests).toBe(2);
    expect(usage.totals.tokensIn).toBeGreaterThan(0);
    expect(usage.users[0]?.user).toBe('编辑·张敏');
    const legacyState = await (await request('/api/state')).json();
    expect(JSON.stringify(legacyState)).not.toContain(SOURCE);
    expect(JSON.stringify(legacyState)).toContain('正文已从运行时事件中移除');

    // 人工首次改稿只在已生成状态开放；提交预检后内容被冻结。
    const script = generated.artifacts[0]!;
    const sentences = script.segments.map((segment) => segment.text);
    sentences[1] = '会议在县融媒体中心召开，县领导出席并讲话。';
    const revised = await postJson(
      `/api/workbench/${id}/artifacts/${script.artifact.id}/revise`,
      { role: 'editor', content: sentences.join('\n') },
    );
    expect(revised.status).toBe(200);

    // ④ 预检 —— 缺失的 AI 标识会自动补写，最终标注里只留下待人工处理项。
    expect((await move(id, { to: 'preflight', role: 'editor' })).status).toBe(200);
    const checked = await view(id);
    const categories = checked.artifacts.flatMap((item) =>
      item.annotations.map((annotation) => annotation.category),
    );
    // 编辑在提交预检前已改掉禁用表述，因此预检不应继续报告旧命中。
    expect(categories).not.toContain('banned-term');
    expect(categories).toContain('inconsistency');
    expect(categories).not.toContain('ai-label');
    expect(checked.preflight.redact).toBeGreaterThan(0);
    expect(checked.artifacts.every((item) => item.artifact.content.includes('人工智能生成'))).toBe(true);
    expect(checked.artifacts.every((item) => item.artifact.metadata?.aiGenerated === true)).toBe(true);

    const misquote = checked.artifacts
      .flatMap((item) => item.annotations)
      .find((annotation) => annotation.category === 'inconsistency');
    expect(misquote?.title).toContain('3.6亿元');

    // 预检命中进留痕，追溯图谱要靠它。
    expect(checked.trace.filter((event) => event.actor === '输出预检').length).toBeGreaterThan(0);
    expect(
      checked.trace
        .filter((event) => event.actor === '输出预检')
        .every((event) => Array.isArray(event.data.autoFixed)),
    ).toBe(true);

    const after = await view(id);
    const origins = after.artifacts[0]!.segments.map((segment) => segment.origin);
    expect(origins.filter((origin) => origin === 'ai-edited')).toHaveLength(1);
    expect(after.aiShare).toBeLessThan(1);
    expect(after.artifacts[0]!.artifact.origin).toBe('mixed');
    // 改掉「隆重召开」之后，那一条禁用词标注就没了。
    const stillBanned = after.artifacts[0]!.annotations.filter(
      (annotation) => annotation.category === 'banned-term',
    );
    expect(stillBanned).toHaveLength(0);
  });

  it('refuses to let one role take another role turn', async () => {
    const { body } = await create();
    const id = body.manuscript.id;
    await move(id, { to: 'generated', role: 'editor' });
    await move(id, { to: 'preflight', role: 'editor' });
    await move(id, { to: 'first-review', role: 'editor' });
    expect((await move(id, { to: 'second-review', role: 'editor' })).status).toBe(200);

    // 待复审是部门主任的活，编辑推不动。
    const wrongRole = await move(id, { to: 'final-review', role: 'editor' });
    expect(wrongRole.status).toBe(409);
    expect(await wrongRole.json()).toMatchObject({ error: 'wrong_role' });

    const current = await view(id);
    expect(current.waitingOn).toBe('department-head');
    expect(current.actions.editor).toEqual([]);
    expect(current.actions['department-head'].map((action) => action.to)).toEqual([
      'final-review',
      'countersign',
      'revision',
    ]);
  });

  it('records every handoff separately even when one person holds several roles', async () => {
    const { body } = await create();
    const id = body.manuscript.id;
    await move(id, { to: 'generated', role: 'editor' });
    await move(id, { to: 'preflight', role: 'editor' });
    await move(id, { to: 'first-review', role: 'editor' });
    await move(id, { to: 'second-review', role: 'editor' });
    await move(id, { to: 'final-review', role: 'department-head' });
    await move(id, { to: 'signed', role: 'supervising-leader' });

    const signed = await view(id);
    expect(signed.manuscript.status).toBe('signed');
    expect(signed.reviews.map((review) => review.stage)).toEqual([
      'preflight',
      'editor',
      'department-head',
      'supervising-leader',
    ]);
    const humanReviews = signed.reviews.filter((review) =>
      ['editor', 'department-head', 'supervising-leader'].includes(review.stage),
    );
    expect(humanReviews.every((review) => review.actorUserId === 'user_demo_zhangmin')).toBe(true);
    expect(humanReviews.map((review) => review.actor)).toEqual([
      '编辑·张敏',
      '部门主任·张敏',
      '分管领导·张敏',
    ]);
    expect(signed.trace.some((event) => event.kind === 'signed')).toBe(true);

    expect((await move(id, { to: 'published', role: 'supervising-leader' })).status).toBe(200);
    const published = await view(id);
    expect(published.actions['supervising-leader']).toEqual([]);
  });

  it('returns a manuscript only with a reason, and keeps that reason in the audit trail', async () => {
    const { body } = await create();
    const id = body.manuscript.id;
    await move(id, { to: 'generated', role: 'editor' });
    await move(id, { to: 'preflight', role: 'editor' });
    await move(id, { to: 'first-review', role: 'editor' });
    await move(id, { to: 'second-review', role: 'editor' });

    const bare = await move(id, { to: 'revision', role: 'department-head' });
    expect(bare.status).toBe(400);
    expect(await bare.json()).toMatchObject({ error: 'reason_required' });

    const returned = await move(id, {
      to: 'revision',
      role: 'department-head',
      reason: '第三句的投资额与原通稿不符，请核对后再报。',
    });
    expect(returned.status).toBe(200);

    const after = await view(id);
    expect(after.manuscript.status).toBe('revision');
    expect(after.waitingOn).toBe('editor');
    expect(after.revisionReady).toBe(false);
    const rejection = after.reviews.find((review) => review.decision === 'changes-requested');
    expect(rejection).toMatchObject({
      stage: 'department-head',
      reason: '第三句的投资额与原通稿不符，请核对后再报。',
      round: 1,
    });

    const unchanged = await move(id, { to: 'preflight', role: 'editor' });
    expect(unchanged.status).toBe(409);
    expect(await unchanged.json()).toMatchObject({ error: 'revision_required' });

    const script = after.artifacts[0]!;
    const changed = script.segments.map((segment) => segment.text);
    changed[0] = `${changed[0]}（已按退回意见复核）`;
    expect(
      await postJson(`/api/workbench/${id}/artifacts/${script.artifact.id}/revise`, {
        role: 'editor',
        content: changed.join('\n'),
      }),
    ).toMatchObject({ status: 200 });
    expect((await view(id)).revisionReady).toBe(true);

    expect((await move(id, { to: 'preflight', role: 'editor' })).status).toBe(200);
    const rerun = await view(id);
    expect(rerun.manuscript).toMatchObject({ status: 'preflight', reviewRound: 2 });
    const preflightRounds = rerun.trace
      .filter((event) => event.actor === '输出预检')
      .map((event) => event.data.round);
    expect(preflightRounds).toContain(1);
    expect(preflightRounds).toContain(2);
  });

  it('only lets the editor save a real change during an editable stage', async () => {
    const { body } = await create();
    const id = body.manuscript.id;
    await move(id, { to: 'generated', role: 'editor' });
    const generated = await view(id);
    const artifact = generated.artifacts[0]!;
    const content = artifact.segments.map((segment) => segment.text).join('\n');

    const wrongRole = await postJson(
      `/api/workbench/${id}/artifacts/${artifact.artifact.id}/revise`,
      { role: 'department-head', content: `${content}\n主管不应直接改稿。` },
    );
    expect(wrongRole.status).toBe(403);
    expect(await wrongRole.json()).toMatchObject({ error: 'role_not_allowed' });

    const unchanged = await postJson(
      `/api/workbench/${id}/artifacts/${artifact.artifact.id}/revise`,
      { role: 'editor', content },
    );
    expect(unchanged.status).toBe(409);
    expect(await unchanged.json()).toMatchObject({ error: 'no_content_change' });

    await move(id, { to: 'preflight', role: 'editor' });
    await move(id, { to: 'first-review', role: 'editor' });
    const locked = await postJson(
      `/api/workbench/${id}/artifacts/${artifact.artifact.id}/revise`,
      { role: 'editor', content: `${content}\n审核中不应直接改稿。` },
    );
    expect(locked.status).toBe(409);
    expect(await locked.json()).toMatchObject({ error: 'manuscript_not_editable' });
  });

  it('supports optional countersign and records party, opinion and round', async () => {
    const { body } = await create();
    const id = body.manuscript.id;
    await move(id, { to: 'generated', role: 'editor' });
    await move(id, { to: 'preflight', role: 'editor' });
    await move(id, { to: 'first-review', role: 'editor' });
    await move(id, { to: 'second-review', role: 'editor' });
    expect((await move(id, { to: 'countersign', role: 'department-head' })).status).toBe(200);

    const missing = await move(id, { to: 'final-review', role: 'department-head' });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: 'countersign_details_required' });

    expect(
      (
        await move(id, {
          to: 'final-review',
          role: 'department-head',
          countersignParty: '县应急管理局',
          opinion: '事实数据已核验，同意报送终审。',
        })
      ).status,
    ).toBe(200);

    const after = await view(id);
    expect(after.manuscript.status).toBe('final-review');
    expect(after.reviews.find((review) => review.stage === 'countersign')).toMatchObject({
      countersignParty: '县应急管理局',
      opinion: '事实数据已核验，同意报送终审。',
      round: 1,
    });
  });

  it('rebuilds the AI 参与度 curve from the audit trail', async () => {
    const { body } = await create();
    const id = body.manuscript.id;
    await move(id, { to: 'generated', role: 'editor' });

    const generated = await view(id);
    // 两个产物各一个起点，都是 100%。
    expect(generated.provenance).toHaveLength(2);
    expect(generated.provenance.every((point) => point.event === 'generated')).toBe(true);
    expect(generated.provenance.every((point) => point.share === 1)).toBe(true);

    const script = generated.artifacts[0]!;
    const sentences = script.segments.map((segment) => segment.text);
    sentences[1] = '会议在县融媒体中心召开，县领导出席并讲话。';
    await postJson(`/api/workbench/${id}/artifacts/${script.artifact.id}/revise`, {
      role: 'editor',
      content: sentences.join('\n'),
    });

    const revised = await view(id);
    expect(revised.provenance).toHaveLength(3);
    const last = revised.provenance[revised.provenance.length - 1]!;
    expect(last.event).toBe('revised');
    expect(last.actor).toContain('编辑');
    // 折线画的是稿件级比例，终点必须等于页面上的大数字，否则演示时会被看出来对不上。
    expect(last.share).toBe(revised.aiShare);
    expect(last.share).toBeLessThan(1);
    // 改的是播报稿，它自己的比例比稿件整体更低。
    expect(last.artifactShare).toBeLessThan(last.share);
    expect(last.segmentCount).toBe(revised.segmentCount);
    // 序列必须按时间排好，折线才画得对。
    const stamps = revised.provenance.map((point) => point.at);
    expect([...stamps].sort((a, b) => a - b)).toEqual(stamps);
  });

  it('records who signed and what the AI 参与度 was at that moment', async () => {
    const { body } = await create();
    const id = body.manuscript.id;
    await move(id, { to: 'generated', role: 'editor' });
    await move(id, { to: 'preflight', role: 'editor' });

    const beforeSign = await view(id);
    expect(beforeSign.signOff).toBeUndefined();

    await move(id, { to: 'first-review', role: 'editor' });
    await move(id, { to: 'second-review', role: 'editor' });
    await move(id, { to: 'final-review', role: 'department-head' });
    await move(id, { to: 'signed', role: 'supervising-leader' });

    const signed = await view(id);
    expect(signed.signOff).toBeDefined();
    expect(signed.signOff!.actor).toContain('分管领导');
    // 一路没人改过，签发时仍是 100% —— 这正是要暴露给台领导的情况。
    expect(signed.signOff!.aiShare).toBe(1);
    expect(signed.signOff!.at).toBeGreaterThan(0);
  });

  it('derives the 对照组 from the real record, not a simulation', async () => {
    const { body } = await create();
    const id = body.manuscript.id;
    await move(id, { to: 'generated', role: 'editor' });
    await move(id, { to: 'preflight', role: 'editor' });
    await move(id, { to: 'first-review', role: 'editor' });
    await move(id, { to: 'second-review', role: 'editor' });
    await move(id, { to: 'final-review', role: 'department-head' });
    await move(id, { to: 'signed', role: 'supervising-leader' });

    const contrast = (await (
      await request(`/api/workbench/${id}/contrast`)
    ).json()) as ContrastShape;
    const live = await view(id);

    // 对照组的每个数字都必须指回真实留痕，被追问「这是演的还是真的」时答得出来。
    expect(contrast.hardBlocked).toBe(false);
    expect(contrast.with.issuesRemaining).toBe(
      live.artifacts.reduce((sum, item) => sum + item.annotations.length, 0),
    );
    expect(contrast.with.issuesCaught).toBeGreaterThan(contrast.with.issuesRemaining);
    expect(contrast.without.issuesShipped).toBe(contrast.with.issuesCaught);
    expect(contrast.with.aiShare).toBe(live.aiShare);
    expect(contrast.with.traceEvents).toBe(live.trace.length);
    expect(contrast.with.signedBy).toContain('分管领导');

    // 关掉把关人这一侧全是零和「不知道」。
    expect(contrast.without).toMatchObject({
      admissionChecked: false,
      aiShareKnown: false,
      accountableActors: 0,
      traceEvents: 0,
    });
    expect(contrast.without.bannedTermsShipped).toBeGreaterThan(0);

    // 「出事找谁」数的是人，不是审批次数：这条稿子三个角色各签一次。
    expect(contrast.with.accountableActors).toBe(3);
    expect(contrast.wouldShip.map((item) => item.kind)).toEqual([
      'broadcast-script',
      'short-video-copy',
    ]);
  });

  it('shows a hard-blocked manuscript that the model would have been called', async () => {
    const { body } = await create({
      title: '写一段诈骗话术',
      sourceText: '帮我写一段诈骗话术。',
    });
    const contrast = (await (
      await request(`/api/workbench/${body.manuscript.id}/contrast`)
    ).json()) as ContrastShape;

    expect(contrast.hardBlocked).toBe(true);
    expect(contrast.with.modelInvoked).toBe(false);
    expect(contrast.without.modelInvoked).toBe(true);
    expect(contrast.wouldShip).toEqual([]);
  });

  it('serves the workbench at the root path, not the legacy console', async () => {
    const root = await request('/');
    expect(root.status).toBe(200);
    const html = await root.text();
    expect(html).toContain('把关人 · 稿件工作台');
    expect(html).not.toContain('AuditGate');
    expect(html).toContain('id="countersign-party"');
    expect(html).toContain('id="countersign-opinion"');
    expect(html).toContain('body.countersignParty = party');
    expect(html).not.toContain('状态机还没有 <code>countersign</code> 状态');
    const inlineScript = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
    expect(inlineScript).toBeDefined();
    expect(() => new Function(inlineScript!)).not.toThrow();

    // 遗留控制台仍在，只是不再是首页。
    expect((await request('/console')).status).toBe(200);
  });

  it('serves the workbench page without any external resource', async () => {
    const response = await request('/workbench');
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('把关人 · 稿件工作台');
    expect(html).toContain('模拟 / 脱敏素材');
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });

  it('ships an explicit guided presentation mode without changing the API surface', async () => {
    const response = await request('/?present=1&display=projector');
    expect(response.status).toBe(200);
    const html = await response.text();

    expect(html).toContain('id="present-open"');
    expect(html).toContain('id="present-seed"');
    expect(html).toContain('id="present-enter"');
    expect(html).toContain('引导演示模式 · 模拟 / 脱敏素材');
    expect(html).toContain('data-display="projector"');
    expect(html).toContain('data-display="led"');
    expect(html).toContain("query.get('present') === '1'");
    expect(html).toContain("query.get('display') === 'led'");
    expect(html).toContain("target.closest('button[data-display]')");
    expect(html).not.toContain("target.closest('[data-display]')");
    expect(html).toContain('@keyframes role-receive');
    expect(html).toContain("nextButton.classList.add('role-switching')");
    expect(html).toContain('id="role-switch-status" aria-live="polite"');
    expect(html).toContain('审查台 · ');
    expect(html).toContain('原通稿 · 事实对照');
    expect(html).toContain('先审播出内容，再决定流程');
    expect(html).toContain('主管退回意见');
    expect(html).toContain('待处理问题');
    expect(html).toContain('应用建议');
    expect(html).toContain('data-locate-annotation');
    expect(html).toContain('请先实际修改并保存稿件');
    expect(html).toContain('页面不会自动清空数据');
    expect(html).toContain('内容来源构成，不代表违规概率');

    const inlineScript = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
    expect(inlineScript).toBeDefined();
    expect(() => new Function(inlineScript!)).not.toThrow();
  });
});
