/**
 * 判定依据（词表）的管理契约 —— 界面、REST 与持久层之间的那道缝。
 *
 * 与 [gatekeeping.ts](gatekeeping.ts) 的分工：那边是**判定结果**的形状，这边是
 * **判定依据本身**的形状。规则引擎在 `src/rules/`，管理界面在
 * `src/views/rules-view.ts`，两边只通过这里的类型交换数据。
 *
 * 这个文件不认识 HTTP、数据库和供应商，和它旁边的 contracts.ts 一样。
 *
 * ————————————————————————————————————————————————————————————————
 * **为什么词表可管理之后必须自己也被追溯。**
 *
 * 词表是判定依据。依据一旦可变，光在留痕里记 `ruleId` 就不够了——三个月后回看，
 * 那条规则可能已经被改过档位、改过词面，「这一篇当时是按什么判的」就答不上来。
 * 所以词表整体带一个单调递增的 `rulesetVersion`，任何一次写操作 +1，准入与预检
 * 的留痕都带上它；第 N 版是什么，由 `RuleChangeEntry` 的改动日志逐条重建。
 */
import type { AnnotationCategory, PreflightAction } from './gatekeeping.js';

/** 词条作用在哪一层。入口准入判「该不该调用」，输出预检判「产出有没有问题」。 */
export const ruleScopes = ['admission', 'preflight'] as const;
export type RuleScope = (typeof ruleScopes)[number];

/**
 * 入口准入的三档。
 *
 * `block` 硬拦（模型完全不碰）、`reason` 要理由（填选题依据后放行留痕）、
 * `off-duty` 公器私用（只标不拦）。
 */
export const admissionBuckets = ['block', 'reason', 'off-duty'] as const;
export type AdmissionBucket = (typeof admissionBuckets)[number];

export const admissionBucketLabels: Readonly<Record<AdmissionBucket, string>> = {
  block: '硬拦',
  reason: '要理由',
  'off-duty': '公器私用',
};

/** 词条是内置基线还是本台自己加的。基线删不掉、词面改不了，只能停用或改档位。 */
export const ruleOrigins = ['builtin', 'custom'] as const;
export type RuleOrigin = (typeof ruleOrigins)[number];

/**
 * 库里的一条词条。
 *
 * `admissionBucket` 与 `category`/`action` 二选一，由 `scope` 决定哪一组有效——
 * 扁平而不是联合类型，是为了让它和 SQLite 的一行一一对应，少一层来回映射。
 */
export interface ManagedRule {
  ruleId: string;
  scope: RuleScope;
  term: string;
  /** 出处。**必填**，没有出处的判定依据不该存在。 */
  source: string;
  origin: RuleOrigin;
  enabled: boolean;
  /** scope='admission' 时有效。 */
  admissionBucket?: AdmissionBucket;
  /** scope='preflight' 时有效。 */
  category?: AnnotationCategory;
  action?: PreflightAction;
  title?: string;
  detail?: string;
  suggestion?: string;
  createdAt: number;
  updatedAt: number;
}

export const ruleChangeActions = ['created', 'updated', 'enabled', 'disabled', 'deleted'] as const;
export type RuleChangeAction = (typeof ruleChangeActions)[number];

export const ruleChangeActionLabels: Readonly<Record<RuleChangeAction, string>> = {
  created: '新增',
  updated: '修改',
  enabled: '启用',
  disabled: '停用',
  deleted: '删除',
};

/**
 * 一次改动的留痕。**只 INSERT，永不 UPDATE 也不 DELETE。**
 *
 * `actor` 是显示名快照而不只是外键：账号被删之后，「这条禁用词是谁加的」还得
 * 答得上来。同一个理由让 review_records 也存了 actor 快照。
 */
export interface RuleChangeEntry {
  id: string;
  /** 这次改动之后的词表版本号。 */
  rulesetVersion: number;
  ruleId: string;
  action: RuleChangeAction;
  before?: ManagedRule;
  after?: ManagedRule;
  /** 改动理由。**必填**——不拦你改，但你得说得清为什么改。 */
  reason: string;
  /** 往硬拦档加词时对题材词警示的确认原文，没有警示则不存在。 */
  acknowledgedWarning?: string;
  actorUserId?: string;
  actor: string;
  createdAt: number;
}

/** 某一版词表的全量快照。引擎按它判定，界面按它渲染。 */
export interface RulesetSnapshot {
  version: number;
  rules: ManagedRule[];
}

export interface CreateRuleInput {
  scope: RuleScope;
  term: string;
  source: string;
  admissionBucket?: AdmissionBucket;
  category?: AnnotationCategory;
  action?: PreflightAction;
  title?: string;
  detail?: string;
  suggestion?: string;
}

/** 可改的字段。`term` 与 `source` 对基线条目不开放。 */
export interface UpdateRuleInput {
  term?: string;
  source?: string;
  admissionBucket?: AdmissionBucket;
  category?: AnnotationCategory;
  action?: PreflightAction;
  title?: string;
  detail?: string;
  suggestion?: string;
  enabled?: boolean;
}

/**
 * 往硬拦档加词时的自检结论。
 *
 * **不是禁止——是让人知道自己在做什么。** 台领导有权把一个词提到硬拦，但
 * 这一步得留下他知情的证据（`RuleChangeEntry.acknowledgedWarning`）。
 */
export interface BlockBucketWarning {
  code: 'topic-word' | 'already-reason-lane';
  message: string;
}
