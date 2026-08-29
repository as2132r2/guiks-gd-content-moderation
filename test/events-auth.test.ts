import { describe, expect, it } from 'vitest';

import { app } from '../src/index.js';
import { publish } from '../src/lib/bus.js';
import { authenticatedRequest, loginAs } from './helpers/auth.js';

describe('event stream authentication', () => {
  it('rejects anonymous subscribers before opening a stream', async () => {
    const response = await app.request('/events');

    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toMatchObject({ error: 'authentication_required' });
  });

  it('keeps the existing SSE stream available to an authenticated browser', async () => {
    const request = authenticatedRequest(app, await loginAs(app));
    const controller = new AbortController();
    const response = await request('/events', { signal: controller.signal });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.body).not.toBeNull();

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const firstChunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timed out waiting for the first SSE frame')), 1_000);
        }),
      ]);
      const frame = decoder.decode(firstChunk.value, { stream: !firstChunk.done });

      expect(firstChunk.done).toBe(false);
      expect(frame).toContain('event: status');
      expect(frame).toContain('"state":"idle"');
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
      await reader.cancel();
    }
  });

  it('revokes an already-open stream after logout before sending queued events', async () => {
    const cookie = await loginAs(app);
    const request = authenticatedRequest(app, cookie);
    const controller = new AbortController();
    const response = await request('/events', { signal: controller.signal });

    expect(response.status).toBe(200);
    expect(response.body).not.toBeNull();

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const firstChunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timed out waiting for the first SSE frame')), 1_000);
        }),
      ]);
      if (timer) clearTimeout(timer);
      expect(decoder.decode(firstChunk.value)).toContain('event: status');

      const logout = await request('/api/auth/logout', { method: 'POST' });
      expect(logout.status).toBe(204);
      expect((await request('/api/auth/me')).status).toBe(401);

      const marker = 'must-not-cross-revoked-stream';
      publish('audit', { body: marker });

      const afterLogout = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('revoked SSE stream did not close')), 1_000);
        }),
      ]);
      expect(decoder.decode(afterLogout.value)).not.toContain(marker);
      expect(afterLogout.done).toBe(true);
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
      await reader.cancel().catch(() => undefined);
    }
  });
});
