
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';

import { computeAiShare, deriveArtifactOrigin } from '../domain/ai-share.js';
import { deriveSegmentOrigins } from '../domain/segmentation.js';
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
  ReviewRecord,
  SentenceSegment,
  TraceEvent,
} from '../domain/contracts.js';
import type { AdmissionResult, RuleHit } from '../domain/gatekeeping.js';
import { createDatabase, type DatabaseHandle } from './client.js';
import {
  admissionResults,
  contentArtifacts,
  manuscripts,
  reviewRecords,
  sentenceSegments,
  traceEvents,
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


type ArtifactRow = typeof contentArtifacts.$inferSelect;
type SegmentRow = typeof sentenceSegments.$inferSelect;

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

  createManuscript(input: CreateManuscriptInput): Manuscript {
    const now = Date.now();
    const manuscript: Manuscript = {
      id: randomUUID(),
      title: input.title,
      sourceType: input.sourceType,
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
          actor: 'editor',
          dataJson: JSON.stringify({ sourceType: manuscript.sourceType }),
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
      .all() as Manuscript[];
  }

  findManuscript(id: string): Manuscript | undefined {
    return this.database.orm.select().from(manuscripts).where(eq(manuscripts.id, id)).get() as
      | Manuscript
      | undefined;
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
    const reviews: ReviewRecord[] = reviewRows.map((row) => ({
      id: row.id,
      manuscriptId: row.manuscriptId,
      stage: row.stage as ReviewRecord['stage'],
      decision: row.decision as ReviewRecord['decision'],
      actor: row.actor,
      ...(row.reason === null ? {} : { reason: row.reason }),
      round: row.round,
      ...(row.countersignParty === null ? {} : { countersignParty: row.countersignParty }),
      ...(row.opinion === null ? {} : { opinion: row.opinion }),
      createdAt: row.createdAt,
    }));
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
      data: parseJsonObject(row.dataJson),
      createdAt: row.createdAt,
    }));


    return { manuscript, artifacts, segments, reviews, trace };
  }

  updateStatus(
    id: string,
    status: ManuscriptStatus,
    actor: string,
    options: { incrementReviewRound?: boolean } = {},
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
          dataJson: JSON.stringify({ from: existing.status, to: status, round: reviewRound }),
          createdAt: now,
        })
        .run();
    });
    return this.findManuscript(id);
  }

  addArtifact(manuscriptId: string, input: CreateArtifactInput): ContentArtifact | undefined {
    if (!this.findManuscript(manuscriptId)) return undefined;
    const { artifact, segments } = prepareArtifact(
      manuscriptId,
      input,
      this.nextTraceTimestamp(manuscriptId),
    );

    this.database.orm.transaction((tx) => {
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
      tx.update(manuscripts)
        .set({ updatedAt: artifact.createdAt })
        .where(eq(manuscripts.id, manuscriptId))
        .run();
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
            // 生成时的原文要留下来: 人改过之后就找不回来了, 而对照组问的正是
            // 「没有把关人的话, 会播出去的是什么」—— 那是这一版, 不是改完的。
            content: artifact.content,
          }),
          createdAt: artifact.createdAt,
        })
        .run();
    });
    return artifact;
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
   * sentences — see [segmentation.ts](../lib/segmentation.ts).
   */
  reviseArtifact(
    manuscriptId: string,
    artifactId: string,
    input: { actor: string; sentences: string[] },
  ): { artifact: ContentArtifact; segments: SentenceSegment[] } | undefined {
    const manuscript = this.findManuscript(manuscriptId);
    const existing = manuscript ? this.findArtifact(manuscriptId, artifactId) : undefined;
    if (!manuscript || !existing) return undefined;

    const prior = this.listArtifactSegments(artifactId);
    const derived = deriveSegmentOrigins(prior, input.sentences, manuscript.sourceText);
    const result = this.replaceArtifactSegments(manuscriptId, artifactId, {
      actor: input.actor,
      segments: derived,
    });
    if (!result) return undefined;

    const origin = artifactOriginOf(result.segments);
    return { artifact: { ...result.artifact, origin }, segments: result.segments };
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
      ...(input.reason ? { reason: input.reason } : {}),
      round: input.round ?? manuscript.reviewRound,
      ...(input.countersignParty ? { countersignParty: input.countersignParty } : {}),
      ...(input.opinion ? { opinion: input.opinion } : {}),
      createdAt: this.nextTraceTimestamp(manuscriptId),
    };

    this.database.orm.transaction((tx) => {
      tx.insert(reviewRecords).values(review).run();
      tx.update(manuscripts)
        .set({ updatedAt: review.createdAt })
        .where(eq(manuscripts.id, manuscriptId))
        .run();
      tx.insert(traceEvents)
        .values({
          id: randomUUID(),
          manuscriptId,
          kind: 'review-recorded',
          actorType: 'human',
          actor: input.actor,
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
    });
    return review;
  }

  appendTrace(manuscriptId: string, input: AppendTraceInput): TraceEvent | undefined {
    if (!this.findManuscript(manuscriptId)) return undefined;
    const event: TraceEvent = {
      id: randomUUID(),
      manuscriptId,
      kind: input.kind,
      actorType: input.actorType,
      actor: input.actor,
      data: input.data ?? {},
      createdAt: this.nextTraceTimestamp(manuscriptId),
    };
    this.database.orm
      .insert(traceEvents)
      .values({ ...event, dataJson: JSON.stringify(event.data) })
      .run();
    return event;
  }

  close(): void {
    this.database.close();
  }
}

let singleton: WorkflowRepository | undefined;

export function getWorkflowRepository(): WorkflowRepository {
  singleton ??= new WorkflowRepository(createDatabase());
  return singleton;
}

export function closeWorkflowRepository(): void {
  singleton?.close();
  singleton = undefined;
}
