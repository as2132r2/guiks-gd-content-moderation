// SSE stream to the console. Each connection gets its own queue so concurrent
// publishes never interleave partial frames.
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { subscribe, type StreamMessage } from '../lib/bus.js';

export const eventsRoutes = new Hono();

eventsRoutes.get('/events', (c) =>
  streamSSE(c, async (stream) => {
    const queue: StreamMessage[] = [];
    let wake: (() => void) | null = null;
    const unsub = subscribe((m) => {
      queue.push(m);
      wake?.();
    });

    stream.onAbort(() => {
      unsub();
      wake?.();
    });

    await stream.writeSSE({
      event: 'status',
      data: JSON.stringify({ state: 'idle', message: '监理台已就绪' }),
    });

    try {
      while (!stream.aborted) {
        if (queue.length === 0) {
          // wait for the next publish, or a 15s keepalive tick
          await new Promise<void>((resolve) => {
            wake = resolve;
            setTimeout(resolve, 15000);
          });
          wake = null;
          if (queue.length === 0 && !stream.aborted) {
            await stream.writeSSE({ event: 'ping', data: '1' });
          }
          continue;
        }
        const m = queue.shift()!;
        await stream.writeSSE({ event: m.name, data: JSON.stringify(m.data) });
      }
    } finally {
      unsub();
    }
  }),
);
