import { describe, expect, it } from 'vitest';

import { app } from '../src/index.js';
import { authenticatedRequest, loginAs } from './helpers/auth.js';

describe('legacy audit read authentication', () => {
  it('rejects anonymous state reads', async () => {
    const response = await app.request('/api/state');

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'authentication_required' });
  });

  it.each(['zhangmin', 'stationadmin'])('allows %s to read legacy audit state', async (username) => {
    const request = authenticatedRequest(app, await loginAs(app, username));
    const response = await request('/api/state');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ audits: expect.any(Array) });
  });

  it('redirects an anonymous console visit to its login return path', async () => {
    const response = await app.request('/console');

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/login?next=/console');
  });

  it('keeps the console available after login', async () => {
    const request = authenticatedRequest(app, await loginAs(app));
    const response = await request('/console');

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('id="audit-stream"');
  });
});
