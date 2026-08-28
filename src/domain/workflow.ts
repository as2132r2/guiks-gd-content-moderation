/**
 * The manuscript state machine.
 *
 * business-process.md 第一条原则: 一条路走到黑，没有分支——用户在任何时刻只有一个
 * 「下一步」。That only holds if the legal moves live in one table instead of
 * being scattered across the UI, so the workbench asks this module what to
 * render and the API asks it what to allow.
 *
 * Pure data + pure functions: no IO, no HTTP, no database.
 */
import type { ManuscriptStatus, ProofreadPass, ReviewStage } from './contracts.js';

/** 三个角色写死（方案 §十三）。`system` is the machine writing its own verdict. */
export const workflowRoles = ['editor', 'department-head', 'supervising-leader'] as const;
export type WorkflowRole = (typeof workflowRoles)[number];
export type TransitionActor = WorkflowRole | 'system';

export const roleLabels: Readonly<Record<WorkflowRole, string>> = {
  editor: '编辑 / 记者',
  'department-head': '部门主任',
  'supervising-leader': '分管领导',
};

export interface ProofreadResponsibility {
  pass: ProofreadPass;
  stage: Extract<ReviewStage, 'editor' | 'department-head' | 'supervising-leader'>;
  label: string;
  responsibilities: readonly string[];
}

/** 三审与三校的职责声明；供状态机、规则层和界面共用。 */
export const proofreadResponsibilities: readonly ProofreadResponsibility[] = [
  {
    pass: 'first',
    stage: 'editor',
    label: '一校',
    responsibilities: ['错别字', '语病', '标点', '格式'],
  },
  {
    pass: 'second',
    stage: 'department-head',
    label: '二校',
    responsibilities: ['数据', '人名', '职务', '地名', '术语', '排版一致性'],
  },
  {
    pass: 'third',
    stage: 'supervising-leader',
    label: '三校',
    responsibilities: ['导向', '事实判断', '通读', '排版效果', '整体一致性'],
  },
];

export const isWorkflowRole = (value: unknown): value is WorkflowRole =>
  typeof value === 'string' && (workflowRoles as readonly string[]).includes(value);

export const statusLabels: Readonly<Record<ManuscriptStatus, string>> = {
  draft: '草稿',
  'admission-blocked': '已拒绝',
  'admission-reason-required': '待填选题依据',
  admitted: '已准入',
  generated: '已生成',
  preflight: '预检完成',
  'first-review': '待初审',
  'second-review': '待复审',
  countersign: '待会签',
  'final-review': '待终审',
  revision: '复核修改',
  signed: '已签发',
  published: '已发布',
};

/** Nothing leaves these two. 已拒绝 is terminal by design — 申诉 is v2. */
export const terminalStatuses: readonly ManuscriptStatus[] = ['admission-blocked', 'published'];

export interface Transition {
  from: ManuscriptStatus;
  to: ManuscriptStatus;
  actor: TransitionActor;
  /** Button text in the workbench. There is only ever one primary button. */
  label: string;
  /** 退回必须带理由，且理由进审计 (business-process.md §三). */
  requiresReason?: boolean;
  /** A 退回 is rendered as a secondary action and always writes a reason. */
  kind: 'advance' | 'return';
  /** Which review stage this move records, when it records one. */
  stage?: ReviewStage;
}

/**
 * The whole state machine. Read it top to bottom and you have read the demo:
 * 草稿 → 准入 → 生成 → 预检 → 三审 → 签发 → 发布.
 */
export const transitions: readonly Transition[] = [
  // ——— 入口准入: the system writes its own verdict, never a human ———
  {
    from: 'draft',
    to: 'admission-blocked',
    actor: 'system',
    kind: 'advance',
    label: '入口准入·硬拦',
    stage: 'admission',
  },
  {
    from: 'draft',
    to: 'admission-reason-required',
    actor: 'system',
    kind: 'advance',
    label: '入口准入·要理由',
    stage: 'admission',
  },
  {
    from: 'draft',
    to: 'admitted',
    actor: 'system',
    kind: 'advance',
    label: '入口准入·仅留痕放行',
    stage: 'admission',
  },

  // 要理由那一档: the editor supplies 选题依据 and the manuscript is let through.
  {
    from: 'admission-reason-required',
    to: 'admitted',
    actor: 'editor',
    kind: 'advance',
    label: '提交选题依据并放行',
    requiresReason: true,
    stage: 'admission',
  },

  // ——— 生产与预检 ———
  {
    from: 'admitted',
    to: 'generated',
    actor: 'editor',
    kind: 'advance',
    label: '生成播报稿与短视频文案',
  },
  {
    from: 'generated',
    to: 'preflight',
    actor: 'editor',
    kind: 'advance',
    label: '运行输出预检',
    stage: 'preflight',
  },
  {
    from: 'preflight',
    to: 'first-review',
    actor: 'editor',
    kind: 'advance',
    label: '提交初审',
  },

  // ——— 三审三校 ———
  {
    from: 'first-review',
    to: 'second-review',
    actor: 'editor',
    kind: 'advance',
    label: '初审通过，报送复审',
    stage: 'editor',
  },
  {
    from: 'first-review',
    to: 'revision',
    actor: 'editor',
    kind: 'return',
    label: '退回修改',
    requiresReason: true,
    stage: 'editor',
  },
  {
    from: 'second-review',
    to: 'final-review',
    actor: 'department-head',
    kind: 'advance',
    label: '复审通过，报送终审',
    stage: 'department-head',
  },
  {
    from: 'second-review',
    to: 'countersign',
    actor: 'department-head',
    kind: 'advance',
    label: '复审通过，发起会签',
    stage: 'department-head',
  },
  {
    from: 'second-review',
    to: 'revision',
    actor: 'department-head',
    kind: 'return',
    label: '退回复核修改',
    requiresReason: true,
    stage: 'department-head',
  },
  {
    from: 'countersign',
    to: 'final-review',
    actor: 'department-head',
    kind: 'advance',
    label: '完成会签，报送终审',
    stage: 'countersign',
  },
  {
    from: 'countersign',
    to: 'revision',
    actor: 'department-head',
    kind: 'return',
    label: '会签后退回复核修改',
    requiresReason: true,
    stage: 'countersign',
  },
  {
    from: 'final-review',
    to: 'signed',
    actor: 'supervising-leader',
    kind: 'advance',
    label: '签发',
    stage: 'supervising-leader',
  },
  {
    from: 'final-review',
    to: 'revision',
    actor: 'supervising-leader',
    kind: 'return',
    label: '退回复核修改',
    requiresReason: true,
    stage: 'supervising-leader',
  },

  // 任一审级退回后，编辑改稿并重跑预检；随后从待初审开始新一轮。
  {
    from: 'revision',
    to: 'preflight',
    actor: 'editor',
    kind: 'advance',
    label: '完成复核修改并重新预检',
    stage: 'preflight',
  },

  // 多平台发布不做，按钮只演示状态变化 (方案 §十三).
  {
    from: 'signed',
    to: 'published',
    actor: 'supervising-leader',
    kind: 'advance',
    label: '发布',
  },
];

/** Every move available from a status, whoever the actor is. */
export function transitionsFrom(status: ManuscriptStatus): Transition[] {
  return transitions.filter((transition) => transition.from === status);
}

/**
 * What the given role may do right now.
 *
 * 角色可合并 (business-process.md §二): one person may hold several roles, so
 * callers pass the role they are currently acting as. The merge happens in the
 * person, not in the responsibility — every action is still recorded under the
 * role that took it.
 */
export function nextActions(status: ManuscriptStatus, role: WorkflowRole): Transition[] {
  return transitionsFrom(status).filter((transition) => transition.actor === role);
}

/** The single primary button, or undefined when this role is only waiting. */
export function primaryAction(
  status: ManuscriptStatus,
  role: WorkflowRole,
): Transition | undefined {
  return nextActions(status, role).find((transition) => transition.kind === 'advance');
}

/** Whose turn it is — used to tell an idle role who they are waiting on. */
export function waitingOn(status: ManuscriptStatus): WorkflowRole | undefined {
  const owner = transitionsFrom(status).find((transition) => transition.actor !== 'system');
  return owner ? (owner.actor as WorkflowRole) : undefined;
}

export type TransitionRefusal =
  | { code: 'terminal_status'; message: string }
  | { code: 'illegal_transition'; message: string }
  | { code: 'wrong_role'; message: string; expected: TransitionActor[] }
  | { code: 'reason_required'; message: string };

/**
 * Guard one move. Returns null when it is allowed, otherwise why not.
 *
 * The reason check is not validation hygiene: 退回不写理由退不回去 is how the
 * responsibility chain stays intact.
 */
export function checkTransition(input: {
  from: ManuscriptStatus;
  to: ManuscriptStatus;
  actor: TransitionActor;
  reason?: string;
}): TransitionRefusal | null {
  const { from, to, actor, reason } = input;

  if (terminalStatuses.includes(from)) {
    return { code: 'terminal_status', message: `${statusLabels[from]}是终态，不能再流转。` };
  }

  const candidates = transitions.filter(
    (transition) => transition.from === from && transition.to === to,
  );
  if (candidates.length === 0) {
    return {
      code: 'illegal_transition',
      message: `不能从「${statusLabels[from]}」直接到「${statusLabels[to]}」。`,
    };
  }

  const allowed = candidates.find((transition) => transition.actor === actor);
  if (!allowed) {
    return {
      code: 'wrong_role',
      message: `「${statusLabels[from]} → ${statusLabels[to]}」不由当前角色执行。`,
      expected: candidates.map((transition) => transition.actor),
    };
  }

  if (allowed.requiresReason && !reason?.trim()) {
    return {
      code: 'reason_required',
      message:
        allowed.kind === 'return'
          ? '退回必须写明理由，理由进审计。'
          : '这一步必须填写选题依据，依据进审计。',
    };
  }

  return null;
}

/** The matching transition, for callers that need its stage/label after the guard. */
export function findTransition(
  from: ManuscriptStatus,
  to: ManuscriptStatus,
  actor: TransitionActor,
): Transition | undefined {
  return transitions.find(
    (transition) => transition.from === from && transition.to === to && transition.actor === actor,
  );
}

/**
 * Ordered checkpoints for the workbench progress rail: the six stages of the
 * 主链, collapsed from the status enum.
 */
export const workbenchStages = [
  { key: 'source', label: '素材入口', statuses: ['draft'] },
  {
    key: 'admission',
    label: '入口准入',
    statuses: ['admission-blocked', 'admission-reason-required', 'admitted'],
  },
  { key: 'generate', label: '稿件生成', statuses: ['generated'] },
  { key: 'preflight', label: '输出预检', statuses: ['preflight'] },
  {
    key: 'review',
    label: '三审流转',
    statuses: ['first-review', 'second-review', 'countersign', 'final-review', 'revision'],
  },
  { key: 'trace', label: 'AI 参与度追溯', statuses: ['signed', 'published'] },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  statuses: readonly ManuscriptStatus[];
}>;

export type WorkbenchStageKey = (typeof workbenchStages)[number]['key'];

export function stageOf(status: ManuscriptStatus): WorkbenchStageKey {
  const stage = workbenchStages.find((candidate) =>
    (candidate.statuses as readonly ManuscriptStatus[]).includes(status),
  );
  return (stage ?? workbenchStages[0]).key;
}
