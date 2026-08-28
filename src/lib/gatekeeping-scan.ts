// Gateway-side 广电 gatekeeping.
//
// 入口准入 runs on the way IN — and its 硬拦 档 is enforced AT the gateway: a
// blocked call never reaches the model. That is what makes 「绕不过网关就绕不过
// 准入」 true for every model call routed through throughGateway().
//
// A source-independent slice of 输出预检 runs on the way OUT for 留痕 (禁用词 /
// 慎用词 / 领导表述 / AI 标识). The full preflight — including the 与原通稿一致性
// 比对 that needs the 原通稿 — stays in the manuscript workbench (src/rules/
// runPreflight), which has that context. Here we reuse the same rule DATA.
//
// These findings use category `sensitive-topic`, which `evaluateGuardrails`'
// policyKey() does not map to a policy rule, so they are pure 留痕 and never
// perturb the legacy AuditGate guardrail counts. Enforcement is the short-circuit
// in throughGateway, not the guardrail layer.
import { runAdmission } from '../rules/index.js';
import { AI_LABEL_MARKERS, PATTERN_RULES, TERM_RULES } from '../rules/terms.js';
import type { Finding, FindingCategory, Severity } from '../types.js';

let seq = 0;
function finding(
  severity: Severity,
  category: FindingCategory,
  title: string,
  detail: string,
  evidence?: string,
): Finding {
  seq += 1;
  return {
    id: `gk_${Date.now().toString(36)}_${seq.toString(36)}`,
    ts: Date.now(),
    severity,
    category,
    title,
    detail,
    ...(evidence ? { evidence } : {}),
  };
}

export interface AdmissionScan {
  /** 硬拦: the model must NOT be called. */
  blocked: boolean;
  /** what to return to the caller when blocked. */
  message: string;
  decision: string;
  findings: Finding[];
}

/** 入口准入 for one model call. Judges 该不该发生这次调用. */
export function admissionScan(userText: string): AdmissionScan {
  const a = runAdmission({ title: '', sourceText: userText });
  const findings: Finding[] = [];
  const evidence = a.hits.map((h) => h.evidence).join('、') || undefined;

  if (a.decision === 'blocked') {
    findings.push(finding('critical', 'sensitive-topic', '入口准入·硬拦：不予受理', a.message, evidence));
  } else if (a.decision === 'reason-required') {
    findings.push(finding('high', 'sensitive-topic', '入口准入·需选题依据', a.message, evidence));
  }
  if (a.offDutyUse) {
    findings.push(finding('medium', 'sensitive-topic', '入口准入·公器私用（只标不拦）', a.message));
  }

  return { blocked: a.decision === 'blocked', message: a.message, decision: a.decision, findings };
}

const splitSentences = (text: string): string[] =>
  text
    .split(/(?<=[。！？!?\n])/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Source-independent 输出预检 for 留痕: 禁用/慎用词、一校模式、AI 标识。 */
export function preflightScan(text: string): Finding[] {
  const out: Finding[] = [];
  const sentences = splitSentences(text);

  for (const sentence of sentences) {
    for (const rule of TERM_RULES) {
      if (sentence.includes(rule.term)) {
        const sev: Severity = rule.action === 'block' ? 'high' : 'low';
        out.push(finding(sev, 'sensitive-topic', rule.title, rule.detail, rule.term));
      }
    }
    for (const rule of PATTERN_RULES) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(sentence)) {
        out.push(finding('low', 'sensitive-topic', rule.title, rule.detail));
      }
      rule.pattern.lastIndex = 0;
    }
  }

  const whole = sentences.join('');
  if (whole && !AI_LABEL_MARKERS.some((marker) => whole.includes(marker))) {
    out.push(
      finding(
        'medium',
        'sensitive-topic',
        '缺少 AI 生成内容标识',
        '《人工智能生成合成内容标识办法》要求显式标识，发布前需补上。',
      ),
    );
  }

  return out;
}
