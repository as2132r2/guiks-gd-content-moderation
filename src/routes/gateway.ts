// The gateway: the point every request flows through. It tees the traffic into
// the audit store, runs detectors on the way in and out, then forwards to the
// upstream model. This is the "接管" layer — a target only needs to point its
// model base_url at POST /gateway/v1/messages.
import { Hono } from 'hono';
import { config } from '../config.js';
import { scanRequest, scanResponse } from '../lib/detectors.js';
import { applyGuardrail, evaluateGuardrails } from '../lib/guardrails.js';
import { nextId, recordAudit, recordGuardrail, recordUsage } from '../lib/store.js';
import { callUpstream, type ChatMessage } from '../lib/upstream.js';
import type { AuditEvent, Finding } from '../types.js';

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 140);
const approx = (s: string) => Math.max(1, Math.round(s.length / 3));

export interface GatewayResult {
  reply: string;
  findings: Finding[];
  tokens: { in: number; out: number };
}

/** Run a set of chat messages through the gateway (in-process). */
export async function throughGateway(
  messages: ChatMessage[],
  opts: { target?: string; model?: string } = {},
): Promise<GatewayResult> {
  const target = opts.target ?? config.targetLabel;
  const model = opts.model ?? config.upstreamModel;
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';

  const reqEvent: AuditEvent = {
    id: nextId('req'),
    ts: Date.now(),
    direction: 'request',
    target,
    model,
    tokens: { in: messages.reduce((n, m) => n + approx(m.content), 0), out: 0 },
    summary: oneLine(lastUser) || '(空请求)',
    body: lastUser,
    findings: scanRequest(lastUser),
  };
  for (const f of reqEvent.findings) f.eventId = reqEvent.id;
  recordAudit(reqEvent);

  const t0 = Date.now();
  const { text, tokens } = await callUpstream(messages, model);
  const latencyMs = Date.now() - t0;

  const respEvent: AuditEvent = {
    id: nextId('res'),
    ts: Date.now(),
    direction: 'response',
    target,
    model,
    latencyMs,
    tokens,
    summary: oneLine(text),
    body: text,
    findings: scanResponse(text),
  };
  for (const f of respEvent.findings) f.eventId = respEvent.id;
  recordAudit(respEvent);

  return {
    reply: text,
    findings: [...reqEvent.findings, ...respEvent.findings],
    tokens: { in: reqEvent.tokens?.in ?? 0, out: respEvent.tokens?.out ?? 0 },
  };
}

/**
 * Audit a single exchange with an EXTERNAL target (TARGET_MODE=http). The
 * target runs its own model, so we don't proxy the upstream — we just record
 * the request/response and run detectors on both.
 */
export function auditExchange(
  message: string,
  reply: string,
  opts: { target?: string; model?: string } = {},
): { findings: Finding[]; tokens: { in: number; out: number } } {
  const target = opts.target ?? config.targetLabel;
  const model = opts.model ?? 'external';

  const reqEvent: AuditEvent = {
    id: nextId('req'),
    ts: Date.now(),
    direction: 'request',
    target,
    model,
    tokens: { in: approx(message), out: 0 },
    summary: oneLine(message) || '(空请求)',
    body: message,
    findings: scanRequest(message),
  };
  for (const f of reqEvent.findings) f.eventId = reqEvent.id;
  recordAudit(reqEvent);

  const respEvent: AuditEvent = {
    id: nextId('res'),
    ts: Date.now(),
    direction: 'response',
    target,
    model,
    tokens: { in: 0, out: approx(reply) },
    summary: oneLine(reply),
    body: reply,
    findings: scanResponse(reply),
  };
  for (const f of respEvent.findings) f.eventId = respEvent.id;
  recordAudit(respEvent);

  return {
    findings: [...reqEvent.findings, ...respEvent.findings],
    tokens: { in: reqEvent.tokens?.in ?? 0, out: respEvent.tokens?.out ?? 0 },
  };
}

export const gatewayRoutes = new Hono();

// OpenAI-compatible surface: a target points its base_url here.
gatewayRoutes.post('/gateway/v1/messages', async (c) => {
  type GatewayBody = { model?: string; messages?: ChatMessage[]; message?: string };
  const body = await c.req.json<GatewayBody>().catch(() => ({}) as GatewayBody);

  const messages: ChatMessage[] = body.messages ?? (body.message ? [{ role: 'user', content: body.message }] : []);
  if (messages.length === 0) return c.json({ error: 'messages required' }, 400);

  // Runtime governance: attribute to a user, enforce guardrails on the reply,
  // and meter tokens. A real product routes its model calls through here.
  // HTTP headers are latin1, so a non-ASCII user id arrives percent-encoded.
  const rawUser = c.req.header('x-user-id') || c.req.header('x-user') || 'anon';
  let user = rawUser;
  try {
    user = decodeURIComponent(rawUser);
  } catch {
    // keep the raw value if it isn't valid percent-encoding
  }
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const { reply, findings, tokens } = await throughGateway(messages, { model: body.model });
  const verdict = evaluateGuardrails(findings, user, { message: lastUserMsg, reply });
  for (const ev of verdict.events) recordGuardrail(ev);
  recordUsage(user, tokens.in, tokens.out, verdict.events.length);
  const guarded = applyGuardrail(reply, verdict);

  return c.json({
    id: nextId('chatcmpl'),
    object: 'chat.completion',
    model: body.model ?? config.upstreamModel,
    choices: [{ index: 0, message: { role: 'assistant', content: guarded }, finish_reason: 'stop' }],
    bohe_guardrail: { action: verdict.action, triggered: verdict.events.map((e) => e.guardrail) },
    usage: { prompt_tokens: tokens.in, completion_tokens: tokens.out },
  });
});
