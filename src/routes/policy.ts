import { Hono } from 'hono';
import { config } from '../config.js';
import { applyPreset, getPolicy, listPresets, setPolicy } from '../lib/policy.js';
import { renderPolicy } from '../views/policy-view.js';
import type { GuardrailPolicy } from '../types.js';

export const policyRoutes = new Hono();

policyRoutes.get('/policy', (c) => c.html(renderPolicy({ targetLabel: config.targetLabel })));

policyRoutes.get('/api/policy', (c) => c.json(getPolicy()));

policyRoutes.get('/api/policy/presets', (c) => c.json({ presets: listPresets() }));

policyRoutes.put('/api/policy', async (c) => {
  const body = await c.req.json<Partial<GuardrailPolicy>>().catch(() => ({}));
  const policy = setPolicy(body);
  return c.json({ ok: true, policy });
});

policyRoutes.post('/api/policy/preset', async (c) => {
  const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
  const policy = applyPreset(body.name ?? '');
  if (!policy) return c.json({ ok: false, error: 'unknown preset' }, 400);
  return c.json({ ok: true, policy });
});
