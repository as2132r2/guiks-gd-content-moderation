import type { Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';

import { config } from '../config.js';
import { getWorkflowRepository } from '../db/repository.js';
import type { UserAccount } from '../domain/auth.js';

export const SESSION_COOKIE = 'gatekeeper_session';

interface SessionPayload {
  userId: string;
  sessionVersion: number;
  expiresAt: number;
}

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'Lax' as const,
  path: '/',
  secure: config.appMode === 'production',
});

const encodePayload = (payload: SessionPayload): string =>
  Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

function decodePayload(value: string): SessionPayload | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const payload = parsed as Record<string, unknown>;
    if (
      typeof payload.userId !== 'string' ||
      payload.userId.length === 0 ||
      !Number.isInteger(payload.sessionVersion) ||
      (payload.sessionVersion as number) < 1 ||
      !Number.isInteger(payload.expiresAt)
    ) {
      return undefined;
    }
    return {
      userId: payload.userId,
      sessionVersion: payload.sessionVersion as number,
      expiresAt: payload.expiresAt as number,
    };
  } catch {
    return undefined;
  }
}

export async function readSessionUser(c: Context): Promise<UserAccount | undefined> {
  if (!config.sessionSecretReady || !config.sessionSecret) return undefined;
  const value = await getSignedCookie(c, config.sessionSecret, SESSION_COOKIE);
  if (typeof value !== 'string') return undefined;
  const payload = decodePayload(value);
  if (!payload || payload.expiresAt <= Date.now()) return undefined;

  const user = getWorkflowRepository().findUserById(payload.userId);
  if (
    !user ||
    user.disabled ||
    user.sessionVersion !== payload.sessionVersion ||
    (config.appMode === 'production' && user.isDemo)
  ) {
    return undefined;
  }
  return user;
}

export async function writeSession(c: Context, user: UserAccount): Promise<void> {
  if (!config.sessionSecretReady || !config.sessionSecret) {
    throw new Error('session secret is not configured');
  }
  const maxAge = config.sessionHours * 60 * 60;
  await setSignedCookie(
    c,
    SESSION_COOKIE,
    encodePayload({
      userId: user.id,
      sessionVersion: user.sessionVersion,
      expiresAt: Date.now() + maxAge * 1_000,
    }),
    config.sessionSecret,
    { ...cookieOptions(), maxAge },
  );
}

export function clearSession(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, cookieOptions());
}
