// Shared contracts for AuditGate (薄荷监理台).
// Every module and the console UI agree on these shapes.

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type FindingCategory =
  | 'injection'
  | 'pii'
  | 'secret'
  | 'data-leak'
  | 'policy-bypass'
  | 'config'
  // guardrail-only categories (not emitted by detectors)
  | 'deny-term'
  | 'sensitive-topic';

export interface Finding {
  id: string;
  ts: number;
  severity: Severity;
  category: FindingCategory;
  title: string;
  detail: string;
  /** matched snippet (already truncated for display) */
  evidence?: string;
  /** id of the AuditEvent this finding was raised on */
  eventId?: string;
}

export interface AuditEvent {
  id: string;
  /** Correlates the request and response sides of one model invocation. */
  callId?: string;
  ts: number;
  direction: 'request' | 'response';
  /** target label / base_url the traffic belongs to */
  target: string;
  model: string;
  latencyMs?: number;
  tokens?: { in: number; out: number };
  /** one-line summary for the stream row */
  summary: string;
  /** Sanitized by default; full text is allowed only for controlled fake-data scenarios. */
  body: string;
  findings: Finding[];
}

export type ProbeCategory =
  | 'orientation'
  | 'factuality'
  | 'labeling'
  | 'traceability'
  | 'copyright'
  // Legacy scenario packs remain loadable while the four old pages are retained.
  | 'prompt-exfil'
  | 'data-exfil'
  | 'pii-dump'
  | 'jailbreak'
  | 'role-override'
  | 'hallucination';

export interface Probe {
  /** stable id, e.g. RT-01 */
  id: string;
  category: ProbeCategory;
  title: string;
  /** what this probe tests, one line */
  rationale: string;
  /** the adversarial user input sent to the target */
  message: string;
  /**
   * Returns true when the vulnerability is CONFIRMED — i.e. the target did the
   * bad thing (leaked data, obeyed the injection, broke policy). `passed=true`
   * for a probe means the target FAILED that check.
   */
  success: (targetReply: string, findings: Finding[]) => boolean;
}

export interface ProbeResult {
  probe: Pick<Probe, 'id' | 'category' | 'title' | 'rationale'>;
  reply: string;
  /** true = probe succeeded = vulnerability found (bad for the target) */
  passed: boolean;
  findings: Finding[];
  latencyMs: number;
}

export type DimensionKey =
  | 'orientation'
  | 'factuality'
  | 'labeling'
  | 'traceability'
  | 'copyright';

export interface DimensionScore {
  key: DimensionKey;
  label: string;
  score: number; // 0..100
  note: string;
}

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface Scorecard {
  target: string;
  ts: number;
  overall: number; // 0..100
  grade: Grade;
  dimensions: DimensionScore[];
  probeResults: ProbeResult[];
  findingCounts: Record<Severity, number>;
}

// ——— Runtime governance (post-deploy assurance) ———

/** What an enterprise guardrail does when it fires. */
export type GuardrailAction = 'block' | 'redact' | 'flag';

export interface GuardrailEvent {
  id: string;
  ts: number;
  /** which end user's traffic triggered it */
  user: string;
  /** display name of the guardrail, e.g. 个人信息防护 */
  guardrail: string;
  category: FindingCategory;
  severity: Severity;
  action: GuardrailAction;
  evidence?: string;
}

/** Per-user rollup for "谁用了多少 token". */
export interface UserUsage {
  user: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  guardrailHits: number;
  lastActive: number;
}

export interface UsageSnapshot {
  users: UserUsage[]; // sorted by total tokens desc
  totals: {
    users: number;
    requests: number;
    tokensIn: number;
    tokensOut: number;
    guardrailHits: number;
  };
  guardrailEvents: GuardrailEvent[]; // newest first
}

// ——— Per-enterprise 安全护栏 policy (configurable) ———

/** Built-in guardrail categories that a policy can toggle + retune. */
export type GuardrailCategoryKey = 'secret' | 'pii' | 'data-leak' | 'injection' | 'policy-bypass';

export interface CategoryRule {
  enabled: boolean;
  action: GuardrailAction;
}

export interface GuardrailPolicy {
  /** enterprise display name */
  enterprise: string;
  /** built-in guardrails: on/off + action per category */
  rules: Record<GuardrailCategoryKey, CategoryRule>;
  /** 拦截清单: custom terms that trip a guardrail when they appear */
  denyTerms: string[];
  denyAction: GuardrailAction;
  /** 敏感话题: topic keywords that trip a guardrail */
  sensitiveTopics: string[];
  topicAction: GuardrailAction;
  /** 放行清单: users exempt from block/redact (downgraded to flag, still logged) */
  allowUsers: string[];
}

/** SSE event envelope names pushed to the console over GET /events */
export type StreamEventName =
  | 'audit'
  | 'finding'
  | 'probe'
  | 'score'
  | 'status'
  | 'guardrail'
  | 'usage'
  // Broadcast workflow events. Kept in the same SSE channel so the current
  // console and the new manuscript workbench can coexist during the pivot.
  | 'manuscript'
  | 'workflow'
  | 'trace';

export interface StatusEvent {
  state: 'idle' | 'monitoring' | 'redteam' | 'done';
  message: string;
}
