/**
 * Shared workflow contracts for the broadcast-content demo.
 *
 * Keep this file free of provider SDKs, HTTP concepts and detector rules. UI,
 * model and audit modules may all depend on it without depending on each other.
 */

export const contentSourceTypes = [
  'script',
  'novel',
  'notice',
  'public-relations',
  'other',
] as const;
export type ContentSourceType = (typeof contentSourceTypes)[number];

export const manuscriptStatuses = [
  'draft',
  'admission-blocked',
  'admission-reason-required',
  'admitted',
  'generated',
  'preflight',
  'first-review',
  'second-review',
  'final-review',
  'signed',
] as const;
export type ManuscriptStatus = (typeof manuscriptStatuses)[number];

export const admissionDecisions = ['blocked', 'reason-required', 'admitted-logged'] as const;
export type AdmissionDecision = (typeof admissionDecisions)[number];

export const artifactKinds = ['source', 'broadcast-script', 'short-video-copy'] as const;
export type ArtifactKind = (typeof artifactKinds)[number];

export const artifactOrigins = ['human', 'ai', 'mixed'] as const;
export type ArtifactOrigin = (typeof artifactOrigins)[number];

export const reviewStages = [
  'admission',
  'preflight',
  'editor',
  'department-head',
  'supervising-leader',
] as const;
export type ReviewStage = (typeof reviewStages)[number];

export const reviewDecisions = [
  'blocked',
  'reason-required',
  'pending-human-review',
  'approved',
  'changes-requested',
  'rejected',
] as const;
export type ReviewDecision = (typeof reviewDecisions)[number];

export const traceKinds = [
  'manuscript-created',
  'status-changed',
  'model-requested',
  'model-completed',
  'artifact-created',
  'rule-hit',
  'review-recorded',
  'signed',
] as const;
export type TraceKind = (typeof traceKinds)[number];

export const actorTypes = ['human', 'ai', 'system'] as const;
export type ActorType = (typeof actorTypes)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface Manuscript {
  id: string;
  title: string;
  sourceType: ContentSourceType;
  sourceText: string;
  status: ManuscriptStatus;
  createdAt: number;
  updatedAt: number;
}

export interface ContentArtifact {
  id: string;
  manuscriptId: string;
  kind: ArtifactKind;
  content: string;
  origin: ArtifactOrigin;
  /** 0..1. Omitted when the contribution cannot yet be measured. */
  aiShare?: number;
  model?: string;
  createdAt: number;
}

export interface ReviewRecord {
  id: string;
  manuscriptId: string;
  stage: ReviewStage;
  decision: ReviewDecision;
  actor: string;
  reason?: string;
  createdAt: number;
}

export interface TraceEvent {
  id: string;
  manuscriptId: string;
  kind: TraceKind;
  actorType: ActorType;
  actor: string;
  data: JsonObject;
  createdAt: number;
}

export interface ManuscriptAggregate {
  manuscript: Manuscript;
  artifacts: ContentArtifact[];
  reviews: ReviewRecord[];
  trace: TraceEvent[];
}

export interface CreateManuscriptInput {
  title: string;
  sourceType: ContentSourceType;
  sourceText: string;
}

export interface CreateArtifactInput {
  kind: ArtifactKind;
  content: string;
  origin: ArtifactOrigin;
  aiShare?: number;
  model?: string;
}

export interface RecordReviewInput {
  stage: ReviewStage;
  decision: ReviewDecision;
  actor: string;
  reason?: string;
}

export interface AppendTraceInput {
  kind: TraceKind;
  actorType: ActorType;
  actor: string;
  data?: JsonObject;
}

export interface WorkflowDomainEvent<T = JsonObject> {
  id: string;
  type: 'manuscript' | 'workflow' | 'trace';
  manuscriptId: string;
  occurredAt: number;
  data: T;
}
