/**
 * 使用限制。
 *
 * 这套用例守的核心只有一条：**超限是资源判定，不是内容判定，两者一个字段都不共用。**
 * 混在一起，留痕里会长出「因为超限所以被判违规」的假因果——而「说得清」正是
 * 这个产品的立身之本。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '../src/index.js';
import { createDatabase, type DatabaseHandle } from '../src/db/client.js';
import { WorkflowRepository } from '../src/db/repository.js';
import { localDay } from '../src/db/usage.js';
import { quotaMessage } from '../src/domain/usage-limit.js';
import { authenticatedRequest, loginAs } from './helpers/auth.js';

type Request = ReturnType<typeof authenticatedRequest>;

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const put = (body: unknown) => ({ ...json(body), method: 'PUT' });

interface LimitsView {
  limits: { dailyCalls?: number; dailyTokens?: number; updatedBy?: string };
  day: string;
  today: Array<{ userId: string; displayName?: string; calls: number; tokensIn: number }>;
  blocked: Array<{ actor: string; kind: string; used: number; limit: number }>;
  canWrite: boolean;
}

const limitsOf = async (request: Request): Promise<LimitsView> =>
  (await (await request('/api/usage-limits')).json()) as LimitsView;

/** 把一篇稿子推到「已准入」，下一步就是会烧 token 的生成。 */
async function admittedManuscript(request: Request, title: string): Promise<string> {
  const created = await request(
    '/api/workbench',
    json({ title, sourceType: 'notice', sourceText: `${title}。全市有关部门参加。` }),
  );
  const body = (await created.json()) as { manuscript: { id: string; status: string } };
  expect(body.manuscript.status).toBe('admitted');
  return body.manuscript.id;
}

const generate = (request: Request, id: string) =>
  request(`/api/workbench/${id}/transition`, json({ to: 'generated', role: 'editor' }));

describe('计数落库', () => {
  let database: DatabaseHandle;
  let repository: WorkflowRepository;

  beforeEach(() => {
    database = createDatabase(':memory:');
    repository = new WorkflowRepository(database);
  });
  afterEach(() => repository.close());

  it('ships with no limit at all, so installing this changes nothing', () => {
    // 出厂两项都空。装上这一版之后开箱行为一个字没变，演示数字也不会漂。
    const limits = repository.usage.limits();
    expect(limits.dailyCalls).toBeUndefined();
    expect(limits.dailyTokens).toBeUndefined();
    expect(repository.usage.check('anyone').allowed).toBe(true);
  });

  it('accumulates per account per day', () => {
    repository.usage.record('user-a', 100, 50);
    repository.usage.record('user-a', 10, 5);
    repository.usage.record('user-b', 7, 3);

    expect(repository.usage.counter('user-a')).toMatchObject({
      calls: 2,
      tokensIn: 110,
      tokensOut: 55,
    });
    expect(repository.usage.counter('user-b')).toMatchObject({ calls: 1 });
  });

  it('keeps yesterday out of today, so the quota really does reset', () => {
    repository.usage.record('user-a', 1000, 1000, '2026-08-28');
    expect(repository.usage.counter('user-a', '2026-08-29')).toMatchObject({ calls: 0 });
  });

  it('blocks on whichever ceiling is hit first', () => {
    repository.usage.setLimits({ dailyCalls: 2 }, '台领导');
    repository.usage.record('user-a', 1, 1);
    expect(repository.usage.check('user-a').allowed).toBe(true);
    repository.usage.record('user-a', 1, 1);
    expect(repository.usage.check('user-a')).toMatchObject({
      allowed: false,
      kind: 'calls',
      used: 2,
      limit: 2,
    });

    repository.usage.setLimits({ dailyCalls: null, dailyTokens: 100 }, '台领导');
    expect(repository.usage.check('user-a').allowed).toBe(true);
    repository.usage.record('user-a', 60, 40);
    expect(repository.usage.check('user-a')).toMatchObject({ allowed: false, kind: 'tokens' });
  });
});

describe('使用限制接口的鉴权', () => {
  it('rejects anonymous access', async () => {
    expect((await app.request('/api/usage-limits')).status).toBe(401);
    expect((await app.request('/api/usage-limits', put({}))).status).toBe(401);
  });

  it('lets every role read and only the station leader write', async () => {
    const editor = authenticatedRequest(app, await loginAs(app, 'zhangmin'));
    expect((await limitsOf(editor)).canWrite).toBe(false);
    const denied = await editor('/api/usage-limits', put({ dailyCalls: 1 }));
    expect(denied.status).toBe(403);

    const leader = authenticatedRequest(app, await loginAs(app, 'stationadmin'));
    expect((await limitsOf(leader)).canWrite).toBe(true);
  });

  it('refuses a zero ceiling, which is account suspension wearing a quota costume', async () => {
    const leader = authenticatedRequest(app, await loginAs(app, 'stationadmin'));
    expect((await leader('/api/usage-limits', put({ dailyCalls: 0 }))).status).toBe(400);
  });
});

describe('超限与入口准入判然两分', () => {
  let leader: Request;
  let editor: Request;

  beforeEach(async () => {
    leader = authenticatedRequest(app, await loginAs(app, 'stationadmin'));
    editor = authenticatedRequest(app, await loginAs(app, 'zhangmin'));
    await leader('/api/usage-limits', put({ dailyCalls: null, dailyTokens: null }));
  });

  it('charges one call per model invocation and shows it under the operator name', async () => {
    const id = await admittedManuscript(editor, '全市防汛工作会议召开');
    expect((await generate(editor, id)).status).toBe(200);

    const view = await limitsOf(leader);
    const mine = view.today.find((row) => row.displayName === '张敏');
    // 一次生成产两份产物 = 两次调用。配额算的是模型调用，不是稿件。
    expect(mine?.calls).toBe(2);
    expect(mine?.tokensIn).toBeGreaterThan(0);
    expect(view.day).toBe(localDay());
  });

  it('refuses the generation with 429 and leaves the manuscript exactly where it was', async () => {
    const id = await admittedManuscript(editor, '全市秋季征兵工作部署会召开');
    await leader('/api/usage-limits', put({ dailyCalls: 1 }));

    const response = await generate(editor, id);
    expect(response.status).toBe(429);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe('usage_quota_exceeded');

    // 编辑看到 429 的第一反应一定是「我写的东西有问题？」——文案必须把这个掐掉。
    expect(body.message).toContain('这不是内容判定');
    expect(body.message).not.toContain('准入');

    // 稿件一步没动，也没有被写成任何一种准入结论。
    const view = (await (await editor(`/api/workbench/${id}`)).json()) as {
      manuscript: { status: string };
      admission: { decision: string; reasonCode: string };
    };
    expect(view.manuscript.status).toBe('admitted');
    expect(view.admission.decision).toBe('admitted-logged');
    expect(view.admission.reasonCode).not.toBe('illegal-unrelated');
  });

  it('records the refusal as its own trace kind, not as a rule hit', async () => {
    const id = await admittedManuscript(editor, '全市文化惠民演出季启动');
    await leader('/api/usage-limits', put({ dailyCalls: 1 }));
    expect((await generate(editor, id)).status).toBe(429);

    const view = (await (await editor(`/api/workbench/${id}`)).json()) as {
      trace: Array<{ kind: string; actor: string; data: Record<string, unknown> }>;
    };
    const quota = view.trace.find((event) => event.kind === 'quota-blocked');
    expect(quota).toBeDefined();
    // actor 是「使用限制」不是「入口准入」：追溯图谱上要一眼看得出这是资源判定。
    expect(quota?.actor).toBe('使用限制');
    expect(quota?.data).toMatchObject({ quotaKind: 'calls', modelInvoked: false });

    // 而且它没有污染入口准入那条留痕。
    const ruleHit = view.trace.find((event) => event.kind === 'rule-hit');
    expect(ruleHit?.data.decision).toBe('admitted-logged');
  });

  it('burns nothing when it refuses: the model is never called', async () => {
    const id = await admittedManuscript(editor, '全市老旧小区改造推进会召开');
    await leader('/api/usage-limits', put({ dailyCalls: 1 }));
    const before = (await limitsOf(leader)).today.find((row) => row.displayName === '张敏');

    expect((await generate(editor, id)).status).toBe(429);

    const after = (await limitsOf(leader)).today.find((row) => row.displayName === '张敏');
    // 挡在网关入口，token 一个没烧——和入口准入硬拦同一个论证。
    expect(after?.calls).toBe(before?.calls);
    expect(after?.tokensIn).toBe(before?.tokensIn);
  });

  it('shows the refusal on the limits page with who, which ceiling, and how much', async () => {
    const id = await admittedManuscript(editor, '全市河湖长制工作推进会召开');
    await leader('/api/usage-limits', put({ dailyCalls: 1 }));
    await generate(editor, id);

    const view = await limitsOf(leader);
    expect(view.blocked[0]).toMatchObject({ kind: 'calls', limit: 1 });
    expect(view.blocked[0]?.actor).toContain('张敏');
  });

  it('lets work resume the moment the ceiling is raised', async () => {
    const id = await admittedManuscript(editor, '全市冬季供暖准备工作会议召开');
    await leader('/api/usage-limits', put({ dailyCalls: 1 }));
    expect((await generate(editor, id)).status).toBe(429);

    await leader('/api/usage-limits', put({ dailyCalls: 100000 }));
    expect((await generate(editor, id)).status).toBe(200);
  });
});

describe('给编辑的那句话', () => {
  it('names the quota and denies being a content verdict', () => {
    const message = quotaMessage({ allowed: false, kind: 'tokens', used: 5000, limit: 4000, day: '2026-08-29' });
    expect(message).toContain('token 额度');
    expect(message).toContain('5000 / 4000');
    expect(message).toContain('这不是内容判定');
    expect(message).toContain('稿件状态也没有变');
  });
});
