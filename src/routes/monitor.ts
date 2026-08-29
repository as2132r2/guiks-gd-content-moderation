// "开始监理": seed a little benign traffic so the audit stream is alive the
// moment the operator opens the console — before any red-team drama.
import { Hono } from 'hono';
import { publish } from '../lib/bus.js';
import { getScenario } from '../lib/scenarios.js';
import { requireAuth, type AuthEnv } from '../middleware/auth.js';
import { askTarget } from './target.js';
import { requireAuditRead } from './events.js';

const BENIGN = getScenario().benignSeed;

export async function seedBenign(): Promise<number> {
  publish('status', { state: 'monitoring', message: '监理中：接管目标流量' });
  for (const m of BENIGN) {
    try {
      await askTarget(m);
    } catch {
      // ignore a single failed seed
    }
  }
  publish('status', { state: 'idle', message: '监理中 · 流量正常' });
  return BENIGN.length;
}

export const monitorRoutes = new Hono<AuthEnv>();

// 它会真的打模型（askTarget → 网关 → 上游），所以匿名一次就能烧掉真实额度。
monitorRoutes.post('/api/monitor/start', requireAuth, requireAuditRead, async (c) => {
  const count = await seedBenign();
  return c.json({ ok: true, seeded: count });
});
