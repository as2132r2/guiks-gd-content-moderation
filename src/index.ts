import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { config, listUpstreamModels, requiresGatewayToken, usingMockUpstream } from './config.js';
import { closeWorkflowRepository, getWorkflowRepository } from './db/repository.js';
import { hasPermission } from './domain/permissions.js';
import { readSessionUser } from './lib/session.js';
import { snapshot } from './lib/store.js';
import { requireAuth, type AuthEnv } from './middleware/auth.js';
import { authRoutes } from './routes/auth.js';
import { eventsRoutes, requireAuditRead } from './routes/events.js';
import { gatewayRoutes } from './routes/gateway.js';
import { landingRoutes } from './routes/landing.js';
import { manualRoutes } from './routes/manual.js';
import { monitorRoutes } from './routes/monitor.js';
import { manuscriptRoutes } from './routes/manuscripts.js';
import { oversightRoutes } from './routes/oversight.js';
import { policyRoutes } from './routes/policy.js';
import { redteamRoutes } from './routes/redteam.js';
import { reportRoutes } from './routes/report.js';
import { rulesRoutes } from './routes/rules.js';
import { runtimeRoutes } from './routes/runtime.js';
import { demoRoutes } from './routes/demo.js';
import { fixtureRoutes } from './routes/fixtures.js';
import { targetRoutes } from './routes/target.js';
import { workbenchRoutes } from './routes/workbench.js';
import { renderConsole } from './views/console.js';
import { isDirectRun } from './lib/entrypoint.js';

export const app = new Hono<AuthEnv>();

app.get('/healthz', (c) => c.text('ok'));
app.get('/readyz', (c) => {
  try {
    const repository = getWorkflowRepository();
    const database = repository.healthcheck();
    const model = usingMockUpstream()
      ? config.allowMockUpstream
        ? 'mock'
        : 'missing'
      : 'configured';
    const gatewayAuth = requiresGatewayToken()
      ? config.gatewayToken && config.gatewayTokenReady
        ? 'configured'
        : 'missing'
      : 'demo-open';
    const authentication = config.sessionSecretReady ? 'configured' : 'missing';
    const account =
      config.appMode !== 'production'
        ? 'not-required'
        : repository.hasEnabledProductionUser()
          ? 'configured'
          : 'missing';
    const ready =
      database &&
      model !== 'missing' &&
      gatewayAuth !== 'missing' &&
      authentication !== 'missing' &&
      account !== 'missing';
    return c.json(
      {
        status: ready ? 'ready' : 'not-ready',
        checks: { database, model, gatewayAuth, authentication, account },
      },
      ready ? 200 : 503,
    );
  } catch {
    return c.json({ status: 'not-ready', checks: { database: false, model: 'unknown' } }, 503);
  }
});
// 「把关人」是这个产品的正面。遗留的 AuditGate 控制台还有用（红队、策略、
// 逐用户计量），但它不是首页——根路径是产品介绍页，干活的地方在 /workbench。
app.get('/console', async (c) => {
  const user = await readSessionUser(c);
  if (!user) return c.redirect('/login?next=/console');
  if (!hasPermission(user, 'audit:read')) return c.json({ error: 'role_not_allowed' }, 403);
  return c.html(renderConsole({ targetLabel: config.targetLabel }));
});
app.get('/api/state', requireAuth, requireAuditRead, (c) => c.json(snapshot()));
app.get('/api/meta', (c) =>
  c.json({
    service: 'guiks-gd-content-moderation',
    mode: config.appMode,
    persistence: 'sqlite',
    model: usingMockUpstream() ? 'mock' : 'configured',
    failClosed: config.failClosed,
    authentication: config.sessionSecretReady ? 'configured' : 'missing',
  }),
);

app.route('/', landingRoutes);
app.route('/', manualRoutes);
app.route('/', eventsRoutes);
app.route('/', gatewayRoutes);
app.route('/', manuscriptRoutes);
app.route('/', authRoutes);
app.route('/', workbenchRoutes);
app.route('/', oversightRoutes);
// 只读的示例素材两种模式都要——手册第 2 步就让人点「填入示例通稿」。
app.route('/', fixtureRoutes);
// 判定依据管理。**不是 demo-only**：真实部署也要能改词表与看改动史。
app.route('/', rulesRoutes);
// 清空整库的端点不该存在于生产构建里。
if (config.appMode === 'demo') {
  app.route('/', demoRoutes);
  app.route('/', targetRoutes);
  app.route('/', monitorRoutes);
  app.route('/', redteamRoutes);
  app.route('/', reportRoutes);
  app.route('/', runtimeRoutes);
  app.route('/', policyRoutes);
}

// Start only when run directly (not when imported by tests). 判定放在
// [lib/entrypoint.ts](lib/entrypoint.ts)：Windows 路径和生产的 `current`
// 符号链接都能让朴素写法静默失效，两次都是「什么也不做还返回 0」。
const isMain = isDirectRun(import.meta.url);
if (isMain) {
  // The production process lives behind a local reverse proxy. Binding it to
  // loopback makes an accidental security-group rule unable to expose the
  // application or machine gateway directly on port 3300.
  const server = serve(
    {
      fetch: app.fetch,
      port: config.port,
      hostname: process.env.HOST ?? (config.appMode === 'production' ? '127.0.0.1' : undefined),
    },
    (info) => {
    // eslint-disable-next-line no-console
    console.log(
      `guiks-gd-content-moderation → http://localhost:${info.port}  ` +
        `[上游模型: ${listUpstreamModels().map((item) => item.id).join(', ')}]`,
    );
    },
  );

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const forceExit = setTimeout(() => {
      if ('closeAllConnections' in server && typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      closeWorkflowRepository();
      process.exit(1);
    }, 5000);
    forceExit.unref();
    server.close(() => {
      clearTimeout(forceExit);
      closeWorkflowRepository();
      process.exit(0);
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
