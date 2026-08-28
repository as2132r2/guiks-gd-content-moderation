// The model behind the gateway.
//
// Default: the ACTIVE scenario's built-in DETERMINISTIC mock (see scenarios.ts)
// — a naive, over-compliant target that provides value on benign asks and leaks
// its planted secrets the moment a user pushes. Reliable on stage, needs no key.
// Set UPSTREAM_URL to proxy a real OpenAI-compatible model instead.
import { config, usingMockUpstream } from '../config.js';
import { broadcastMockReply } from '../model/broadcast-mock.js';
import { getScenario } from './scenarios.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface UpstreamReply {
  text: string;
  tokens: { in: number; out: number };
  model: string;
  usageSource: 'provider' | 'estimated';
  mode: 'mock' | 'upstream';
  protocol: 'mock' | 'openai';
  modelSource: 'provider' | 'requested';
}

const approxTokens = (s: string) => Math.max(1, Math.round(s.length / 3));

export class UpstreamError extends Error {
  constructor(
    public readonly code:
      | 'mock_disabled'
      | 'upstream_http_error'
      | 'upstream_invalid_response'
      | 'upstream_network_error'
      | 'upstream_timeout',
    public readonly status?: number,
  ) {
    super(code);
    this.name = 'UpstreamError';
  }
}

const nonNegativeInteger = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;

export function parseOpenAiReply(
  payload: unknown,
  messages: ChatMessage[],
  requestedModel: string,
): UpstreamReply {
  if (!payload || typeof payload !== 'object') {
    throw new UpstreamError('upstream_invalid_response');
  }
  const json = payload as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = json.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || text.trim() === '') {
    throw new UpstreamError('upstream_invalid_response');
  }

  const inputTokens = nonNegativeInteger(json.usage?.prompt_tokens);
  const outputTokens = nonNegativeInteger(json.usage?.completion_tokens);
  const providerUsage = inputTokens !== undefined && outputTokens !== undefined;
  const providerModel = typeof json.model === 'string' ? json.model.trim() : '';
  return {
    text,
    tokens: providerUsage
      ? { in: inputTokens, out: outputTokens }
      : {
          in: messages.reduce((n, message) => n + approxTokens(message.content), 0),
          out: approxTokens(text),
        },
    model: providerModel || requestedModel,
    usageSource: providerUsage ? 'provider' : 'estimated',
    mode: 'upstream',
    protocol: 'openai',
    modelSource: providerModel ? 'provider' : 'requested',
  };
}

/** Real OpenAI-compatible upstream (only used when UPSTREAM_URL is set). */
async function realReply(messages: ChatMessage[], model: string): Promise<UpstreamReply> {
  const base = config.upstreamUrl.replace(/\/$/, '');
  const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.upstreamKey ? { authorization: `Bearer ${config.upstreamKey}` } : {}),
      },
      body: JSON.stringify({ model, messages, stream: false }),
      signal: AbortSignal.timeout(config.upstreamTimeoutMs),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    throw new UpstreamError(
      name === 'TimeoutError' || name === 'AbortError' ? 'upstream_timeout' : 'upstream_network_error',
    );
  }
  if (!res.ok) throw new UpstreamError('upstream_http_error', res.status);
  return parseOpenAiReply(await res.json(), messages, model);
}

export async function callUpstream(
  messages: ChatMessage[],
  model = config.upstreamModel,
): Promise<UpstreamReply> {
  const inTokens = messages.reduce((n, m) => n + approxTokens(m.content), 0);
  if (usingMockUpstream()) {
    if (!config.allowMockUpstream) throw new UpstreamError('mock_disabled');
    // 广电主链的生成请求先走稿件 mock；其余流量仍归当前 AuditGate 场景。
    const text = broadcastMockReply(messages) ?? getScenario().mockReply(messages);
    return {
      text,
      tokens: { in: inTokens, out: approxTokens(text) },
      model,
      usageSource: 'estimated',
      mode: 'mock',
      protocol: 'mock',
      modelSource: 'requested',
    };
  }

  // A configured upstream is authoritative. Never turn its failure into a
  // successful-looking artifact: the caller must see and record the failure.
  return realReply(messages, model);
}
