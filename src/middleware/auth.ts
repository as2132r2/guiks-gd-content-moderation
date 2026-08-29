import { createMiddleware } from 'hono/factory';

import type { UserAccount } from '../domain/auth.js';
import { hasPermission } from '../domain/permissions.js';
import { readSessionUser } from '../lib/session.js';

export type AuthEnv = {
  Variables: {
    currentUser: UserAccount;
  };
};

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const user = await readSessionUser(c);
  if (!user) {
    return c.json(
      { error: 'authentication_required', message: '请先登录后再继续。' },
      401,
    );
  }
  c.set('currentUser', user);
  await next();
});

/**
 * 页面守卫：匿名跳登录、无 `audit:read` 则 403。
 *
 * 和接口的 `requireAuth` 分开，是因为两者对匿名访问的正确反应不同——接口该回
 * 401 交给前端处理，页面该把人直接送去登录页，别让他对着空壳等 JS 把自己弹走。
 * 写法与 `/console`、`/monitor` 取齐。
 */
export const requirePageAuth = (path: string) =>
  createMiddleware<AuthEnv>(async (c, next) => {
    const user = await readSessionUser(c);
    if (!user) return c.redirect(`/login?next=${path}`);
    if (!hasPermission(user, 'audit:read')) return c.json({ error: 'role_not_allowed' }, 403);
    c.set('currentUser', user);
    await next();
  });
