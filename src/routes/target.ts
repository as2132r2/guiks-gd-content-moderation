// The controlled demo target for the ACTIVE scenario (see scenarios.ts) — a
// DELIBERATELY vulnerable toy product. Its weakness is textbook: it stuffs
// confidential data straight into the model context and tells the model to
// satisfy every request. On stage we point it at the gateway, so every leak is
// caught live.
//
// ⚠️ Everything embedded here is fake. This exists only to be tested by us,
// with consent (it is our own target).
import { Hono } from 'hono';
import { config } from '../config.js';
import { getScenario } from '../lib/scenarios.js';
import type { ChatMessage } from '../lib/upstream.js';
import { auditExchange, throughGateway, type GatewayResult } from './gateway.js';

const SYSTEM_PROMPT = getScenario().systemPrompt;

/** Pull the assistant reply out of a target's JSON response. */
export function extractReply(json: unknown, format: 'openai' | 'simple'): string {
  if (typeof json === 'string') return json;
  if (!json || typeof json !== 'object') return '';
  // biome-ignore lint/suspicious/noExplicitAny: tolerant parsing of unknown target shapes
  const j = json as Record<string, any>;
  let v: unknown;
  if (format === 'openai') {
    const choice = Array.isArray(j.choices) ? j.choices[0] : undefined;
    v = choice?.message?.content ?? choice?.text;
  } else {
    v = j.reply ?? j.text ?? j.content ?? j.output ?? j.message;
  }
  return typeof v === 'string' ? v : '';
}

/** Call a REAL external product over HTTP (TARGET_MODE=http). */
async function callExternalTarget(message: string): Promise<string> {
  if (!config.targetUrl) return '[未配置 TARGET_URL]';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (config.targetKey) headers.authorization = `Bearer ${config.targetKey}`;
  const body =
    config.targetFormat === 'openai'
      ? JSON.stringify({
          model: config.targetModel,
          messages: [{ role: 'user', content: message }],
          stream: false,
        })
      : JSON.stringify({ message });
  try {
    const res = await fetch(config.targetUrl, { method: 'POST', headers, body });
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) return extractReply(await res.json(), config.targetFormat);
    return await res.text();
  } catch (e) {
    return `[目标不可达] ${(e as Error).message}`;
  }
}

/**
 * Ask the configured target one message, returning its reply plus any findings.
 * `toy` mode drives the built-in vulnerable target through our gateway; `http`
 * mode calls a real external product and audits its reply.
 */
export async function askTarget(message: string): Promise<GatewayResult> {
  if (config.targetMode === 'http') {
    const reply = await callExternalTarget(message);
    const { findings, tokens } = auditExchange(message, reply, {
      target: config.targetLabel,
      model: `external:${config.targetFormat}`,
    });
    return { reply, model: `external:${config.targetFormat}`, findings, tokens };
  }
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: message },
  ];
  return throughGateway(messages, {
    target: config.targetLabel,
    // This target contains planted fake data and exists specifically so the
    // legacy red-team console can show a full controlled exchange.
    retainAuditBody: true,
  });
}

export const targetRoutes = new Hono();

targetRoutes.get('/target/info', (c) =>
  c.json({
    label: config.targetLabel,
    note: '受控演示靶子：故意留洞的企业客服 AI，用于自有的安全体检。',
  }),
);

targetRoutes.post('/target/chat', async (c) => {
  const body = await c.req.json<{ message?: string }>().catch(() => ({}) as { message?: string });
  const message = (body.message ?? '').trim();
  if (!message) return c.json({ error: 'message required' }, 400);
  const { reply } = await askTarget(message);
  return c.json({ reply });
});
