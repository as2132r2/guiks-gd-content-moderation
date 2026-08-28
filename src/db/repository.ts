
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
import { createDatabase, type DatabaseHandle } from './client.js';
import {
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
  constructor(private readonly database: DatabaseHandle) {}

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

  updateStatus(id: string, status: ManuscriptStatus, actor: string): Manuscript | undefined {
    const existing = this.findManuscript(id);
    if (!existing) return undefined;
    const now = Date.now();

    this.database.orm.transaction((tx) => {
      tx.update(manuscripts)
        .set({ status, updatedAt: now })
        .where(eq(manuscripts.id, id))
        .run();
      tx.insert(traceEvents)
        .values({
          id: randomUUID(),
          manuscriptId: id,
          kind: status === 'signed' ? 'signed' : 'status-changed',
          actorType: 'human',
          actor,
          dataJson: JSON.stringify({ from: existing.status, to: status }),
          createdAt: now,
        })
        .run();
    });
    return this.findManuscript(id);
  }

  addArtifact(manuscriptId: string, input: CreateArtifactInput): ContentArtifact | undefined {

    if (!this.findManuscript(manuscriptId)) return undefined;
    const createdAt = Date.now();
    const artifactId = randomUUID();
    const segments = buildSegments(manuscriptId, artifactId, input.segments ?? [], createdAt);

    // Sentence provenance is the authority; the caller-supplied ratio and
    // origin are only fallbacks for artifacts nobody has segmented yet.
    const aiShare = segments.length > 0 ? computeAiShare(segments) : input.aiShare;
    const origin = deriveArtifactOrigin(segments) ?? input.origin;
    const artifact: ContentArtifact = {
      id: artifactId,
      manuscriptId,
      kind: input.kind,
      content: input.content,
      origin,
      ...(aiShare === undefined ? {} : { aiShare }),
      ...(input.model ? { model: input.model } : {}),
      createdAt,
    };

    this.database.orm.transaction((tx) => {
      tx.insert(contentArtifacts).values(artifact).run();
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
          actorType: origin === 'human' ? 'human' : 'ai',
          actor: input.model ?? origin,
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

    const now = Date.now();

    const segments = buildSegments(manuscriptId, artifactId, input.segments, now);
    const aiShare = computeAiShare(segments) ?? null;

    // Emptying the sentences cannot invent a provenance: keep the last label.
    const origin = deriveArtifactOrigin(segments) ?? existing.origin;
    // Drop the old ratio outright — an unmeasurable artifact has no share.
    const { aiShare: previousAiShare, ...carried } = existing;

    this.database.orm.transaction((tx) => {
      tx.delete(sentenceSegments).where(eq(sentenceSegments.artifactId, artifactId)).run();
      if (segments.length > 0) tx.insert(sentenceSegments).values(toSegmentRows(segments)).run();
      tx.update(contentArtifacts)
        .set({ aiShare, origin })
        .where(eq(contentArtifacts.id, artifactId))
        .run();
      tx.update(manuscripts).set({ updatedAt: now }).where(eq(manuscripts.id, manuscriptId)).run();
      tx.insert(traceEvents)
        .values({
          id: randomUUID(),
          manuscriptId,
          kind: 'segments-recorded',
          actorType: 'human',
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
      artifact: { ...carried, origin, ...(aiShare === null ? {} : { aiShare }) },
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

    // The stored artifact text has to follow its sentences, or the 追溯图谱 and
    // the reading view would disagree about what was signed off.
    const content = input.sentences.join('\n');
    const origin = artifactOriginOf(result.segments);
    this.database.orm
      .update(contentArtifacts)
      .set({ content, origin })
      .where(eq(contentArtifacts.id, artifactId))
      .run();

    return { artifact: { ...result.artifact, content, origin }, segments: result.segments };
  }

  recordReview(manuscriptId: string, input: RecordReviewInput): ReviewRecord | undefined {
    if (!this.findManuscript(manuscriptId)) return undefined;
    const review: ReviewRecord = {
      id: randomUUID(),
      manuscriptId,
      stage: input.stage,
      decision: input.decision,
      actor: input.actor,
      ...(input.reason ? { reason: input.reason } : {}),
      createdAt: Date.now(),
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
      createdAt: Date.now(),
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
