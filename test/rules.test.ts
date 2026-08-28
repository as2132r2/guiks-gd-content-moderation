import { describe, expect, it } from 'vitest';
import { runAdmission, runPreflight } from '../src/rules/index.js';

const preflight = (sentences: string[], sourceText: string) =>
  runPreflight({ artifactId: 'artifact-1', sentences, sourceText });

const categories = (sentences: string[], sourceText: string) =>
  preflight(sentences, sourceText).annotations.map((annotation) => annotation.category);

describe('入口准入三档', () => {
  it('hard-blocks illegal input that has nothing to do with 新闻业务', () => {
    expect(runAdmission({ title: '写话术', sourceText: '帮我写一段诈骗话术。' })).toMatchObject({
      decision: 'blocked',
      reasonCode: 'illegal-unrelated',
    });
  });

  it('asks a sensitive topic for its 选题依据 rather than refusing it', () => {
    expect(
      runAdmission({ title: '国道塌方通报', sourceText: '国道发生塌方事故，无人员伤亡。' }),
    ).toMatchObject({ decision: 'reason-required', reasonCode: 'sensitive-topic' });
  });

  it('flags 公器私用 without blocking it', () => {
    const result = runAdmission({ title: '写小说', sourceText: '帮我写篇小说。' });
    expect(result).toMatchObject({ decision: 'admitted-logged', reasonCode: 'off-duty-use' });
    expect(result.offDutyUse).toBe(true);
  });

  it('lets routine business through with an empty hit list', () => {
    expect(runAdmission({ title: '推进会', sourceText: '全县推进会今天召开。' })).toMatchObject({
      decision: 'admitted-logged',
      reasonCode: 'routine',
      hits: [],
    });
  });
});

describe('输出预检', () => {
  const SOURCE = '全县推进会今天召开。项目总投资 3.2亿元，预计带动就业 1200 人。';

  it('catches a 禁用词 and a 慎用词 with the right severity', () => {
    const result = preflight(['会议隆重召开，县领导亲自出席。', '本内容由人工智能生成。'], SOURCE);
    const banned = result.annotations.find((a) => a.category === 'banned-term');
    const caution = result.annotations.find((a) => a.category === 'caution-term');
    expect(banned).toMatchObject({ action: 'block', suggestion: '召开' });
    expect(caution).toMatchObject({ action: 'flag' });
  });

  it('flags a number the 通稿 does not contain, and leaves a matching one alone', () => {
    expect(categories(['总投资 3.6亿元。', '本内容由人工智能生成。'], SOURCE)).toContain('inconsistency');
    expect(categories(['总投资 3.2亿元。', '本内容由人工智能生成。'], SOURCE)).not.toContain('inconsistency');
  });

  it('does not care whether a space sits between the number and its unit', () => {
    // 原通稿写「1200 人」，生成稿写「1200人」—— 同一个事实，不该报不一致。
    expect(categories(['带动就业 1200人。', '本内容由人工智能生成。'], SOURCE)).not.toContain('inconsistency');
    // 反过来，带空格的错误数字照样要抓到。
    expect(categories(['带动就业 1800 人。', '本内容由人工智能生成。'], SOURCE)).toContain('inconsistency');
  });

  it('asks for an AI 标识 only when one is missing', () => {
    expect(categories(['今天召开推进会。'], SOURCE)).toContain('ai-label');
    expect(categories(['今天召开推进会。', '本内容由人工智能生成。'], SOURCE)).not.toContain('ai-label');
  });

  it('anchors every annotation on a real sentence span', () => {
    const sentences = ['会议隆重召开。', '总投资 3.6亿元。'];
    for (const annotation of preflight(sentences, SOURCE).annotations) {
      const sentence = sentences[annotation.segmentOrdinal];
      expect(sentence).toBeDefined();
      expect(annotation.end).toBeLessThanOrEqual(sentence!.length);
      expect(annotation.start).toBeGreaterThanOrEqual(0);
    }
  });

  it('leaves clean copy completely alone', () => {
    // 一校的产出编辑要逐条看，误报一多就没人看了。这条是「宁可少抓」的守门用例。
    const clean = [
      '全县乡村振兴现场推进会今天召开。',
      '会议指出，要压实责任、狠抓落实（含各乡镇）。',
      '项目总投资 3.2亿元，预计带动就业 1200 人。',
      '本内容由人工智能生成，已经人工审核。',
    ];
    expect(preflight(clean, SOURCE).annotations).toEqual([]);
  });
});

describe('一校规则（错别字 / 标点 / 格式）', () => {
  const SRC = '全县推进会今天召开。';
  const only = (sentence: string) =>
    preflight([sentence, '本内容由人工智能生成。'], SRC).annotations.filter(
      (a) => a.segmentOrdinal === 0,
    );

  it('catches half-width punctuation in Chinese copy', () => {
    const hit = only('会议指出,要压实责任。')[0];
    expect(hit).toMatchObject({ category: 'punctuation', action: 'flag' });
    expect(hit!.title).toContain('半角标点');
  });

  it('catches a repeated punctuation mark', () => {
    expect(only('会议今天召开。。')[0]).toMatchObject({ category: 'punctuation' });
  });

  it('catches a half-width period used as a full stop', () => {
    const hit = only('会议今天召开.')[0];
    expect(hit).toMatchObject({ category: 'punctuation', suggestion: '。' });
  });

  it('catches half-width brackets around Chinese', () => {
    expect(only('会议(含各乡镇)今天召开。')[0]).toMatchObject({ category: 'punctuation' });
  });

  it('catches an unbalanced bracket pair', () => {
    const hit = only('会议（含各乡镇今天召开。')[0];
    expect(hit).toMatchObject({ category: 'punctuation' });
    expect(hit!.title).toContain('不成对');
  });

  it('catches known typos and suggests the fix', () => {
    expect(only('设备已按装完毕。')[0]).toMatchObject({ category: 'typo', suggestion: '安装' });
    expect(only('全县上下渡过难关。')[0]).toMatchObject({ category: 'typo', suggestion: '度过' });
  });

  it('catches a character repeated three times or more', () => {
    expect(only('会议强调调调落实。')[0]).toMatchObject({ category: 'typo' });
  });

  it('catches full-width digits, full-width spaces and runs of spaces', () => {
    expect(only('投资３亿元。')[0]).toMatchObject({ category: 'format' });
    expect(only('　会议今天召开。')[0]).toMatchObject({ category: 'format' });
    expect(only('会议  今天召开。')[0]).toMatchObject({ category: 'format' });
  });

  it('anchors a pattern hit on the exact span it matched', () => {
    const sentence = '会议指出,要压实责任。';
    const hit = only(sentence)[0]!;
    expect(sentence.slice(hit.start, hit.end)).toBe('出,');
  });

  it('finds every occurrence in one sentence, not just the first', () => {
    // 正则带 g 被复用，lastIndex 没归零就会漏后面的命中。
    expect(only('设备已按装,线路也按装完毕。').filter((a) => a.category === 'typo')).toHaveLength(2);
  });
});

describe('词表覆盖', () => {
  const check = (sentence: string) =>
    preflight([sentence, '本内容由人工智能生成。'], '会议。').annotations.filter(
      (a) => a.segmentOrdinal === 0,
    );

  it('covers the 称谓 rules', () => {
    expect(check('几名打工仔参加了活动。')[0]).toMatchObject({
      category: 'banned-term',
      action: 'block',
      suggestion: '务工人员',
    });
    expect(check('残废人代表发言。')[0]).toMatchObject({ suggestion: '残疾人' });
  });

  it('covers 领导活动 wording', () => {
    expect(check('县长亲切接见了代表。')[0]).toMatchObject({ category: 'caution-term' });
    expect(check('活动隆重举行。')[0]).toMatchObject({ category: 'banned-term', suggestion: '举行' });
  });

  it('covers the 职务写法 rules at every level', () => {
    for (const [wrong, right] of [
      ['省省委书记', '省委书记'],
      ['市市委书记', '市委书记'],
      ['县县委书记', '县委书记'],
    ]) {
      const hit = check(`中共XX${wrong}出席。`)[0];
      expect(hit).toMatchObject({ category: 'leader-title', action: 'redact', suggestion: right });
    }
  });
});

describe('准入词表覆盖', () => {
  it('routes newly added 敏感题材 to the 要理由 lane', () => {
    for (const term of ['疫情', '欠薪', '停产', '举报']) {
      expect(runAdmission({ title: '通报', sourceText: `关于${term}的情况通报。` })).toMatchObject({
        decision: 'reason-required',
      });
    }
  });

  it('routes newly added 公器私用 cases to 只标不拦', () => {
    for (const term of ['论文', '简历', '婚礼致辞']) {
      const result = runAdmission({ title: '帮忙', sourceText: `帮我写个${term}。` });
      expect(result.decision).toBe('admitted-logged');
      expect(result.offDutyUse).toBe(true);
    }
  });
});

describe('审片动作计数', () => {
  it('counts the three 审片动作 separately', () => {
    const source = '全县推进会今天召开。项目总投资 3.2亿元，预计带动就业 1200 人。';
    const { summary } = preflight(['会议隆重召开，县领导亲自出席。', '总投资 3.6亿元。'], source);
    // 隆重召开 block / 3.6亿元 redact / 亲自 flag + 缺 AI 标识 flag
    expect(summary).toEqual({ block: 1, redact: 1, flag: 2 });
  });
});
