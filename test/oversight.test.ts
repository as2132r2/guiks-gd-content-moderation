import { beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/index.js';
import { aiShareWeights } from '../src/domain/ai-share.js';
import type { OversightSnapshot } from '../src/db/oversight.js';
import { authenticatedRequest, loginAs } from './helpers/auth.js';

let request: ReturnType<typeof authenticatedRequest>;

beforeAll(async () => {
  request = authenticatedRequest(app, await loginAs(app));
});

const post = (path: string, body?: unknown) =>
  request(path, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });

const overview = async (): Promise<OversightSnapshot> =>
  (await (await request('/api/monitor/overview')).json()) as OversightSnapshot;

const find = (list: Array<{ key: string; count: number }>, key: string) =>
  list.find((row) => row.key === key)?.count ?? 0;

/** 走一份稿件到签发，顺带改两句，让每个维度都有料。 */
async function walkOne() {
  const fixtures = (await (await request('/api/demo/fixtures')).json()) as {
    mainNotice: { title: string; sourceType: string; sourceText: string };
  };
  const created = (await (await post('/api/workbench', fixtures.mainNotice)).json()) as {
    manuscript: { id: string };
  };
  const id = created.manuscript.id;
  const move = (to: string, role: string) => post(`/api/workbench/${id}/transition`, { to, role });

  await move('generated', 'editor');

  // 改稿只在 generated / revision 两个状态允许（mutation-policy.ts），
  // 预检之后内容就锁了——所以先改再预检。
  const view = (await (await request(`/api/workbench/${id}`)).json()) as {
    artifacts: Array<{ artifact: { id: string }; segments: Array<{ text: string }> }>;
  };
  const artifact = view.artifacts[0]!;
  const sentences = artifact.segments.map((segment) => segment.text);
  // 动最后一句收尾话——它本身不命中任何规则。改含「隆重召开」那句会把禁用词
  // 一并改掉，预检就抓不到了，规则命中那条断言也就无从谈起。
  sentences[sentences.length - 1] = '下一步，各乡镇要按照会议部署抓好落实。';
  const revised = await post(`/api/workbench/${id}/artifacts/${artifact.artifact.id}/revise`, {
    role: 'editor',
    content: sentences.join('\n'),
  });
  expect(revised.status).toBe(200);

  await move('preflight', 'editor');
  await move('first-review', 'editor');
  await move('second-review', 'editor');
  await move('final-review', 'department-head');
  await move('signed', 'supervising-leader');
  return id;
}

describe('全流程监控聚合', () => {
  it('counts nothing on an empty database instead of dividing by zero', async () => {
    await post('/api/demo/reset');
    const data = await overview();
    expect(data.totals.manuscripts).toBe(0);
    // 未测量不等于 0 —— 这一条在整条链路上是一致的。
    expect(data.overallAiShare).toBeNull();
    expect(data.shares).toEqual([]);
    expect(data.model.calls).toBe(0);
    expect(data.model.averageLatencyMs).toBe(0);
  });

  it('aggregates across manuscripts, which no other endpoint does', async () => {
    await post('/api/demo/reset');
    await post('/api/demo/seed');
    await walkOne();

    const data = await overview();
    expect(data.totals.manuscripts).toBe(4);
    expect(data.totals.signed).toBe(1);
    expect(data.totals.blocked).toBe(1);
    expect(data.totals.segments).toBeGreaterThan(0);

    // 三组样例把准入三档都覆盖到了。
    expect(find(data.admissions, 'blocked')).toBe(1);
    expect(find(data.admissions, 'reason-required')).toBe(1);
    expect(find(data.admissions, 'admitted-logged')).toBeGreaterThanOrEqual(2);
  });

  it('derives 全台 AI 参与度 with the shared weights, not a second formula', async () => {
    await post('/api/demo/reset');
    await walkOne();
    const data = await overview();

    const weighted = data.origins.reduce(
      (sum, row) => sum + (aiShareWeights[row.key as keyof typeof aiShareWeights] ?? 0) * row.count,
      0,
    );
    const total = data.origins.reduce((sum, row) => sum + row.count, 0);
    expect(data.overallAiShare).toBeCloseTo(weighted / total, 4);

    // 改过一句，所以整体一定低于 100%。
    expect(data.overallAiShare).toBeLessThan(1);
    expect(find(data.origins, 'ai-edited')).toBe(1);
  });

  it('drills down per manuscript and keeps 未测量 distinct from 0', async () => {
    await post('/api/demo/reset');
    await post('/api/demo/seed');
    await walkOne();

    const data = await overview();
    const measured = data.shares.filter((row) => row.aiShare !== null);
    const unmeasured = data.shares.filter((row) => row.aiShare === null);

    expect(measured).toHaveLength(1);
    expect(measured[0]!.segmentCount).toBeGreaterThan(0);
    // 三组准入样例从未生成过产物，所以是「未测量」而不是 0%。
    expect(unmeasured).toHaveLength(3);
    expect(unmeasured.every((row) => row.segmentCount === 0)).toBe(true);
  });

  it('unfolds rule hits straight out of the audit trail', async () => {
    await post('/api/demo/reset');
    await walkOne();
    const data = await overview();

    // 留痕里记着 rules[]，用 JSON1 展开，没有另存一份表。
    expect(find(data.ruleHits, 'banned-term')).toBeGreaterThan(0);
    expect(find(data.ruleHits, 'inconsistency')).toBeGreaterThan(0);
    expect(data.ruleHits[0]!.count).toBeGreaterThanOrEqual(data.ruleHits[data.ruleHits.length - 1]!.count);
  });

  it('reports per-stage return rates', async () => {
    await post('/api/demo/reset');
    const id = await walkOne();
    await post(`/api/workbench/${id}/transition`, { to: 'published', role: 'supervising-leader' });

    const data = await overview();
    const editor = data.reviews.find((row) => row.stage === 'editor');
    expect(editor).toBeDefined();
    expect(editor!.approved).toBeGreaterThan(0);
    expect(editor!.returnRate).toBe(0);
  });

  it('carries the model call receipts that make AI 参与度 evidenced, not just computed', async () => {
    await post('/api/demo/reset');
    await walkOne();
    const data = await overview();

    expect(data.model.calls).toBe(2); // 播报稿 + 短视频文案
    expect(data.model.inputTokens).toBeGreaterThan(0);
    expect(data.model.outputTokens).toBeGreaterThan(0);
    expect(data.model.models.length).toBeGreaterThan(0);
  });

  it('does not expose station-wide numbers to an unauthenticated caller', async () => {
    // 这个端点横着看全台，比任何单稿件端点都敏感——不能裸奔。
    const anonymous = await app.request('/api/monitor/overview');
    expect(anonymous.status).toBe(401);
  });

  it('serves the board with no external resource', async () => {
    const response = await app.request('/monitor');
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('把关人 · 全流程监控');
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });
});
