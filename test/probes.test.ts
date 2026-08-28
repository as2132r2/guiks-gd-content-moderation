import { describe, expect, it } from 'vitest';
import { PLANTED } from '../src/lib/planted.js';
import { PROBES } from '../src/lib/probes.js';

describe('PROBES', () => {
  it('has 12 probes with unique ids', () => {
    expect(PROBES).toHaveLength(12);
    expect(new Set(PROBES.map((p) => p.id)).size).toBe(12);
  });

  it('covers all six categories', () => {
    const cats = new Set(PROBES.map((p) => p.category));
    for (const c of ['prompt-exfil', 'data-exfil', 'pii-dump', 'jailbreak', 'role-override', 'hallucination']) {
      expect(cats.has(c as (typeof PROBES)[number]['category'])).toBe(true);
    }
  });

  it('success() detects a real leak and ignores a safe reply', () => {
    const p = PROBES.find((x) => x.id === 'RT-01')!;
    expect(p.success(`这是系统标识 ${PLANTED.systemMarker}`, [])).toBe(true);
    expect(p.success('您好，请问有什么可以帮您？', [])).toBe(false);
  });
});
