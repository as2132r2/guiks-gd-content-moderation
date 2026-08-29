
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';

import { computeAiShare, deriveArtifactOrigin } from '../domain/ai-share.js';
import {
  hashPassword,
  parseRolesJson,
  type StoredUserAccount,
  type UserAccount,
} from '../domain/auth.js';
import { deriveSegmentOrigins, splitSentences } from '../domain/segmentation.js';
import type {
  AppendTraceInput,
  ContentArtifact,
  CreateArtifactInput,
  CreateManuscriptInput,
  CreateSegmentInput,
  JsonObject,
  Manuscript,
  ManuscriptAggregate,
  ManuscriptStatus,
  RecordReviewInput,
  ReplaceSegmentsInput,
  ReviewDecision,
  ReviewRecord,
  ReviewStage,
  SentenceSegment,
  SystemRole,
  TraceEvent,
} from '../domain/contracts.js';
import type { AdmissionResult, RuleHit } from '../domain/gatekeeping.js';
import {
  isSameHumanReviewDecision,
  type HumanReviewDecisionInput,
  type HumanReviewDecisionResult,
} from '../domain/review-decision.js';
import { config } from '../config.js';
import { createDatabase, type DatabaseHandle } from './client.js';
import { buildOversight, type OversightSnapshot } from './oversight.js';
import {
  admissionResults,
  contentArtifacts,
  manuscripts,
  reviewRecords,
  sentenceSegments,
  traceEvents,
  users,
} from './schema.js';

const parseJsonObject = (value: string): JsonObject => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as JsonObject;
  } catch {
    // Old or damaged trace data must not make the whole manuscript unreadable.
  }
  return {};
};


type ManuscriptRow = typeof manuscripts.$inferSelect;

/**
 * `coverage_topic` 是 manuscripts 上第一个可空列。契约里它是可选字段，
 * 而 SQLite 给的是 null —— 直接强转会让 null 冒充 CoverageTopic 漏到 API 上。
 */
const toManuscript = (row: ManuscriptRow): Manuscript => ({
  ...(row as Manuscript),
  ...(row.coverageTopic
    ? { coverageTopic: row.coverageTopic as NonNullable<Manuscript['coverageTopic']> }
    : {}),
});

type ArtifactRow = typeof contentArtifacts.$inferSelect;
type SegmentRow = typeof sentenceSegments.$inferSelect;
type UserRow = typeof users.$inferSelect;
type ReviewRow = typeof reviewRecords.$inferSelect;

const toStoredUser = (row: UserRow): StoredUserAccount | undefined => {
  const roles = parseRolesJson(row.rolesJson);
  if (!roles) return undefined;
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    passwordHash: row.passwordHash,
    roles,
    isDemo: row.isDemo,
    disabled: row.disabled,
    sessionVersion: row.sessionVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};

const withoutPassword = ({ passwordHash: _passwordHash, ...user }: StoredUserAccount): UserAccount =>
  user;

const toArtifact = (row: ArtifactRow): ContentArtifact => ({
  id: row.id,
  manuscriptId: row.manuscriptId,
  kind: row.kind as ContentArtifact['kind'],
  content: row.content,
  origin: row.origin as ContentArtifact['origin'],
  ...(row.aiShare === null ? {} : { aiShare: row.aiShare }),
  ...(row.model === null ? {} : { model: row.model }),
  ...(row.metadataJson === null ? {} : { metadata: parseJsonObject(row.metadataJson) }),
  createdAt: row.createdAt,
});

const toReview = (row: ReviewRow): ReviewRecord => ({
  id: row.id,
  manuscriptId: row.manuscriptId,
  stage: row.stage as ReviewRecord['stage'],
  decision: row.decision as ReviewRecord['decision'],
  actor: row.actor,
  ...(row.actorUserId === null ? {} : { actorUserId: row.actorUserId }),
  ...(row.reason === null ? {} : { reason: row.reason }),
  round: row.round,
  ...(row.countersignParty === null ? {} : { countersignParty: row.countersignParty }),
  ...(row.opinion === null ? {} : { opinion: row.opinion }),
  createdAt: row.createdAt,
});

const toSegment = (row: SegmentRow): SentenceSegment => ({
  id: row.id,
  manuscriptId: row.manuscriptId,
  artifactId: row.artifactId,
  ordinal: row.ordinal,
  text: row.text,
  origin: row.origin as SentenceSegment['origin'],
  ...(row.sourceRef === null ? {} : { sourceRef: row.sourceRef }),
  createdAt: row.createdAt,
});

/** Ordinals come from array position: callers send sentences in reading order. */
const buildSegments = (
  manuscriptId: string,
  artifactId: string,
  inputs: CreateSegmentInput[],
  createdAt: number,
): SentenceSegment[] =>
  inputs.map((input, ordinal) => ({
    id: randomUUID(),
    manuscriptId,
    artifactId,
    ordinal,
    text: input.text,
    origin: input.origin,
    ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
    createdAt,
  }));

const toSegmentRows = (segments: SentenceSegment[]) =>
  segments.map((segment) => ({ ...segment, sourceRef: segment.sourceRef ?? null }));

interface PreparedArtifact {
  artifact: ContentArtifact;
  segments: SentenceSegment[];
}

function prepareArtifact(
  manuscriptId: string,
  input: CreateArtifactInput,
  createdAt: number,
): PreparedArtifact {
  const artifactId = randomUUID();
  const segments = buildSegments(manuscriptId, artifactId, input.segments ?? [], createdAt);
  const aiShare = segments.length > 0 ? computeAiShare(segments) : input.aiShare;
  const origin = deriveArtifactOrigin(segments) ?? input.origin;
  return {
    artifact: {
      id: artifactId,
      manuscriptId,
      kind: input.kind,
      content: input.content,
      origin,
      ...(aiShare === undefined ? {} : { aiShare }),
      ...(input.model ? { model: input.model } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
      createdAt,
    },
    segments,
  };
}

/**
 * An artifact's coarse origin, derived from its sentences. `mixed` is the
 * honest answer the moment a human has touched a generated draft.
 */
const artifactOriginOf = (segments: readonly SentenceSegment[]): ContentArtifact['origin'] => {
  if (segments.length === 0) return 'ai';
  const machine = segments.some((segment) => segment.origin === 'ai');
  const human = segments.some((segment) => segment.origin !== 'ai');
  if (machine && human) return 'mixed';
  return machine ? 'ai' : 'human';
};
const countOrigins = (segments: SentenceSegment[]): JsonObject => {
  const counts: Record<string, number> = {};
  for (const segment of segments) counts[segment.origin] = (counts[segment.origin] ?? 0) + 1;
  return counts;
};

type WorkflowTransaction = Parameters<
  Parameters<DatabaseHandle['orm']['transaction']>[0]
>[0];

interface ArtifactWrite {
  artifact: ContentArtifact;
  segments: SentenceSegment[];
}

const prepareArtifactWrite = (
  manuscriptId: string,
  input: CreateArtifactInput,
  createdAt: number,
): ArtifactWrite => {
  const artifactId = randomUUID();
  const segments = buildSegments(manuscriptId, artifactId, input.segments ?? [], createdAt);
  const aiShare = segments.length > 0 ? computeAiShare(segments) : input.aiShare;
  const origin = deriveArtifactOrigin(segments) ?? input.origin;
  return {
    artifact: {
      id: artifactId,
      manuscriptId,
      kind: input.kind,
      content: input.content,
      origin,
      ...(aiShare === undefined ? {} : { aiShare }),
      ...(input.model ? { model: input.model } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
      createdAt,
    },
    segments,
  };
};

const insertArtifactWrite = (
  tx: WorkflowTransaction,
  write: ArtifactWrite,
  traceActor?: { actor: string; actorUserId: string },
): void => {
  const { artifact, segments } = write;
  tx.insert(contentArtifacts)
    .values({
      id: artifact.id,
      manuscriptId: artifact.manuscriptId,
      kind: artifact.kind,
      content: artifact.content,
      origin: artifact.origin,
      aiShare: artifact.aiShare ?? null,
      model: artifact.model ?? null,
      metadataJson: artifact.metadata ? JSON.stringify(artifact.metadata) : null,
      createdAt: artifact.createdAt,
    })
    .run();
  if (segments.length > 0) tx.insert(sentenceSegments).values(toSegmentRows(segments)).run();
  tx.insert(traceEvents)
    .values({
      id: randomUUID(),
      manuscriptId: artifact.manuscriptId,
      kind: 'artifact-created',
      actorType: traceActor ? 'human' : artifact.origin === 'human' ? 'human' : 'ai',
      actor: traceActor?.actor ?? artifact.model ?? artifact.origin,
      actorUserId: traceActor?.actorUserId ?? null,
      dataJson: JSON.stringify({
        artifactId: artifact.id,
        kind: artifact.kind,
        origin: artifact.origin,
        aiShare: artifact.aiShare ?? null,
        segmentCount: segments.length,
        origins: countOrigins(segments),
        content: artifact.content,
      }),
      createdAt: artifact.createdAt,
    })
    .run();
};

const insertReviewWrite = (tx: WorkflowTransaction, review: ReviewRecord): void => {
  tx.insert(reviewRecords).values(review).run();
  tx.insert(traceEvents)
    .values({
      id: randomUUID(),
      manuscriptId: review.manuscriptId,
      kind: 'review-recorded',
      actorType: 'human',
      actor: review.actor,
      actorUserId: review.actorUserId ?? null,
      dataJson: JSON.stringify({
        reviewId: review.id,
        stage: review.stage,
        decision: review.decision,
        reason: review.reason ?? null,
        round: review.round,
        countersignParty: review.countersignParty ?? null,
        opinion: review.opinion ?? null,
      }),
      createdAt: review.createdAt,
    })
    .run();
};

export interface PreparedPreflightMutation {
  artifactId: string;
  /** Present only when preflight auto-appends the explicit AI label. */
  replacementSegments?: CreateSegmentInput[];
  metadata: JsonObject;
  /** Round is injected from the manuscript row inside the transaction. */
  traceData: JsonObject;
}

export interface CanonicalTransitionReview {
  mode: 'append-system' | 'idempotent-human';
  stage: ReviewStage;
  decision: ReviewDecision;
  reason?: string;
  countersignParty?: string;
  opinion?: string;
}

export interface CommitCanonicalTransitionInput {
  manuscriptId: string;
  expectedFrom: ManuscriptStatus;
  to: ManuscriptStatus;
  actor: string;
  actorUserId: string;
  incrementReviewRound?: boolean;
  generatedArtifacts?: CreateArtifactInput[];
  preflightMutations?: PreparedPreflightMutation[];
  review?: CanonicalTransitionReview;
}

export type CommitCanonicalTransitionResult =
  | { outcome: 'committed'; manuscript: Manuscript; review?: ReviewRecord }
  | { outcome: 'manuscript-not-found' }
  | { outcome: 'status-conflict'; manuscript: Manuscript }
  | { outcome: 'review-conflict'; review: ReviewRecord };

export class WorkflowRepository {
  constructor(private readonly database: DatabaseHandle) {
    this.reconcileInterruptedModelCalls();
  }

  private nextTraceTimestamp(manuscriptId: string): number {
    const row = this.database.sqlite
      .prepare('SELECT MAX(created_at) AS latest FROM trace_events WHERE manuscript_id = ?')
      .get(manuscriptId) as { latest?: number | null } | undefined;
    return Math.max(Date.now(), (row?.latest ?? 0) + 1);
  }

  /** Close model calls left open by a previous process crash. */
  private reconcileInterruptedModelCalls(): void {
    const rows = this.database.sqlite
      .prepare(
        `SELECT manuscript_id, kind, actor, data_json, created_at
         FROM trace_events
         WHERE kind IN ('model-requested', 'model-completed')
         ORDER BY created_at ASC`,
      )
      .all() as Array<{
      manuscript_id: string;
      kind: 'model-requested' | 'model-completed';
      actor: string;
      data_json: string;
      created_at: number;
    }>;

    const terminal = new Set<string>();
    const requested = new Map<
      string,
      (typeof rows)[number] & { callId: string; data: JsonObject }
    >();
    for (const row of rows) {
      const data = parseJsonObject(row.data_json);
      const callId = typeof data.callId === 'string' ? data.callId : '';
      if (!callId) continue;
      const key = `${row.manuscript_id}:${callId}`;
      if (row.kind === 'model-completed') terminal.add(key);
      else requested.set(key, { ...row, callId, data });
    }

    for (const [key, row] of requested) {
      if (terminal.has(key)) continue;
      const createdAt = this.nextTraceTimestamp(row.manuscript_id);
      this.database.orm
        .insert(traceEvents)
        .values({
          id: randomUUID(),
          manuscriptId: row.manuscript_id,
          kind: 'model-completed',
          actorType: 'ai',
          actor: row.actor,
          dataJson: JSON.stringify({
            callId: row.callId,
            operation: row.data.operation ?? 'unknown',
            requestedModel: row.data.requestedModel ?? row.actor,
            mode: row.data.mode ?? 'unknown',
            initiatedBy: row.data.initiatedBy ?? 'unknown',
            latencyMs: Math.max(0, createdAt - row.created_at),
            outcome: 'error',
            errorCode: 'process_interrupted',
          }),
          createdAt,
        })
        .run();
    }
  }

  healthcheck(): boolean {
    const row = this.database.sqlite.prepare('SELECT 1 AS ok').get() as { ok?: number } | undefined;
    return row?.ok === 1;
  }

  /** Demo identities are deterministic and idempotent; production never gets known passwords. */
  ensureDemoUsers(): void {
    if (!config.seedDemoUsers) return;
    const now = Date.now();
    const seeds = [
      {
        id: 'user_demo_zhangmin',
        username: 'zhangmin',
        displayName: '张敏',
        roles: ['editor', 'department-head', 'supervising-leader'],
      },
      {
        id: 'user_demo_lijianguo',
        username: 'lijianguo',
        displayName: '李建国',
        roles: ['department-head'],
      },
      {
        id: 'user_demo_wangzhiyuan',
        username: 'wangzhiyuan',
        displayName: '王志远',
        roles: ['supervising-leader'],
      },
      {
        id: 'user_demo_stationadmin',
        username: 'stationadmin',
        displayName: '台领导·管理员',
        roles: ['station-leader'],
      },
    ] as const;

    for (const seed of seeds) {
      if (this.database.orm.select({ id: users.id }).from(users).where(eq(users.id, seed.id)).get()) {
        continue;
      }
      this.database.orm
        .insert(users)
        .values({
          id: seed.id,
          username: seed.username,
          displayName: seed.displayName,
          passwordHash: hashPassword(config.demoSeedPassword),
          rolesJson: JSON.stringify(seed.roles),
          isDemo: true,
          disabled: false,
          sessionVersion: 1,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run();
    }
  }

  provisionProductionUser(input: {
    username: string;
    displayName: string;
    password: string;
    roles: SystemRole[];
  }): UserAccount {
    const username = input.username.trim().toLowerCase();
    const displayName = input.displayName.trim();
    if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) {
      throw new Error('username must be 3-64 lowercase letters, digits, dot, underscore or hyphen');
    }
    if (displayName.length === 0 || displayName.length > 100) {
      throw new Error('display name must be 1-100 characters');
    }
    if (input.password.length < 12) throw new Error('password must be at least 12 characters');
    const roles = parseRolesJson(JSON.stringify(input.roles));
    if (!roles || roles.length !== input.roles.length) {
      throw new Error('roles must be a non-empty, duplicate-free list of system roles');
    }
    if (this.findStoredUserByUsername(username)) throw new Error('username already exists');

    const now = Date.now();
    const id = `user_${randomUUID()}`;
    this.database.orm
      .insert(users)
      .values({
        id,
        username,
        displayName,
        passwordHash: hashPassword(input.password),
        rolesJson: JSON.stringify(roles),
        isDemo: false,
        disabled: false,
        sessionVersion: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return this.findUserById(id)!;
  }

  hasEnabledProductionUser(): boolean {
    return this.database.orm
      .select()
      .from(users)
      .all()
      .some((row) => {
        const user = toStoredUser(row);
        return Boolean(user && !user.isDemo && !user.disabled);
      });
  }

  findUserById(id: string): UserAccount | undefined {
    const row = this.database.orm.select().from(users).where(eq(users.id, id)).get();
    const stored = row ? toStoredUser(row) : undefined;
    return stored ? withoutPassword(stored) : undefined;
  }

  findStoredUserByUsername(username: string): StoredUserAccount | undefined {
    const row = this.database.orm
      .select()
      .from(users)
      .where(eq(users.username, username.trim().toLowerCase()))
      .get();
    return row ? toStoredUser(row) : undefined;
  }

  incrementSessionVersion(id: string): UserAccount | undefined {
    const existing = this.findUserById(id);
    if (!existing) return undefined;
    this.database.orm
      .update(users)
      .set({ sessionVersion: existing.sessionVersion + 1, updatedAt: Date.now() })
      .where(eq(users.id, id))
      .run();
    return this.findUserById(id);
  }

  setUserDisabled(id: string, disabled: boolean): UserAccount | undefined {
    const existing = this.findUserById(id);
    if (!existing) return undefined;
    this.database.orm
      .update(users)
      .set({
        disabled,
        sessionVersion: existing.sessionVersion + 1,
        updatedAt: Date.now(),
      })
      .where(eq(users.id, id))
      .run();
    return this.findUserById(id);
  }

  createManuscript(
    input: CreateManuscriptInput,
    actor?: { label: string; userId?: string },
  ): Manuscript {
    const now = Date.now();
    const manuscript: Manuscript = {
      id: randomUUID(),
      title: input.title,
      sourceType: input.sourceType,
      ...(input.coverageTopic ? { coverageTopic: input.coverageTopic } : {}),
      sourceText: input.sourceText,
      status: 'draft',
      reviewRound: 1,
      createdAt: now,
      updatedAt: now,
    };

    this.database.orm.transaction((tx) => {
      tx.insert(manuscripts).values(manuscript).run();
      tx.insert(traceEvents)
        .values({
          id: randomUUID(),
          manuscriptId: manuscript.id,
          kind: 'manuscript-created',
          actorType: 'human',
          actor: actor?.label ?? 'editor',
          actorUserId: actor?.userId ?? null,
          dataJson: JSON.stringify({
            sourceType: manuscript.sourceType,
            coverageTopic: manuscript.coverageTopic ?? null,
          }),
          createdAt: now,
        })
        .run();
    });
    return manuscript;
  }

  listManuscripts(limit = 50): Manuscript[] {
    return this.database.orm
      .select()
      .from(manuscripts)
      .orderBy(desc(manuscripts.updatedAt))
      .limit(Math.min(Math.max(limit, 1), 100))
      .all()
      .map(toManuscript);
  }

  findManuscript(id: string): Manuscript | undefined {
    const row = this.database.orm.select().from(manuscripts).where(eq(manuscripts.id, id)).get();
    return row ? toManuscript(row) : undefined;
  }

  /** 固化入口准入结论，历史稿件不再随词表变化而改判。 */
  saveAdmissionResult(manuscriptId: string, result: AdmissionResult): AdmissionResult | undefined {
    if (!this.findManuscript(manuscriptId)) return undefined;
    this.database.orm
      .insert(admissionResults)
      .values({
        manuscriptId,
        decision: result.decision,
        reasonCode: result.reasonCode,
        message: result.message,
        hitsJson: JSON.stringify(result.hits),
        offDutyUse: result.offDutyUse ?? false,
        createdAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: admissionResults.manuscriptId,
        set: {
          decision: result.decision,
          reasonCode: result.reasonCode,
          message: result.message,
          hitsJson: JSON.stringify(result.hits),
          offDutyUse: result.offDutyUse ?? false,
        },
      })
      .run();
    return result;
  }

  getAdmissionResult(manuscriptId: string): AdmissionResult | undefined {
    const row = this.database.orm
      .select()
      .from(admissionResults)
      .where(eq(admissionResults.manuscriptId, manuscriptId))
      .get();
    if (!row) return undefined;

    let hits: RuleHit[] = [];
    try {
      const parsed: unknown = JSON.parse(row.hitsJson);
      if (Array.isArray(parsed)) hits = parsed as RuleHit[];
    } catch {
      // Damaged optional evidence must not hide the persisted verdict.
    }

    return {
      decision: row.decision as AdmissionResult['decision'],
      reasonCode: row.reasonCode as AdmissionResult['reasonCode'],
      message: row.message,
      hits,
      ...(row.offDutyUse ? { offDutyUse: true } : {}),
    };
  }

  getAggregate(id: string): ManuscriptAggregate | undefined {
    const manuscript = this.findManuscript(id);
    if (!manuscript) return undefined;

    const artifactRows = this.database.orm
      .select()
      .from(contentArtifacts)
      .where(eq(contentArtifacts.manuscriptId, id))
      .orderBy(asc(contentArtifacts.createdAt))
      .all();

    const artifacts: ContentArtifact[] = artifactRows.map(toArtifact);

    // Sentences follow their artifact's order, not their own write time: a
    // handoff rewrite must not reshuffle the manuscript.
    const artifactOrder = new Map(artifacts.map((artifact, index) => [artifact.id, index]));
    const segments: SentenceSegment[] = this.database.orm
      .select()
      .from(sentenceSegments)
      .where(eq(sentenceSegments.manuscriptId, id))
      .all()
      .map(toSegment)
      .sort(
        (a, b) =>
          (artifactOrder.get(a.artifactId) ?? 0) - (artifactOrder.get(b.artifactId) ?? 0) ||
          a.ordinal - b.ordinal,
      );
    const reviewRows = this.database.orm
      .select()
      .from(reviewRecords)
      .where(eq(reviewRecords.manuscriptId, id))
      .orderBy(asc(reviewRecords.createdAt))
      .all();
    const reviews: ReviewRecord[] = reviewRows.map(toReview);
    const traceRows = this.database.orm
      .select()
      .from(traceEvents)
      .where(eq(traceEvents.manuscriptId, id))
      .orderBy(asc(traceEvents.createdAt))
      .all();
    const trace: TraceEvent[] = traceRows.map((row) => ({
      id: row.id,
      manuscriptId: row.manuscriptId,
      kind: row.kind as TraceEvent['kind'],
      actorType: row.actorType as TraceEvent['actorType'],
      actor: row.actor,
      ...(row.actorUserId === null ? {} : { actorUserId: row.actorUserId }),
      data: parseJsonObject(row.dataJson),
      createdAt: row.createdAt,
    }));


    return { manuscript, artifacts, segments, reviews, trace };
  }

  updateStatus(
    id: string,
    status: ManuscriptStatus,
    actor: string,
    options: {
      incrementReviewRound?: boolean;
      actorUserId?: string;
      signedAiShare?: number | null;
      signedSegmentCount?: number;
    } = {},
  ): Manuscript | undefined {
    const existing = this.findManuscript(id);
    if (!existing) return undefined;
    const now = this.nextTraceTimestamp(id);
    const reviewRound = existing.reviewRound + (options.incrementReviewRound ? 1 : 0);

    this.database.orm.transaction((tx) => {
      tx.update(manuscripts)
        .set({ status, reviewRound, updatedAt: now })
        .where(eq(manuscripts.id, id))
        .run();
      tx.insert(traceEvents)
        .values({
          id: randomUUID(),
          manuscriptId: id,
          kind: status === 'signed' ? 'signed' : 'status-changed',
          actorType: 'human',
          actor,
          actorUserId: options.actorUserId ?? null,
          dataJson: JSON.stringify({
            from: existing.status,
            to: status,
            round: reviewRound,
            ...(status === 'signed' && options.signedAiShare !== undefined
              ? { aiShare: options.signedAiShare }
              : {}),
            ...(status === 'signed' && options.signedSegmentCount !== undefined
              ? { segmentCount: options.signedSegmentCount }
              : {}),
          }),
          createdAt: now,
        })
        .run();
    });
    return this.findManuscript(id);
  }

  addArtifact(
    manuscriptId: string,
    input: CreateArtifactInput,
    traceActor?: { actor: string; actorUserId: string },
  ): ContentArtifact | undefined {
    if (!this.findManuscript(manuscriptId)) return undefined;
    const write = prepareArtifactWrite(
      manuscriptId,
      input,
      this.nextTraceTimestamp(manuscriptId),
    );

    this.database.orm.transaction((tx) => {
      insertArtifactWrite(tx, write, traceActor);
      tx.update(manuscripts)
        .set({ updatedAt: write.artifact.createdAt })
        .where(eq(manuscripts.id, manuscriptId))
        .run();
    });
    return write.artifact;
  }

  /**
   * Persist an artifact submitted by an authenticated editor.
   *
   * The browser supplies content, not provenance. Sentence origins are derived
   * from the authoritative source text and the action is always attributed to
   * the stable human account. Canonical model generation continues to call
   * `addArtifact` directly with trusted in-process provenance and model data.
   */
  addHumanArtifact(
    manuscriptId: string,
    input: Pick<CreateArtifactInput, 'kind' | 'content'> & {
      actor: string;
      actorUserId: string;
    },
  ): ContentArtifact | undefined {
    const manuscript = this.findManuscript(manuscriptId);
    if (!manuscript) return undefined;

    const segments = deriveSegmentOrigins(
      [],
      splitSentences(input.content),
      manuscript.sourceText,
    );
    return this.addArtifact(
      manuscriptId,
      {
        kind: input.kind,
        content: input.content,
        origin: 'human',
        segments,
      },
      { actor: input.actor, actorUserId: input.actorUserId },
    );
  }

  /**
   * Commit a generation batch and its state transition atomically. A retry can
   * never observe one artifact without the other or duplicate a half-finished
   * generation after a persistence error.
   */
  completeGeneration(
    manuscriptId: string,
    inputs: CreateArtifactInput[],
    actor: string,
  ): { manuscript: Manuscript; artifacts: ContentArtifact[] } | undefined {
    const existing = this.findManuscript(manuscriptId);
    if (!existing || existing.status !== 'admitted' || inputs.length === 0) return undefined;

    const startedAt = this.nextTraceTimestamp(manuscriptId);
    const prepared = inputs.map((input, index) => ({
      input,
      ...prepareArtifact(manuscriptId, input, startedAt + index),
    }));
    const transitionAt = startedAt + prepared.length;

    this.database.orm.transaction((tx) => {
      for (const { input, artifact, segments } of prepared) {
        tx.insert(contentArtifacts)
          .values({
            id: artifact.id,
            manuscriptId: artifact.manuscriptId,
            kind: artifact.kind,
            content: artifact.content,
            origin: artifact.origin,
            aiShare: artifact.aiShare ?? null,
            model: artifact.model ?? null,
            metadataJson: artifact.metadata ? JSON.stringify(artifact.metadata) : null,
            createdAt: artifact.createdAt,
          })
          .run();
        if (segments.length > 0) tx.insert(sentenceSegments).values(toSegmentRows(segments)).run();
        tx.insert(traceEvents)
          .values({
            id: randomUUID(),
            manuscriptId,
            kind: 'artifact-created',
            actorType: artifact.origin === 'human' ? 'human' : 'ai',
            actor: input.model ?? artifact.origin,
            dataJson: JSON.stringify({
              artifactId: artifact.id,
              kind: artifact.kind,
              origin: artifact.origin,
              aiShare: artifact.aiShare ?? null,
              segmentCount: segments.length,
              origins: countOrigins(segments),
              // Preserve the generated version for the before/after contrast,
              // even after a human revises the live artifact.
              content: artifact.content,
            }),
            createdAt: artifact.createdAt,
          })
          .run();
      }

      tx.update(manuscripts)
        .set({ status: 'generated', updatedAt: transitionAt })
        .where(eq(manuscripts.id, manuscriptId))
        .run();
      tx.insert(traceEvents)
        .values({
          id: randomUUID(),
          manuscriptId,
          kind: 'status-changed',
          actorType: 'human',
          actor,
          dataJson: JSON.stringify({
            from: existing.status,
            to: 'generated',
            round: existing.reviewRound,
          }),
          createdAt: transitionAt,
        })
        .run();
    });

    const manuscript = this.findManuscript(manuscriptId);
    return manuscript
      ? { manuscript, artifacts: prepared.map(({ artifact }) => artifact) }
      : undefined;
  }

  findArtifact(manuscriptId: string, artifactId: string): ContentArtifact | undefined {
    const row = this.database.orm
      .select()
      .from(contentArtifacts)
      .where(
        and(eq(contentArtifacts.id, artifactId), eq(contentArtifacts.manuscriptId, manuscriptId)),
      )
      .get();
    return row ? toArtifact(row) : undefined;
  }

  listArtifactSegments(artifactId: string): SentenceSegment[] {
    return this.database.orm
      .select()
      .from(sentenceSegments)
      .where(eq(sentenceSegments.artifactId, artifactId))
      .orderBy(asc(sentenceSegments.ordinal))
      .all()
      .map(toSegment);
  }


  /**
   * Replace an artifact's sentences and recompute AI 参与度. Called on every
   * handoff where a human rewrote something: the ratio is never edited by hand.
   */
  replaceArtifactSegments(
    manuscriptId: string,
    artifactId: string,
    input: ReplaceSegmentsInput,
  ): { artifact: ContentArtifact; segments: SentenceSegment[] } | undefined {
    const existing = this.findArtifact(manuscriptId, artifactId);
    if (!existing) return undefined;

    const now = this.nextTraceTimestamp(manuscriptId);

    const segments = buildSegments(manuscriptId, artifactId, input.segments, now);
    const aiShare = computeAiShare(segments) ?? null;

    // Emptying the sentences cannot invent a provenance: keep the last label.
    const origin = deriveArtifactOrigin(segments) ?? existing.origin;
    const content = segments.map((segment) => segment.text).join('\n');
    // Drop the old ratio outright — an unmeasurable artifact has no share.
    const { aiShare: previousAiShare, ...carried } = existing;

    this.database.orm.transaction((tx) => {
      tx.delete(sentenceSegments).where(eq(sentenceSegments.artifactId, artifactId)).run();
      if (segments.length > 0) tx.insert(sentenceSegments).values(toSegmentRows(segments)).run();
      tx.update(contentArtifacts)
        .set({ aiShare, origin, content })
        .where(eq(contentArtifacts.id, artifactId))
        .run();
      tx.update(manuscripts).set({ updatedAt: now }).where(eq(manuscripts.id, manuscriptId)).run();
      tx.insert(traceEvents)
        .values({
          id: randomUUID(),
          manuscriptId,
          kind: 'segments-recorded',
          actorType: input.actorType ?? 'human',
          actor: input.actor,
          actorUserId: input.actorUserId ?? null,

          dataJson: JSON.stringify({
            artifactId,
            segmentCount: segments.length,
            aiShare,

            previousAiShare: previousAiShare ?? null,
            origin,
            previousOrigin: existing.origin,
            origins: countOrigins(segments),
          }),
          createdAt: now,
        })
        .run();
    });



    return {
      artifact: { ...carried, content, origin, ...(aiShare === null ? {} : { aiShare }) },
      segments,
    };
  }

  /**
   * A human rewrote the artifact: store the new sentences and let the server
   * decide where each one came from.
   *
   * The caller sends text only. AI 参与度 is the number a 台领导 uses to spot
   * 走过场的审核, so the person being measured never gets to label their own
   * sentences — see [segmentation.ts](../domain/segmentation.ts).
   */
  reviseArtifact(
    manuscriptId: string,
    artifactId: string,
    input: { actor: string; actorUserId?: string; sentences: string[] },
  ): { artifact: ContentArtifact; segments: SentenceSegment[] } | undefined {
    const manuscript = this.findManuscript(manuscriptId);
    const existing = manuscript ? this.findArtifact(manuscriptId, artifactId) : undefined;
    if (!manuscript || !existing) return undefined;

    const prior = this.listArtifactSegments(artifactId);
    const derived = deriveSegmentOrigins(prior, input.sentences, manuscript.sourceText);
    const result = this.replaceArtifactSegments(manuscriptId, artifactId, {
      actor: input.actor,
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      segments: derived,
    });
    if (!result) return undefined;

    return result;
  }

  setArtifactMetadata(
    manuscriptId: string,
    artifactId: string,
    metadata: JsonObject,
  ): ContentArtifact | undefined {
    const existing = this.findArtifact(manuscriptId, artifactId);
    if (!existing) return undefined;
    this.database.orm
      .update(contentArtifacts)
      .set({ metadataJson: JSON.stringify(metadata) })
      .where(eq(contentArtifacts.id, artifactId))
      .run();
    return { ...existing, metadata };
  }

  recordReview(manuscriptId: string, input: RecordReviewInput): ReviewRecord | undefined {
    const manuscript = this.findManuscript(manuscriptId);
    if (!manuscript) return undefined;
    const review: ReviewRecord = {
      id: randomUUID(),
      manuscriptId,
      stage: input.stage,
      decision: input.decision,
      actor: input.actor,
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      round: input.round ?? manuscript.reviewRound,
      ...(input.countersignParty ? { countersignParty: input.countersignParty } : {}),
      ...(input.opinion ? { opinion: input.opinion } : {}),
      createdAt: this.nextTraceTimestamp(manuscriptId),
    };

    this.database.orm.transaction((tx) => {
      insertReviewWrite(tx, review);
      tx.update(manuscripts)
        .set({ updatedAt: review.createdAt })
        .where(eq(manuscripts.id, manuscriptId))
        .run();
    });
    return review;
  }

  /**
   * Persist one human decision per (manuscript, stage, round).
   *
   * The lookup and insert share one synchronous SQLite transaction. That is
   * the single-process concurrency boundary: two request handlers cannot both
   * observe an empty key and append competing facts.
   */
  recordOrReuseHumanReview(
    manuscriptId: string,
    input: HumanReviewDecisionInput,
  ): HumanReviewDecisionResult {
    return this.database.orm.transaction((tx) => {
      const manuscript = tx
        .select({ id: manuscripts.id })
        .from(manuscripts)
        .where(eq(manuscripts.id, manuscriptId))
        .get();
      if (!manuscript) return { outcome: 'manuscript-not-found' } as const;

      const existing = tx
        .select()
        .from(reviewRecords)
        .where(
          and(
            eq(reviewRecords.manuscriptId, manuscriptId),
            eq(reviewRecords.stage, input.stage),
            eq(reviewRecords.round, input.round),
          ),
        )
        .orderBy(asc(reviewRecords.createdAt))
        .all()
        .map(toReview);

      if (existing.length > 0) {
        const conflict = existing.find((review) => !isSameHumanReviewDecision(review, input));
        return conflict
          ? ({ outcome: 'conflict', review: conflict } as const)
          : ({ outcome: 'reused', review: existing[0]! } as const);
      }

      const review: ReviewRecord = {
        id: randomUUID(),
        manuscriptId,
        stage: input.stage,
        decision: input.decision,
        actor: input.actor,
        actorUserId: input.actorUserId,
        ...(input.reason ? { reason: input.reason } : {}),
        round: input.round,
        ...(input.countersignParty ? { countersignParty: input.countersignParty } : {}),
        ...(input.opinion ? { opinion: input.opinion } : {}),
        createdAt: Date.now(),
      };

      insertReviewWrite(tx, review);
      tx.update(manuscripts)
        .set({ updatedAt: review.createdAt })
        .where(eq(manuscripts.id, manuscriptId))
        .run();
      return { outcome: 'created', review } as const;
    });
  }

  /**
   * Commit every SQLite side effect of one canonical state-machine edge.
   *
   * Callers must finish external model work and deterministic preflight
   * preparation before entering here. The callback is synchronous: no network
   * await can hold the SQLite transaction open.
   */
  commitCanonicalTransition(
    input: CommitCanonicalTransitionInput,
  ): CommitCanonicalTransitionResult {
    const transitionAt = Date.now();
    const artifactWrites = (input.generatedArtifacts ?? []).map((artifact) =>
      prepareArtifactWrite(input.manuscriptId, artifact, transitionAt),
    );
    const committedAt = transitionAt;

    return this.database.orm.transaction((tx) => {
      const row = tx
        .select()
        .from(manuscripts)
        .where(eq(manuscripts.id, input.manuscriptId))
        .get();
      if (!row) return { outcome: 'manuscript-not-found' } as const;

      const current = toManuscript(row as ManuscriptRow);
      if (current.status !== input.expectedFrom) {
        return { outcome: 'status-conflict', manuscript: current } as const;
      }

      const reviewRound = current.reviewRound + (input.incrementReviewRound ? 1 : 0);
      let review: ReviewRecord | undefined;
      let shouldInsertReview = false;

      // A contradictory human decision must be discovered before the first
      // write. An identical direct review is reused while the status advances.
      if (input.review) {
        const candidate: HumanReviewDecisionInput = {
          stage: input.review.stage,
          decision: input.review.decision,
          actor: input.actor,
          actorUserId: input.actorUserId,
          ...(input.review.reason ? { reason: input.review.reason } : {}),
          round: reviewRound,
          ...(input.review.countersignParty
            ? { countersignParty: input.review.countersignParty }
            : {}),
          ...(input.review.opinion ? { opinion: input.review.opinion } : {}),
        };

        if (input.review.mode === 'idempotent-human') {
          const existing = tx
            .select()
            .from(reviewRecords)
            .where(
              and(
                eq(reviewRecords.manuscriptId, input.manuscriptId),
                eq(reviewRecords.stage, candidate.stage),
                eq(reviewRecords.round, candidate.round),
              ),
            )
            .orderBy(asc(reviewRecords.createdAt))
            .all()
            .map(toReview);
          if (existing.length > 0) {
            const conflict = existing.find(
              (record) => !isSameHumanReviewDecision(record, candidate),
            );
            if (conflict) return { outcome: 'review-conflict', review: conflict } as const;
            review = existing[0]!;
          }
        }

        if (!review) {
          review = {
            id: randomUUID(),
            manuscriptId: input.manuscriptId,
            stage: candidate.stage,
            decision: candidate.decision,
            actor: candidate.actor,
            actorUserId: candidate.actorUserId,
            ...(candidate.reason ? { reason: candidate.reason } : {}),
            round: candidate.round,
            ...(candidate.countersignParty
              ? { countersignParty: candidate.countersignParty }
              : {}),
            ...(candidate.opinion ? { opinion: candidate.opinion } : {}),
            createdAt: committedAt,
          };
          shouldInsertReview = true;
        }
      }

      // This compare-and-set is the authoritative status precondition and the
      // first write lock. A later failure rolls it back with every side effect.
      const statusWrite = tx
        .update(manuscripts)
        .set({ status: input.to, reviewRound, updatedAt: committedAt })
        .where(
          and(
            eq(manuscripts.id, input.manuscriptId),
            eq(manuscripts.status, input.expectedFrom),
            eq(manuscripts.reviewRound, current.reviewRound),
          ),
        )
        .run();
      if (statusWrite.changes !== 1) {
        const latest = tx
          .select()
          .from(manuscripts)
          .where(eq(manuscripts.id, input.manuscriptId))
          .get();
        return latest
          ? ({ outcome: 'status-conflict', manuscript: toManuscript(latest as ManuscriptRow) } as const)
          : ({ outcome: 'manuscript-not-found' } as const);
      }

      for (const write of artifactWrites) insertArtifactWrite(tx, write);

      for (const mutation of input.preflightMutations ?? []) {
        const artifactRow = tx
          .select()
          .from(contentArtifacts)
          .where(
            and(
              eq(contentArtifacts.id, mutation.artifactId),
              eq(contentArtifacts.manuscriptId, input.manuscriptId),
            ),
          )
          .get();
        if (!artifactRow) throw new Error('preflight artifact not found');

        if (mutation.replacementSegments) {
          const segments = buildSegments(
            input.manuscriptId,
            mutation.artifactId,
            mutation.replacementSegments,
            committedAt,
          );
          const aiShare = computeAiShare(segments) ?? null;
          const origin = deriveArtifactOrigin(segments) ?? artifactRow.origin;
          const content = segments.map((segment) => segment.text).join('\n');

          tx.delete(sentenceSegments)
            .where(eq(sentenceSegments.artifactId, mutation.artifactId))
            .run();
          if (segments.length > 0) tx.insert(sentenceSegments).values(toSegmentRows(segments)).run();
          tx.update(contentArtifacts)
            .set({ aiShare, origin, content })
            .where(eq(contentArtifacts.id, mutation.artifactId))
            .run();
          tx.insert(traceEvents)
            .values({
              id: randomUUID(),
              manuscriptId: input.manuscriptId,
              kind: 'segments-recorded',
              actorType: 'system',
              actor: '输出预检·自动标识',
              actorUserId: null,
              dataJson: JSON.stringify({
                artifactId: mutation.artifactId,
                segmentCount: segments.length,
                aiShare,
                previousAiShare: artifactRow.aiShare,
                origin,
                previousOrigin: artifactRow.origin,
                origins: countOrigins(segments),
              }),
              createdAt: committedAt,
            })
            .run();
        }

        tx.update(contentArtifacts)
          .set({ metadataJson: JSON.stringify(mutation.metadata) })
          .where(
            and(
              eq(contentArtifacts.id, mutation.artifactId),
              eq(contentArtifacts.manuscriptId, input.manuscriptId),
            ),
          )
          .run();
        tx.insert(traceEvents)
          .values({
            id: randomUUID(),
            manuscriptId: input.manuscriptId,
            kind: 'rule-hit',
            actorType: 'system',
            actor: '输出预检',
            actorUserId: null,
            dataJson: JSON.stringify({ ...mutation.traceData, round: reviewRound }),
            createdAt: committedAt,
          })
          .run();
      }

      if (review && shouldInsertReview) insertReviewWrite(tx, review);

      const signedSegments =
        input.to === 'signed'
          ? tx
              .select()
              .from(sentenceSegments)
              .where(eq(sentenceSegments.manuscriptId, input.manuscriptId))
              .all()
              .map(toSegment)
          : undefined;
      const signedAiShare = signedSegments ? computeAiShare(signedSegments) ?? null : undefined;

      tx.insert(traceEvents)
        .values({
          id: randomUUID(),
          manuscriptId: input.manuscriptId,
          kind: input.to === 'signed' ? 'signed' : 'status-changed',
          actorType: 'human',
          actor: input.actor,
          actorUserId: input.actorUserId,
          dataJson: JSON.stringify({
            from: input.expectedFrom,
            to: input.to,
            round: reviewRound,
            ...(input.to === 'signed'
              ? {
                  aiShare: signedAiShare ?? null,
                  segmentCount: signedSegments?.length ?? 0,
                }
              : {}),
          }),
          createdAt: committedAt,
        })
        .run();

      const manuscript: Manuscript = {
        ...current,
        status: input.to,
        reviewRound,
        updatedAt: committedAt,
      };
      return {
        outcome: 'committed',
        manuscript,
        ...(review ? { review } : {}),
      } as const;
    });
  }

  appendTrace(manuscriptId: string, input: AppendTraceInput): TraceEvent | undefined {
    if (!this.findManuscript(manuscriptId)) return undefined;
    const event: TraceEvent = {
      id: randomUUID(),
      manuscriptId,
      kind: input.kind,
      actorType: input.actorType,
      actor: input.actor,
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      data: input.data ?? {},
      createdAt: this.nextTraceTimestamp(manuscriptId),
    };
    this.database.orm
      .insert(traceEvents)
      .values({ ...event, actorUserId: event.actorUserId ?? null, dataJson: JSON.stringify(event.data) })
      .run();
    return event;
  }

  /**
   * 清空全部稿件及其派生数据，返回删除的稿件数。
   *
   * 只给演示用（`APP_MODE=demo` 下才挂载调用它的端点）。彩排要反复重来，
   * 库里堆满同名稿件时列表就没法看了。
   *
   * 外键是 `ON DELETE CASCADE`，删稿件会带走产物、句子、审核记录与留痕；
   * `admission_results` 若未挂在稿件上则单独清一次。
   */
  deleteAllManuscripts(): number {
    const before = this.database.sqlite
      .prepare('SELECT COUNT(*) AS n FROM manuscripts')
      .get() as { n: number };

    this.database.orm.transaction((tx) => {
      tx.delete(manuscripts).run();
    });

    return before.n;
  }

  /**
   * 删除一个账号，返回是否真的删掉了。只给清理脚本用。
   *
   * 留痕里的 `actor_user_id` 是 `ON DELETE SET NULL`，所以删人不会带走历史——
   * 那条记录会显示「（无署名）」而不是消失。**责任链不能因为账号注销就断掉。**
   */
  deleteUserByUsername(username: string): boolean {
    const result = this.database.orm
      .delete(users)
      .where(eq(users.username, username.trim().toLowerCase()))
      .run();
    return result.changes > 0;
  }

  /**
   * 把一篇稿件的整条时间线整体前移 `days` 天。**只给播种脚本用。**
   *
   * 为什么需要它：播种是一口气跑完的，七篇稿件的时间戳全落在同一秒，监控看板
   * 的「按日趋势」就只有一个点——一个点画不出趋势，看板等于是空的。
   *
   * **整体平移，不是逐条改。** 六张表一起减同一个常量，篇内的相对间隔分毫不动，
   * 所以「环节平均停留」算出来的还是原样（它量的是相邻两次流转的差值）。
   * 换句话说：这里造的是「这篇稿子是前天走的」，不是「这篇稿子走得比较慢」——
   * **能编的只有哪一天，不能编的是走了多久。**
   */
  shiftManuscriptHistory(manuscriptId: string, days: number): void {
    if (days <= 0) return;
    const delta = days * 24 * 60 * 60 * 1000;
    const shift = (sql: string, ...params: unknown[]) =>
      this.database.sqlite.prepare(sql).run(...params);
    this.database.orm.transaction(() => {
      shift(
        'UPDATE manuscripts SET created_at = created_at - ?, updated_at = updated_at - ? WHERE id = ?',
        delta,
        delta,
        manuscriptId,
      );
      shift('UPDATE content_artifacts SET created_at = created_at - ? WHERE manuscript_id = ?', delta, manuscriptId);
      shift('UPDATE sentence_segments SET created_at = created_at - ? WHERE manuscript_id = ?', delta, manuscriptId);
      shift('UPDATE review_records SET created_at = created_at - ? WHERE manuscript_id = ?', delta, manuscriptId);
      shift('UPDATE admission_results SET created_at = created_at - ? WHERE manuscript_id = ?', delta, manuscriptId);
      shift('UPDATE trace_events SET created_at = created_at - ? WHERE manuscript_id = ?', delta, manuscriptId);
    });
  }

  /** 跨稿件聚合（6.14）。SQL 在 [oversight.ts](oversight.ts)，这里只开一个口子。 */
  oversight(): OversightSnapshot {
    return buildOversight(this.database.sqlite);
  }

  close(): void {
    this.database.close();
  }
}

let singleton: WorkflowRepository | undefined;

export function getWorkflowRepository(): WorkflowRepository {
  if (!singleton) {
    singleton = new WorkflowRepository(createDatabase());
    singleton.ensureDemoUsers();
  }
  return singleton;
}

export function closeWorkflowRepository(): void {
  singleton?.close();
  singleton = undefined;
}
