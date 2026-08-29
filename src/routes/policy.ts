/**
 * 遗留 AuditGate 策略面。
 *
 * ⚠️ 这套策略作用在 [lib/detectors.ts](../lib/detectors.ts) 的旧规格上，
 * **不作用于工作台的入口准入与输出预检**，而且是内存态、进程重启即失。
 * 广电主链的判定依据在 `/rules`。
 *
 * 只在 `APP_MODE=demo` 下挂载，但 demo 也可能开在公网上，所以一样要认人：
 * 读写都收在 `audit:read` 之下，与 `/api/state`、`/api/monitor/overview` 取齐。
 */
import { Hono } from 'hono';
import { config } from '../config.js';
import { applyPreset, getPolicy, listPresets, setPolicy } from '../lib/policy.js';
import { requireAuth, requirePageAuth, type AuthEnv } from '../middleware/auth.js';
import { renderPolicy } from '../views/policy-view.js';
import type { GuardrailPolicy } from '../types.js';
import { requireAuditRead } from './events.js';

export const policyRoutes = new Hono<AuthEnv>();

policyRoutes.use('/api/policy', requireAuth, requireAuditRead);
policyRoutes.use('/api/policy/*', requireAuth, requireAuditRead);

policyRoutes.get('/policy', requirePageAuth('/policy'), (c) =>
  c.html(renderPolicy({ targetLabel: config.targetLabel })),
);

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
