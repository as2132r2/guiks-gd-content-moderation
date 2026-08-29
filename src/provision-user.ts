
import { config } from './config.js';
import { closeWorkflowRepository, getWorkflowRepository } from './db/repository.js';
import { isSystemRole, type SystemRole } from './domain/contracts.js';
import { isDirectRun } from './lib/entrypoint.js';

export interface ProvisionArguments {
  username: string;
  displayName: string;
  roles: SystemRole[];
}

export function parseProvisionArguments(args: string[]): ProvisionArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag || !['--username', '--display-name', '--roles'].includes(flag) || !value) {
      throw new Error('usage: --username NAME --display-name NAME --roles ROLE[,ROLE]');
    }
    if (values.has(flag)) throw new Error(`duplicate option: ${flag}`);
    values.set(flag, value);
  }
  const username = values.get('--username');
  const displayName = values.get('--display-name');
  const rawRoles = values.get('--roles');
  if (!username || !displayName || !rawRoles) {
    throw new Error('usage: --username NAME --display-name NAME --roles ROLE[,ROLE]');
  }
  const roles = rawRoles.split(',').map((role) => role.trim());
  if (
    roles.length === 0 ||
    roles.some((role) => !isSystemRole(role)) ||
    new Set(roles).size !== roles.length
  ) {
    throw new Error('roles must be a non-empty, duplicate-free list of system roles');
  }
  return { username, displayName, roles: roles as SystemRole[] };
}

const stripOneLineEnding = (value: string): string => value.replace(/\r?\n$/, '');

async function readPipedPassword(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return stripOneLineEnding(Buffer.concat(chunks).toString('utf8'));
}

async function readHiddenLine(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('hidden interactive input is unavailable');
  }
  process.stderr.write(prompt);
  const previousRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  let value = '';
  try {
    return await new Promise<string>((resolve, reject) => {
      const onData = (chunk: string) => {
        for (const character of chunk) {
          if (character === '\u0003') {
            process.stdin.off('data', onData);
            reject(new Error('cancelled'));
            return;
          }
          if (character === '\r' || character === '\n') {
            process.stdin.off('data', onData);
            process.stderr.write('\n');
            resolve(value);
            return;
          }
          if (character === '\b' || character === '\u007f') value = value.slice(0, -1);
          else value += character;
        }
      };
      process.stdin.on('data', onData);
    });
  } finally {
    process.stdin.setRawMode(Boolean(previousRaw));
    process.stdin.pause();
  }
}

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) return readPipedPassword();
  const password = await readHiddenLine('Password: ');
  const confirmation = await readHiddenLine('Confirm password: ');
  if (password !== confirmation) throw new Error('password confirmation does not match');
  return password;
}

async function main(): Promise<void> {
  if (config.appMode !== 'production') {
    throw new Error('provision:user requires APP_MODE=production');
  }
  if (config.databasePath === ':memory:') {
    throw new Error('provision:user requires a persistent DATABASE_PATH');
  }
  const options = parseProvisionArguments(process.argv.slice(2));
  const password = await readPassword();
  try {
    const user = getWorkflowRepository().provisionProductionUser({ ...options, password });
    process.stdout.write(
      `${JSON.stringify({ id: user.id, username: user.username, roles: user.roles })}\n`,
    );
  } finally {
    closeWorkflowRepository();
  }
}

if (isDirectRun(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'provisioning failed';
    process.stderr.write(`provision:user failed: ${message}\n`);
    process.exitCode = 1;
  });
}
