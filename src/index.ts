import { serve } from '@hono/node-server';
import { pathToFileURL } from 'node:url';
import { Hono } from 'hono';
import { config, requiresGatewayToken, usingMockUpstream } from './config.js';
import { closeWorkflowRepository, getWorkflowRepository } from './db/repository.js';
import { snapshot } from './lib/store.js';
import { eventsRoutes } from './routes/events.js';
import { gatewayRoutes } from './routes/gateway.js';
import { monitorRoutes } from './routes/monitor.js';
import { manuscriptRoutes } from './routes/manuscripts.js';
import { policyRoutes } from './routes/policy.js';
import { redteamRoutes } from './routes/redteam.js';
import { reportRoutes } from './routes/report.js';
import { runtimeRoutes } from './routes/runtime.js';
import { targetRoutes } from './routes/target.js';
import { workbenchRoutes } from './routes/workbench.js';
import { renderConsole } from './views/console.js';

export const app = new Hono();

app.get('/healthz', (c) => c.text('ok'));
app.get('/readyz', (c) => {
  try {
    const database = getWorkflowRepository().healthcheck();
    const model = usingMockUpstream()
      ? config.allowMockUpstream
        ? 'mock'
        : 'missing'
      : 'configured';
    const gatewayAuth = config.gatewayToken
      ? 'configured'
      : requiresGatewayToken()
        ? 'missing'
        : 'demo-open';
    const ready = database && model !== 'missing' && gatewayAuth !== 'missing';
    return c.json(
      { status: ready ? 'ready' : 'not-ready', checks: { database, model, gatewayAuth } },
      ready ? 200 : 503,
    );
  } catch {
    return c.json({ status: 'not-ready', checks: { database: false, model: 'unknown' } }, 503);
  }
});
// 遗留的 AuditGate 控制台还有用（红队、策略、逐用户计量），但它不是
// guiks-gd-content-moderation 的首页——打开根路径应当直接进稿件工作台。
app.get('/console', (c) => c.html(renderConsole({ targetLabel: config.targetLabel })));
app.get('/api/state', (c) => c.json(snapshot()));
app.get('/api/meta', (c) =>
  c.json({
    service: 'guiks-gd-content-moderation',
    mode: config.appMode,
    persistence: 'sqlite',
    model: usingMockUpstream() ? 'mock' : 'configured',
    failClosed: config.failClosed,
  }),
);

app.route('/', eventsRoutes);
app.route('/', gatewayRoutes);
app.route('/', targetRoutes);
app.route('/', monitorRoutes);
app.route('/', manuscriptRoutes);
app.route('/', workbenchRoutes);
app.route('/', redteamRoutes);
app.route('/', reportRoutes);
app.route('/', runtimeRoutes);
app.route('/', policyRoutes);

// Start only when run directly (not when imported by tests). pathToFileURL is
// what makes this work on Windows too — a Windows path never string-concats
// into a valid file:// URL, so `npm run dev` used to exit silently there.
const entryPoint = process.argv[1];
const isMain = entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href;
if (isMain) {
  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    // eslint-disable-next-line no-console
    console.log(
      `guiks-gd-content-moderation → http://localhost:${info.port}  ` +
        `[上游: ${usingMockUpstream() ? '内置受控 mock' : config.upstreamUrl}]`,
    );
  });

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
