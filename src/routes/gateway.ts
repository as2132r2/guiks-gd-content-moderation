// The gateway: the point every request flows through. It tees the traffic into
// the audit store, runs detectors on the way in and out, then forwards to the
// upstream model. This is the "接管" layer — a target only needs to point its
// model base_url at POST /gateway/v1/messages.
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { config, requiresGatewayToken, usingMockUpstream } from '../config.js';
import { getWorkflowRepository } from '../db/repository.js';
import type { TraceEvent, WorkflowDomainEvent } from '../domain/contracts.js';
import { publish } from '../lib/bus.js';
import { scanRequest, scanResponse } from '../lib/detectors.js';
import { applyGuardrail, evaluateGuardrails } from '../lib/guardrails.js';
import { nextId, recordAudit, recordGuardrail, recordUsage } from '../lib/store.js';
import { callUpstream, type ChatMessage, UpstreamError } from '../lib/upstream.js';
import type { AuditEvent, Finding } from '../types.js';

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 140);
const approx = (s: string) => Math.max(1, Math.round(s.length / 3));

export interface GatewayResult {
  reply: string;
  model: string;
  findings: Finding[];
  tokens: { in: number; out: number };
}

export interface ModelCallTelemetry {
  callId: string;
  requestedModel: string;
  servedModel: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  usageSource: 'provider' | 'estimated';
  mode: 'mock' | 'upstream';
  protocol: 'mock' | 'openai';
  modelSource: 'provider' | 'requested';
  outcome: 'success';
}

export interface GatewayGovernance {
  action: 'block' | 'redact' | 'flag' | 'none';
  triggered: string[];
}

export interface ProxiedGatewayResult extends GatewayResult {
  telemetry: ModelCallTelemetry;
  governance: GatewayGovernance;
}

export interface GatewayTraceContext {
  manuscriptId: string;
  /** Human who initiated the business action. */
  actor: string;
  /** Stable business purpose, e.g. broadcast-script. */
  operation: string;
}

export interface GatewayOptions {
  target?: string;
  model?: string;
  /** Present for business calls that must join a manuscript responsibility chain. */
  trace?: GatewayTraceContext;
  /** When present, guardrails and usage metering run inside this shared lifecycle. */
  governanceUser?: string;
  /** Only controlled fake-data scenarios may expose bodies on the legacy console. */
  retainAuditBody?: boolean;
}

export class ModelTraceError extends Error {
  constructor(
    public readonly code: 'model_trace_context_missing' | 'model_trace_write_failed',
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'ModelTraceError';
  }
}

function emitTrace(event: TraceEvent): void {
  const update: WorkflowDomainEvent = {
    id: randomUUID(),
    type: 'trace',
    manuscriptId: event.manuscriptId,
    occurredAt: event.createdAt,
    data: { traceId: event.id, kind: event.kind },
  };
  publish('trace', update);
}

function appendModelTrace(
  context: GatewayTraceContext,
  kind: 'model-requested' | 'model-completed',
  model: string,
  data: TraceEvent['data'],
): TraceEvent {
  let event: TraceEvent | undefined;
  try {
    event = getWorkflowRepository().appendTrace(context.manuscriptId, {
      kind,
      actorType: 'ai',
      actor: model,
      data: { ...data, initiatedBy: context.actor },
    });
  } catch (cause) {
    throw new ModelTraceError('model_trace_write_failed', { cause });
  }
  // Never let an untraceable business call reach the model.
  if (!event) throw new ModelTraceError('model_trace_context_missing');
  emitTrace(event);
  return event;
}

/** A transient SQLite busy/error must not leave an otherwise completed call open. */
function appendTerminalTrace(
  context: GatewayTraceContext,
  model: string,
  data: TraceEvent['data'],
): TraceEvent {
  try {
    return appendModelTrace(context, 'model-completed', model, data);
  } catch (error) {
    if (!(error instanceof ModelTraceError) || error.code !== 'model_trace_write_failed') throw error;
    return appendModelTrace(context, 'model-completed', model, data);
  }
}

/** Run a set of chat messages through the gateway (in-process). */
export async function throughGateway(
  messages: ChatMessage[],
  opts: GatewayOptions = {},
): Promise<ProxiedGatewayResult> {
  const target = opts.target ?? config.targetLabel;
  const model = opts.model ?? config.upstreamModel;
  const callId = randomUUID();
  const mode = usingMockUpstream() ? 'mock' : 'upstream';
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const requestSummary = opts.retainAuditBody
    ? oneLine(lastUser) || '(空请求)'
    : `模型请求 · ${lastUser.length} 字（正文未进入运行时事件）`;

  const reqEvent: AuditEvent = {
    id: nextId('req'),
    callId,
    ts: Date.now(),
    direction: 'request',
    target,
    model,
    tokens: { in: messages.reduce((n, m) => n + approx(m.content), 0), out: 0 },
    summary: requestSummary,
    body: opts.retainAuditBody ? lastUser : '[正文已从运行时事件中移除]',
    findings: scanRequest(lastUser),
  };
  for (const f of reqEvent.findings) f.eventId = reqEvent.id;
  recordAudit(reqEvent);

  const requestTrace = opts.trace
    ? appendModelTrace(opts.trace, 'model-requested', model, {
        callId,
        operation: opts.trace.operation,
        requestedModel: model,
        mode,
      })
    : undefined;

  const t0 = Date.now();
  let upstream;
  try {
    upstream = await callUpstream(messages, model);
  } catch (error) {
    const latencyMs = Date.now() - t0;
    if (opts.trace) {
      appendTerminalTrace(opts.trace, model, {
        callId,
        ...(requestTrace ? { requestTraceId: requestTrace.id } : {}),
        operation: opts.trace.operation,
        requestedModel: model,
        mode,
        latencyMs,
        outcome: 'error',
        errorCode: error instanceof UpstreamError ? error.code : 'upstream_failure',
        ...(error instanceof UpstreamError && error.status !== undefined
          ? { upstreamStatus: error.status }
          : {}),
      });
    }
    throw error;
  }
  const latencyMs = Date.now() - t0;

  const respEvent: AuditEvent = {
    id: nextId('res'),
    callId,
    ts: Date.now(),
    direction: 'response',
    target,
    model: upstream.model,
    latencyMs,
    tokens: upstream.tokens,
    summary: opts.retainAuditBody
      ? oneLine(upstream.text)
      : `模型响应 · ${upstream.text.length} 字（正文未进入运行时事件）`,
    body: opts.retainAuditBody ? upstream.text : '[正文已从运行时事件中移除]',
    findings: scanResponse(upstream.text),
  };
  for (const f of respEvent.findings) f.eventId = respEvent.id;
  recordAudit(respEvent);

  const telemetry: ModelCallTelemetry = {
    callId,
    requestedModel: model,
    servedModel: upstream.model,
    inputTokens: upstream.tokens.in,
    outputTokens: upstream.tokens.out,
    latencyMs,
    usageSource: upstream.usageSource,
    mode: upstream.mode,
    protocol: upstream.protocol,
    modelSource: upstream.modelSource,
    outcome: 'success',
  };

  if (opts.trace) {
    appendTerminalTrace(opts.trace, upstream.model, {
      callId,
      ...(requestTrace ? { requestTraceId: requestTrace.id } : {}),
      operation: opts.trace.operation,
      requestedModel: telemetry.requestedModel,
      servedModel: telemetry.servedModel,
      inputTokens: telemetry.inputTokens,
      outputTokens: telemetry.outputTokens,
      totalTokens: telemetry.inputTokens + telemetry.outputTokens,
      latencyMs: telemetry.latencyMs,
      usageSource: telemetry.usageSource,
      mode: telemetry.mode,
      protocol: telemetry.protocol,
      modelSource: telemetry.modelSource,
      outcome: telemetry.outcome,
    });
  }

  let governedReply = upstream.text;
  let governance: GatewayGovernance = { action: 'none', triggered: [] };
  if (opts.governanceUser) {
    const verdict = evaluateGuardrails(
      [...reqEvent.findings, ...respEvent.findings],
      opts.governanceUser,
      { message: lastUser, reply: upstream.text },
    );
    for (const event of verdict.events) recordGuardrail(event);
    recordUsage(
      opts.governanceUser,
      upstream.tokens.in,
      upstream.tokens.out,
      verdict.events.length,
    );
    governedReply = applyGuardrail(upstream.text, verdict);
    governance = {
      action: verdict.action,
      triggered: verdict.events.map((event) => event.guardrail),
    };
  }

  return {
    reply: governedReply,
    model: upstream.model,
    findings: [...reqEvent.findings, ...respEvent.findings],
    tokens: upstream.tokens,
    telemetry,
    governance,
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
  opts: { target?: string; model?: string; retainAuditBody?: boolean } = {},
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
    summary: opts.retainAuditBody
      ? oneLine(message) || '(空请求)'
      : `外部请求 · ${message.length} 字（正文未进入运行时事件）`,
    body: opts.retainAuditBody ? message : '[正文已从运行时事件中移除]',
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
    summary: opts.retainAuditBody
      ? oneLine(reply)
      : `外部响应 · ${reply.length} 字（正文未进入运行时事件）`,
    body: opts.retainAuditBody ? reply : '[正文已从运行时事件中移除]',
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
  if (config.gatewayToken) {
    if (c.req.header('authorization') !== `Bearer ${config.gatewayToken}`) {
      return c.json({ error: 'gateway_unauthorized' }, 401);
    }
  } else if (requiresGatewayToken()) {
    return c.json({ error: 'gateway_auth_not_configured' }, 503);
  }

  type GatewayBody = { model?: unknown; messages?: unknown; message?: unknown };
  const body = await c.req.json<GatewayBody>().catch(() => ({}) as GatewayBody);

  const candidateMessages = Array.isArray(body.messages)
    ? body.messages
    : typeof body.message === 'string'
      ? [{ role: 'user', content: body.message }]
      : [];
  const validRoles = new Set(['system', 'user', 'assistant']);
  if (
    !candidateMessages.every(
      (message) =>
        message &&
        typeof message === 'object' &&
        validRoles.has((message as { role?: unknown }).role as string) &&
        typeof (message as { content?: unknown }).content === 'string',
    )
  ) {
    return c.json({ error: 'invalid_messages' }, 400);
  }
  const messages = candidateMessages as ChatMessage[];
  if (messages.length === 0) return c.json({ error: 'messages required' }, 400);
  if (body.model !== undefined && typeof body.model !== 'string') {
    return c.json({ error: 'invalid_model' }, 400);
  }
  const requestedModel = typeof body.model === 'string' ? body.model : undefined;
  if (requestedModel && requestedModel !== config.upstreamModel) {
    return c.json({ error: 'model_not_allowed' }, 400);
  }
  const totalCharacters = messages.reduce((sum, message) => sum + message.content.length, 0);
  if (messages.length > 64 || totalCharacters > 500_000) {
    return c.json({ error: 'request_too_large' }, 413);
  }

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
  let result: ProxiedGatewayResult;
  try {
    result = await throughGateway(messages, { model: requestedModel, governanceUser: user });
  } catch (error) {
    return c.json(
      {
        error: 'upstream_unavailable',
        code: error instanceof UpstreamError ? error.code : 'upstream_failure',
      },
      502,
    );
  }
  const { reply, tokens, telemetry, governance } = result;

  return c.json({
    id: nextId('chatcmpl'),
    object: 'chat.completion',
    model: telemetry.servedModel,
    choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
    bohe_guardrail: governance,
    usage: { prompt_tokens: tokens.in, completion_tokens: tokens.out },
  });
});
