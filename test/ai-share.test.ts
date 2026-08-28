import { describe, expect, it } from 'vitest';

import { computeAiShare, deriveArtifactOrigin } from '../src/domain/ai-share.js';

describe('AI 参与度', () => {
  it('counts ai-edited as half and human/source as zero', () => {
    expect(
      computeAiShare([
        { origin: 'ai' },
        { origin: 'ai-edited' },
        { origin: 'human' },
        { origin: 'source' },
      ]),
    ).toBe(0.375);
  });

  it('separates "not measured" from zero', () => {
    expect(computeAiShare([])).toBeUndefined();
    expect(computeAiShare([{ origin: 'human' }])).toBe(0);
  });

  it('falls as a human rewrites the same sentences', () => {
    const generated = computeAiShare([{ origin: 'ai' }, { origin: 'ai' }, { origin: 'ai' }]);
    const afterEditing = computeAiShare([
      { origin: 'ai' },
      { origin: 'ai-edited' },
      { origin: 'human' },
    ]);
    expect(generated).toBe(1);
    expect(afterEditing).toBeCloseTo(0.5, 5);
  });


  it('derives the artifact label from the same sentences', () => {
    expect(deriveArtifactOrigin([{ origin: 'ai' }, { origin: 'ai' }])).toBe('ai');
    expect(deriveArtifactOrigin([{ origin: 'ai' }, { origin: 'source' }])).toBe('mixed');
    expect(deriveArtifactOrigin([{ origin: 'ai-edited' }])).toBe('mixed');
    // A quote from the incoming 通稿 is not something the model wrote.
    expect(deriveArtifactOrigin([{ origin: 'human' }, { origin: 'source' }])).toBe('human');
    expect(deriveArtifactOrigin([])).toBeUndefined();
  });

  it('accepts a custom weighting so the demo can state its own formula', () => {
    expect(
      computeAiShare([{ origin: 'ai' }, { origin: 'ai-edited' }], {
        ai: 1,
        'ai-edited': 1,
        human: 0,
        source: 0,
      }),
    ).toBe(1);
  });
});
