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
import { config, isUpstreamModelAllowed, listUpstreamModels } from '../config.js';
import {
  getWorkflowRepository,
  type PreparedPreflightMutation,
} from '../db/repository.js';
import { computeAiShare } from '../domain/ai-share.js';
import type { UserAccount } from '../domain/auth.js';
import {
  contentSourceTypes,
  coverageTopics,
  manuscriptStatuses,
  type ContentArtifact,
  type CreateArtifactInput,
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
  manuscriptNotEditableMessage,
  mayMutateManuscriptContent,
} from '../domain/mutation-policy.js';
import {
  hasPermission,
  mayActAs,
  mayPerformAs,
  requiredPermissionForTransition,
  requiredRoleForReview,
  workflowActorLabel,
} from '../domain/permissions.js';
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
import { KeyedLock } from '../lib/keyed-lock.js';
import { readSessionUser } from '../lib/session.js';
import { UpstreamError } from '../lib/upstream.js';
import { requireAuth, type AuthEnv } from '../middleware/auth.js';
import { generateBroadcastArtifacts } from '../model/broadcast.js';
import { runAdmission, runPreflight } from '../rules/index.js';
import { renderWorkbench } from '../views/workbench-view.js';
import { ModelTraceError } from './gateway.js';

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  sourceType: z.enum(contentSourceTypes),
  coverageTopic: z.enum(coverageTopics).optional(),
  sourceText: z.string().trim().min(1).max(500_000),
});

const transitionSchema = z.object({
  to: z.enum(manuscriptStatuses),
  role: z.enum(workflowRoles),
  model: z.string().trim().min(1).max(100).optional(),
  reason: z.string().trim().min(1).max(2_000).optional(),
  countersignParty: z.string().trim().min(1).max(100).optional(),
  opinion: z.string().trim().min(1).max(2_000).optional(),
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
  /** A returned manuscript may only re-enter preflight after a real human edit. */
  revisionReady: boolean;
  /** AI 参与度随流转的变化，供追溯图谱画折线。 */
  provenance: ProvenancePoint[];
  signOff?: SignOff;
  /** UI hint only; the route repeats the authoritative server-side check. */
  contentEditable: boolean;
}

function hasRevisionAfterLatestReturn(
  reviews: readonly ReviewRecord[],
  trace: readonly TraceEvent[],
): boolean {
  const latestReturn = [...reviews]
    .reverse()
    .find((review) => review.decision === 'changes-requested' || review.decision === 'rejected');
  if (!latestReturn) return false;
  return trace.some(
    (event) =>
      event.kind === 'segments-recorded' &&
      event.actorType === 'human' &&
      event.createdAt > latestReturn.createdAt,
  );
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
    const isSegmentUpdate = event.kind === 'segments-recorded';
    const isRevise = isSegmentUpdate && event.actorType === 'human';
    if (!isCreate && !isSegmentUpdate) continue;

    const artifactShare = asNumber(event.data.aiShare);
    const count = asNumber(event.data.segmentCount);
    const artifactId = asText(event.data.artifactId);
    if (artifactShare === undefined || count === undefined || count === 0 || !artifactId) continue;

    live.set(artifactId, { share: artifactShare, count });

    // 自动补标识会改变句数，但不是一次人工改稿：更新曲线基线，不新增拐点。
    if (!isCreate && !isRevise) continue;

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
  const signedShare = signed ? asNumber(signed.data.aiShare) : undefined;
  return {
    manuscript,
    stage: stageOf(manuscript.status),
    statusLabel: statusLabels[manuscript.status],
    admission: getWorkflowRepository().getAdmissionResult(manuscriptId) ?? runAdmission(manuscript),
    artifacts: artifactViews,
    preflight: summarize(allAnnotations),
    ...(share === undefined ? {} : { aiShare: share }),
    segmentCount: segments.length,
    reviews,
    trace,
    actions,
    ...(owner ? { waitingOn: owner } : {}),
    revisionReady: manuscript.status === 'revision' && hasRevisionAfterLatestReturn(reviews, trace),
    provenance: readProvenance(trace),
    contentEditable: mayMutateManuscriptContent(
      manuscript.status,
      'workbench-artifact-revise',
    ),
    ...(signed
      ? {
          signOff: {
            actor: signed.actor,
            at: signed.createdAt,
            ...(signedShare === undefined ? {} : { aiShare: signedShare }),
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

/**
 * Prepare deterministic preflight mutations without writing SQLite.
 * The canonical repository commit applies the whole plan with the status edge.
 */
function preparePreflight(manuscriptId: string): PreparedPreflightMutation[] | undefined {
  const repository = getWorkflowRepository();
  const aggregate = repository.getAggregate(manuscriptId);
  if (!aggregate) return undefined;

  return aggregate.artifacts
    .filter((item) => item.kind !== 'source')
    .map((artifact) => {
      const own = aggregate.segments.filter((segment) => segment.artifactId === artifact.id);
      const sentences =
        own.length > 0
          ? own.map((segment) => segment.text)
          : splitSentences(artifact.content);
      const checked = runPreflight({
        artifactId: artifact.id,
        sentences,
        sourceText: aggregate.manuscript.sourceText,
      });
      const label = checked.annotations.find(
        (annotation) => annotation.category === 'ai-label' && annotation.suggestion,
      );

      return {
        artifactId: artifact.id,
        ...(label?.suggestion
          ? {
              replacementSegments: [
                ...own.map((segment) => ({
                  text: segment.text,
                  origin: segment.origin,
                  ...(segment.sourceRef ? { sourceRef: segment.sourceRef } : {}),
                })),
                { text: label.suggestion, origin: 'ai' as const },
              ],
            }
          : {}),
        metadata: {
          ...(artifact.metadata ?? {}),
          aiGenerated: true,
          aiLabel: '人工智能生成',
          labeledAt: Date.now(),
        },
        traceData: {
          artifactId: artifact.id,
          kind: artifact.kind,
          ...checked.summary,
          rules: checked.annotations.map((annotation) => annotation.category),
          proofreadPasses: checked.annotations.map((annotation) => annotation.proofreadPass),
          autoFixed: label ? ['ai-label'] : [],
        },
      } satisfies PreparedPreflightMutation;
    });
}

export const workbenchRoutes = new Hono<AuthEnv>();

// 根路径是产品介绍页（src/routes/landing.ts）。工作台只在 /workbench——
// 访客点进来先看懂这是什么，再决定要不要登录。
workbenchRoutes.get('/workbench', async (c) =>
  (await readSessionUser(c))
    ? c.html(renderWorkbench({ demoToolsEnabled: config.demoToolsEnabled }))
    : c.redirect('/login?next=/workbench'),
);

workbenchRoutes.use('/api/workbench', requireAuth);
workbenchRoutes.use('/api/workbench/*', requireAuth);

workbenchRoutes.get('/api/workbench', (c) =>
  hasPermission(c.get('currentUser'), 'manuscript:read')
    ? c.json({ items: getWorkflowRepository().listManuscripts(50) })
    : c.json({ error: 'role_not_allowed' }, 403),
);

/** Browser-safe model catalogue. Provider URLs and credentials never leave the server. */
workbenchRoutes.get('/api/workbench-models', requireAuth, (c) =>
  c.json({ defaultModel: config.upstreamModel, items: listUpstreamModels() }),
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

  const user = c.get('currentUser');
  if (!mayPerformAs(user, 'editor', 'manuscript:create')) {
    return c.json({ error: 'role_not_allowed', message: '当前账号不能新建稿件。' }, 403);
  }
  const repository = getWorkflowRepository();
  const admission = runAdmission(parsed.data);
  const actor = workflowActorLabel(user, 'editor');
  const manuscript = repository.createManuscript(parsed.data, { label: actor, userId: user.id });
  repository.saveAdmissionResult(manuscript.id, admission);

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
  if (!hasPermission(c.get('currentUser'), 'manuscript:read')) {
    return c.json({ error: 'role_not_allowed' }, 403);
  }
  const view = buildView(c.req.param('id'));
  if (!view) return c.json({ error: 'manuscript_not_found' }, 404);
  return c.json(view);
});

/**
 * 对照组：同一份通稿，关掉把关人会怎样。
 *
 * 不重跑、不模拟——它就是**同一份产物减去把关**之后剩下的东西。所以这一屏上
 * 的每个数字都能指回真实留痕，被追问「这是演的还是真的」时答得出来。
 */
workbenchRoutes.get('/api/workbench/:id/contrast', (c) => {
  if (!hasPermission(c.get('currentUser'), 'audit:read')) {
    return c.json({ error: 'role_not_allowed' }, 403);
  }
  const view = buildView(c.req.param('id'));
  if (!view) return c.json({ error: 'manuscript_not_found' }, 404);

  // 对照的是**生成时那一版**，不是改完的那一版。关掉把关人就没有预检标注，
  // 编辑根本不知道要改哪里——所以直接播出去的是模型原样写的东西。
  const asShipped = view.artifacts.map((item) => {
    const created = view.trace.find(
      (event) =>
        event.kind === 'artifact-created' && event.data.artifactId === item.artifact.id,
    );
    const original = asText(created?.data.content) || item.artifact.content;
    const { annotations } = runPreflight({
      artifactId: item.artifact.id,
      sentences: splitSentences(original),
      sourceText: view.manuscript.sourceText,
    });
    return { kind: item.artifact.kind, content: original, annotations };
  });

  const shipped = asShipped.flatMap((item) => item.annotations);
  const count = (category: string) =>
    shipped.filter((annotation) => annotation.category === category).length;

  // 「出事找谁」数的是**不同的人**，不是审批次数：同一个人走两级只算一个人头。
  const accountable = new Set(view.reviews.map((review) => review.actor));
  const hardBlocked = view.manuscript.status === 'admission-blocked';

  return c.json({
    manuscriptId: view.manuscript.id,
    title: view.manuscript.title,
    hardBlocked,
    /** 关掉把关人时，这就是会直接发出去的东西——模型原样写的那一版。 */
    wouldShip: asShipped.map((item) => ({ kind: item.kind, content: item.content })),
    without: {
      admissionChecked: false,
      // 硬拦那一档的对照最刺眼：模型本来会被调用，内容本来会产生。
      modelInvoked: true,
      issuesShipped: shipped.length,
      bannedTermsShipped: count('banned-term'),
      inconsistenciesShipped: count('inconsistency'),
      // 关掉把关人，受保护当事人的真名会原样发出去——对照里最刺眼的一项。
      namesExposed: count('privacy-name'),
      proofreadIssuesShipped: count('typo') + count('punctuation') + count('format'),
      aiLabelled: false,
      aiShareKnown: false,
      accountableActors: 0,
      traceEvents: 0,
    },
    with: {
      admissionDecision: view.admission.decision,
      modelInvoked: !hardBlocked,
      /** 把关人在生成那一刻抓到了多少。 */
      issuesCaught: shipped.length,
      ...summarize(shipped),
      /** 走完流程后还剩多少——系统自动处理或人工改掉的命中不再计入。 */
      issuesRemaining: view.artifacts.reduce((sum, item) => sum + item.annotations.length, 0),
      ...(view.aiShare === undefined ? {} : { aiShare: view.aiShare }),
      segmentCount: view.segmentCount,
      accountableActors: accountable.size,
      traceEvents: view.trace.length,
      ...(view.signOff ? { signedBy: view.signOff.actor } : {}),
    },
  });
});

export interface AuthenticatedTransitionIntent {
  to: ManuscriptStatus;
  role: WorkflowRole;
  model?: string;
  reason?: string;
  countersignParty?: string;
  opinion?: string;
}

type TransitionFailure = {
  ok: false;
  status: 400 | 403 | 404 | 409 | 429 | 502 | 503;
  body: { error: string; message?: string };
};

type TransitionSuccess = {
  ok: true;
  manuscript: Manuscript;
  view: WorkbenchView;
};

const transitionLocks = new KeyedLock<string>();

/** Canonical human transition pipeline shared by both HTTP API surfaces. */
export async function executeAuthenticatedTransition(
  id: string,
  user: UserAccount,
  intent: AuthenticatedTransitionIntent,
): Promise<TransitionFailure | TransitionSuccess> {
  return transitionLocks.run(id, async () => {
    const repository = getWorkflowRepository();
    const manuscript = repository.findManuscript(id);
    if (!manuscript) {
      return { ok: false, status: 404, body: { error: 'manuscript_not_found' } };
    }

    const { to, role, model, reason, countersignParty, opinion } = intent;
    const permission = requiredPermissionForTransition(manuscript.status, to);
    if (!mayActAs(user, role)) {
      return {
        ok: false,
        status: 403,
        body: { error: 'role_not_allowed', message: '当前账号不能行使该角色。' },
      };
    }
    const refusal = checkTransition({
      from: manuscript.status,
      to,
      actor: role,
      ...(reason ? { reason } : {}),
    });
    if (refusal) {
      return {
        ok: false,
        status: refusal.code === 'reason_required' ? 400 : 409,
        body: { error: refusal.code, message: refusal.message },
      };
    }

    // A state-machine edge without an authorization mapping is a configuration
    // defect. Fail closed instead of silently treating membership as permission.
    if (!permission || !mayPerformAs(user, role, permission)) {
      return {
        ok: false,
        status: 403,
        body: { error: 'role_not_allowed', message: '当前角色无权执行该动作。' },
      };
    }

    const transition = findTransition(manuscript.status, to, role)!;
    const actor = workflowActorLabel(user, role);

    if (transition.from === 'revision' && to === 'preflight') {
      const aggregate = repository.getAggregate(id);
      if (!aggregate || !hasRevisionAfterLatestReturn(aggregate.reviews, aggregate.trace)) {
        return {
          ok: false,
          status: 409,
          body: {
            error: 'revision_required',
            message: '请先按退回意见实际修改并保存至少一处内容，再重新预检。',
          },
        };
      }
    }

    if (
      transition.from === 'countersign' &&
      to === 'final-review' &&
      (!countersignParty || !opinion)
    ) {
      return {
        ok: false,
        status: 400,
        body: {
          error: 'countersign_details_required',
          message: '完成会签必须填写会签方和会签意见。',
        },
      };
    }

    // Finish external work and deterministic preparation before opening the
    // one synchronous SQLite transaction for this edge.
    let generatedArtifacts: CreateArtifactInput[] | undefined;
    if (transition.from === 'admitted' && to === 'generated') {
      const selectedModel = model ?? config.upstreamModel;
      if (!isUpstreamModelAllowed(selectedModel)) {
        return {
          ok: false,
          status: 400,
          body: {
            error: 'model_not_allowed',
            message: '所选模型未配置或已停用，请刷新后重新选择。',
          },
        };
      }
      let generated: Awaited<ReturnType<typeof generateBroadcastArtifacts>>;
      try {
        generated = await generateBroadcastArtifacts({
          manuscriptId: id,
          title: manuscript.title,
          sourceText: manuscript.sourceText,
          actor,
          model: selectedModel,
        });
      } catch (error) {
        if (error instanceof UpstreamError) {
          if (error.status === 429) {
            return {
              ok: false,
              status: 429,
              body: {
                error: 'model_quota_unavailable',
                message: '所选模型账户余额不足或无可用资源包，稿件状态未推进。请充值或切换其他模型。',
              },
            };
          }
          return {
            ok: false,
            status: 502,
            body: {
              error: 'model_upstream_failed',
              message: '模型暂时不可用，稿件状态未推进，请稍后重试。',
            },
          };
        }
        if (error instanceof ModelTraceError) {
          return {
            ok: false,
            status: 503,
            body: {
              error: 'model_trace_unavailable',
              message: '调用留痕暂时不可用，系统未放行本次生成。',
            },
          };
        }
        throw error;
      }
      generatedArtifacts = generated.map((item) => {
        const sentences = splitSentences(item.content);
        return {
          kind: item.kind,
          content: item.content,
          origin: 'ai',
          model: item.model,
          metadata: { aiGenerated: true, aiLabel: '人工智能生成' },
          segments: sentences.map((text) => ({ text, origin: 'ai' as const })),
        };
      });
    }

    let preflightMutations: PreparedPreflightMutation[] | undefined;
    if (
      (transition.from === 'generated' || transition.from === 'revision') &&
      to === 'preflight'
    ) {
      preflightMutations = preparePreflight(id);
      if (!preflightMutations) {
        return { ok: false, status: 404, body: { error: 'manuscript_not_found' } };
      }
    }

    const committed = repository.commitCanonicalTransition({
      manuscriptId: id,
      expectedFrom: transition.from,
      to,
      actor,
      actorUserId: user.id,
      incrementReviewRound: transition.from === 'revision' && to === 'preflight',
      ...(generatedArtifacts ? { generatedArtifacts } : {}),
      ...(preflightMutations ? { preflightMutations } : {}),
      ...(transition.stage
        ? {
            review: {
              mode: requiredRoleForReview(transition.stage)
                ? ('idempotent-human' as const)
                : ('append-system' as const),
              stage: transition.stage,
              decision:
                transition.kind === 'return'
                  ? ('changes-requested' as const)
                  : ('approved' as const),
              ...(reason ? { reason } : {}),
              ...(countersignParty ? { countersignParty } : {}),
              ...(opinion ? { opinion } : {}),
            },
          }
        : {}),
    });
    if (committed.outcome === 'manuscript-not-found') {
      return { ok: false, status: 404, body: { error: 'manuscript_not_found' } };
    }
    if (committed.outcome === 'review-conflict') {
      return {
        ok: false,
        status: 409,
        body: {
          error: 'review_decision_conflict',
          message: '本轮该审级已有不同审核决定，不能覆盖或继续流转。',
        },
      };
    }
    if (committed.outcome === 'status-conflict') {
      return {
        ok: false,
        status: 409,
        body: { error: 'illegal_transition', message: '稿件状态已变化，请刷新后重试。' },
      };
    }
    emit(id, { action: 'transition', from: transition.from, to, role, actor });

    const view = buildView(id);
    if (!view) {
      return { ok: false, status: 404, body: { error: 'manuscript_not_found' } };
    }
    return { ok: true, manuscript: committed.manuscript, view };
  });
}

/**
 * The one button. Every stage advance goes through the canonical pipeline so
 * state, generated artifacts, reviews, trace, and authorization stay atomic in meaning.
 */
workbenchRoutes.post('/api/workbench/:id/transition', async (c) => {
  const parsed = transitionSchema.safeParse(await readJson(c.req));
  if (!parsed.success) return c.json(badRequest(parsed.error.issues), 400);

  const result = await executeAuthenticatedTransition(
    c.req.param('id'),
    c.get('currentUser'),
    parsed.data,
  );
  if (!result.ok) return c.json(result.body, result.status);
  return c.json({ manuscript: result.manuscript, view: result.view });
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

  const repository = getWorkflowRepository();
  const id = c.req.param('id');
  const user = c.get('currentUser');
  if (!mayPerformAs(user, parsed.data.role, 'artifact:revise')) {
    return c.json({ error: 'role_not_allowed', message: '只有编辑角色可以改稿。' }, 403);
  }
  const manuscript = repository.findManuscript(id);
  if (!manuscript) return c.json({ error: 'manuscript_not_found' }, 404);
  if (!mayMutateManuscriptContent(manuscript.status, 'workbench-artifact-revise')) {
    return c.json(
      { error: 'manuscript_not_editable', message: manuscriptNotEditableMessage },
      409,
    );
  }
  const sentences = splitSentences(parsed.data.content);
  if (sentences.length === 0) return c.json({ error: 'empty_content' }, 400);

  const artifactId = c.req.param('artifactId');
  const existing = repository.findArtifact(id, artifactId);
  if (!existing) return c.json({ error: 'artifact_not_found' }, 404);
  const previous = repository.listArtifactSegments(artifactId).map((segment) => segment.text);
  if (
    previous.length === sentences.length &&
    previous.every((sentence, index) => sentence === sentences[index])
  ) {
    return c.json(
      { error: 'no_content_change', message: '稿件内容没有变化，请修改后再保存。' },
      409,
    );
  }

  const result = repository.reviseArtifact(id, artifactId, {
    actor: workflowActorLabel(user, 'editor'),
    actorUserId: user.id,
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
/** 演示夹具复用同一份准入结论→状态的映射，避免播种出来的稿件与真链路走偏。 */
export { admissionStatus as admissionStatusOf };
