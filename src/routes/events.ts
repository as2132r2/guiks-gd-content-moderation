// SSE stream to the console. Each connection gets its own queue so concurrent
// publishes never interleave partial frames.
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { streamSSE } from 'hono/streaming';
import { hasPermission } from '../domain/permissions.js';
import { subscribe, type StreamMessage } from '../lib/bus.js';
import { readSessionUser } from '../lib/session.js';
import { requireAuth, type AuthEnv } from '../middleware/auth.js';

export const eventsRoutes = new Hono<AuthEnv>();

export const requireAuditRead = createMiddleware<AuthEnv>(async (c, next) => {
  if (!hasPermission(c.get('currentUser'), 'audit:read')) {
    return c.json({ error: 'role_not_allowed' }, 403);
  }
  await next();
});

eventsRoutes.get('/events', requireAuth, requireAuditRead, (c) =>
  streamSSE(c, async (stream) => {
    const queue: StreamMessage[] = [];
    let wake: (() => void) | null = null;
    const unsub = subscribe((m) => {
      queue.push(m);
      // A slow or backgrounded browser must not grow an unbounded queue.
      if (queue.length > 200) queue.splice(0, queue.length - 200);
      wake?.();
    });

    // The middleware proves the session only at connection time. Re-read the
    // signed cookie and authoritative user row before every frame so logout,
    // disablement, role changes, and session expiry also revoke an open stream.
    const stillAuthorized = async (): Promise<boolean> => {
      const user = await readSessionUser(c);
      return Boolean(user && hasPermission(user, 'audit:read'));
    };

    stream.onAbort(() => {
      unsub();
      wake?.();
    });

    if (!(await stillAuthorized())) return;
    await stream.writeSSE({
      event: 'status',
      data: JSON.stringify({ state: 'idle', message: '服务已就绪' }),
      retry: 3000,
    });

    try {
      while (!stream.aborted) {
        if (queue.length === 0) {
          // wait for the next publish, or a 15s keepalive tick
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 15000);
            wake = () => {
              clearTimeout(timer);
              resolve();
            };
          });
          wake = null;
          if (queue.length === 0 && !stream.aborted) {
            if (!(await stillAuthorized())) return;
            await stream.writeSSE({ event: 'ping', data: '1' });
          }
          continue;
        }
        const m = queue.shift()!;
        if (!(await stillAuthorized())) return;
        await stream.writeSSE({ event: m.name, data: JSON.stringify(m.data) });
      }
    } finally {
      unsub();
    }
  }),
);
