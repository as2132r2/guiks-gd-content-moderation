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
    if (config.appMode === 'production' && !config.cookieSecure) {
      // 明确说一次。这是为纯 HTTP 部署开的口子，上了 HTTPS 就该关掉。
      // eslint-disable-next-line no-console
      console.warn(
        '  ⚠ ALLOW_INSECURE_COOKIE=true：会话 cookie 不带 Secure，仅适用于纯 HTTP 部署。上 HTTPS 后请去掉这一项。',
      );
    }
    },
  );

  let shuttingDown = false;
  /**
   * 优雅停机。
   *
   * **`server.close()` 只是停止接受新连接，它会一直等已有连接自己结束。**
   * `/events` 的 SSE 是长连接，谁开着工作台或监控页，这一等就是无限期——于是
   * 每次 `systemctl restart` 都熬满 5 秒被强杀、以退出码 1 收场，systemd 记一条
   * `Failed with result 'exit-code'`。而运维手册把「systemd 服务失败」列为告警项，
   * 也就是说**每次正常部署都会打一次假警报**，真出事那天反而被淹掉。
   *
   * 所以分三档：先断空闲连接，再给在途请求一点时间后强断长连接，最后才是兜底。
   * 断 SSE 是安全的——[events.ts](routes/events.ts) 给浏览器下发了 `retry: 3000`，
   * EventSource 会自己重连。
   */
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;

    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      closeWorkflowRepository();
      process.exit(code);
    };

    // 兜底：连强断都没能收尾，那是真卡住了，退 1 让告警响。
    const hardExit = setTimeout(() => {
      if ('closeAllConnections' in server && typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      finish(1);
    }, 5000);
    hardExit.unref();

    server.close(() => {
      clearTimeout(hardExit);
      finish(0);
    });

    // 空闲的 keep-alive（nginx 常年挂着几条）先断，它们没有在途请求可等。
    if ('closeIdleConnections' in server && typeof server.closeIdleConnections === 'function') {
      server.closeIdleConnections();
    }
    // 长连接（SSE）等不到自己结束。留一点时间给在途的普通请求写完响应，然后强断。
    const cutLongLived = setTimeout(() => {
      if ('closeAllConnections' in server && typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
    }, 1500);
    cutLongLived.unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
