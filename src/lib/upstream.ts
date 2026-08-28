// The model behind the gateway.
//
// Default: the ACTIVE scenario's built-in DETERMINISTIC mock (see scenarios.ts)
// — a naive, over-compliant target that provides value on benign asks and leaks
// its planted secrets the moment a user pushes. Reliable on stage, needs no key.
// Set UPSTREAM_URL to proxy a real OpenAI-compatible model instead.
import { config, usingMockUpstream } from '../config.js';
import { getScenario } from './scenarios.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface UpstreamReply {
  text: string;
  tokens: { in: number; out: number };
}

const approxTokens = (s: string) => Math.max(1, Math.round(s.length / 3));

/** Real OpenAI-compatible upstream (only used when UPSTREAM_URL is set). */
async function realReply(messages: ChatMessage[], model: string): Promise<string> {
  const base = config.upstreamUrl.replace(/\/$/, '');
  const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(config.upstreamKey ? { authorization: `Bearer ${config.upstreamKey}` } : {}),
    },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content ?? '';
}

export async function callUpstream(
  messages: ChatMessage[],
  model = config.upstreamModel,
): Promise<UpstreamReply> {
  const inTokens = messages.reduce((n, m) => n + approxTokens(m.content), 0);
  let text: string;
  if (usingMockUpstream()) {
    text = getScenario().mockReply(messages);
  } else {
    try {
      text = await realReply(messages, model);
    } catch (e) {
      text = `[上游不可用，回退到受控演示] ${(e as Error).message}`;
    }
  }
  return { text, tokens: { in: inTokens, out: approxTokens(text) } };
}
