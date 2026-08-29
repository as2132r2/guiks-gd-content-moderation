import { describe, expect, it } from 'vitest';
import { computeAiShare } from '../src/domain/ai-share.js';
import { deriveSegmentOrigins, similarity, splitSentences } from '../src/domain/segmentation.js';

describe('切句', () => {
  it('keeps the terminator with the sentence it closes', () => {
    expect(splitSentences('今天召开会议。明天开工！真的吗？')).toEqual([
      '今天召开会议。',
      '明天开工！',
      '真的吗？',
    ]);
  });

  it('treats a newline as a sentence break, because a 通稿 is full of one-line paragraphs', () => {
    expect(splitSentences('标题一行\n正文第一句。\n\n正文第二句。')).toEqual([
      '标题一行',
      '正文第一句。',
      '正文第二句。',
    ]);
  });

  it('drops empty fragments instead of emitting blank sentences', () => {
    expect(splitSentences('  \n \n')).toEqual([]);
  });
});

describe('句级来源判定', () => {
  const generated = [
    { text: '各位听众，全市推进会今天召开。', origin: 'ai' as const },
    { text: '会议在市融媒体中心隆重召开。', origin: 'ai' as const },
    { text: '总投资 3.6亿元。', origin: 'ai' as const },
  ];

  it('leaves untouched sentences exactly as they were', () => {
    const derived = deriveSegmentOrigins(generated, generated.map((s) => s.text));
    expect(derived.map((s) => s.origin)).toEqual(['ai', 'ai', 'ai']);
  });

  it('degrades a rewritten AI sentence to ai-edited', () => {
    const derived = deriveSegmentOrigins(generated, [
      '各位听众，全市推进会今天召开。',
      '会议在市融媒体中心召开。',
      '总投资 3.6亿元。',
    ]);
    expect(derived.map((s) => s.origin)).toEqual(['ai', 'ai-edited', 'ai']);
  });

  it('does not degrade twice: an already-edited sentence stays ai-edited', () => {
    const prior = [{ text: '会议在市融媒体中心召开。', origin: 'ai-edited' as const }];
    const derived = deriveSegmentOrigins(prior, ['会议在市融媒体中心正式召开。']);
    expect(derived[0]!.origin).toBe('ai-edited');
  });

  it('marks a genuinely new sentence as human', () => {
    const derived = deriveSegmentOrigins(generated, [
      ...generated.map((s) => s.text),
      '记者从会上了解到，后续将逐项对账销号。',
    ]);
    expect(derived.map((s) => s.origin)).toEqual(['ai', 'ai', 'ai', 'human']);
  });

  it('marks a sentence quoted verbatim from the 通稿 as source', () => {
    const sourceText = '会议指出，要压实责任。项目涉及 12 个乡镇。';
    const derived = deriveSegmentOrigins(generated, [...generated.map((s) => s.text), '会议指出，要压实责任。'], sourceText);
    expect(derived[3]).toMatchObject({ origin: 'source', sourceRef: '原通稿' });
  });

  it('handles a deletion without mislabelling the survivors', () => {
    const derived = deriveSegmentOrigins(generated, [generated[0]!.text, generated[2]!.text]);
    expect(derived.map((s) => s.origin)).toEqual(['ai', 'ai']);
  });

  it('drives AI 参与度 down as a human takes the draft over', () => {
    const untouched = deriveSegmentOrigins(generated, generated.map((s) => s.text));
    expect(computeAiShare(untouched)).toBe(1);

    const edited = deriveSegmentOrigins(generated, [
      '各位听众，全市推进会今天召开。',
      '会议在市融媒体中心召开。',
      '总投资 3.2亿元。',
    ]);
    // 两句被改过 → (1 + 0.5 + 0.5) / 3
    expect(computeAiShare(edited)).toBeCloseTo(0.6667, 4);

    const rewritten = deriveSegmentOrigins(generated, [
      '今天上午，全市乡村振兴现场推进会在市委礼堂举行。',
      '与会人员实地察看了三个项目点位。',
      '会议要求，各乡镇要在月底前拿出施工方案。',
    ]);
    expect(computeAiShare(rewritten)).toBe(0);
  });
});

describe('相似度', () => {
  it('scores a small edit high and an unrelated sentence low', () => {
    expect(similarity('会议在市融媒体中心隆重召开。', '会议在市融媒体中心召开。')).toBeGreaterThan(0.8);
    expect(similarity('会议在市融媒体中心隆重召开。', '今天下了一场大雨。')).toBeLessThan(0.2);
  });
});
