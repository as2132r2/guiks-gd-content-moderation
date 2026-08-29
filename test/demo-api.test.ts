import { beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/index.js';
import { DEMO_FIXTURES, MAIN_NOTICE } from '../src/routes/demo-fixtures.js';
import { BROADCAST_TASK, SOURCE_MARKER, broadcastMockReply } from '../src/model/broadcast-mock.js';
import { runAdmission, runPreflight } from '../src/rules/index.js';
import { authenticatedRequest, loginAs } from './helpers/auth.js';

let request: ReturnType<typeof authenticatedRequest>;

beforeAll(async () => {
  request = authenticatedRequest(app, await loginAs(app));
});

const post = (path: string) => request(path, { method: 'POST' });

interface SeedResult {
  deleted: number;
  created: Array<{ id: string; label: string; status: string; decision: string; reasonCode: string }>;
}

describe('演示夹具', () => {
  it('seeds the three admission lanes, each landing in its own状态', async () => {
    const response = await post('/api/demo/seed');
    expect(response.status).toBe(200);
    const seeded = (await response.json()) as SeedResult;

    expect(seeded.created.map((item) => item.label)).toEqual(['要理由', '硬拦', '公器私用']);
    expect(seeded.created.map((item) => item.decision)).toEqual([
      'reason-required',
      'blocked',
      'admitted-logged',
    ]);
    expect(seeded.created.map((item) => item.status)).toEqual([
      'admission-reason-required',
      'admission-blocked',
      'admitted',
    ]);
    expect(seeded.created[2]!.reasonCode).toBe('off-duty-use');
  });

  it('lists the seeded cases in the order the demo script walks them', async () => {
    await post('/api/demo/seed');
    const list = (await (await request('/api/workbench')).json()) as {
      items: Array<{ title: string }>;
    };
    // 0:25 先讲「要理由」，所以它必须排在列表最上面。
    expect(list.items.slice(0, 3).map((item) => item.title)).toEqual(
      DEMO_FIXTURES.map((fixture) => fixture.title),
    );
  });

  it('wipes everything, so a rehearsal starts from a known state', async () => {
    await post('/api/demo/seed');
    const reset = (await (await post('/api/demo/reset')).json()) as { deleted: number };
    expect(reset.deleted).toBeGreaterThanOrEqual(DEMO_FIXTURES.length);

    const list = (await (await request('/api/workbench')).json()) as { items: unknown[] };
    expect(list.items).toEqual([]);
  });

  it('serves the main notice for the 填入示例 button', async () => {
    const data = (await (await request('/api/demo/fixtures')).json()) as {
      mainNotice: { title: string; sourceText: string };
      cases: unknown[];
    };
    expect(data.mainNotice.title).toBe(MAIN_NOTICE.title);
    expect(data.cases).toHaveLength(3);
  });
});

describe('主通稿的四条硬要求', () => {
  it('stays in the 仅留痕 lane, or the 0:25 three-way contrast loses a leg', () => {
    expect(runAdmission(MAIN_NOTICE)).toMatchObject({
      decision: 'admitted-logged',
      reasonCode: 'routine',
      hits: [],
    });
  });

  it('leads with a money figure, which is what the misquote hangs on', () => {
    // mock 取正文里第一个带单位的数字做手脚。如果排在前面的是「3200 户」，
    // 播报稿会生成「总投资 3680户」这种不通的句子，1:20 的数字标红就废了。
    const first = /\d+(?:\.\d+)?\s*(亿元|万元|元|万|亿|人次|人|户|公里|吨|平方米|家)/.exec(
      MAIN_NOTICE.sourceText,
    );
    expect(first).not.toBeNull();
    expect(first![1]).toBe('亿元');
  });

  it('opens with a complete sentence usable as a 导语', () => {
    const lead = MAIN_NOTICE.sourceText.split(/[。！？\n]/).map((s) => s.trim()).find(Boolean)!;
    expect(lead.length).toBeGreaterThan(15);
    expect(lead).toContain('召开');
  });

  it('keeps every 准入样例 in the lane the demo script promises', () => {
    const lanes = DEMO_FIXTURES.map((fixture) => runAdmission(fixture).decision);
    expect(lanes).toEqual(['reason-required', 'blocked', 'admitted-logged']);
  });
});

describe('1:20 预检那一镜的四处命中', () => {
  const generate = (task: string) =>
    broadcastMockReply([
      { role: 'user', content: `${task}\n${SOURCE_MARKER}${MAIN_NOTICE.sourceText}` },
    ])!
      .split('\n')
      .filter(Boolean);

  const shippedAnnotations = () =>
    [
      runPreflight({
        artifactId: 'script',
        sentences: generate(BROADCAST_TASK.script),
        sourceText: MAIN_NOTICE.sourceText,
      }),
      runPreflight({
        artifactId: 'short',
        sentences: generate(BROADCAST_TASK.shortVideo),
        sourceText: MAIN_NOTICE.sourceText,
      }),
    ]
      .flatMap((result) => result.annotations)
      // AI 标识会被自动补写，不进演示屏那三个数。
      .filter((annotation) => annotation.category !== 'ai-label');

  it('copies the real leader through without flagging it', () => {
    // 原通稿里真有「市委书记周立」。把它标出来，1:20 那句
    //「系统比的是原稿里有没有」就说不成立了。
    const script = generate(BROADCAST_TASK.script).join('\n');
    expect(script).toContain('市委书记周立');
    expect(
      shippedAnnotations().some((annotation) => annotation.title.includes('周立')),
    ).toBe(false);
  });

  it('invents one leader the 原通稿 never had, and catches it', () => {
    expect(generate(BROADCAST_TASK.script).join('\n')).toContain('副市长李国强');
    expect(MAIN_NOTICE.sourceText).not.toContain('李国强');
    expect(
      shippedAnnotations().some((annotation) => annotation.title === '与原通稿不一致：副市长李国强'),
    ).toBe(true);
  });

  it('holds the counts the 口播稿 reads out loud', () => {
    const shipped = shippedAnnotations();
    const count = (action: string) => shipped.filter((item) => item.action === action).length;
    // 改这三个数，docs/demo/script.md、source-notice.md、runbook.md 要一起改。
    expect({ block: count('block'), redact: count('redact'), flag: count('flag') }).toEqual({
      block: 1,
      redact: 3,
      flag: 1,
    });
  });
});
