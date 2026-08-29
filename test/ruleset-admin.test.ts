/**
 * 判定依据管理。
 *
 * 这套用例守的是一句话：**词表可以改，但改了之后「说得清」不能掉。**
 * 出处必填、理由必填、基线删不掉、改动查得到、判定留痕带版本号——少一条，
 * 词表落库就从「把判定依据变成产品的一部分」退化成「给系统开了个后门」。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '../src/index.js';
import { createDatabase, type DatabaseHandle } from '../src/db/client.js';
import { WorkflowRepository } from '../src/db/repository.js';
import { runAdmission, runPreflight } from '../src/rules/index.js';
import { builtinManagedRules, toRuleset } from '../src/rules/ruleset.js';
import { authenticatedRequest, loginAs } from './helpers/auth.js';

type Request = ReturnType<typeof authenticatedRequest>;

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const patch = (body: unknown) => ({ ...json(body), method: 'PATCH' });
const remove = (body: unknown) => ({ ...json(body), method: 'DELETE' });

interface RuleRow {
  ruleId: string;
  term: string;
  source: string;
  origin: string;
  enabled: boolean;
  scope: string;
  admissionBucket?: string;
}
interface Listing {
  version: number;
  rules: RuleRow[];
  canWrite: boolean;
  engineRules: Array<{ ruleId: string }>;
}

const list = async (request: Request): Promise<Listing> =>
  (await (await request('/api/rules')).json()) as Listing;

describe('内置基线灌库', () => {
  let database: DatabaseHandle;
  let repository: WorkflowRepository;

  beforeEach(() => {
    database = createDatabase(':memory:');
    repository = new WorkflowRepository(database);
    repository.ensureBuiltinRuleTerms();
    // 改动日志的 actor_user_id 指向真实账号——留痕认人，不认一个自由文本。
    repository.ensureDemoUsers();
  });
  afterEach(() => repository.close());

  it('lands every baseline entry with a source it can point at', () => {
    const snapshot = repository.ruleset.snapshot();
    expect(snapshot.version).toBe(0);
    expect(snapshot.rules).toHaveLength(builtinManagedRules(0).length);
    // 出处必填不是前端提示，是数据本身的性质。
    for (const rule of snapshot.rules) {
      expect(rule.source.trim().length, rule.ruleId).toBeGreaterThan(0);
      expect(rule.origin).toBe('builtin');
    }
  });

  it('reproduces the built-in verdicts exactly, so 落库不改变判定', () => {
    const snapshot = repository.ruleset.snapshot();
    const stored = toRuleset(snapshot.version, snapshot.rules);
    const input = { title: '通报', sourceText: '国道发生塌方事故，无人员伤亡。' };
    expect(runAdmission(input, stored)).toEqual(runAdmission(input));

    const sentences = ['会议隆重召开，市领导亲自出席。', '设备已按装完毕。'];
    expect(runPreflight({ artifactId: 'a', sentences, sourceText: '会议。' }, stored)).toEqual(
      runPreflight({ artifactId: 'a', sentences, sourceText: '会议。' }),
    );
  });

  it('never clobbers a disabled entry on re-seed', () => {
    // 重启会再灌一次基线。停用状态被冲回来，台领导不会收到任何提示——
    // 他以为关掉的那条词还在判，这比不能停用更糟。
    const target = repository.ruleset.snapshot().rules[0]!;
    repository.ruleset.update(
      target,
      { enabled: false },
      { userId: 'user_demo_stationadmin', actor: '台领导', reason: '演示用，先关掉' },
    );

    repository.ensureBuiltinRuleTerms();

    expect(repository.ruleset.findRule(target.ruleId)?.enabled).toBe(false);
  });
});

describe('判定依据接口的鉴权', () => {
  it('rejects anonymous reads and writes', async () => {
    expect((await app.request('/api/rules')).status).toBe(401);
    expect((await app.request('/api/rules', json({}))).status).toBe(401);
    const page = await app.request('/rules');
    expect(page.status).toBe(302);
    expect(page.headers.get('location')).toBe('/login?next=/rules');
  });

  it.each(['zhangmin', 'lijianguo', 'wangzhiyuan'])('lets %s read but not write', async (who) => {
    const request = authenticatedRequest(app, await loginAs(app, who));
    const listing = await list(request);
    expect(listing.rules.length).toBeGreaterThan(0);
    expect(listing.canWrite).toBe(false);

    const denied = await request(
      '/api/rules',
      json({ scope: 'admission', term: '测试词', source: '测试出处', reason: '测试理由', admissionBucket: 'reason' }),
    );
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: 'role_not_allowed' });
  });

  it('lets the station leader write', async () => {
    const request = authenticatedRequest(app, await loginAs(app, 'stationadmin'));
    expect((await list(request)).canWrite).toBe(true);
  });
});

describe('改一条词表', () => {
  let request: Request;

  beforeEach(async () => {
    request = authenticatedRequest(app, await loginAs(app, 'stationadmin'));
  });

  it('refuses an entry that cannot say where it came from', async () => {
    const response = await request(
      '/api/rules',
      json({ scope: 'admission', term: '无出处词', admissionBucket: 'reason', reason: '就想加一条' }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('refuses a change that cannot say why', async () => {
    const response = await request(
      '/api/rules',
      json({ scope: 'admission', term: '无理由词', admissionBucket: 'reason', source: '某某规范第三条' }),
    );
    expect(response.status).toBe(400);
  });

  it('adds an entry, bumps the version, logs who changed what, and takes effect', async () => {
    const before = await list(request);

    const created = await request(
      '/api/rules',
      json({
        scope: 'admission',
        term: '重大项目开工',
        admissionBucket: 'reason',
        source: '本台选题管理办法（2026 年修订）第七条',
        reason: '开工报道要先确认口径，走要理由这一档',
      }),
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as { version: number; rule: RuleRow };
    expect(body.version).toBe(before.version + 1);
    expect(body.rule.origin).toBe('custom');

    const changes = (await (await request('/api/rules/changes')).json()) as {
      changes: Array<{ ruleId: string; action: string; actor: string; reason: string; rulesetVersion: number }>;
    };
    const entry = changes.changes.find((item) => item.ruleId === body.rule.ruleId);
    expect(entry).toMatchObject({
      action: 'created',
      actor: '台领导·管理员',
      reason: '开工报道要先确认口径，走要理由这一档',
      rulesetVersion: body.version,
    });

    // 真正生效：新建一篇带这个词的稿子，应该落到「要理由」那一档。
    const manuscriptRequest = authenticatedRequest(app, await loginAs(app, 'zhangmin'));
    const manuscript = await manuscriptRequest(
      '/api/workbench',
      json({ title: '开工仪式', sourceType: 'notice', sourceText: '本市重大项目开工仪式今天举行。' }),
    );
    expect(manuscript.status).toBe(201);
    const view = (await manuscript.json()) as {
      admission: { decision: string; hits: Array<{ ruleId: string }> };
    };
    expect(view.admission.decision).toBe('reason-required');
    expect(view.admission.hits.map((hit) => hit.ruleId)).toContain(body.rule.ruleId);
  });

  it('records the ruleset version on the admission trace', async () => {
    const editor = authenticatedRequest(app, await loginAs(app, 'zhangmin'));
    const created = await editor(
      '/api/workbench',
      json({ title: '例会通报', sourceType: 'notice', sourceText: '全市例会今天召开。' }),
    );
    const { manuscript } = (await created.json()) as { manuscript: { id: string } };
    const view = (await (await editor(`/api/workbench/${manuscript.id}`)).json()) as {
      trace: Array<{ kind: string; data: Record<string, unknown> }>;
    };
    const admission = view.trace.find((event) => event.kind === 'rule-hit');
    // 判定依据可变之后，光记 ruleId 不够——留痕必须说得出「按哪一版判的」。
    expect(typeof admission?.data.rulesetVersion).toBe('number');
  });

  it('keeps the baseline immutable: no deleting, no rewriting its term or source', async () => {
    const listing = await list(request);
    const baseline = listing.rules.find((rule) => rule.ruleId === 'PF-T-01')!;
    expect(baseline.origin).toBe('builtin');

    const deleted = await request(`/api/rules/${baseline.ruleId}`, remove({ reason: '不想要了' }));
    expect(deleted.status).toBe(409);
    expect(await deleted.json()).toMatchObject({ error: 'builtin_rule_immutable' });

    const renamed = await request(
      `/api/rules/${baseline.ruleId}`,
      patch({ term: '改个词面', reason: '试试能不能改' }),
    );
    expect(renamed.status).toBe(409);

    const resourced = await request(
      `/api/rules/${baseline.ruleId}`,
      patch({ source: '我自己说的', reason: '试试能不能改出处' }),
    );
    expect(resourced.status).toBe(409);
  });

  it('lets the baseline be switched off instead, and says so in the log', async () => {
    const disabled = await request(
      '/api/rules/PF-T-03',
      patch({ enabled: false, reason: '本台报道领导活动另有口径，暂不提示' }),
    );
    expect(disabled.status).toBe(200);

    const changes = (await (await request('/api/rules/changes?ruleId=PF-T-03')).json()) as {
      changes: Array<{ action: string; reason: string }>;
    };
    // 「停用」而不是笼统的「修改」——回看「这条词什么时候被关掉的」是最常问的。
    expect(changes.changes[0]).toMatchObject({ action: 'disabled' });

    const listing = await list(request);
    expect(listing.rules.find((rule) => rule.ruleId === 'PF-T-03')?.enabled).toBe(false);
  });

  it('refuses a duplicate rather than letting two entries fight over one word', async () => {
    const payload = {
      scope: 'admission' as const,
      term: '安全生产检查',
      admissionBucket: 'reason' as const,
      source: '本台选题管理办法（2026 年修订）第七条',
      reason: '涉安全生产的报道要先确认口径',
    };
    expect((await request('/api/rules', json(payload))).status).toBe(201);
    const again = await request('/api/rules', json(payload));
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: 'rule_already_exists' });
  });
});

describe('硬拦档的题材词警示', () => {
  let request: Request;

  beforeEach(async () => {
    request = authenticatedRequest(app, await loginAs(app, 'stationadmin'));
  });

  it('stops a topic word from sliding into the hard-block lane unacknowledged', async () => {
    // 「涉黑」是题材不是操作指令。按题材硬拦会把「扫黑除恶专项行动」这类
    // 正经选题拦死——评委问一句「那我要报道这个怎么办」方案当场就崩。
    const response = await request(
      '/api/rules',
      json({
        scope: 'admission',
        term: '涉黑',
        admissionBucket: 'block',
        source: '本台选题管理办法（2026 年修订）第九条',
        reason: '这类题材风险高，想直接拦掉',
      }),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe('block_bucket_confirmation_required');
    expect(body.message).toContain('题材');
  });

  it('warns before promoting an existing 要理由 word into the hard-block lane', async () => {
    // 「制毒」是 AD-R-27，本来就在要理由档。提到硬拦，「破获制毒窝点」这类稿子
    // 一次都调不动模型——这正是 terms.ts 顶部那段注释在守的东西。
    const response = await request(
      '/api/rules/AD-R-27',
      patch({ admissionBucket: 'block', reason: '想提到硬拦' }),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe('block_bucket_confirmation_required');
    expect(body.message).toContain('要理由');
  });

  it('refuses to add a word that already exists rather than letting two entries fight', async () => {
    const response = await request(
      '/api/rules',
      json({
        scope: 'admission',
        term: '制毒',
        admissionBucket: 'block',
        source: '本台选题管理办法（2026 年修订）第九条',
        reason: '想提到硬拦',
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'rule_already_exists' });
  });

  it('lets it through once acknowledged, and keeps the acknowledgement on record', async () => {
    // 不禁止——台领导有权这么做，但这一步得留下他知情的证据。
    const response = await request(
      '/api/rules',
      json({
        scope: 'admission',
        term: '涉黑',
        admissionBucket: 'block',
        source: '本台选题管理办法（2026 年修订）第九条',
        reason: '台党委会决定本季度此类选题一律不自行采写',
        acknowledge: true,
      }),
    );
    expect(response.status).toBe(201);
    const { rule } = (await response.json()) as { rule: RuleRow };

    const changes = (await (await request(`/api/rules/changes?ruleId=${rule.ruleId}`)).json()) as {
      changes: Array<{ acknowledgedWarning?: string }>;
    };
    expect(changes.changes[0]?.acknowledgedWarning).toContain('题材');
  });

  it('does not get in the way of an instructional phrase, which is what the lane is for', async () => {
    const response = await request(
      '/api/rules',
      json({
        scope: 'admission',
        term: '刷单教程',
        admissionBucket: 'block',
        source: '本台选题管理办法（2026 年修订）第九条',
        reason: '操作指令式措辞，与新闻业务无关',
      }),
    );
    expect(response.status).toBe(201);
  });
});

describe('不落库的那一部分', () => {
  it('still lists the engine rules it cannot edit', async () => {
    // 看不见会让人以为词表就是判定的全部，那反而是新的误导。
    const request = authenticatedRequest(app, await loginAs(app, 'stationadmin'));
    const listing = await list(request);
    expect(listing.engineRules.length).toBeGreaterThan(0);
    expect(listing.engineRules.map((rule) => rule.ruleId)).toContain('PF-N-01..09');
  });
});
