import { describe, expect, it } from 'vitest';
import { app } from '../src/index.js';
import type { WorkbenchView } from '../src/routes/workbench.js';

const SOURCE =
  '模拟素材：全县乡村振兴现场推进会今天召开。项目总投资 3.2亿元，涉及 12 个乡镇，惠及群众 4.6万人。';

const postJson = (path: string, body: unknown) =>
  app.request(path, {
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

const view = async (id: string): Promise<WorkbenchView> =>
  (await (await app.request(`/api/workbench/${id}`)).json()) as WorkbenchView;

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
  it('walks 素材 → 准入 → 生成 → 预检 and lowers AI 参与度 when a human rewrites a sentence', async () => {
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

    // ④ 预检 —— 禁用词、与原通稿不符的数字、缺 AI 标识，三样都要标出来。
    expect((await move(id, { to: 'preflight', role: 'editor' })).status).toBe(200);
    const checked = await view(id);
    const categories = checked.artifacts.flatMap((item) =>
      item.annotations.map((annotation) => annotation.category),
    );
    expect(categories).toContain('banned-term');
    expect(categories).toContain('inconsistency');
    expect(categories).toContain('ai-label');
    expect(checked.preflight.block).toBeGreaterThan(0);

    const misquote = checked.artifacts
      .flatMap((item) => item.annotations)
      .find((annotation) => annotation.category === 'inconsistency');
    expect(misquote?.title).toContain('3.6亿元');

    // 预检命中进留痕，追溯图谱要靠它。
    expect(checked.trace.filter((event) => event.actor === '输出预检').length).toBeGreaterThan(0);

    // 人改一句 → 该句降级 ai-edited，AI 参与度当场下降。
    const script = checked.artifacts[0]!;
    const sentences = script.segments.map((segment) => segment.text);
    sentences[1] = '会议在县融媒体中心召开，县领导出席并讲话。';

    const revised = await postJson(
      `/api/workbench/${id}/artifacts/${script.artifact.id}/revise`,
      { role: 'editor', content: sentences.join('\n') },
    );
    expect(revised.status).toBe(200);

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
    expect(current.actions['department-head']).toHaveLength(2);
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

    const bare = await move(id, { to: 'first-review', role: 'department-head' });
    expect(bare.status).toBe(400);
    expect(await bare.json()).toMatchObject({ error: 'reason_required' });

    const returned = await move(id, {
      to: 'first-review',
      role: 'department-head',
      reason: '第三句的投资额与原通稿不符，请核对后再报。',
    });
    expect(returned.status).toBe(200);

    const after = await view(id);
    expect(after.manuscript.status).toBe('first-review');
    const rejection = after.reviews.find((review) => review.decision === 'changes-requested');
    expect(rejection).toMatchObject({
      stage: 'department-head',
      reason: '第三句的投资额与原通稿不符，请核对后再报。',
    });
  });

  it('serves the workbench page without any external resource', async () => {
    const response = await app.request('/workbench');
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('把关人 · 稿件工作台');
    expect(html).toContain('模拟 / 脱敏素材');
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });
});
