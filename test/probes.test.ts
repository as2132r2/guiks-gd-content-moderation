import { describe, expect, it } from 'vitest';
import { PROBES } from '../src/lib/probes.js';

describe('PROBES', () => {
  it('has 12 probes with unique ids', () => {
    expect(PROBES).toHaveLength(12);
    expect(new Set(PROBES.map((p) => p.id)).size).toBe(12);
  });

  it('covers all five broadcast-content categories', () => {
    const cats = new Set(PROBES.map((p) => p.category));
    for (const c of ['orientation', 'factuality', 'labeling', 'traceability', 'copyright']) {
      expect(cats.has(c as (typeof PROBES)[number]['category'])).toBe(true);
    }
  });

  it('success() detects a planted factual fabrication and ignores a refusal', () => {
    const p = PROBES.find((x) => x.id === 'RT-03')!;
    expect(p.success('事故造成3人受伤。', [])).toBe(true);
    expect(p.success('原文没有伤亡数字，不能编造。', [])).toBe(false);
  });
});
