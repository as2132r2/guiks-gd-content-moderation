import type { ManuscriptStatus } from './contracts.js';

/**
 * Content mutations are deliberately narrower than workflow transitions.
 *
 * The foundation API keeps `draft` writable for fixtures and low-level imports.
 * The real production path only lets an editor revise after generation or after
 * an explicit return. Every other status fails closed; there is no default role
 * or status fallback.
 */
export const manuscriptContentMutationStatuses = {
  'foundation-artifact-create': ['draft'],
  'foundation-segments-replace': ['draft', 'generated', 'revision'],
  'workbench-artifact-revise': ['generated', 'revision'],
} as const satisfies Readonly<Record<string, readonly ManuscriptStatus[]>>;

export type ManuscriptContentMutation = keyof typeof manuscriptContentMutationStatuses;

export const manuscriptNotEditableMessage = '稿件当前状态不允许修改内容。';

export function mayMutateManuscriptContent(
  status: ManuscriptStatus,
  operation: ManuscriptContentMutation,
): boolean {
  return (manuscriptContentMutationStatuses[operation] as readonly ManuscriptStatus[]).includes(
    status,
  );
}
