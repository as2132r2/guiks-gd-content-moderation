import {
  randomBytes,
  scrypt as nodeScrypt,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

import { isSystemRole, type SystemRole } from './contracts.js';

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 64 * 1024 * 1024;

const deriveKey = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    nodeScrypt(
      password,
      salt,
      KEY_LENGTH,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: MAX_MEMORY },
      (error, derived) => (error ? reject(error) : resolve(derived)),
    );
  });

export interface UserAccount {
  id: string;
  username: string;
  displayName: string;
  roles: SystemRole[];
  isDemo: boolean;
  disabled: boolean;
  sessionVersion: number;
  createdAt: number;
  updatedAt: number;
}

export interface StoredUserAccount extends UserAccount {
  passwordHash: string;
}

function encodePasswordHash(password: string, salt: Buffer): string {
  const derived = scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAX_MEMORY,
  });
  return [
    'scrypt',
    'v1',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

export function hashPassword(password: string): string {
  if (password.length < 8) throw new Error('password must be at least 8 characters');
  return encodePasswordHash(password, randomBytes(16));
}

/** A fixed-cost comparison target keeps unknown usernames from taking a fast path. */
export const dummyPasswordHash = encodePasswordHash(
  'invalid-account-password',
  Buffer.from('gatekeeper-dummy-salt', 'utf8').subarray(0, 16),
);

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 7 || parts[0] !== 'scrypt' || parts[1] !== 'v1') return false;

  const n = Number(parts[2]);
  const r = Number(parts[3]);
  const p = Number(parts[4]);
  if (n !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) return false;

  try {
    const salt = Buffer.from(parts[5]!, 'base64url');
    const expected = Buffer.from(parts[6]!, 'base64url');
    if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
    const derived = await deriveKey(password, salt);
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** Roles are authoritative. Corruption is an authentication failure, never editor fallback. */
export function parseRolesJson(value: string): SystemRole[] | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isSystemRole)) {
      return undefined;
    }
    return [...new Set(parsed)];
  } catch {
    return undefined;
  }
}
