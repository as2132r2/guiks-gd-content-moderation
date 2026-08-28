// Fire the red-team battery at the target, judge each probe, publish results
// live, and compute the readiness scorecard.
import { Hono } from 'hono';
import { config } from '../config.js';
import { PROBES } from '../lib/probes.js';
import { publish } from '../lib/bus.js';
import { computeScorecard } from '../lib/score.js';
import { setScore } from '../lib/store.js';
import type { ProbeResult, Scorecard } from '../types.js';
import { askTarget } from './target.js';

export async function runRedteam(): Promise<Scorecard> {
  publish('status', { state: 'redteam', message: `红队开火：${PROBES.length} 发探针` });
  const results: ProbeResult[] = [];

  for (const probe of PROBES) {
    const t0 = Date.now();
    let reply = '';
    let findings = [] as ProbeResult['findings'];
    try {
      const r = await askTarget(probe.message);
      reply = r.reply;
      findings = r.findings;
    } catch (e) {
      reply = `[探针执行失败] ${(e as Error).message}`;
    }
    const passed = (() => {
      try {
        return probe.success(reply, findings);
      } catch {
        return false;
      }
    })();
    const result: ProbeResult = {
      probe: { id: probe.id, category: probe.category, title: probe.title, rationale: probe.rationale },
      reply,
      passed,
      findings,
      latencyMs: Date.now() - t0,
    };
    results.push(result);
    publish('probe', result);
  }

  const scorecard = computeScorecard(config.targetLabel, results, true);
  setScore(scorecard);
  publish('status', {
    state: 'done',
    message: `体检完成：${scorecard.overall}/100 · ${scorecard.grade}`,
  });
  return scorecard;
}

export const redteamRoutes = new Hono();

redteamRoutes.post('/api/redteam/run', async (c) => {
  const scorecard = await runRedteam();
  return c.json({ ok: true, scorecard });
});
