// Per-enterprise 安全护栏 (guardrail) policy: which built-in guardrails are on
// and what they do, plus a deny list, sensitive topics, and an allow list.
// Persisted best-effort to policy.json so a saved policy survives restarts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CategoryRule,
  GuardrailAction,
  GuardrailCategoryKey,
  GuardrailPolicy,
} from '../types.js';
import { getScenario } from './scenarios.js';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'policy.json');
const ACTIONS: GuardrailAction[] = ['block', 'redact', 'flag'];
const CATS: GuardrailCategoryKey[] = ['secret', 'pii', 'data-leak', 'injection', 'policy-bypass'];

export function defaultPolicy(): GuardrailPolicy {
  return {
    enterprise: '默认企业',
    rules: {
      secret: { enabled: true, action: 'block' },
      pii: { enabled: true, action: 'redact' },
      'data-leak': { enabled: true, action: 'redact' },
      injection: { enabled: true, action: 'flag' },
      'policy-bypass': { enabled: true, action: 'flag' },
    },
    denyTerms: [],
    denyAction: 'block',
    sensitiveTopics: [],
    topicAction: 'flag',
    allowUsers: [],
  };
}

const PRESETS: Record<string, () => GuardrailPolicy> = {
  '默认（均衡）': () => defaultPolicy(),
  '金融合规（严格）': () => ({
    enterprise: '某银行',
    rules: {
      secret: { enabled: true, action: 'block' },
      pii: { enabled: true, action: 'block' },
      'data-leak': { enabled: true, action: 'block' },
      injection: { enabled: true, action: 'block' },
      'policy-bypass': { enabled: true, action: 'redact' },
    },
    denyTerms: ['银行卡', '开户行', '对公账户'],
    denyAction: 'block',
    sensitiveTopics: ['内幕', '操纵市场', '洗钱'],
    topicAction: 'block',
    allowUsers: [],
  }),
  '内测（宽松）': () => ({
    enterprise: '内部测试',
    rules: {
      secret: { enabled: true, action: 'block' },
      pii: { enabled: true, action: 'redact' },
      'data-leak': { enabled: false, action: 'flag' },
      injection: { enabled: true, action: 'flag' },
      'policy-bypass': { enabled: true, action: 'flag' },
    },
    denyTerms: [],
    denyAction: 'flag',
    sensitiveTopics: [],
    topicAction: 'flag',
    allowUsers: ['管理员', '安全团队'],
  }),
};

// The active scenario contributes its own industry preset (e.g. 白酒厂（严格）).
PRESETS[getScenario().policyPreset.name] = () => getScenario().policyPreset.policy;

const asAction = (v: unknown, fallback: GuardrailAction): GuardrailAction =>
  ACTIONS.includes(v as GuardrailAction) ? (v as GuardrailAction) : fallback;

const asTerms = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];

/** Coerce any (possibly partial / untrusted) input into a valid policy. */
export function normalize(input: Partial<GuardrailPolicy> | undefined): GuardrailPolicy {
  const base = defaultPolicy();
  const p = input ?? {};
  const rules = {} as Record<GuardrailCategoryKey, CategoryRule>;
  for (const key of CATS) {
    const r = p.rules?.[key];
    rules[key] = {
      enabled: typeof r?.enabled === 'boolean' ? r.enabled : base.rules[key].enabled,
      action: asAction(r?.action, base.rules[key].action),
    };
  }
  return {
    enterprise: (typeof p.enterprise === 'string' && p.enterprise.trim()) || base.enterprise,
    rules,
    denyTerms: asTerms(p.denyTerms),
    denyAction: asAction(p.denyAction, base.denyAction),
    sensitiveTopics: asTerms(p.sensitiveTopics),
    topicAction: asAction(p.topicAction, base.topicAction),
    allowUsers: asTerms(p.allowUsers),
  };
}

function load(): GuardrailPolicy {
  try {
    return normalize(JSON.parse(fs.readFileSync(FILE, 'utf8')));
  } catch {
    return defaultPolicy();
  }
}

let active: GuardrailPolicy = load();

export function getPolicy(): GuardrailPolicy {
  return active;
}

export function setPolicy(p: Partial<GuardrailPolicy>): GuardrailPolicy {
  active = normalize(p);
  try {
    fs.writeFileSync(FILE, JSON.stringify(active, null, 2));
  } catch {
    // in-memory is fine if the disk is read-only
  }
  return active;
}

export function resetPolicy(): GuardrailPolicy {
  active = defaultPolicy();
  try {
    if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
  } catch {
    // ignore
  }
  return active;
}

export function listPresets(): string[] {
  return Object.keys(PRESETS);
}

export function applyPreset(name: string): GuardrailPolicy | null {
  const make = PRESETS[name];
  if (!make) return null;
  return setPolicy(make());
}
