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
      // A slow or backgrounded browser must not grow an unbounded queue.
      if (queue.length > 200) queue.splice(0, queue.length - 200);
      wake?.();
    });

    stream.onAbort(() => {
      unsub();
      wake?.();
    });

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
