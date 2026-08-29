import { beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/index.js';
import { aiShareWeights } from '../src/domain/ai-share.js';
import { systemRoles, type SystemRole } from '../src/domain/contracts.js';
import { rolePermissions, type Permission } from '../src/domain/permissions.js';
import { renderWorkbench } from '../src/views/workbench-view.js';
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
  const fixtures = (await (await request('/api/fixtures')).json()) as {
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

  it('groups by 报道方向 and keeps 未分类 distinct from 其他', async () => {
    await post('/api/demo/reset');
    await post('/api/demo/seed');

    const data = await overview();
    // 三组样例分别是 民生 / 其他 / 文化教育。
    expect(find(data.topics, 'livelihood')).toBe(1);
    expect(find(data.topics, 'other')).toBe(1);
    expect(find(data.topics, 'culture')).toBe(1);

    // 未填的键是 null，不能被折进「其他」——老稿件在这个字段之前建的。
    const unclassified = data.topics.find((row) => row.key === null);
    expect(unclassified).toBeUndefined();
  });

  it('attributes work to people, not roles', async () => {
    await post('/api/demo/reset');
    await walkOne();

    const data = await overview();
    // 张敏一个人走完了编辑、主任、分管领导三步（角色可合并），
    // 但按 actor_user_id 归并后只能是一个人头，不是三个。
    const named = data.producers.filter((row) => row.userId !== null);
    expect(named).toHaveLength(1);

    const person = named[0]!;
    expect(person.displayName).toBeTruthy();
    expect(person.created).toBe(1);
    expect(person.revised).toBe(1);
    expect(person.reviewed).toBeGreaterThanOrEqual(3);
    expect(person.returned).toBe(0);
  });

  it('trends signed AI 参与度 by day, and says so when a day signed nothing', async () => {
    await post('/api/demo/reset');
    await post('/api/demo/seed');
    await walkOne();

    const data = await overview();
    expect(data.trend.length).toBeGreaterThan(0);

    const signedDay = data.trend.find((row) => row.signedAiShare !== null);
    expect(signedDay).toBeDefined();
    // 改过一句，所以签发时不该是 100%——那正是这条线要暴露的东西。
    expect(signedDay!.signedAiShare).toBeLessThan(1);
    expect(signedDay!.manuscripts).toBeGreaterThan(0);
  });

  it('counts each rule once, not once per position in the rules array', async () => {
    await post('/api/demo/reset');
    await walkOne();

    const data = await overview();
    expect(data.ruleHits.length).toBeGreaterThan(0);

    // 这条断言看着平淡，挡的是一个具体的坑：`json_each` 自带 `key` 列（数组
    // 下标），SQL 里写 `GROUP BY key` 会被解析成按下标分组，同一条规则出现在
    // rules[1] 和 rules[3] 就变成两行，排行榜的名次跟着错。
    const keys = data.ruleHits.map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('leaves machine-written traces out of 内容生产者', async () => {
    await post('/api/demo/reset');
    await walkOne();

    const data = await overview();
    // 自动补 AI 标识时系统也会重写句级来源、也记 segments-recorded。
    // 那不是人的改稿量，这张表里不该有它。
    expect(data.producers.every((row) => row.displayName !== '（无署名）')).toBe(true);

    const total = data.producers.reduce((sum, row) => sum + row.revised, 0);
    expect(total).toBe(1); // walkOne 只有一次人工改稿
  });

  it('serves the board with no external resource', async () => {
    const response = await request('/monitor');
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('把关人 · 全流程监控');
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });
});

/**
 * 眼下四个角色都持有 audit:read，真实账号里造不出「没这条权限的人」。临时把
 * 矩阵收紧一格，验的正是收紧那天守卫会不会跟着生效——这也是给这两处补
 * requireAuditRead 的全部理由。改动在 finally 里原样还回去。
 */
async function withoutAuditRead(role: SystemRole, run: () => Promise<void>): Promise<void> {
  const granted = rolePermissions[role] as Permission[];
  const index = granted.indexOf('audit:read');
  expect(index, `${role} 本应持有 audit:read`).toBeGreaterThanOrEqual(0);
  granted.splice(index, 1);
  try {
    await run();
  } finally {
    granted.splice(index, 0, 'audit:read');
  }
}

describe('监控看板的守卫', () => {
  it('sends an anonymous visitor to the login page instead of an empty shell', async () => {
    const response = await app.request('/monitor');

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/login?next=/monitor');
  });

  it('requires audit:read, not merely a session, on both the board and its data', async () => {
    const station = authenticatedRequest(app, await loginAs(app, 'stationadmin'));
    expect((await station('/api/monitor/overview')).status).toBe(200);
    expect((await station('/monitor')).status).toBe(200);

    await withoutAuditRead('station-leader', async () => {
      const data = await station('/api/monitor/overview');
      expect(data.status).toBe(403);
      expect(await data.json()).toMatchObject({ error: 'role_not_allowed' });
      // 页面同样收紧，否则试用者会盯着一个只会报「取数失败」的空壳。
      expect((await station('/monitor')).status).toBe(403);
    });
  });
});

describe('工作台顶栏的监控入口', () => {
  const allowList = (html: string): string[] => {
    const matched = html.match(/var AUDIT_READ_ROLES = (\[[^\]]*\]);/);
    expect(matched, '顶栏没有注入可读留痕的角色名单').not.toBeNull();
    return JSON.parse(matched![1]!) as string[];
  };

  it('puts a link to the board in the topbar, hidden until the account is known', () => {
    const html = renderWorkbench({ demoToolsEnabled: true });

    expect(html).toContain(
      '<a class="topbar-link" id="monitor-link" href="/monitor" hidden>全流程监控</a>',
    );
    expect(html).toContain("$('monitor-link').hidden = !(user.roles || []).some(");
  });

  it('derives the allow-list from the permission matrix instead of copying it', () => {
    expect(allowList(renderWorkbench({ demoToolsEnabled: true }))).toEqual(
      systemRoles.filter((role) => rolePermissions[role].includes('audit:read')),
    );
    // 台领导没有任何流程角色，却正是这块看板的主要读者。
    expect(allowList(renderWorkbench({ demoToolsEnabled: true }))).toContain('station-leader');
  });

  it('hides the entry from a role the matrix stops granting audit:read', async () => {
    await withoutAuditRead('station-leader', async () => {
      expect(allowList(renderWorkbench({ demoToolsEnabled: true }))).not.toContain('station-leader');
    });
  });
});
