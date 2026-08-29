/**
 * 遗留面的鉴权回归。
 *
 * 这六组路由只在 `APP_MODE=demo` 下挂载，而线上就是 demo——它们曾经一个
 * `requireAuth` 都没有，公网直连即 200。其中 `/api/redteam/run`、
 * `/api/runtime/chat`、`/api/runtime/simulate`、`/target/chat`、
 * `/api/monitor/start` 每一次调用都会真的打模型，匿名可触发等于把额度敞开，
 * 违反 CLAUDE.md 硬约束 6「真实模型不裸奔」。
 *
 * 这个文件的作用是让那个洞回不来。
 */
import { describe, expect, it } from 'vitest';

import { app } from '../src/index.js';
import { authenticatedRequest, loginAs } from './helpers/auth.js';

/** 匿名必须 401 的接口。会烧额度的都在这里。 */
const GUARDED_APIS: ReadonlyArray<{ path: string; method: 'GET' | 'POST' | 'PUT' }> = [
  { path: '/api/policy', method: 'GET' },
  { path: '/api/policy/presets', method: 'GET' },
  { path: '/api/policy', method: 'PUT' },
  { path: '/api/policy/preset', method: 'POST' },
  { path: '/api/usage', method: 'GET' },
  { path: '/api/runtime/chat', method: 'POST' },
  { path: '/api/runtime/simulate', method: 'POST' },
  { path: '/api/redteam/run', method: 'POST' },
  { path: '/api/monitor/start', method: 'POST' },
  { path: '/target/info', method: 'GET' },
  { path: '/target/chat', method: 'POST' },
];

/** 匿名必须跳登录的页面。 */
const GUARDED_PAGES = ['/policy', '/runtime', '/report'] as const;

describe('legacy demo surfaces require a session', () => {
  it.each(GUARDED_APIS)('rejects anonymous $method $path', async ({ path, method }) => {
    const response = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(method === 'GET' ? {} : { body: '{}' }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'authentication_required' });
  });

  it.each(GUARDED_PAGES)('sends an anonymous %s visit to the login page', async (path) => {
    const response = await app.request(path);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`/login?next=${path}`);
  });

  it('keeps the pages reachable once signed in', async () => {
    const request = authenticatedRequest(app, await loginAs(app));

    for (const path of GUARDED_PAGES) {
      const response = await request(path);
      expect(response.status, path).toBe(200);
    }
  });

  it('keeps the read APIs working once signed in', async () => {
    const request = authenticatedRequest(app, await loginAs(app));

    expect((await request('/api/policy')).status).toBe(200);
    expect((await request('/api/usage')).status).toBe(200);
    expect((await request('/target/info')).status).toBe(200);
  });
});
