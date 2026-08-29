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

/**
 * 演示夹具工具（重置、播种、引导演示外壳）。**这一组会清空整库**，所以它
 * 和清库端点一样只存在于 demo 构建里——生产库被一个按钮清光，试用者手上
 * 的稿件连同责任链就没了。只读的示例素材不在此列，两种模式都给。
 */
export const demoToolsEnabledFor = (mode: 'demo' | 'production'): boolean => mode === 'demo';

/**
 * 会话 cookie 的 `Secure` 标志。
 *
 * 默认跟着 `production` 走。但**纯 HTTP 部署下必须关掉**：浏览器会直接丢弃
 * 带 `Secure` 的 cookie，接口返 200、`Set-Cookie` 也发了，人就是登不进去——
 * 排查起来极其难，因为 curl 不理会这个标志，命令行怎么试都是通的。
 *
 * 关掉它并不比原来更弱：站点本来就是明文 HTTP，会话在传输中已经是暴露的，
 * `Secure` 在这种部署下一点保护都提供不了，只提供了一个登不进去的登录页。
 * **真正要做的是上 HTTPS**，那之后把这个开关去掉。
 */
export const cookieSecureFor = (
  mode: 'demo' | 'production',
  allowInsecureCookie: boolean,
): boolean => mode === 'production' && !allowInsecureCookie;

const appMode = appModeEnv();
const allowInsecureCookie = booleanEnv('ALLOW_INSECURE_COOKIE', false);
const configuredSessionSecret = process.env.SESSION_SECRET?.trim() ?? '';
const configuredGatewayToken = process.env.GATEWAY_TOKEN?.trim() ?? '';

function upstreamThinkingEnv(): 'provider-default' | 'enabled' | 'disabled' {
  const value = process.env.UPSTREAM_THINKING?.trim().toLowerCase() || 'provider-default';
  if (value === 'provider-default' || value === 'enabled' || value === 'disabled') return value;
  throw new Error('UPSTREAM_THINKING must be provider-default, enabled or disabled');
}

function upstreamReasoningEffortEnv(): ReasoningEffort | undefined {
  const value = process.env.UPSTREAM_REASONING_EFFORT?.trim().toLowerCase();
  if (!value) return undefined;
  if (REASONING_EFFORTS.includes(value)) return value as ReasoningEffort;
  throw new Error(`UPSTREAM_REASONING_EFFORT must be ${REASONING_EFFORTS.join(', ')}`);
}

export type UpstreamThinking = 'provider-default' | 'enabled' | 'disabled';

/**
 * 思考强度（OpenAI 兼容的 `reasoning_effort`）。
 *
 * **和 `thinking` 不是一回事，也不能互相替代。** GLM-5.3 系列拒绝关闭思考
 * （返回 `1210: 该模型始终思考，不支持关闭思考`），`thinking:{type:"low"}`
 * 同样被拒；能压住它的是平级的 `reasoning_effort`。线上实测（glm-5.3，
 * 同一份通稿改写任务）：
 *
 * | 设置 | 耗时 | 正文 | 思考链 |
 * | --- | --- | --- | --- |
 * | 不带（provider-default） | 16–62 秒 | ~200 字 | 4千–1.6万字 |
 * | `reasoning_effort=low` | **2.1 秒** | 192 字 | 33 字 |
 *
 * 正文长度与质量没有下降，省下的全是思考链——那部分既拖垮响应，也照样计费。
 */
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'max';

const REASONING_EFFORTS: readonly string[] = ['low', 'medium', 'high', 'max'];

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
  /** 可选。省略就不发这个参数，完全保持供应商默认行为。 */
  reasoningEffort?: ReasoningEffort;
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
    const reasoningEffort =
      item.reasoningEffort === undefined || item.reasoningEffort === null
        ? undefined
        : String(item.reasoningEffort).trim().toLowerCase();

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
    if (reasoningEffort !== undefined && !REASONING_EFFORTS.includes(reasoningEffort)) {
      throw new Error(
        `UPSTREAM_PROFILES_JSON[${index}].reasoningEffort must be ${REASONING_EFFORTS.join(', ')}`,
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
      ...(reasoningEffort ? { reasoningEffort: reasoningEffort as ReasoningEffort } : {}),
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
  demoToolsEnabled: demoToolsEnabledFor(appMode),
  /** 只给纯 HTTP 部署用。上了 HTTPS 就该去掉。 */
  allowInsecureCookie,
  cookieSecure: cookieSecureFor(appMode, allowInsecureCookie),
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
   * `@anthropic-ai/claude-agent-sdk` used to sit in dependencies for that
   * adapter but was never imported, so it was removed — reinstall it when the
   * adapter is actually written rather than carrying an unused dependency that
   * makes the stack description wrong.
   */
  upstreamUrl: process.env.UPSTREAM_URL ?? '',
  upstreamKey: process.env.UPSTREAM_KEY ?? '',
  upstreamModel,
  upstreamTimeoutMs: integerEnv('UPSTREAM_TIMEOUT_MS', 30_000, 1_000, 300_000),
  /** Optional OpenAI-compatible extension, used by providers such as DeepSeek V4. */
  upstreamThinking: upstreamThinkingEnv(),
  /** 单模型兼容配置下的思考强度；多模型走配置档里的 `reasoningEffort`。 */
  upstreamReasoningEffort: upstreamReasoningEffortEnv(),
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
    ...(config.upstreamReasoningEffort
      ? { reasoningEffort: config.upstreamReasoningEffort }
      : {}),
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
