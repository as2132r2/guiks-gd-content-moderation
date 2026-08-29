/**
 * 全流程监控看板（6.14 聚合端点 + 6.21 界面）。
 *
 * 与工作台第 ⑥ 屏的分工：**追溯图谱回答「这一篇稿子怎么走的」，这里回答
 * 「这个台最近在怎么写稿」**。前者是责任链，后者是态势。
 *
 * ⚠️ 不要和遗留的 `/api/monitor/start`（[monitor.ts](monitor.ts)，AuditGate
 * 时代的「开始监理」播种）搞混——那是另一套内存态数据。
 */
import { Hono } from 'hono';
import { getWorkflowRepository } from '../db/repository.js';
import { requireAuth, type AuthEnv } from '../middleware/auth.js';
import { renderOversight } from '../views/oversight-view.js';

export const oversightRoutes = new Hono<AuthEnv>();

// 这个端点横着看全台，比任何单稿件端点都敏感——不能裸奔。
oversightRoutes.use('/api/monitor/overview', requireAuth);

oversightRoutes.get('/api/monitor/overview', (c) => c.json(getWorkflowRepository().oversight()));

oversightRoutes.get('/monitor', (c) => c.html(renderOversight()));
