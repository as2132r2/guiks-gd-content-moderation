import { generateSignedCookie } from 'hono/cookie';
import { describe, expect, it } from 'vitest';

import { app } from '../src/index.js';
import {
  config,
  demoLoginEnabledFor,
  sessionSecretReadyFor,
} from '../src/config.js';
import { getWorkflowRepository } from '../src/db/repository.js';
import { parseRolesJson } from '../src/domain/auth.js';
import { SESSION_COOKIE } from '../src/lib/session.js';
import { authenticatedRequest, loginAs } from './helpers/auth.js';

const jsonPost = (path: string, body: unknown, cookie?: string) => {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (cookie) headers.set('cookie', cookie);
  return app.request(path, { method: 'POST', headers, body: JSON.stringify(body) });
};

describe('account authentication', () => {
  it('requires authentication for both workflow API surfaces', async () => {
    expect((await app.request('/api/workbench')).status).toBe(401);
    expect((await app.request('/api/manuscripts')).status).toBe(401);
    expect(await (await app.request('/api/workbench')).json()).toMatchObject({
      error: 'authentication_required',
    });
  });

  it('supports password login and returns the authoritative account roles', async () => {
    const login = await jsonPost('/api/auth/login', {
      username: 'zhangmin',
      password: 'gatekeeper-demo',
    });
    expect(login.status).toBe(200);
    expect(await login.clone().json()).toMatchObject({
      user: {
        id: 'user_demo_zhangmin',
        username: 'zhangmin',
        displayName: '张敏',
        roles: ['editor', 'department-head', 'supervising-leader'],
      },
    });
    const setCookie = login.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).not.toContain('Secure');

    const cookie = setCookie.split(';', 1)[0]!;
    const me = await authenticatedRequest(app, cookie)('/api/auth/me');
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ user: { id: 'user_demo_zhangmin' } });
  });

  it('does not reveal whether an account exists or is disabled', async () => {
    const wrongPassword = await jsonPost('/api/auth/login', {
      username: 'zhangmin',
      password: 'definitely-wrong',
    });
    const unknown = await jsonPost('/api/auth/login', {
      username: 'nobody',
      password: 'definitely-wrong',
    });
    expect(wrongPassword.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrongPassword.json()).toMatchObject({ error: 'invalid_credentials' });
    expect(await unknown.json()).toMatchObject({ error: 'invalid_credentials' });

    const repository = getWorkflowRepository();
    repository.setUserDisabled('user_demo_lijianguo', true);
    const disabled = await jsonPost('/api/auth/login', { username: 'lijianguo', demo: true });
    expect(disabled.status).toBe(401);
    expect(await disabled.json()).toMatchObject({ error: 'invalid_credentials' });
    repository.setUserDisabled('user_demo_lijianguo', false);
  });

  it('rejects tampered and server-expired signed cookies', async () => {
    const cookie = await loginAs(app);
    const tampered = `${cookie}x`;
    expect((await authenticatedRequest(app, tampered)('/api/auth/me')).status).toBe(401);

    const expiredValue = Buffer.from(
      JSON.stringify({
        userId: 'user_demo_zhangmin',
        sessionVersion: getWorkflowRepository().findUserById('user_demo_zhangmin')!.sessionVersion,
        expiresAt: Date.now() - 1,
      }),
      'utf8',
    ).toString('base64url');
    const expiredCookie = (
      await generateSignedCookie(SESSION_COOKIE, expiredValue, config.sessionSecret, { path: '/' })
    ).split(';', 1)[0]!;
    expect((await authenticatedRequest(app, expiredCookie)('/api/auth/me')).status).toBe(401);
  });

  it('invalidates copied cookies on logout and keeps logout idempotent', async () => {
    const cookie = await loginAs(app);
    const request = authenticatedRequest(app, cookie);
    expect((await request('/api/auth/logout', { method: 'POST' })).status).toBe(204);
    expect((await request('/api/auth/me')).status).toBe(401);
    expect((await app.request('/api/auth/logout', { method: 'POST' })).status).toBe(204);
  });

  it('fails closed for corrupt roles and production authentication settings', () => {
    expect(parseRolesJson('[]')).toBeUndefined();
    expect(parseRolesJson('["editor","unknown"]')).toBeUndefined();
    expect(parseRolesJson('{"role":"editor"}')).toBeUndefined();
    expect(parseRolesJson('["editor","editor"]')).toEqual(['editor']);
    expect(sessionSecretReadyFor('production', '')).toBe(false);
    expect(sessionSecretReadyFor('production', 'short')).toBe(false);
    expect(
      sessionSecretReadyFor('production', 'gatekeeper-demo-session-secret-change-me'),
    ).toBe(false);
    expect(sessionSecretReadyFor('production', 'x'.repeat(32))).toBe(false);
    expect(sessionSecretReadyFor('production', `base64:${Buffer.alloc(32).toString('base64')}`)).toBe(
      false,
    );
    expect(
      sessionSecretReadyFor(
        'production',
        `base64:${Buffer.from('abcdefghijklmnopqrstuvwxyz123456').toString('base64')}`,
      ),
    ).toBe(false);
    expect(
      sessionSecretReadyFor(
        'production',
        `base64:${Buffer.from(
          '9bb9e9de92b695d006ef87ad9fdb3d11bc9961d37142637c3a711eb734a0a04b',
          'hex',
        ).toString('base64')}`,
      ),
    ).toBe(true);
    expect(demoLoginEnabledFor('production')).toBe(false);
  });
});

describe('fixed role authorization', () => {
  it('treats requested roles as intent and rejects roles the account does not hold', async () => {
    const editor = authenticatedRequest(app, await loginAs(app, 'zhangmin'));
    const created = await editor('/api/workbench', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '角色校验稿',
        sourceType: 'notice',
        sourceText: '模拟素材：县里召开工作会议。',
      }),
    });
    const id = ((await created.json()) as { manuscript: { id: string } }).manuscript.id;

    const departmentHead = authenticatedRequest(app, await loginAs(app, 'lijianguo'));
    const escalated = await departmentHead(`/api/workbench/${id}/transition`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'generated', role: 'editor' }),
    });
    expect(escalated.status).toBe(403);
    expect(await escalated.json()).toMatchObject({ error: 'role_not_allowed' });

    const supervisingLeader = authenticatedRequest(app, await loginAs(app, 'wangzhiyuan'));
    const impersonatedHead = await supervisingLeader(`/api/workbench/${id}/transition`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'generated', role: 'department-head' }),
    });
    expect(impersonatedHead.status).toBe(403);
    expect(await impersonatedHead.json()).toMatchObject({ error: 'role_not_allowed' });

    const stationLeader = authenticatedRequest(app, await loginAs(app, 'stationadmin'));
    expect((await stationLeader('/api/workbench')).status).toBe(200);
    const stationWrite = await stationLeader('/api/workbench', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '越权稿', sourceType: 'notice', sourceText: '模拟素材。' }),
    });
    expect(stationWrite.status).toBe(403);
    const stationFoundationWrite = await stationLeader('/api/manuscripts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '底层越权稿',
        sourceType: 'notice',
        sourceText: '模拟素材。',
      }),
    });
    expect(stationFoundationWrite.status).toBe(403);
    expect(await stationFoundationWrite.json()).toMatchObject({ error: 'role_not_allowed' });
  });

  it('ignores a forged actor and records the stable authenticated user id', async () => {
    const request = authenticatedRequest(app, await loginAs(app, 'zhangmin'));
    const created = await request('/api/workbench', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '稳定身份稿',
        sourceType: 'notice',
        sourceText: '模拟素材：县里召开会议。',
      }),
    });
    const id = ((await created.json()) as { manuscript: { id: string } }).manuscript.id;
    for (const status of ['generated', 'preflight', 'first-review']) {
      const transition = await request(`/api/manuscripts/${id}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status, role: 'editor' }),
      });
      expect(transition.status, status).toBe(200);
    }
    const review = await request(`/api/manuscripts/${id}/reviews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        stage: 'editor',
        decision: 'approved',
        actor: '伪造的其他人',
      }),
    });
    expect(review.status).toBe(201);
    expect(await review.json()).toMatchObject({
      review: { actor: '编辑·张敏', actorUserId: 'user_demo_zhangmin' },
    });
  });
});
