
/**
 * Everything derived from sentence-level provenance: AI 参与度 and the
 * artifact-level origin label. Recomputed on every handoff, never hand-edited.
 * A manuscript that reaches 签发 still at 100% means nobody actually read it —
 * that is the management signal, not just a compliance record.
 */
import type { ArtifactOrigin, SentenceOrigin } from './contracts.js';

/** Per-origin weight. Tunable — state the formula whenever a number is shown. */
export const aiShareWeights: Readonly<Record<SentenceOrigin, number>> = {
  ai: 1,
  'ai-edited': 0.5,
  human: 0,
  source: 0,
};

/**
 * Weighted share of AI-written sentences, rounded to 4 decimals.
 * Returns undefined for an empty set: unmeasured is not the same as 0.
 */
export function computeAiShare(
  segments: ReadonlyArray<{ origin: SentenceOrigin }>,
  weights: Readonly<Record<SentenceOrigin, number>> = aiShareWeights,
): number | undefined {
  if (segments.length === 0) return undefined;

  const weighted = segments.reduce((sum, segment) => sum + (weights[segment.origin] ?? 0), 0);
  return Math.round((weighted / segments.length) * 10_000) / 10_000;
}

/**
 * The artifact-level label the sentences add up to. `source` counts as
 * not-AI: a quote from the incoming 通稿 is not something the model wrote.
 * Returns undefined for an empty set, so the caller keeps its declared origin.
 */
export function deriveArtifactOrigin(
  segments: ReadonlyArray<{ origin: SentenceOrigin }>,
): ArtifactOrigin | undefined {
  if (segments.length === 0) return undefined;
  let ai = 0;
  let aiEdited = 0;
  for (const segment of segments) {
    if (segment.origin === 'ai') ai += 1;
    else if (segment.origin === 'ai-edited') aiEdited += 1;
  }
  if (ai === segments.length) return 'ai';
  if (ai + aiEdited === 0) return 'human';
  return 'mixed';
}
