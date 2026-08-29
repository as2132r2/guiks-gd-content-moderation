import { describe, expect, it } from 'vitest';
import { SEED_ACCOUNTS, SEED_MANUSCRIPTS } from '../src/demo-dataset.js';
import { parseResetArguments } from '../src/reset-demo.js';
import { isSystemRole } from '../src/domain/contracts.js';
import { transitions } from '../src/domain/workflow.js';
import { runAdmission } from '../src/rules/index.js';

describe('清理脚本的护栏', () => {
  it('refuses to run without an explicit confirmation', () => {
    // 它删的是整库稿件连同留痕，责任链删掉找不回来——手滑必须不可能发生。
    expect(parseResetArguments([]).confirmed).toBe(false);
    expect(parseResetArguments(['--yes']).confirmed).toBe(true);
  });

  it('keeps accounts unless asked, so a re-seed does not clobber changed passwords', () => {
    expect(parseResetArguments(['--yes']).accounts).toBe(false);
    expect(parseResetArguments(['--yes', '--accounts']).accounts).toBe(true);
  });

  it('rejects anything it does not understand rather than guessing', () => {
    expect(() => parseResetArguments(['--force'])).toThrow(/unknown option/);
    expect(() => parseResetArguments(['--yes', '-y'])).toThrow(/unknown option/);
  });
});

describe('试用账号', () => {
  it('declares only real system roles', () => {
    for (const account of SEED_ACCOUNTS) {
      expect(account.roles.length).toBeGreaterThan(0);
      expect(account.roles.every(isSystemRole)).toBe(true);
      expect(account.purpose).toBeTruthy();
    }
  });

  it('gives one account every workflow role, so one person can walk the whole chain', () => {
    // 手册的推荐路径靠它：融媒体中心常常只有两三个人，一人多岗是实况。
    const merged = SEED_ACCOUNTS.find((account) => account.username === 'zhangmin');
    expect(merged?.roles).toEqual(
      expect.arrayContaining(['editor', 'department-head', 'supervising-leader']),
    );
  });

  it('keeps a single-role account, so 越权推不动 can actually be demonstrated', () => {
    const single = SEED_ACCOUNTS.find((account) => account.username === 'lijianguo');
    expect(single?.roles).toEqual(['department-head']);
  });

  it('has usernames the manual can print verbatim', () => {
    for (const account of SEED_ACCOUNTS) {
      expect(account.username).toMatch(/^[a-z0-9][a-z0-9._-]{2,63}$/);
    }
  });
});

describe('试用数据集', () => {
  it('leaves work for the visitor instead of parking everything in a terminal state', () => {
    // 一进来全是终态就只能看不能试。
    const stops = SEED_MANUSCRIPTS.map((seed) => seed.stopAt);
    expect(stops).toContain('preflight');
    expect(stops).toContain('second-review');
    expect(stops).toContain('published');
  });

  it('covers all three admission lanes', () => {
    const lanes = SEED_MANUSCRIPTS.filter((seed) => seed.stopAt === 'admission').map(
      (seed) => runAdmission(seed).decision,
    );
    expect(new Set(lanes)).toEqual(new Set(['blocked', 'reason-required', 'admitted-logged']));
  });

  it('keeps every walked manuscript out of the admission gates', () => {
    // 走主链的稿件若命中硬拦或要理由，播种会在半路停下或多要一步。
    for (const seed of SEED_MANUSCRIPTS.filter((item) => item.stopAt !== 'admission')) {
      expect(runAdmission(seed).decision).toBe('admitted-logged');
    }
  });

  it('leads every walked manuscript with a money figure, which the misquote hangs on', () => {
    for (const seed of SEED_MANUSCRIPTS.filter((item) => item.stopAt !== 'admission')) {
      const first = /\d+(?:\.\d+)?\s*(亿元|万元|元|万|亿|人次|人|户|公里|吨|平方米|家|个|所)/.exec(
        seed.sourceText,
      );
      expect(first, `${seed.title} 缺少带单位的数字`).not.toBeNull();
    }
  });

  it('has at least one bounce, so the board shows a non-zero return rate', () => {
    expect(SEED_MANUSCRIPTS.some((seed) => seed.bounce)).toBe(true);
  });

  it('spreads coverage topics, or the 报道方向 chart is a single bar', () => {
    const topics = new Set(SEED_MANUSCRIPTS.map((seed) => seed.coverageTopic));
    expect(topics.size).toBeGreaterThanOrEqual(4);
  });
});

describe('播种脚本走的路必须是状态机允许的', () => {
  const legal = (from: string, to: string) =>
    transitions.some((move) => move.from === from && move.to === to);

  it('walks a path the state machine still allows', () => {
    // 状态机改过一次（退回从「回上一级」改成统一落 revision），播种脚本当时就断了。
    // 这条用例把主链钉死，下次再改状态机会先在这里红。
    const main = [
      ['admitted', 'generated'],
      ['generated', 'preflight'],
      ['preflight', 'first-review'],
      ['first-review', 'second-review'],
      ['second-review', 'final-review'],
      ['final-review', 'signed'],
      ['signed', 'published'],
    ];
    for (const [from, to] of main) expect(legal(from!, to!), `${from} → ${to}`).toBe(true);
  });

  it('bounces the way the state machine now models it', () => {
    expect(legal('second-review', 'revision')).toBe(true);
    expect(legal('revision', 'preflight')).toBe(true);
    // 旧写法：复审直接退回初审。已经不合法了。
    expect(legal('second-review', 'first-review')).toBe(false);
  });

  it('opens the 要理由 gate the way the seed script does', () => {
    expect(legal('admission-reason-required', 'admitted')).toBe(true);
  });
});
