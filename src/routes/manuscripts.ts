import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { getWorkflowRepository } from '../db/repository.js';
import {
  actorTypes,
  artifactKinds,
  artifactOrigins,
  contentSourceTypes,
  manuscriptStatuses,
  reviewDecisions,
  reviewStages,
  traceKinds,
  type JsonObject,
  type WorkflowDomainEvent,
} from '../domain/contracts.js';
import { publish } from '../lib/bus.js';

const createManuscriptSchema = z.object({
  title: z.string().trim().min(1).max(200),
  sourceType: z.enum(contentSourceTypes),
  sourceText: z.string().min(1).max(500_000),
});

const createArtifactSchema = z.object({
  kind: z.enum(artifactKinds),
  content: z.string().min(1).max(500_000),
  origin: z.enum(artifactOrigins),
  aiShare: z.number().min(0).max(1).optional(),
  model: z.string().trim().min(1).max(100).optional(),
});

const recordReviewSchema = z.object({
  stage: z.enum(reviewStages),
  decision: z.enum(reviewDecisions),
  actor: z.string().trim().min(1).max(100),
  reason: z.string().trim().min(1).max(2_000).optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(manuscriptStatuses),
  actor: z.string().trim().min(1).max(100),
});

const appendTraceSchema = z.object({
  kind: z.enum(traceKinds),
  actorType: z.enum(actorTypes),
  actor: z.string().trim().min(1).max(100),
  data: z.record(z.string(), z.unknown()).optional(),
});

const badRequest = (issues: z.core.$ZodIssue[]) => ({
  error: 'invalid_request',
  issues: issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
});

async function readJson(request: { json: () => Promise<unknown> }): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function emitWorkflowEvent(
  type: WorkflowDomainEvent['type'],
  manuscriptId: string,
  data: JsonObject,
): void {
  const event: WorkflowDomainEvent = {
    id: randomUUID(),
    type,
    manuscriptId,
    occurredAt: Date.now(),
    data,
  };
  publish(type, event);
}

export const manuscriptRoutes = new Hono();

manuscriptRoutes.get('/api/manuscripts', (c) => {
  const rawLimit = Number(c.req.query('limit') ?? 50);
  const limit = Number.isInteger(rawLimit) ? rawLimit : 50;
  return c.json({ items: getWorkflowRepository().listManuscripts(limit) });
});

manuscriptRoutes.post('/api/manuscripts', async (c) => {
  const parsed = createManuscriptSchema.safeParse(await readJson(c.req));
  if (!parsed.success) return c.json(badRequest(parsed.error.issues), 400);

  const manuscript = getWorkflowRepository().createManuscript(parsed.data);
  emitWorkflowEvent('manuscript', manuscript.id, {
    action: 'created',
    status: manuscript.status,
    sourceType: manuscript.sourceType,
  });
  return c.json({ manuscript }, 201);
});

manuscriptRoutes.get('/api/manuscripts/:id', (c) => {
  const aggregate = getWorkflowRepository().getAggregate(c.req.param('id'));
  if (!aggregate) return c.json({ error: 'manuscript_not_found' }, 404);
  return c.json(aggregate);
});

manuscriptRoutes.patch('/api/manuscripts/:id/status', async (c) => {
  const parsed = updateStatusSchema.safeParse(await readJson(c.req));
  if (!parsed.success) return c.json(badRequest(parsed.error.issues), 400);

  const manuscript = getWorkflowRepository().updateStatus(
    c.req.param('id'),
    parsed.data.status,
    parsed.data.actor,
  );
  if (!manuscript) return c.json({ error: 'manuscript_not_found' }, 404);
  emitWorkflowEvent('workflow', manuscript.id, {
    action: 'status-changed',
    status: manuscript.status,
    actor: parsed.data.actor,
  });
  return c.json({ manuscript });
});

manuscriptRoutes.post('/api/manuscripts/:id/artifacts', async (c) => {
  const parsed = createArtifactSchema.safeParse(await readJson(c.req));
  if (!parsed.success) return c.json(badRequest(parsed.error.issues), 400);

  const artifact = getWorkflowRepository().addArtifact(c.req.param('id'), parsed.data);
  if (!artifact) return c.json({ error: 'manuscript_not_found' }, 404);
  emitWorkflowEvent('workflow', artifact.manuscriptId, {
    action: 'artifact-created',
    artifactId: artifact.id,
    kind: artifact.kind,
    origin: artifact.origin,
  });
  return c.json({ artifact }, 201);
});

manuscriptRoutes.post('/api/manuscripts/:id/reviews', async (c) => {
  const parsed = recordReviewSchema.safeParse(await readJson(c.req));
  if (!parsed.success) return c.json(badRequest(parsed.error.issues), 400);

  const review = getWorkflowRepository().recordReview(c.req.param('id'), parsed.data);
  if (!review) return c.json({ error: 'manuscript_not_found' }, 404);
  emitWorkflowEvent('workflow', review.manuscriptId, {
    action: 'review-recorded',
    reviewId: review.id,
    stage: review.stage,
    decision: review.decision,
    actor: review.actor,
  });
  return c.json({ review }, 201);
});

manuscriptRoutes.post('/api/manuscripts/:id/trace', async (c) => {
  const parsed = appendTraceSchema.safeParse(await readJson(c.req));
  if (!parsed.success) return c.json(badRequest(parsed.error.issues), 400);

  const trace = getWorkflowRepository().appendTrace(c.req.param('id'), {
    ...parsed.data,
    data: (parsed.data.data ?? {}) as JsonObject,
  });
  if (!trace) return c.json({ error: 'manuscript_not_found' }, 404);
  emitWorkflowEvent('trace', trace.manuscriptId, {
    action: 'trace-appended',
    traceId: trace.id,
    kind: trace.kind,
    actorType: trace.actorType,
  });
  return c.json({ trace }, 201);
});
