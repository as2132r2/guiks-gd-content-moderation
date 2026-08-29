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

/**
 * 报道方向（题材）。
 *
 * **和 `ContentSourceType` 不是一回事**：后者说的是「素材是什么形态」
 * （通知 / 通稿 / 脚本），前者说的是「这条报道属于哪个口」。
 * 全流程监控要按口分析用量与退回率，靠素材类型分不出来。
 *
 * 由编辑在投料时手选（requirements 第六节待定②）。自动分类要过模型，
 * 归赛后——手选一步到位，也更符合「判断留给人」。
 */
export const coverageTopics = [
  'politics',
  'livelihood',
  'economy',
  'agriculture',
  'culture',
  'other',
] as const;
export type CoverageTopic = (typeof coverageTopics)[number];

export const coverageTopicLabels: Readonly<Record<CoverageTopic, string>> = {
  politics: '时政',
  livelihood: '民生',
  economy: '经济',
  agriculture: '三农',
  culture: '文化教育',
  other: '其他',
};

export const manuscriptStatuses = [
  'draft',
  'admission-blocked',
  'admission-reason-required',
  'admitted',
  'generated',
  'preflight',
  'first-review',
  'second-review',
  'countersign',
  'final-review',
  'revision',
  'signed',
  'published',
] as const;
export type ManuscriptStatus = (typeof manuscriptStatuses)[number];

export const admissionDecisions = ['blocked', 'reason-required', 'admitted-logged'] as const;
export type AdmissionDecision = (typeof admissionDecisions)[number];

export const admissionReasonCodes = [
  'illegal-unrelated',
  'sensitive-topic',
  'off-duty-use',
  'routine',
] as const;
export type AdmissionReasonCode = (typeof admissionReasonCodes)[number];

export const artifactKinds = ['source', 'broadcast-script', 'short-video-copy'] as const;
export type ArtifactKind = (typeof artifactKinds)[number];


export const artifactOrigins = ['human', 'ai', 'mixed'] as const;
export type ArtifactOrigin = (typeof artifactOrigins)[number];

/**
 * Sentence-level provenance. Downstream 审校 products only ever receive a
 * finished manuscript; we sit in the production line, so every sentence can
 * carry who wrote it and AI 参与度 can be recomputed on every handoff.
 */
export const sentenceOrigins = ['ai', 'ai-edited', 'human', 'source'] as const;
export type SentenceOrigin = (typeof sentenceOrigins)[number];

export const reviewStages = [
  'admission',
  'preflight',
  'editor',
  'department-head',
  'countersign',
  'supervising-leader',
] as const;
export type ReviewStage = (typeof reviewStages)[number];

/** Only these three roles participate in the manuscript state machine. */
export const workflowRoles = ['editor', 'department-head', 'supervising-leader'] as const;
export type WorkflowRole = (typeof workflowRoles)[number];

/** System roles may observe the product without becoming workflow actors. */
export const systemRoles = [...workflowRoles, 'station-leader'] as const;
export type SystemRole = (typeof systemRoles)[number];

export const isWorkflowRole = (value: unknown): value is WorkflowRole =>
  typeof value === 'string' && (workflowRoles as readonly string[]).includes(value);

export const isSystemRole = (value: unknown): value is SystemRole =>
  typeof value === 'string' && (systemRoles as readonly string[]).includes(value);

/** 校次是预检标注的分类与审级职责，不是稿件状态。 */
export const proofreadPasses = ['first', 'second', 'third'] as const;
export type ProofreadPass = (typeof proofreadPasses)[number];

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
  // 超限。**刻意不复用 `rule-hit`**：那一条讲的是内容判定，这一条讲的是资源
  // 配额。共用一个 kind，追溯图谱上就会出现「因为超限所以被判违规」的假因果。
  'quota-blocked',
  'segments-recorded',
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
  /** 报道方向。老稿件没有这个字段，所以可空——未分类不等于「其他」。 */
  coverageTopic?: CoverageTopic;
  sourceText: string;
  status: ManuscriptStatus;
  /** 当前三审三校轮次；复核修改完成并重新预检时递增。 */
  reviewRound: number;
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
  /** 隐式 AI 标识等随产物保存的机器可读元数据。 */
  metadata?: JsonObject;
  createdAt: number;
}


export interface SentenceSegment {
  id: string;
  manuscriptId: string;
  artifactId: string;
  /** 0-based position inside the artifact; segments are always kept in order. */
  ordinal: number;
  text: string;
  origin: SentenceOrigin;
  /** For quoted sentences: which part of the source they came from. */
  sourceRef?: string;
  createdAt: number;
}

export interface ReviewRecord {
  id: string;
  manuscriptId: string;
  stage: ReviewStage;
  decision: ReviewDecision;
  actor: string;
  /** Stable account identity; actor remains the immutable display snapshot. */
  actorUserId?: string;
  reason?: string;
  /** 第几轮三审三校；复核修改后重新预检时递增。 */
  round: number;
  countersignParty?: string;
  opinion?: string;
  createdAt: number;
}

export interface TraceEvent {
  id: string;
  manuscriptId: string;
  kind: TraceKind;
  actorType: ActorType;
  actor: string;
  /** Present for authenticated human actions, absent for AI/system events. */
  actorUserId?: string;
  data: JsonObject;
  createdAt: number;
}


export interface ManuscriptAggregate {
  manuscript: Manuscript;
  artifacts: ContentArtifact[];
  /** Every artifact's sentences, ordered by artifact then by ordinal. */
  segments: SentenceSegment[];
  reviews: ReviewRecord[];
  trace: TraceEvent[];
}

export interface CreateManuscriptInput {
  title: string;
  sourceType: ContentSourceType;
  coverageTopic?: CoverageTopic;
  sourceText: string;
}


export interface CreateSegmentInput {
  text: string;
  origin: SentenceOrigin;
  sourceRef?: string;
}

export interface CreateArtifactInput {
  kind: ArtifactKind;
  content: string;
  origin: ArtifactOrigin;
  /** Ignored when `segments` are supplied: the ratio is recomputed from them. */
  aiShare?: number;
  model?: string;
  metadata?: JsonObject;
  segments?: CreateSegmentInput[];
}

/** A handoff rewrite: sentences are replaced wholesale, AI 参与度 recomputed. */
export interface ReplaceSegmentsInput {
  actor: string;
  actorUserId?: string;
  actorType?: ActorType;
  segments: CreateSegmentInput[];
}

export interface RecordReviewInput {
  stage: ReviewStage;
  decision: ReviewDecision;
  actor: string;
  actorUserId?: string;
  reason?: string;
  round?: number;
  countersignParty?: string;
  opinion?: string;
}

export interface AppendTraceInput {
  kind: TraceKind;
  actorType: ActorType;
  actor: string;
  actorUserId?: string;
  data?: JsonObject;
}

export interface WorkflowDomainEvent<T = JsonObject> {
  id: string;
  type: 'manuscript' | 'workflow' | 'trace';
  manuscriptId: string;
  occurredAt: number;
  data: T;
}
