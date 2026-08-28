// Runtime governance surface (post-deploy). Real user traffic flows through the
// gateway; here we attribute it to users, enforce guardrails, meter tokens, and
// expose it all on the /runtime dashboard.
import { Hono } from 'hono';
import { config } from '../config.js';
import { publish } from '../lib/bus.js';
import { applyGuardrail, evaluateGuardrails, type GuardrailVerdict } from '../lib/guardrails.js';
import { getScenario } from '../lib/scenarios.js';
import { recordGuardrail, recordUsage, usageSnapshot } from '../lib/store.js';
import { renderRuntime } from '../views/runtime-view.js';
import { askTarget } from './target.js';

export interface RuntimeResult {
  reply: string;
  action: GuardrailVerdict['action'];
  triggered: string[];
}

/** One governed exchange for an end user: audit → guardrail → meter. */
export async function runtimeExchange(user: string, message: string): Promise<RuntimeResult> {
  const { reply, findings, tokens } = await askTarget(message);
  const verdict = evaluateGuardrails(findings, user, { message, reply });
  for (const ev of verdict.events) recordGuardrail(ev);
  recordUsage(user, tokens.in, tokens.out, verdict.events.length);
  return {
    reply: applyGuardrail(reply, verdict),
    action: verdict.action,
    triggered: verdict.events.map((e) => e.guardrail),
  };
}

// A believable slice of one enterprise's day (defined by the active scenario):
// mostly ordinary work, with a handful of requests that trip real guardrails.
const SIMULATION = getScenario().simulation;

export const runtimeRoutes = new Hono();

runtimeRoutes.get('/runtime', (c) => c.html(renderRuntime({ targetLabel: config.targetLabel })));

runtimeRoutes.get('/api/usage', (c) => c.json(usageSnapshot()));

runtimeRoutes.post('/api/runtime/chat', async (c) => {
  const body = await c.req.json<{ user?: string; message?: string }>().catch(
    () => ({}) as { user?: string; message?: string },
  );
  const message = (body.message ?? '').trim();
  if (!message) return c.json({ error: 'message required' }, 400);
  const result = await runtimeExchange(body.user?.trim() || 'anon', message);
  return c.json(result);
});

runtimeRoutes.post('/api/runtime/simulate', async (c) => {
  publish('status', { state: 'monitoring', message: '模拟用户流量中…' });
  for (const { user, message } of SIMULATION) {
    try {
      await runtimeExchange(user, message);
    } catch {
      // one bad exchange shouldn't abort the simulation
    }
  }
  publish('status', { state: 'idle', message: '运行时监控 · 流量正常' });
  return c.json({ ok: true, exchanges: SIMULATION.length });
});
