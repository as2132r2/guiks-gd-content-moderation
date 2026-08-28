// Runtime config. Everything has a demo-safe default so the app runs with zero
// setup and needs no API key. Point at a real product/upstream only when you
// deliberately set the env vars.
import { getScenario } from './lib/scenarios.js';

export const config = {
  port: Number(process.env.PORT ?? 3300),

  /** Default target label shown in the console's "接管目标" field. */
  targetLabel: process.env.TARGET_LABEL ?? getScenario().label,

  /**
   * Upstream model behind the gateway (used in `toy` target mode). Empty = use
   * the built-in deterministic mock upstream (no key needed, reliable on stage).
   * Set to a real OpenAI/Anthropic-compatible base URL to proxy a real model.
   */
  upstreamUrl: process.env.UPSTREAM_URL ?? '',
  upstreamKey: process.env.UPSTREAM_KEY ?? '',
  upstreamModel: process.env.UPSTREAM_MODEL ?? 'glm-4.6-mock',

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
  maxAudits: Number(process.env.MAX_AUDITS ?? 500),
} as const;

export const usingMockUpstream = () => config.upstreamUrl.trim() === '';
