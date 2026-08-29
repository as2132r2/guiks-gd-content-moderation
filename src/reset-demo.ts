/**
 * 数据清理（部署留底脚本）。
 *
 * ```bash
 * npm run reset:demo -- --yes              # 只清稿件，保留账号
 * npm run reset:demo -- --yes --accounts   # 连试用账号一起清
 * ```
 *
 * **必须显式带 `--yes`。** 这个脚本删的是整库的稿件，包括留痕与审核记录——
 * 责任链一旦删掉就找不回来了。不给确认参数就拒绝执行，是为了让「手滑」这件事
 * 不可能发生。
 *
 * 保留账号是默认行为：清数据是为了重播，重播不需要重建账号，
 * 而重建账号会把管理员改过的口令冲掉。
 */
import { pathToFileURL } from 'node:url';

import { config } from './config.js';
import { closeWorkflowRepository, getWorkflowRepository } from './db/repository.js';
import { SEED_ACCOUNTS } from './demo-dataset.js';

export interface ResetOptions {
  confirmed: boolean;
  accounts: boolean;
}

export function parseResetArguments(args: readonly string[]): ResetOptions {
  const known = new Set(['--yes', '--accounts']);
  for (const arg of args) {
    if (!known.has(arg)) throw new Error(`unknown option: ${arg}（用法：--yes [--accounts]）`);
  }
  return { confirmed: args.includes('--yes'), accounts: args.includes('--accounts') };
}

const log = (line: string) => process.stdout.write(`${line}\n`);

export function resetDemoData(options: ResetOptions): void {
  if (!options.confirmed) {
    throw new Error('拒绝执行：这会删除全部稿件与留痕。确认请加 --yes');
  }
  if (config.databasePath === ':memory:') {
    throw new Error('reset:demo requires a persistent DATABASE_PATH');
  }

  const repository = getWorkflowRepository();
  const removed = repository.deleteAllManuscripts();
  log(`已删除稿件 ${removed} 篇（连带产物、句子、审核记录与留痕）`);

  if (!options.accounts) {
    log('账号已保留。要一并删除请加 --accounts');
    return;
  }
  let deleted = 0;
  for (const account of SEED_ACCOUNTS) {
    if (repository.deleteUserByUsername(account.username)) deleted += 1;
  }
  log(`已删除试用账号 ${deleted} 个`);
}

function main(): void {
  try {
    resetDemoData(parseResetArguments(process.argv.slice(2)));
  } finally {
    closeWorkflowRepository();
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  try {
    main();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'reset failed';
    process.stderr.write(`reset:demo failed: ${message}\n`);
    process.exitCode = 1;
  }
}
