/**
 * 入口准入 与 输出预检 的结果契约 —— the seam between the production line and
 * the rule engine.
 *
 * The workbench renders these shapes; `src/rules/` produces them. Whoever
 * rewrites the detectors replaces the function bodies behind
 * `src/rules/index.ts` and the界面 does not change a line.
 *
 * Keep this file free of HTTP, database and provider concepts, exactly like
 * contracts.ts next to it.
 */
import type { AdmissionDecision, SentenceOrigin } from './contracts.js';

/** Why the entry gate reached its verdict. Drives the copy the editor sees. */
export const admissionReasonCodes = [
  /** 明确违法且与新闻业务无关 → 硬拦，模型完全不碰 */
  'illegal-unrelated',
  /** 涉敏感题材但可能是正当报道 → 要理由 */
  'sensitive-topic',
  /** 公器私用：不违法，但不是业务用途 → 只标不拦 */
  'off-duty-use',
  /** 正常业务 → 仅留痕 */
  'routine',
] as const;
export type AdmissionReasonCode = (typeof admissionReasonCodes)[number];

export interface RuleHit {
  /** Stable rule id so a hit can be traced back to the word list entry. */
  ruleId: string;
  /** The matched fragment, already trimmed for display. */
  evidence: string;
}

export interface AdmissionResult {
  decision: AdmissionDecision;
  reasonCode: AdmissionReasonCode;
  /** One line shown to the editor. Never the word 「安全」, never 「敏感词过滤」. */
  message: string;
  hits: RuleHit[];
  /**
   * 公器私用 is flagged alongside any decision: it is a discipline signal for
   * the 台领导 report, not a gate. 只标不拦.
   */
  offDutyUse?: boolean;
}

/** 三档动作，语义是审片动作: 拦下不让播 / 标红待复核 / 放行留痕. */
export const preflightActions = ['block', 'redact', 'flag'] as const;
export type PreflightAction = (typeof preflightActions)[number];

export const annotationCategories = [
  'banned-term',
  'caution-term',
  'leader-title',
  'inconsistency',
  'ai-label',
  'judgment',
] as const;
export type AnnotationCategory = (typeof annotationCategories)[number];

export const annotationCategoryLabels: Readonly<Record<AnnotationCategory, string>> = {
  'banned-term': '禁用词',
  'caution-term': '慎用词',
  'leader-title': '领导表述规范',
  inconsistency: '与原通稿不一致',
  'ai-label': 'AI 生成内容标识',
  judgment: '导向与事实判断',
};

/**
 * One preflight finding.
 *
 * Anchored on `segmentOrdinal` rather than a whole-document offset so an
 * annotation and a sentence's provenance share one coordinate system: the same
 * span carries both its AI 来源色 and its 标注下划线.
 */
export interface Annotation {
  id: string;
  artifactId: string;
  segmentOrdinal: number;
  /** Character range inside that sentence. */
  start: number;
  end: number;
  action: PreflightAction;
  category: AnnotationCategory;
  title: string;
  detail: string;
  /** What to change it to, when the rule can say. */
  suggestion?: string;
  /**
   * L1 是确定性规则，可复现；L2 是模型判断。
   * L2 一律输出「待人工复核」，不给自动终审结论 (方案 §六).
   */
  tier: 'L1' | 'L2';
}

export interface PreflightSummary {
  block: number;
  redact: number;
  flag: number;
}

export interface PreflightResult {
  artifactId: string;
  annotations: Annotation[];
  summary: PreflightSummary;
}

export function summarize(annotations: readonly Annotation[]): PreflightSummary {
  const summary: PreflightSummary = { block: 0, redact: 0, flag: 0 };
  for (const annotation of annotations) summary[annotation.action] += 1;
  return summary;
}

/** Display metadata for sentence provenance. Shared by the workbench and 追溯图谱. */
export const sentenceOriginLabels: Readonly<Record<SentenceOrigin, string>> = {
  ai: 'AI 生成',
  'ai-edited': 'AI 生成·人改过',
  human: '人新写',
  source: '原文引用',
};
