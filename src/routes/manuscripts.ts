import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { getWorkflowRepository } from '../db/repository.js';
import {
  artifactKinds,
  artifactOrigins,
  contentSourceTypes,
  manuscriptStatuses,

  reviewDecisions,
  reviewStages,
  sentenceOrigins,
  type JsonObject,
  type ManuscriptStatus,
  type ReviewStage,
  type WorkflowDomainEvent,
} from '../domain/contracts.js';
import {
  hasPermission,
  mayPerformAs,
  requiredRoleForReview,
  workflowActorLabel,
} from '../domain/permissions.js';
import { workflowRoles } from '../domain/workflow.js';
import {
  manuscriptNotEditableMessage,
  mayMutateManuscriptContent,
} from '../domain/mutation-policy.js';
import { publish } from '../lib/bus.js';
import { requireAuth, type AuthEnv } from '../middleware/auth.js';
import { executeAuthenticatedTransition } from './workbench.js';

const createManuscriptSchema = z.object({
  title: z.string().trim().min(1).max(200),
  sourceType: z.enum(contentSourceTypes),
  sourceText: z.string().min(1).max(500_000),
});


const segmentSchema = z.object({
  text: z.string().min(1).max(5_000),
  // Legacy provenance fields remain parseable but are never authoritative at
  // the browser boundary. Only `text` reaches the repository revision path.
  origin: z.enum(sentenceOrigins).optional(),
  sourceRef: z.string().trim().min(1).max(200).optional(),
});

const segmentListSchema = z.array(segmentSchema).max(2_000);

const createArtifactSchema = z.object({
  kind: z.enum(artifactKinds),
  content: z.string().min(1).max(500_000),
  origin: z.enum(artifactOrigins).optional(),
  aiShare: z.number().min(0).max(1).optional(),
  model: z.string().trim().min(1).max(100).optional(),
  segments: segmentListSchema.optional(),
});

const replaceSegmentsSchema = z.object({
  actor: z.string().trim().min(1).max(100).optional(),
  segments: segmentListSchema,
});

const recordReviewSchema = z.object({
  stage: z.enum(reviewStages),
  decision: z.enum(reviewDecisions),
  actor: z.string().trim().min(1).max(100).optional(),
  reason: z.string().trim().min(1).max(2_000).optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(manuscriptStatuses),
  actor: z.string().trim().min(1).max(100).optional(),
  /** Untrusted intent; membership is checked against the authenticated account. */
  role: z.enum(workflowRoles),
  reason: z.string().trim().min(1).max(2_000).optional(),
});

const activeStatusForReview: Readonly<Partial<Record<ReviewStage, ManuscriptStatus>>> = {
  editor: 'first-review',
  'department-head': 'second-review',
  countersign: 'countersign',
  'supervising-leader': 'final-review',
};

const humanReviewDecisions = ['approved', 'changes-requested'] as const;

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

export const manuscriptRoutes = new Hono<AuthEnv>();

manuscriptRoutes.use('/api/manuscripts', requireAuth);
manuscriptRoutes.use('/api/manuscripts/*', requireAuth);

manuscriptRoutes.get('/api/manuscripts', (c) => {
  if (!hasPermission(c.get('currentUser'), 'manuscript:read')) {
    return c.json({ error: 'role_not_allowed' }, 403);
  }
  const rawLimit = Number(c.req.query('limit') ?? 50);
  const limit = Number.isInteger(rawLimit) ? rawLimit : 50;
  return c.json({ items: getWorkflowRepository().listManuscripts(limit) });
});

manuscriptRoutes.post('/api/manuscripts', async (c) => {
  const parsed = createManuscriptSchema.safeParse(await readJson(c.req));
  if (!parsed.success) return c.json(badRequest(parsed.error.issues), 400);

  const user = c.get('currentUser');
  if (!mayPerformAs(user, 'editor', 'manuscript:create')) {
    return c.json({ error: 'role_not_allowed', message: '当前账号不能新建稿件。' }, 403);
  }
  const actor = workflowActorLabel(user, 'editor');
  const manuscript = getWorkflowRepository().createManuscript(parsed.data, {
    label: actor,
    userId: user.id,
  });
  emitWorkflowEvent('manuscript', manuscript.id, {
    action: 'created',
    status: manuscript.status,
    sourceType: manuscript.sourceType,
  });
  return c.json({ manuscript }, 201);
});

manuscriptRoutes.get('/api/manuscripts/:id', (c) => {
  if (!hasPermission(c.get('currentUser'), 'manuscript:read')) {
    return c.json({ error: 'role_not_allowed' }, 403);
  }
  const aggregate = getWorkflowRepository().getAggregate(c.req.param('id'));
  if (!aggregate) return c.json({ error: 'manuscript_not_found' }, 404);
  return c.json(aggregate);
});

manuscriptRoutes.patch('/api/manuscripts/:id/status', async (c) => {
  const parsed = updateStatusSchema.safeParse(await readJson(c.req));
  if (!parsed.success) return c.json(badRequest(parsed.error.issues), 400);

  // Both public surfaces share one executor. A raw status write could otherwise
  // publish an empty manuscript without artifacts, preflight, or approvals.
  const result = await executeAuthenticatedTransition(
    c.req.param('id'),
    c.get('currentUser'),
    {
      to: parsed.data.status,
      role: parsed.data.role,
      ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
    },
  );
  if (!result.ok) return c.json(result.body, result.status);
  return c.json({ manuscript: result.manuscript });
});

manuscriptRoutes.post('/api/manuscripts/:id/artifacts', async (c) => {
  const parsed = createArtifactSchema.safeParse(await readJson(c.req));
  if (!parsed.success) return c.json(badRequest(parsed.error.issues), 400);

  const user = c.get('currentUser');
  if (!mayPerformAs(user, 'editor', 'artifact:create')) {
    return c.json({ error: 'role_not_allowed', message: '当前账号不能保存稿件产物。' }, 403);
  }
  const repository = getWorkflowRepository();
  const manuscript = repository.findManuscript(c.req.param('id'));
  if (!manuscript) return c.json({ error: 'manuscript_not_found' }, 404);
  if (!mayMutateManuscriptContent(manuscript.status, 'foundation-artifact-create')) {
    return c.json(
      { error: 'manuscript_not_editable', message: manuscriptNotEditableMessage },
      409,
    );
  }
  const actor = workflowActorLabel(user, 'editor');
  const artifact = repository.addHumanArtifact(manuscript.id, {
    kind: parsed.data.kind,
    content: parsed.data.content,
    actor,
    actorUserId: user.id,
  });
  if (!artifact) return c.json({ error: 'manuscript_not_found' }, 404);
  emitWorkflowEvent('workflow', artifact.manuscriptId, {
    action: 'artifact-created',
    artifactId: artifact.id,
    kind: artifact.kind,
    origin: artifact.origin,
  });
  return c.json({ artifact }, 201);
});


manuscriptRoutes.put('/api/manuscripts/:id/artifacts/:artifactId/segments', async (c) => {
  const parsed = replaceSegmentsSchema.safeParse(await readJson(c.req));
  if (!parsed.success) return c.json(badRequest(parsed.error.issues), 400);

  const manuscriptId = c.req.param('id');
  const user = c.get('currentUser');
  if (!mayPerformAs(user, 'editor', 'artifact:revise')) {
    return c.json({ error: 'role_not_allowed', message: '只有编辑角色可以改稿。' }, 403);
  }
  const repository = getWorkflowRepository();
  const manuscript = repository.findManuscript(manuscriptId);
  if (!manuscript) return c.json({ error: 'manuscript_not_found' }, 404);
  if (!mayMutateManuscriptContent(manuscript.status, 'foundation-segments-replace')) {
    return c.json(
      { error: 'manuscript_not_editable', message: manuscriptNotEditableMessage },
      409,
    );
  }
  const actor = workflowActorLabel(user, 'editor');
  const result = repository.reviseArtifact(
    manuscriptId,
    c.req.param('artifactId'),
    {
      actor,
      actorUserId: user.id,
      sentences: parsed.data.segments.map((segment) => segment.text),
    },
  );
  if (!result) return c.json({ error: 'artifact_not_found' }, 404);
  emitWorkflowEvent('trace', manuscriptId, {
    action: 'segments-recorded',
    artifactId: result.artifact.id,
    segmentCount: result.segments.length,
    aiShare: result.artifact.aiShare ?? null,
    actor,
  });
  return c.json(result);
});

manuscriptRoutes.post('/api/manuscripts/:id/reviews', async (c) => {
  const parsed = recordReviewSchema.safeParse(await readJson(c.req));
  if (!parsed.success) return c.json(badRequest(parsed.error.issues), 400);

  const role = requiredRoleForReview(parsed.data.stage);
  if (!role) {
    return c.json({ error: 'system_only', message: '准入与预检记录只能由系统写入。' }, 403);
  }
  const user = c.get('currentUser');
  const reviewPermission = `review:${role}` as const;
  if (!mayPerformAs(user, role, reviewPermission)) {
    return c.json({ error: 'role_not_allowed', message: '当前账号不能记录该审级。' }, 403);
  }
  if (!(humanReviewDecisions as readonly string[]).includes(parsed.data.decision)) {
    return c.json(
      { error: 'invalid_review_decision', message: '人工审级只接受通过或退回修改。' },
      400,
    );
  }
  if (parsed.data.stage === 'countersign') {
    return c.json(
      {
        error: 'countersign_transition_required',
        message: '会签决定必须通过状态流转同时提交会签方和意见。',
      },
      409,
    );
  }
  if (parsed.data.decision === 'changes-requested' && !parsed.data.reason) {
    return c.json({ error: 'reason_required', message: '退回必须写明理由，理由进审计。' }, 400);
  }
  const manuscript = getWorkflowRepository().findManuscript(c.req.param('id'));
  if (!manuscript) return c.json({ error: 'manuscript_not_found' }, 404);
  if (activeStatusForReview[parsed.data.stage] !== manuscript.status) {
    return c.json(
      { error: 'review_stage_not_active', message: '当前稿件尚未进入该人工审级。' },
      409,
    );
  }
  const actor = workflowActorLabel(user, role);
  const result = getWorkflowRepository().recordOrReuseHumanReview(c.req.param('id'), {
    ...parsed.data,
    actor,
    actorUserId: user.id,
    round: manuscript.reviewRound,
  });
  if (result.outcome === 'manuscript-not-found') {
    return c.json({ error: 'manuscript_not_found' }, 404);
  }
  if (result.outcome === 'conflict') {
    return c.json(
      {
        error: 'review_decision_conflict',
        message: '本轮该审级已有不同审核决定，不能覆盖。',
      },
      409,
    );
  }
  if (result.outcome === 'created') {
    emitWorkflowEvent('workflow', result.review.manuscriptId, {
      action: 'review-recorded',
      reviewId: result.review.id,
      stage: result.review.stage,
      decision: result.review.decision,
      actor: result.review.actor,
    });
  }
  const reused = result.outcome === 'reused';
  return c.json({ review: result.review, reused, idempotent: reused }, reused ? 200 : 201);
});

manuscriptRoutes.post('/api/manuscripts/:id/trace', async (c) => {
  return c.json(
    { error: 'system_only', message: '模型与规则留痕只能由进程内系统模块写入。' },
    403,
  );
});
