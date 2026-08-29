import { Hono } from 'hono';
import { z } from 'zod';

import { config } from '../config.js';
import { getWorkflowRepository } from '../db/repository.js';
import { dummyPasswordHash, verifyPassword, type StoredUserAccount } from '../domain/auth.js';
import { clearSession, readSessionUser, writeSession } from '../lib/session.js';
import { requireAuth, type AuthEnv } from '../middleware/auth.js';
import { renderLogin } from '../views/login-view.js';

const loginSchema = z.object({
  username: z.string().trim().min(1).max(100).transform((value) => value.toLowerCase()),
  password: z.string().max(500).optional(),
  demo: z.boolean().optional(),
});

const publicUser = (user: StoredUserAccount | NonNullable<Awaited<ReturnType<typeof readSessionUser>>>) => ({
  id: user.id,
  username: user.username,
  displayName: user.displayName,
  roles: user.roles,
});

export const authRoutes = new Hono<AuthEnv>();

authRoutes.get('/login', async (c) => {
  if (await readSessionUser(c)) return c.redirect('/');
  return c.html(
    renderLogin({
      demoLoginEnabled: config.demoLoginEnabled,
      next: c.req.query('next'),
    }),
  );
});

authRoutes.post('/api/auth/login', async (c) => {
  if (!config.sessionSecretReady) {
    return c.json({ error: 'authentication_unavailable', message: '登录服务尚未正确配置。' }, 503);
  }
  const parsed = loginSchema.safeParse(await c.req.json<unknown>().catch(() => undefined));
  if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
  if (parsed.data.demo && !config.demoLoginEnabled) {
    return c.json({ error: 'demo_login_disabled', message: '当前环境不允许快捷登录。' }, 403);
  }

  const user = getWorkflowRepository().findStoredUserByUsername(parsed.data.username);
  let valid = false;
  if (parsed.data.demo) {
    valid = Boolean(user && !user.disabled);
  } else {
    valid = await verifyPassword(parsed.data.password ?? '', user?.passwordHash ?? dummyPasswordHash);
    valid =
      valid &&
      Boolean(user && !user.disabled && (config.appMode !== 'production' || !user.isDemo));
  }
  if (!valid || !user) {
    return c.json({ error: 'invalid_credentials', message: '用户名或密码不正确。' }, 401);
  }

  await writeSession(c, user);
  return c.json({ user: publicUser(user) });
});

authRoutes.post('/api/auth/logout', async (c) => {
  const user = await readSessionUser(c);
  if (user) getWorkflowRepository().incrementSessionVersion(user.id);
  clearSession(c);
  return c.body(null, 204);
});

authRoutes.get('/api/auth/me', requireAuth, (c) =>
  c.json({ user: publicUser(c.get('currentUser')) }),
);
