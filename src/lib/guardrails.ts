// Enterprise runtime 安全护栏 (guardrails). Detectors observe; guardrails ACT,
// driven by the active per-enterprise policy. Given the findings + text of an
// exchange, decide what the end user actually sees and record who tripped what.
import type {
  Finding,
  FindingCategory,
  GuardrailAction,
  GuardrailCategoryKey,
  GuardrailEvent,
  GuardrailPolicy,
} from '../types.js';
import { PLANTED } from './planted.js';
import { getPolicy } from './policy.js';

const NAME: Record<FindingCategory, string> = {
  secret: '密钥外泄防护',
  pii: '个人信息防护',
  'data-leak': '机密数据防护',
  injection: '提示注入拦截',
  'policy-bypass': '越权/设定读取',
  config: '越权/设定读取',
  'deny-term': '自定义拦截词',
  'sensitive-topic': '敏感话题',
};

const STRICTNESS: Record<GuardrailAction, number> = { flag: 1, redact: 2, block: 3 };

/** Detector categories map onto the five configurable policy keys. */
function policyKey(cat: FindingCategory): GuardrailCategoryKey | null {
  switch (cat) {
    case 'secret':
    case 'pii':
    case 'data-leak':
    case 'injection':
    case 'policy-bypass':
      return cat;
    case 'config':
      return 'policy-bypass';
    default:
      return null;
  }
}

let gseq = 0;
function event(
  user: string,
  category: FindingCategory,
  severity: Finding['severity'],
  action: GuardrailAction,
  evidence?: string,
): GuardrailEvent {
  gseq += 1;
  return {
    id: `g_${Date.now().toString(36)}_${gseq.toString(36)}`,
    ts: Date.now(),
    user,
    guardrail: NAME[category],
    category,
    severity,
    action,
    ...(evidence ? { evidence } : {}),
  };
}

export interface GuardrailVerdict {
  action: GuardrailAction | 'none';
  events: GuardrailEvent[];
  /** custom deny / topic terms that matched — also masked on redact */
  matchedTerms: string[];
}

/** Decide the guardrail response for one exchange, under the active policy. */
export function evaluateGuardrails(
  findings: Finding[],
  user: string,
  ctx: { message: string; reply: string } = { message: '', reply: '' },
  policy: GuardrailPolicy = getPolicy(),
): GuardrailVerdict {
  const events: GuardrailEvent[] = [];
  const matchedTerms: string[] = [];

  // 1) built-in detector findings, gated + retuned by policy
  for (const f of findings) {
    const key = policyKey(f.category);
    if (!key) continue;
    const rule = policy.rules[key];
    if (!rule?.enabled) continue;
    events.push(event(user, f.category, f.severity, rule.action, f.evidence));
  }

  // 2) custom deny list + sensitive topics scanned across message + reply
  const hay = `${ctx.message}\n${ctx.reply}`;
  const scan = (terms: string[], category: FindingCategory, action: GuardrailAction) => {
    const seen = new Set<string>();
    for (const term of terms) {
      if (!term || seen.has(term) || !hay.includes(term)) continue;
      seen.add(term);
      matchedTerms.push(term);
      events.push(event(user, category, category === 'deny-term' ? 'high' : 'medium', action, term));
    }
  };
  scan(policy.denyTerms, 'deny-term', policy.denyAction);
  scan(policy.sensitiveTopics, 'sensitive-topic', policy.topicAction);

  // 3) allow list: exempt users are downgraded to flag (still logged)
  const exempt = policy.allowUsers.includes(user);
  if (exempt) for (const e of events) e.action = 'flag';

  let action: GuardrailAction | 'none' = 'none';
  for (const e of events) {
    if (action === 'none' || STRICTNESS[e.action] > STRICTNESS[action]) action = e.action;
  }
  return { action, events, matchedTerms };
}

const PHONE = /(?<!\d)1[3-9]\d{9}(?!\d)/g;
const IDCARD = /(?<!\d)\d{17}[\dXx](?!\d)/g;
const BANKCARD = /(?<!\d)(?:\d{16}|\d{17}|\d{19})(?!\d)/g;

/** Mask sensitive spans (planted secrets/PII + any extra terms) in a reply. */
export function redactText(text: string, extraTerms: string[] = []): string {
  let out = text;
  for (const s of [PLANTED.apiKey, PLANTED.internalPolicy, PLANTED.systemMarker, ...extraTerms]) {
    if (s) out = out.split(s).join('【已打码】');
  }
  out = out
    .replace(IDCARD, (m) => `${m.slice(0, 4)}********${m.slice(-2)}`)
    .replace(BANKCARD, (m) => `${m.slice(0, 6)}****${m.slice(-4)}`)
    .replace(PHONE, (m) => `${m.slice(0, 3)}****${m.slice(-2)}`);
  return out;
}

/** Apply the verdict to the reply the user receives. */
export function applyGuardrail(reply: string, verdict: GuardrailVerdict): string {
  if (verdict.action === 'block') {
    return '【已被企业安全护栏拦截：本次响应命中敏感策略（如密钥 / 机密 / 拦截词），已对用户屏蔽。如需该信息请走正规审批流程。】';
  }
  if (verdict.action === 'redact') {
    return redactText(reply, verdict.matchedTerms);
  }
  return reply;
}
