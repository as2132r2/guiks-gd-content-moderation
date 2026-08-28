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

/**
 * 一次 AI 参与度的变动。生成时是起点，之后每一次人工改稿都推低它一格。
 *
 * 追溯图谱靠这条序列回答台领导真正关心的问题: 这篇稿子一路走下来，人到底
 * 有没有动过它。
 */
export interface ProvenancePoint {
  at: number;
  event: 'generated' | 'revised';
  artifactId: string;
  artifactKind: string;
  actor: string;
  /** 稿件级 AI 参与度 —— 折线画的是这个，终点必须等于页面上的大数字。 */
  share: number;
  /** 这一次动到的那个产物自己的比例。 */
  artifactShare: number;
  /** 稿件当时的总句数。 */
  segmentCount: number;
}

export interface SignOff {
  actor: string;
  at: number;
  /** 签发那一刻的 AI 参与度。100% 一路签发 = 三审三校形同虚设。 */
  aiShare?: number;
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
  /** AI 参与度随流转的变化，供追溯图谱画折线。 */
  provenance: ProvenancePoint[];
  signOff?: SignOff;
}

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asText = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Rebuild the AI 参与度 curve from the audit trail rather than storing it
 * twice. 留痕 is the record of what happened; deriving from it means the graph
 * can never disagree with the trail it claims to visualise.
 */
function readProvenance(trace: readonly TraceEvent[]): ProvenancePoint[] {
  // 每个产物的最新状态，随时间往前滚。稿件级比例 = Σ(比例×句数) / Σ句数，
  // 因为 比例×句数 就是这个产物的加权 AI 句数。
  const live = new Map<string, { share: number; count: number }>();
  const points: ProvenancePoint[] = [];

  const ordered = [...trace].sort((a, b) => a.createdAt - b.createdAt);
  for (const event of ordered) {
    const isCreate = event.kind === 'artifact-created';
    const isRevise = event.kind === 'segments-recorded';
    if (!isCreate && !isRevise) continue;

    const artifactShare = asNumber(event.data.aiShare);
    const count = asNumber(event.data.segmentCount);
    const artifactId = asText(event.data.artifactId);
    if (artifactShare === undefined || count === undefined || count === 0 || !artifactId) continue;

    live.set(artifactId, { share: artifactShare, count });

    let weighted = 0;
    let total = 0;
    for (const entry of live.values()) {
      weighted += entry.share * entry.count;
      total += entry.count;
    }

    points.push({
      at: event.createdAt,
      event: isCreate ? 'generated' : 'revised',
      artifactId,
      artifactKind: asText(event.data.kind),
      actor: event.actor,
      share: total === 0 ? 0 : Math.round((weighted / total) * 10_000) / 10_000,
      artifactShare,
      segmentCount: total,
    });
  }
  return points;
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
  const signed = trace.find((event) => event.kind === 'signed');
  const share = computeAiShare(segments);
  return {
    manuscript,
    stage: stageOf(manuscript.status),
    statusLabel: statusLabels[manuscript.status],
    admission: runAdmission(manuscript),
    artifacts: artifactViews,
    preflight: summarize(allAnnotations),
    ...(share === undefined ? {} : { aiShare: share }),
    segmentCount: segments.length,
    reviews,
    trace,
    actions,
    ...(owner ? { waitingOn: owner } : {}),
    provenance: readProvenance(trace),
    ...(signed
      ? {
          signOff: {
            actor: signed.actor,
            at: signed.createdAt,
            ...(share === undefined ? {} : { aiShare: share }),
          },
        }
      : {}),
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

// 根路径就是工作台。/workbench 保留为别名，旧链接和书签不会断。
workbenchRoutes.get('/', (c) => c.html(renderWorkbench()));
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
