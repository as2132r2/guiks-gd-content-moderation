import { describe, expect, it } from 'vitest';
import { app } from '../src/index.js';
import { DEMO_FIXTURES, MAIN_NOTICE } from '../src/routes/demo-fixtures.js';
import { runAdmission } from '../src/rules/index.js';

const post = (path: string) => app.request(path, { method: 'POST' });

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
    const list = (await (await app.request('/api/workbench')).json()) as {
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

    const list = (await (await app.request('/api/workbench')).json()) as { items: unknown[] };
    expect(list.items).toEqual([]);
  });

  it('serves the main notice for the 填入示例 button', async () => {
    const data = (await (await app.request('/api/demo/fixtures')).json()) as {
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
