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

const DEMO_SESSION_SECRET = 'gatekeeper-demo-session-secret-change-me';

/**
 * Production secrets use an explicit, copy-safe encoding instead of accepting
 * arbitrary passphrases. Randomness cannot be proven after generation, but we
 * can reject malformed, undersized and obviously repeated/low-entropy values.
 */
export function isStrongRandomSecret(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith('base64:')) return false;
  const encoded = trimmed.slice('base64:'.length);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    return false;
  }
  try {
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length < 32 || bytes.toString('base64') !== encoded) return false;
    if (new Set(bytes).size < 16) return false;
    const printable = [...bytes].filter((byte) => byte >= 0x20 && byte <= 0x7e).length;
    if (printable / bytes.length > 0.85) return false;
    const deltas = [...bytes.subarray(1)].map((byte, index) => (byte - bytes[index]! + 256) % 256);
    if (deltas.length > 0 && new Set(deltas).size === 1) return false;
    for (let patternLength = 1; patternLength <= Math.min(8, bytes.length / 2); patternLength += 1) {
      let repeated = true;
      for (let index = patternLength; index < bytes.length; index += 1) {
        if (bytes[index] !== bytes[index % patternLength]) {
          repeated = false;
          break;
        }
      }
      if (repeated) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export const sessionSecretReadyFor = (
  mode: 'demo' | 'production',
  secret: string,
): boolean =>
  mode !== 'production' ||
  (secret.trim() !== DEMO_SESSION_SECRET && isStrongRandomSecret(secret));

export const gatewayTokenReadyFor = (
  mode: 'demo' | 'production',
  token: string,
  sessionSecret: string,
): boolean =>
  mode !== 'production' ||
  (isStrongRandomSecret(token) && token !== sessionSecret);

export const demoLoginEnabledFor = (mode: 'demo' | 'production'): boolean => mode === 'demo';

const appMode = appModeEnv();
const configuredSessionSecret = process.env.SESSION_SECRET?.trim() ?? '';
const configuredGatewayToken = process.env.GATEWAY_TOKEN?.trim() ?? '';

export const config = {
  port: integerEnv('PORT', 3300, 1, 65535),
  appMode,

  /** Persistent workflow database. Use :memory: only in tests. */
  databasePath:
    process.env.DATABASE_PATH?.trim() || (process.env.NODE_ENV === 'test' ? ':memory:' : './data/app.db'),

  /** Demo mode may use the deterministic mock; production must opt in. */
  allowMockUpstream: booleanEnv('ALLOW_MOCK_UPSTREAM', appMode !== 'production'),
  failClosed: booleanEnv('FAIL_CLOSED', true),

  /** Signed-cookie integrity. Production refuses short or missing secrets. */
  sessionSecret:
    configuredSessionSecret ||
    (appMode === 'demo' ? DEMO_SESSION_SECRET : ''),
  sessionSecretReady: sessionSecretReadyFor(appMode, configuredSessionSecret),
  sessionHours: 8,
  demoLoginEnabled: demoLoginEnabledFor(appMode),
  seedDemoUsers:
    appMode !== 'production' && booleanEnv('SEED_DEMO_USERS', appMode === 'demo'),
  demoSeedPassword: process.env.DEMO_SEED_PASSWORD?.trim() || 'gatekeeper-demo',

  /** Default target label shown in the console's "接管目标" field. */
  targetLabel: process.env.TARGET_LABEL ?? getScenario().label,

  /**
   * Upstream model behind the gateway (used in `toy` target mode). Empty = use
   * the built-in deterministic mock upstream (no key needed, reliable on stage).
   * Set to a real OpenAI-compatible Chat Completions base URL to proxy a model.
   * Anthropic Messages/SSE needs its own adapter and is not implemented here.
   */
  upstreamUrl: process.env.UPSTREAM_URL ?? '',
  upstreamKey: process.env.UPSTREAM_KEY ?? '',
  upstreamModel: process.env.UPSTREAM_MODEL ?? 'GLM-5.2',
  upstreamTimeoutMs: integerEnv('UPSTREAM_TIMEOUT_MS', 30_000, 1_000, 300_000),
  /** Optional only for a mock demo; required by the HTTP gateway with a real upstream. */
  gatewayToken: configuredGatewayToken,
  gatewayTokenReady: gatewayTokenReadyFor(
    appMode,
    configuredGatewayToken,
    configuredSessionSecret,
  ),

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

/**
 * Demo mock traffic may stay open on localhost. Any real upstream can spend
 * provider quota, so its public HTTP gateway must have a token even in demo.
 */
export const requiresGatewayToken = () =>
  config.appMode === 'production' || !usingMockUpstream();
