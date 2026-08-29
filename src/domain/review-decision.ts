import type { RecordReviewInput, ReviewRecord } from './contracts.js';

/**
 * One human review stage has one authoritative fact per manuscript round.
 * Display labels are snapshots; stable account identity and substantive fields
 * decide whether a retry is the same fact or an attempted overwrite.
 */
export type HumanReviewDecisionInput = RecordReviewInput & {
  actorUserId: string;
  round: number;
};

const sameOptionalText = (left: string | undefined, right: string | undefined): boolean =>
  (left ?? null) === (right ?? null);

export function isSameHumanReviewDecision(
  existing: ReviewRecord,
  candidate: HumanReviewDecisionInput,
): boolean {
  return (
    existing.stage === candidate.stage &&
    existing.round === candidate.round &&
    existing.actorUserId === candidate.actorUserId &&
    existing.decision === candidate.decision &&
    sameOptionalText(existing.reason, candidate.reason) &&
    sameOptionalText(existing.countersignParty, candidate.countersignParty) &&
    sameOptionalText(existing.opinion, candidate.opinion)
  );
}

export type HumanReviewDecisionResult =
  | { outcome: 'created'; review: ReviewRecord }
  | { outcome: 'reused'; review: ReviewRecord }
  | { outcome: 'conflict'; review: ReviewRecord }
  | { outcome: 'manuscript-not-found' };
