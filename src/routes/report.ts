import { Hono } from 'hono';
import { config } from '../config.js';
import { snapshot } from '../lib/store.js';
import { renderReport } from '../views/report-view.js';

export const reportRoutes = new Hono();

reportRoutes.get('/report', (c) => {
  const { lastScore } = snapshot();
  return c.html(renderReport(lastScore, config.targetLabel));
});
