import { randomUUID } from 'node:crypto';
import { asc, desc, eq } from 'drizzle-orm';
import type {
  AppendTraceInput,
  ContentArtifact,
  CreateArtifactInput,
  CreateManuscriptInput,
  JsonObject,
  Manuscript,
  ManuscriptAggregate,
  ManuscriptStatus,
  RecordReviewInput,
  ReviewRecord,
  TraceEvent,
} from '../domain/contracts.js';
import { createDatabase, type DatabaseHandle } from './client.js';
import { contentArtifacts, manuscripts, reviewRecords, traceEvents } from './schema.js';

const parseJsonObject = (value: string): JsonObject => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as JsonObject;
  } catch {
    // Old or damaged trace data must not make the whole manuscript unreadable.
  }
  return {};
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
    const artifacts: ContentArtifact[] = artifactRows.map((row) => ({
      id: row.id,
      manuscriptId: row.manuscriptId,
      kind: row.kind as ContentArtifact['kind'],
      content: row.content,
      origin: row.origin as ContentArtifact['origin'],
      ...(row.aiShare === null ? {} : { aiShare: row.aiShare }),
      ...(row.model === null ? {} : { model: row.model }),
      createdAt: row.createdAt,
    }));
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

    return { manuscript, artifacts, reviews, trace };
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
    const artifact: ContentArtifact = {
      id: randomUUID(),
      manuscriptId,
      kind: input.kind,
      content: input.content,
      origin: input.origin,
      ...(input.aiShare === undefined ? {} : { aiShare: input.aiShare }),
      ...(input.model ? { model: input.model } : {}),
      createdAt: Date.now(),
    };

    this.database.orm.transaction((tx) => {
      tx.insert(contentArtifacts).values(artifact).run();
      tx.update(manuscripts)
        .set({ updatedAt: artifact.createdAt })
        .where(eq(manuscripts.id, manuscriptId))
        .run();
      tx.insert(traceEvents)
        .values({
          id: randomUUID(),
          manuscriptId,
          kind: 'artifact-created',
          actorType: input.origin === 'human' ? 'human' : 'ai',
          actor: input.model ?? input.origin,
          dataJson: JSON.stringify({
            artifactId: artifact.id,
            kind: artifact.kind,
            origin: artifact.origin,
            aiShare: artifact.aiShare ?? null,
          }),
          createdAt: artifact.createdAt,
        })
        .run();
    });
    return artifact;
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
