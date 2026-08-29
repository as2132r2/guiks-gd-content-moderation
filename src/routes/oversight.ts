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
import { hasPermission } from '../domain/permissions.js';
import { readSessionUser } from '../lib/session.js';
import { requireAuth, type AuthEnv } from '../middleware/auth.js';
import { requireAuditRead } from './events.js';
import { renderOversight } from '../views/oversight-view.js';

export const oversightRoutes = new Hono<AuthEnv>();

// 这个端点横着看全台，比任何单稿件端点都敏感——不能裸奔。守卫与遗留审计面
// （`/api/state`）取齐：读留痕要 audit:read。眼下四个角色都有这条权限，所以
// 现在看不出差别；矩阵哪天收紧，两个面才会一起收紧。
oversightRoutes.get('/api/monitor/overview', requireAuth, requireAuditRead, (c) =>
  c.json(getWorkflowRepository().oversight()),
);

// 页面本身也先认人再渲染，和 `/console`、`/workbench` 一个写法：匿名访问直接
// 跳登录，别让人看着空壳等 JS 把自己弹走。页内 load() 的 401 分支仍然留着——
// 那管的是页面开着、会话过期的那一种。
oversightRoutes.get('/monitor', async (c) => {
  const user = await readSessionUser(c);
  if (!user) return c.redirect('/login?next=/monitor');
  if (!hasPermission(user, 'audit:read')) return c.json({ error: 'role_not_allowed' }, 403);
  return c.html(renderOversight());
});
