import { createMiddleware } from 'hono/factory';

import type { UserAccount } from '../domain/auth.js';
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
