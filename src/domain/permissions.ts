import type {
  ManuscriptStatus,
  ReviewStage,
  SystemRole,
  WorkflowRole,
} from './contracts.js';
import type { UserAccount } from './auth.js';

export const permissions = [
  'manuscript:read',
  'manuscript:create',
  'artifact:create',
  'artifact:revise',
  'review:editor',
  'review:department-head',
  'review:supervising-leader',
  'workflow:admission-reason',
  'workflow:generate',
  'workflow:preflight',
  'workflow:submit-initial-review',
  'workflow:initial-review',
  'workflow:department-review',
  'workflow:countersign',
  'workflow:final-review',
  'workflow:sign',
  'workflow:publish',
  'audit:read',
  // 判定依据（词表）与使用限制。读给所有系统角色，写只给台领导——判定依据是
  // 「说得清」的底，谁都能改就等于谁都不负责。
  'rules:read',
  'rules:write',
  // 使用限制。和判定依据同一个道理：读给所有人，写只给台领导。
  'usage-limit:read',
  'usage-limit:write',
] as const;
export type Permission = (typeof permissions)[number];

export const rolePermissions: Readonly<Record<SystemRole, readonly Permission[]>> = {
  editor: [
    'manuscript:read',
    'manuscript:create',
    'artifact:create',
    'artifact:revise',
    'review:editor',
    'workflow:admission-reason',
    'workflow:generate',
    'workflow:preflight',
    'workflow:submit-initial-review',
    'workflow:initial-review',
    'audit:read',
    'rules:read',
    'usage-limit:read',
  ],
  'department-head': [
    'manuscript:read',
    'review:department-head',
    'workflow:department-review',
    'workflow:countersign',
    'audit:read',
    'rules:read',
    'usage-limit:read',
  ],
  'supervising-leader': [
    'manuscript:read',
    'review:supervising-leader',
    'workflow:final-review',
    'workflow:sign',
    'workflow:publish',
    'audit:read',
    'rules:read',
    'usage-limit:read',
  ],
  // 台领导不进状态机，但判定依据和使用限制归他管——这是这个角色唯一的写权限。
  'station-leader': [
    'manuscript:read',
    'audit:read',
    'rules:read',
    'rules:write',
    'usage-limit:read',
    'usage-limit:write',
  ],
};

export const hasPermission = (user: UserAccount, permission: Permission): boolean =>
  user.roles.some((role) => rolePermissions[role].includes(permission));

export const mayActAs = (user: UserAccount, role: WorkflowRole): boolean =>
  user.roles.includes(role);

/**
 * Authorize one concrete action under the role named by the request.
 *
 * Deliberately do not use `hasPermission` here: a multi-role account may own a
 * permission through another role, but the audit record must reflect the role
 * actually exercising it.
 */
export const mayPerformAs = (
  user: UserAccount,
  role: WorkflowRole,
  permission: Permission,
): boolean => mayActAs(user, role) && rolePermissions[role].includes(permission);

type TransitionKey = `${ManuscriptStatus}->${ManuscriptStatus}`;

/** Every human state-machine edge has one deterministic permission. */
export const transitionPermissions: Readonly<Partial<Record<TransitionKey, Permission>>> = {
  'admission-reason-required->admitted': 'workflow:admission-reason',
  'admitted->generated': 'workflow:generate',
  'generated->preflight': 'workflow:preflight',
  'preflight->first-review': 'workflow:submit-initial-review',
  'first-review->second-review': 'workflow:initial-review',
  'first-review->revision': 'workflow:initial-review',
  'second-review->final-review': 'workflow:department-review',
  'second-review->countersign': 'workflow:countersign',
  'second-review->revision': 'workflow:department-review',
  'countersign->final-review': 'workflow:countersign',
  'countersign->revision': 'workflow:countersign',
  'final-review->signed': 'workflow:sign',
  'final-review->revision': 'workflow:final-review',
  'revision->preflight': 'workflow:preflight',
  'signed->published': 'workflow:publish',
};

export const requiredPermissionForTransition = (
  from: ManuscriptStatus,
  to: ManuscriptStatus,
): Permission | undefined => transitionPermissions[`${from}->${to}`];

export const workflowActorLabel = (user: UserAccount, role: WorkflowRole): string => {
  const roleLabel: Record<WorkflowRole, string> = {
    editor: '编辑',
    'department-head': '部门主任',
    'supervising-leader': '分管领导',
  };
  return `${roleLabel[role]}·${user.displayName}`;
};

export function requiredRoleForReview(stage: ReviewStage): WorkflowRole | undefined {
  if (stage === 'editor') return 'editor';
  if (stage === 'department-head' || stage === 'countersign') return 'department-head';
  if (stage === 'supervising-leader') return 'supervising-leader';
  return undefined;
}
