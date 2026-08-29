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

function upstreamThinkingEnv(): 'provider-default' | 'enabled' | 'disabled' {
  const value = process.env.UPSTREAM_THINKING?.trim().toLowerCase() || 'provider-default';
  if (value === 'provider-default' || value === 'enabled' || value === 'disabled') return value;
  throw new Error('UPSTREAM_THINKING must be provider-default, enabled or disabled');
}

export type UpstreamThinking = 'provider-default' | 'enabled' | 'disabled';

export interface UpstreamProfile {
  /** Exact model identifier sent to the provider. */
  model: string;
  /** Human-facing name; safe to expose to the workbench. */
  label: string;
  /** Human-facing provider name; safe to expose to the workbench. */
  provider: string;
  /** OpenAI-compatible base URL. Empty is reserved for the legacy demo mock. */
  url: string;
  /** Provider credential. Never return this object from an HTTP route. */
  key: string;
  thinking: UpstreamThinking;
  timeoutMs: number;
}

const modelProvider = (model: string): string => {
  const normalized = model.toLowerCase();
  if (normalized.startsWith('glm-')) return '智谱 GLM';
  if (normalized.startsWith('deepseek-')) return 'DeepSeek';
  return 'OpenAI 兼容模型';
};

/**
 * Parse multi-model configuration without ever including the raw value in an
 * error. UPSTREAM_PROFILES_JSON commonly contains credentials, so startup
 * diagnostics must only identify the failing field/index.
 */
export function parseUpstreamProfiles(raw: string | undefined): UpstreamProfile[] {
  if (!raw?.trim()) return [];

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error('UPSTREAM_PROFILES_JSON must be valid JSON');
  }
  if (!Array.isArray(decoded) || decoded.length === 0) {
    throw new Error('UPSTREAM_PROFILES_JSON must be a non-empty array');
  }

  const seen = new Set<string>();
  return decoded.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error(`UPSTREAM_PROFILES_JSON[${index}] must be an object`);
    }
    const item = candidate as Record<string, unknown>;
    const model = typeof item.model === 'string' ? item.model.trim() : '';
    const url = typeof item.url === 'string' ? item.url.trim().replace(/\/$/, '') : '';
    const key = typeof item.key === 'string' ? item.key.trim() : '';
    const label = typeof item.label === 'string' && item.label.trim() ? item.label.trim() : model;
    const provider =
      typeof item.provider === 'string' && item.provider.trim()
        ? item.provider.trim()
        : modelProvider(model);
    const thinking =
      typeof item.thinking === 'string' ? item.thinking.trim().toLowerCase() : 'provider-default';
    const timeoutMs = item.timeoutMs === undefined ? 30_000 : Number(item.timeoutMs);

    if (!model || model.length > 100) {
      throw new Error(`UPSTREAM_PROFILES_JSON[${index}].model must be 1-100 characters`);
    }
    if (seen.has(model)) {
      throw new Error(`UPSTREAM_PROFILES_JSON contains duplicate model: ${model}`);
    }
    seen.add(model);
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') throw new Error();
    } catch {
      throw new Error(`UPSTREAM_PROFILES_JSON[${index}].url must be an HTTP(S) URL`);
    }
    if (!['provider-default', 'enabled', 'disabled'].includes(thinking)) {
      throw new Error(
        `UPSTREAM_PROFILES_JSON[${index}].thinking must be provider-default, enabled or disabled`,
      );
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) {
      throw new Error(
        `UPSTREAM_PROFILES_JSON[${index}].timeoutMs must be an integer between 1000 and 300000`,
      );
    }

    return {
      model,
      label,
      provider,
      url,
      key,
      thinking: thinking as UpstreamThinking,
      timeoutMs,
    };
  });
}

const upstreamProfiles = parseUpstreamProfiles(process.env.UPSTREAM_PROFILES_JSON);
const upstreamModel = process.env.UPSTREAM_MODEL?.trim() || upstreamProfiles[0]?.model || 'GLM-5.2';
if (upstreamProfiles.length > 0 && !upstreamProfiles.some((profile) => profile.model === upstreamModel)) {
  throw new Error('UPSTREAM_MODEL must match a model in UPSTREAM_PROFILES_JSON');
}

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
  upstreamModel,
  upstreamTimeoutMs: integerEnv('UPSTREAM_TIMEOUT_MS', 30_000, 1_000, 300_000),
  /** Optional OpenAI-compatible extension, used by providers such as DeepSeek V4. */
  upstreamThinking: upstreamThinkingEnv(),
  /** Optional multi-provider profiles; credentials remain server-side only. */
  upstreamProfiles,
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

/** Resolve a selectable model to its server-only provider profile. */
export function resolveUpstreamProfile(model = config.upstreamModel): UpstreamProfile | undefined {
  if (config.upstreamProfiles.length > 0) {
    return config.upstreamProfiles.find((profile) => profile.model === model);
  }
  if (model !== config.upstreamModel) return undefined;
  return {
    model,
    label: model,
    provider: modelProvider(model),
    url: config.upstreamUrl.trim().replace(/\/$/, ''),
    key: config.upstreamKey,
    thinking: config.upstreamThinking,
    timeoutMs: config.upstreamTimeoutMs,
  };
}

/** Safe model catalogue for APIs and the browser; excludes URLs and keys. */
export const listUpstreamModels = () =>
  (config.upstreamProfiles.length > 0
    ? config.upstreamProfiles
    : [resolveUpstreamProfile(config.upstreamModel)!]
  ).map((profile) => ({
    id: profile.model,
    label: profile.label,
    provider: profile.provider,
    mode: profile.url ? ('upstream' as const) : ('mock' as const),
  }));

export const isUpstreamModelAllowed = (model: string) => resolveUpstreamProfile(model) !== undefined;

export const usingMockUpstream = (model = config.upstreamModel) =>
  resolveUpstreamProfile(model)?.url.trim() === '';

const hasRealUpstream = () =>
  config.upstreamProfiles.length > 0
    ? config.upstreamProfiles.some((profile) => profile.url.trim() !== '')
    : config.upstreamUrl.trim() !== '';

/**
 * Demo mock traffic may stay open on localhost. Any real upstream can spend
 * provider quota, so its public HTTP gateway must have a token even in demo.
 */
export const requiresGatewayToken = () =>
  config.appMode === 'production' || hasRealUpstream();
