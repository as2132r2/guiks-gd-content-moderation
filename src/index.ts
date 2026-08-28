import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { config, usingMockUpstream } from './config.js';
import { snapshot } from './lib/store.js';
import { eventsRoutes } from './routes/events.js';
import { gatewayRoutes } from './routes/gateway.js';
import { monitorRoutes } from './routes/monitor.js';
import { policyRoutes } from './routes/policy.js';
import { redteamRoutes } from './routes/redteam.js';
import { reportRoutes } from './routes/report.js';
import { runtimeRoutes } from './routes/runtime.js';
import { targetRoutes } from './routes/target.js';
import { renderConsole } from './views/console.js';

export const app = new Hono();

app.get('/healthz', (c) => c.text('ok'));
app.get('/', (c) => c.html(renderConsole({ targetLabel: config.targetLabel })));
app.get('/api/state', (c) => c.json(snapshot()));

app.route('/', eventsRoutes);
app.route('/', gatewayRoutes);
app.route('/', targetRoutes);
app.route('/', monitorRoutes);
app.route('/', redteamRoutes);
app.route('/', reportRoutes);
app.route('/', runtimeRoutes);
app.route('/', policyRoutes);

// Start only when run directly (not when imported by tests).
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  serve({ fetch: app.fetch, port: config.port }, (info) => {
    // eslint-disable-next-line no-console
    console.log(
      `guiks-gd-content-moderation → http://localhost:${info.port}  ` +
        `[上游: ${usingMockUpstream() ? '内置受控 mock' : config.upstreamUrl}]`,
    );
  });
}
