import { Hono } from 'hono';
import { config } from '../config.js';
import { snapshot } from '../lib/store.js';
import { requirePageAuth, type AuthEnv } from '../middleware/auth.js';
import { renderReport } from '../views/report-view.js';

export const reportRoutes = new Hono<AuthEnv>();

// 只在 demo 下挂载，但 demo 也会开在公网上——报告是全量留痕的摘要，不能裸奔。
reportRoutes.get('/report', requirePageAuth('/report'), (c) => {
  const { lastScore } = snapshot();
  return c.html(renderReport(lastScore, config.targetLabel));
});
