/**
 * 第 ③ 屏的「这次生成动了什么」。
 *
 * 这套用例守两件事：
 *
 * 1. **AI 埋的雷必须报出来。** 编造的数字与虚构的人名在原通稿里不存在、在产物里
 *    存在，所以必须落进 `introduced`。这一栏是整个面板存在的理由。
 * 2. **别把必然项算成 AI 的过错。** 「缺少 AI 生成内容标识」模型永远不会自己加、
 *    预检永远会自动补；把它算进 `introduced`，警报栏就天天亮着，亮着等于没有。
 */
import { describe, expect, it } from 'vitest';

import { app } from '../src/index.js';
import { diffGeneration, type IssueScan } from '../src/domain/generation-delta.js';
import { runPreflight } from '../src/rules/index.js';
import { authenticatedRequest, loginAs } from './helpers/auth.js';

const NOTICE = [
  '8月28日，全市文明城市创建工作推进会隆重召开。市文明办负责人亲自出席会议并发表重要讲话。',
  '会议布署了下一阶段重点任务，全市已建成新时代文明实践中心 12 个，注册志愿者 8.6 万人。',
  '会议要求，各单位要一如继往抓好落实，确保创建工作取得实效。',
];
const SOURCE = NOTICE.join('\n');

const scan = (sentences: string[], sourceText = SOURCE): IssueScan => ({
  annotations: runPreflight({ artifactId: 'probe', sentences, sourceText }).annotations,
  sentences,
});

const texts = (list: ReadonlyArray<{ text: string }>) => list.map((issue) => issue.text);

describe('生成前后的问题增减', () => {
  it('reports what the model cleaned up', () => {
    // 真模型会自己把这些改对：隆重召开→召开、布署→部署、一如继往→一以贯之。
    const clean = [
      '全市文明城市创建工作推进会昨天召开，市文明办负责人出席并讲话。',
      '会议部署了下一阶段重点任务：全市已建成新时代文明实践中心12个，注册志愿者8.6万人。',
      '要求各单位一以贯之抓好落实，确保创建工作见实效。',
    ];
    const delta = diffGeneration(scan(NOTICE), [scan(clean)]);

    expect(texts(delta.sourceIssues)).toEqual(
      expect.arrayContaining(['隆重召开', '亲自', '发表重要讲话', '布署', '一如继往']),
    );
    expect(texts(delta.resolved)).toEqual(
      expect.arrayContaining(['隆重召开', '亲自', '布署', '一如继往']),
    );
    expect(delta.introduced).toHaveLength(0);
    expect(delta.carried).toHaveLength(0);
  });

  it('raises the alarm when the model invents a number or a person', () => {
    // 这是整个面板存在的理由：模型编的东西原通稿里查无此项。
    const hallucinated = [
      '全市文明城市创建工作推进会昨天召开。',
      '全市已建成新时代文明实践中心 18 个，注册志愿者 9.9 万人。',
      '副市长李国强出席并讲话。',
    ];
    const delta = diffGeneration(scan(NOTICE), [scan(hallucinated)]);

    // 命中的是原文那一段的字面，带不带空格取决于稿子怎么写；数字模式里「万」排在
    // 「人」前面，所以 9.9 万人 切出来是「9.9 万」。这是既有引擎行为，不在这里改。
    expect(texts(delta.introduced)).toEqual(expect.arrayContaining(['18 个', '9.9 万']));
    expect(delta.introduced.some((issue) => issue.text.includes('李国强'))).toBe(true);
    for (const issue of delta.introduced) expect(issue.category).toBe('inconsistency');
  });

  it('keeps a problem the model carried over in its own row, not in the alarm', () => {
    const lazy = ['全市文明城市创建工作推进会隆重召开。'];
    const delta = diffGeneration(scan(NOTICE), [scan(lazy)]);

    expect(texts(delta.carried)).toContain('隆重召开');
    expect(texts(delta.introduced)).not.toContain('隆重召开');
  });

  it('never counts the missing AI label as something the model introduced', () => {
    // 模型不会自己加标识，预检会自动补。把必然项算成 AI 的过错，警报栏就天天
    // 亮着——亮着等于没有。
    const clean = ['全市推进会昨天召开。'];
    const delta = diffGeneration(scan(['全市推进会今天召开。']), [scan(clean)]);

    for (const bucket of [delta.introduced, delta.resolved, delta.carried, delta.sourceIssues]) {
      expect(bucket.every((issue) => issue.category !== 'ai-label')).toBe(true);
    }
  });

  it('never lets 与原通稿不一致 show up against the source itself', () => {
    // 那一类的语义是「拿产物比原通稿」。原通稿自比恒为空，留着只会让人误会
    // 原通稿「和自己对不上」。
    const delta = diffGeneration(scan(NOTICE), [scan(NOTICE)]);
    expect(delta.sourceIssues.every((issue) => issue.category !== 'inconsistency')).toBe(true);
  });

  it('merges repeats of one word into a single item with a count', () => {
    const twice = ['设备已按装。', '线路也按装完毕。'];
    const delta = diffGeneration(scan(twice), [scan(['设备与线路均已安装完毕。'])]);
    const typo = delta.resolved.find((issue) => issue.text === '按装');
    expect(typo?.count).toBe(2);
  });

  it('puts the heaviest action first, so 拦下不让播 is never buried', () => {
    const messy = ['会议隆重召开，负责人亲自出席。', '设备已按装。'];
    const delta = diffGeneration(scan(messy), [scan(['会议召开。'])]);
    expect(delta.resolved[0]?.action).toBe('block');
  });
});

describe('工作台把它带给界面', () => {
  it('ships a delta with the generated manuscript', async () => {
    const request = authenticatedRequest(app, await loginAs(app, 'zhangmin'));
    const created = await request('/api/workbench', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '文明城市创建推进会', sourceType: 'notice', sourceText: SOURCE }),
    });
    const { manuscript } = (await created.json()) as { manuscript: { id: string } };

    const generated = await request(`/api/workbench/${manuscript.id}/transition`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'generated', role: 'editor' }),
    });
    expect(generated.status).toBe(200);

    const view = (await (await request(`/api/workbench/${manuscript.id}`)).json()) as {
      generationDelta?: { sourceIssues: unknown[]; introduced: Array<{ category: string }> };
    };
    expect(view.generationDelta).toBeDefined();
    expect(view.generationDelta!.sourceIssues.length).toBeGreaterThan(0);
    // 确定性 mock 会故意埋雷（改错的数字、虚构的副市长），所以这一栏必须非空——
    // 它空了说明比对没生效，而不是模型变乖了。
    expect(view.generationDelta!.introduced.length).toBeGreaterThan(0);
  });

  it('omits the delta before anything has been generated', async () => {
    const request = authenticatedRequest(app, await loginAs(app, 'zhangmin'));
    const created = await request('/api/workbench', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '还没生成', sourceType: 'notice', sourceText: '全市例会今天召开。' }),
    });
    const { manuscript } = (await created.json()) as { manuscript: { id: string } };
    const view = (await (await request(`/api/workbench/${manuscript.id}`)).json()) as {
      generationDelta?: unknown;
    };
    // 还没有产物就没有「前后」可比，给个空壳只会让人以为比过了。
    expect(view.generationDelta).toBeUndefined();
  });
});
