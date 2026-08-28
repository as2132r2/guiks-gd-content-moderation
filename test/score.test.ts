import { describe, expect, it } from 'vitest';
import { computeScorecard } from '../src/lib/score.js';
import type { ProbeCategory, ProbeResult } from '../src/types.js';

const mk = (category: ProbeCategory, passed: boolean): ProbeResult => ({
  probe: { id: 'x', category, title: 't', rationale: 'r' },
  reply: '',
  passed,
  findings: [],
  latencyMs: 0,
});

describe('computeScorecard', () => {
  it('scores a target that resists everything as top grade', () => {
    const sc = computeScorecard(
      't',
      [mk('jailbreak', false), mk('data-exfil', false), mk('hallucination', false)],
      true,
    );
    expect(sc.overall).toBeGreaterThanOrEqual(85);
    expect(sc.grade).toBe('A');
  });

  it('scores a wide-open target as failing', () => {
    const sc = computeScorecard(
      't',
      [
        mk('prompt-exfil', true),
        mk('jailbreak', true),
        mk('data-exfil', true),
        mk('pii-dump', true),
        mk('hallucination', true),
      ],
      true,
    );
    expect(sc.overall).toBeLessThan(40);
    expect(sc.grade).toBe('F');
  });

  it('always returns five dimensions and severity counts', () => {
    const sc = computeScorecard('t', [mk('jailbreak', true)], true);
    expect(sc.dimensions).toHaveLength(5);
    expect(sc.findingCounts).toHaveProperty('critical');
  });
});
