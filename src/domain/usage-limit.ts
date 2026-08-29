/**
 * 使用限制 —— 每个账号每天能调多少次、烧多少 token。
 *
 * ————————————————————————————————————————————————————————————————
 * **这一层和入口准入是两件事，任何一个字段都不许共用。**
 *
 * | | 入口准入 | 使用限制 |
 * | --- | --- | --- |
 * | 判什么 | 这次调用**该不该发生**（内容） | 这个账号**今天还能不能调**（资源） |
 * | 判据 | 稿件内容与词表 | 累计次数 / token |
 * | 结论 | `AdmissionDecision` + `AdmissionReasonCode` | `UsageQuotaVerdict`，**不复用上面任何一个** |
 * | 稿件状态 | 进 admission-blocked / reason-required | **一步不动** |
 * | HTTP | 201 + admission 体 | 429 `usage_quota_exceeded` |
 * | 留痕 | `rule-hit`，actor「入口准入」 | `quota-blocked`，actor「使用限制」 |
 * | 怎么解除 | 填选题依据即放行 | **填理由不能放行**——只能台领导改上限或等次日重置 |
 *
 * 混在一起的后果很具体：留痕里会长出「因为超限所以被判违规」这种假因果，
 * 而「说得清」正是这个产品的立身之本。所以文案上也要划干净——编辑看到 429 的
 * 第一反应一定是「我写的东西有问题？」，得在同一屏把这个误解掐掉。
 */

/** 全台统一的上限。两个字段都可空，空即不限；默认两个都空，开箱行为不变。 */
export interface UsageLimits {
  /** 单账号每日调用次数上限。 */
  dailyCalls?: number;
  /** 单账号每日 token 上限（输入 + 输出）。 */
  dailyTokens?: number;
  updatedAt: number;
  /** 上一次改上限的人，显示名快照。 */
  updatedBy?: string;
}

export interface UpdateUsageLimitsInput {
  /** null 表示显式取消该项限制；undefined 表示不动它。 */
  dailyCalls?: number | null;
  dailyTokens?: number | null;
}

/** 某个账号某一天的用量。落库，所以进程重启不清零。 */
export interface UsageCounter {
  day: string;
  userId: string;
  displayName?: string;
  username?: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  updatedAt: number;
}

export const quotaKinds = ['calls', 'tokens'] as const;
export type QuotaKind = (typeof quotaKinds)[number];

export const quotaKindLabels: Readonly<Record<QuotaKind, string>> = {
  calls: '调用次数',
  tokens: 'token 用量',
};

/**
 * 一次配额判定。
 *
 * 刻意不叫 decision，也刻意不复用 `AdmissionDecision` 的任何取值——
 * 两套结论一旦长得像，迟早有人把它们并到一个字段里。
 */
export interface UsageQuotaVerdict {
  allowed: boolean;
  /** 被哪一项挡住的。allowed 时不存在。 */
  kind?: QuotaKind;
  used: number;
  /** 当时的上限。allowed 且该项不限时不存在。 */
  limit?: number;
  day: string;
}

/** 一次超限。只 INSERT。 */
export interface UsageLimitEvent {
  id: string;
  userId?: string;
  actor: string;
  manuscriptId?: string;
  kind: QuotaKind;
  used: number;
  limit: number;
  day: string;
  createdAt: number;
}

/**
 * 给编辑看的那句话。
 *
 * 第二句是刻意的：**这不是内容判定**。不写这一句，编辑会以为自己写的东西有问题，
 * 然后去改一篇本来没问题的稿子。
 */
export function quotaMessage(verdict: UsageQuotaVerdict): string {
  const what = verdict.kind === 'tokens' ? 'token 额度' : '调用次数';
  return (
    `今日${what}已用完（${verdict.used} / ${verdict.limit}）。` +
    '这不是内容判定——这篇稿子本身没有问题，稿件状态也没有变。' +
    '请联系台领导调整额度，或明天再试。'
  );
}
