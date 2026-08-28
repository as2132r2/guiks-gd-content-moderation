// Runtime config. Everything has a demo-safe default so the app runs with zero
// setup and needs no API key. Point at a real product/upstream only when you
// deliberately set the env vars.
import { getScenario } from './lib/scenarios.js';

function integerEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new Error(`${name} must be true or false`);
}

function appModeEnv(): 'demo' | 'production' {
  const value = process.env.APP_MODE?.trim() || 'demo';
  if (value === 'demo' || value === 'production') return value;
  throw new Error('APP_MODE must be demo or production');
}

const appMode = appModeEnv();

export const config = {
  port: integerEnv('PORT', 3300, 1, 65535),
  appMode,

  /** Persistent workflow database. Use :memory: only in tests. */
  databasePath:
    process.env.DATABASE_PATH?.trim() || (process.env.NODE_ENV === 'test' ? ':memory:' : './data/app.db'),

  /** Demo mode may use the deterministic mock; production must opt in. */
  allowMockUpstream: booleanEnv('ALLOW_MOCK_UPSTREAM', appMode !== 'production'),
  failClosed: booleanEnv('FAIL_CLOSED', true),

  /** Default target label shown in the console's "接管目标" field. */
  targetLabel: process.env.TARGET_LABEL ?? getScenario().label,

  /**
   * Upstream model behind the gateway (used in `toy` target mode). Empty = use
   * the built-in deterministic mock upstream (no key needed, reliable on stage).
   * Set to a real OpenAI-compatible base URL to proxy a real model.
   */
  upstreamUrl: process.env.UPSTREAM_URL ?? '',
  upstreamKey: process.env.UPSTREAM_KEY ?? '',
  upstreamModel: process.env.UPSTREAM_MODEL ?? 'GLM-5.2',
  upstreamTimeoutMs: integerEnv('UPSTREAM_TIMEOUT_MS', 30_000, 1_000, 300_000),
  /** Optional in demo, mandatory for the public HTTP gateway in production. */
  gatewayToken: process.env.GATEWAY_TOKEN?.trim() ?? '',

  /**
   * What we point the red team at.
   *   'toy'  — the built-in controlled vulnerable target (default, no setup).
   *   'http' — a REAL external product. We call its chat endpoint over HTTP and
   *            audit the replies. This is how we test 别人的产品.
   */
  targetMode: (process.env.TARGET_MODE ?? 'toy') as 'toy' | 'http',
  /** External target endpoint (TARGET_MODE=http). */
  targetUrl: process.env.TARGET_URL ?? '',
  targetKey: process.env.TARGET_KEY ?? '',
  /** 'openai' = POST {model,messages}; 'simple' = POST {message} → {reply}. */
  targetFormat: (process.env.TARGET_FORMAT ?? 'openai') as 'openai' | 'simple',
  targetModel: process.env.TARGET_MODEL ?? 'gpt-4o-mini',

  /** Cap how much traffic we keep in memory for the demo. */
  maxAudits: integerEnv('MAX_AUDITS', 500, 50, 10_000),
} as const;

export const usingMockUpstream = () => config.upstreamUrl.trim() === '';
