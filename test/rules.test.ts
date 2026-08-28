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

  it('counts the three 审片动作 separately', () => {
    const { summary } = preflight(['会议隆重召开，县领导亲自出席。', '总投资 3.6亿元。'], SOURCE);
    expect(summary).toEqual({ block: 1, redact: 1, flag: 2 });
  });
});
