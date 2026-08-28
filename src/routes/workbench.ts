/**
 * 工作台 —— 六步主链的宿主。
 *
 * 一条路走到黑，没有分支: the page never shows a menu, it shows whatever the
 * state machine says is next. So the server hands the browser a finished view
 * model (`GET /api/workbench/:id`) and takes one action at a time
 * (`POST /api/workbench/:id/transition`), instead of letting the client decide
 * what is legal.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { getWorkflowRepository } from '../db/repository.js';
import { computeAiShare } from '../domain/ai-share.js';
import {
  contentSourceTypes,
  manuscriptStatuses,
  type ContentArtifact,
  type JsonObject,
  type Manuscript,
  type ManuscriptStatus,
  type ReviewRecord,
  type SentenceSegment,
  type TraceEvent,
} from '../domain/contracts.js';
import {
  summarize,
  type AdmissionResult,
  type Annotation,
  type PreflightSummary,
} from '../domain/gatekeeping.js';
import { splitSentences } from '../domain/segmentation.js';
import {
  checkTransition,
  findTransition,
  isWorkflowRole,
  nextActions,
  stageOf,
  statusLabels,
  transitions,
  waitingOn,
  workflowRoles,
  type Transition,
  type WorkflowRole,
} from '../domain/workflow.js';
import { publish } from '../lib/bus.js';
import { generateBroadcastArtifacts } from '../model/broadcast.js';
import { runAdmission, runPreflight } from '../rules/index.js';
import { renderWorkbench } from '../views/workbench-view.js';

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  sourceType: z.enum(contentSourceTypes),
  sourceText: z.string().trim().min(1).max(500_000),
});

const transitionSchema = z.object({
  to: z.enum(manuscriptStatuses),
  role: z.enum(workflowRoles),
  reason: z.string().trim().min(1).max(2_000).optional(),
});

const reviseSchema = z.object({
  role: z.enum(workflowRoles),
  actor: z.string().trim().min(1).max(100).optional(),
  content: z.string().trim().min(1).max(500_000),
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

/** 角色可合并: the switcher names the role someone is acting as right now. */
const actorNames: Readonly<Record<WorkflowRole, string>> = {
  editor: '编辑·张敏',
  'department-head': '部门主任·李建国',
  'supervising-leader': '分管领导·王志远',
};

const actorName = (role: WorkflowRole) => actorNames[role];

export interface ArtifactView {
  artifact: ContentArtifact;
  segments: SentenceSegment[];
  annotations: Annotation[];
}

export interface WorkbenchView {
  manuscript: Manuscript;
  stage: string;
  statusLabel: string;
  admission: AdmissionResult;
  artifacts: ArtifactView[];
  preflight: PreflightSummary;
  /** Weighted across every sentence of every artifact. Undefined = 未测量. */
  aiShare?: number;
  segmentCount: number;
  reviews: ReviewRecord[];
  trace: TraceEvent[];
  /** Every role's legal moves, so switching roles needs no round trip. */
  actions: Record<WorkflowRole, Transition[]>;
  waitingOn?: WorkflowRole;
}

function buildView(manuscriptId: string): WorkbenchView | undefined {
  const aggregate = getWorkflowRepository().getAggregate(manuscriptId);
  if (!aggregate) return undefined;

  const { manuscript, artifacts, segments, reviews, trace } = aggregate;

  const artifactViews: ArtifactView[] = artifacts
    .filter((artifact) => artifact.kind !== 'source')
    .map((artifact) => {
      const own = segments.filter((segment) => segment.artifactId === artifact.id);
      const sentences = own.length > 0 ? own.map((segment) => segment.text) : splitSentences(artifact.content);
      const { annotations } = runPreflight({
        artifactId: artifact.id,
        sentences,
        sourceText: manuscript.sourceText,
      });
      return { artifact, segments: own, annotations };
    });

  const allAnnotations = artifactViews.flatMap((view) => view.annotations);
  const actions = Object.fromEntries(
    workflowRoles.map((role) => [role, nextActions(manuscript.status, role)]),
  ) as Record<WorkflowRole, Transition[]>;

  const owner = waitingOn(manuscript.status);
  return {
    manuscript,
    stage: stageOf(manuscript.status),
    statusLabel: statusLabels[manuscript.status],
    admission: runAdmission(manuscript),
    artifacts: artifactViews,
    preflight: summarize(allAnnotations),
    ...(computeAiShare(segments) === undefined ? {} : { aiShare: computeAiShare(segments) }),
    segmentCount: segments.length,
    reviews,
    trace,
    actions,
    ...(owner ? { waitingOn: owner } : {}),
  };
}

const emit = (manuscriptId: string, data: JsonObject) =>
  publish('workflow', { id: `wb_${Date.now().toString(36)}`, type: 'workflow', manuscriptId, occurredAt: Date.now(), data });

/**
 * The status a fresh manuscript lands in, straight from the entry gate.
 * 硬拦 那一档到这里就结束了 —— 模型一次都没有被调用。
 */
function admissionStatus(result: AdmissionResult): ManuscriptStatus {
  if (result.decision === 'blocked') return 'admission-blocked';
  if (result.decision === 'reason-required') return 'admission-reason-required';
  return 'admitted';
}

export const workbenchRoutes = new Hono();

workbenchRoutes.get('/workbench', (c) => c.html(renderWorkbench()));

workbenchRoutes.get('/api/workbench', (c) =>
  c.json({ items: getWorkflowRepository().listManuscripts(50) }),
);

/**
 * 阶段① 素材入口 + 阶段② 入口准入, in one call.
 *
 * They are one action for the editor: paste a 通稿, get a verdict. Splitting
 * them into two clicks would put a menu where the principle says there is only
 * ever one next step.
 */
workbenchRoutes.post('/api/workbench', async (c) => {
  const parsed = createSchema.safeParse(await readJson(c.req));
  if (!parsed.success) return c.json(badRequest(parsed.error.issues), 400);

  const repository = getWorkflowRepository();
  const admission = runAdmission(parsed.data);
  const manuscript = repository.createManuscript(parsed.data);

  repository.appendTrace(manuscript.id, {
    kind: 'rule-hit',
    actorType: 'system',
    actor: '入口准入',
    data: {
      decision: admission.decision,
      reasonCode: admission.reasonCode,
      hits: admission.hits.map((hit) => hit.ruleId),
      offDutyUse: admission.offDutyUse ?? false,
      modelInvoked: admission.decision !== 'blocked',
    },
  });

  const updated = repository.updateStatus(manuscript.id, admissionStatus(admission), '入口准入');
  emit(manuscript.id, { action: 'admission', decision: admission.decision });
  return c.json({ manuscript: updated ?? manuscript, admission }, 201);
});

workbenchRoutes.get('/api/workbench/:id', (c) => {
  const view = buildView(c.req.param('id'));
  if (!view) return c.json({ error: 'manuscript_not_found' }, 404);
  return c.json(view);
});

/**
 * The one button. Every stage advance goes through here so the state machine
 * is the only thing that decides what may happen next.
 */
workbenchRoutes.post('/api/workbench/:id/transition', async (c) => {
  const parsed = transitionSchema.safeParse(await readJson(c.req));
  if (!parsed.success) return c.json(badRequest(parsed.error.issues), 400);

  const repository = getWorkflowRepository();
  const id = c.req.param('id');
  const manuscript = repository.findManuscript(id);
  if (!manuscript) return c.json({ error: 'manuscript_not_found' }, 404);

  const { to, role, reason } = parsed.data;
  const refusal = checkTransition({ from: manuscript.status, to, actor: role, ...(reason ? { reason } : {}) });
  if (refusal) {
    return c.json(
      { error: refusal.code, message: refusal.message },
      refusal.code === 'reason_required' ? 400 : 409,
    );
  }

  const transition = findTransition(manuscript.status, to, role)!;
  const actor = actorName(role);

  // 生成 and 预检 are side effects of their transition, not separate buttons.
  if (transition.from === 'admitted' && to === 'generated') {
    const generated = await generateBroadcastArtifacts({
      title: manuscript.title,
      sourceText: manuscript.sourceText,
      actor,
    });
    for (const item of generated) {
      // Everything the model wrote starts as `ai`; the ratio only moves when a
      // human actually rewrites something.
      const sentences = splitSentences(item.content);
      repository.addArtifact(id, {
        kind: item.kind,
        content: item.content,
        origin: 'ai',
        model: item.model,
        segments: sentences.map((text) => ({ text, origin: 'ai' as const })),
      });
    }
  }

  if (transition.from === 'generated' && to === 'preflight') {
    const view = buildView(id);
    for (const artifactView of view?.artifacts ?? []) {
      const summary = summarize(artifactView.annotations);
      repository.appendTrace(id, {
        kind: 'rule-hit',
        actorType: 'system',
        actor: '输出预检',
        data: {
          artifactId: artifactView.artifact.id,
          kind: artifactView.artifact.kind,
          ...summary,
          rules: artifactView.annotations.map((annotation) => annotation.category),
        },
      });
    }
  }

  if (transition.stage) {
    repository.recordReview(id, {
      stage: transition.stage,
      decision: transition.kind === 'return' ? 'changes-requested' : 'approved',
      actor,
      ...(reason ? { reason } : {}),
    });
  }

  const updated = repository.updateStatus(id, to, actor);
  emit(id, { action: 'transition', from: transition.from, to, role, actor });

  const view = buildView(id);
  return c.json({ manuscript: updated, view });
});

/**
 * 阶段④ 的人工改稿。
 *
 * The body carries text only — never an origin. See
 * [repository.reviseArtifact](../db/repository.ts): the server diffs against
 * the previous sentences and decides provenance itself, because AI 参与度 is
 * what exposes 走过场的审核 and the person being measured cannot be its source.
 */
workbenchRoutes.post('/api/workbench/:id/artifacts/:artifactId/revise', async (c) => {
  const parsed = reviseSchema.safeParse(await readJson(c.req));
  if (!parsed.success) return c.json(badRequest(parsed.error.issues), 400);

  const id = c.req.param('id');
  const sentences = splitSentences(parsed.data.content);
  if (sentences.length === 0) return c.json({ error: 'empty_content' }, 400);

  const result = getWorkflowRepository().reviseArtifact(id, c.req.param('artifactId'), {
    actor: parsed.data.actor?.trim() || actorName(parsed.data.role),
    sentences,
  });
  if (!result) return c.json({ error: 'artifact_not_found' }, 404);

  emit(id, {
    action: 'revised',
    artifactId: result.artifact.id,
    aiShare: result.artifact.aiShare ?? null,
  });
  return c.json({ view: buildView(id) });
});

/** Exposed for the view layer and tests; the page never computes legality itself. */
export const workflowTransitions = transitions;
export { isWorkflowRole };
