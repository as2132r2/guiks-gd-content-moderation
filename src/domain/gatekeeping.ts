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
import {
  admissionReasonCodes,
  type AdmissionDecision,
  type AdmissionReasonCode,
  type ProofreadPass,
  type SentenceOrigin,
} from './contracts.js';

/** Why the entry gate reached its verdict. Drives the copy the editor sees. */
export { admissionReasonCodes };
export type { AdmissionReasonCode };

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
  // 一校：错别字、语病、标点、格式（plan §七 把这一档归为「L1 全自动」）
  'typo',
  'punctuation',
  'format',
  // 二校 / 复审：词表与事实
  'banned-term',
  'caution-term',
  'leader-title',
  'inconsistency',
  // 标识与判断
  'ai-label',
  'judgment',
] as const;
export type AnnotationCategory = (typeof annotationCategories)[number];

export const annotationCategoryLabels: Readonly<Record<AnnotationCategory, string>> = {
  typo: '错别字与用词',
  punctuation: '标点差错',
  format: '格式规范',
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
  /** 这条标注由哪一校负责处理。校次不是状态。 */
  proofreadPass: ProofreadPass;
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
