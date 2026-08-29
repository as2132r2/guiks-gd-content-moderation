/**
 * 试用数据播种（部署留底脚本）。
 *
 * ```bash
 * npm run seed:demo            # 开发 / demo
 * npm run seed:demo:prod       # 生产构建
 * ```
 *
 * **为什么走真实路由而不是直接写库**：稿件要经过入口准入、生成、预检、三审
 * 才会有留痕、句级来源和 AI 参与度。绕开路由直接插表，播出来的数据就和用户
 * 实际操作产生的不一样——**演示夹具一旦和真实流程不一致，就失去了它的全部
 * 意义**。所以这里用 `app.request()` 在进程内打自己的 API，不需要另起服务，
 * 也不需要网络。
 *
 * **幂等**：先清空稿件再重建。账号是 upsert，已存在就跳过。
 */
import { pathToFileURL } from 'node:url';

import { config } from './config.js';
import { closeWorkflowRepository, getWorkflowRepository } from './db/repository.js';
import {
  BOUNCE_REASON,
  REVISED_CLOSING,
  SEED_ACCOUNTS,
  SEED_MANUSCRIPTS,
  type SeedManuscript,
} from './demo-dataset.js';
import { app } from './index.js';

/** 试用账号的固定口令，写在用户手册里。生产部署请用 `SEED_PASSWORD` 覆盖。 */
export const DEFAULT_SEED_PASSWORD = 'gatekeeper-demo';

const log = (line: string) => process.stdout.write(`${line}\n`);

interface Session {
  cookie: string;
  displayName: string;
}

async function login(username: string, password: string): Promise<Session> {
  const response = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (response.status !== 200) {
    throw new Error(`login failed for ${username}: ${response.status} ${await response.text()}`);
  }
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
  if (!cookie) throw new Error(`login for ${username} returned no session cookie`);
  const body = (await response.json()) as { user: { displayName: string } };
  return { cookie, displayName: body.user.displayName };
}

function callerFor(session: Session) {
  return async (path: string, method = 'GET', body?: unknown) => {
    const response = await app.request(path, {
      method,
      headers: {
        cookie: session.cookie,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text}`);
    return text ? (JSON.parse(text) as unknown) : undefined;
  };
}

type Caller = ReturnType<typeof callerFor>;

/** 建账号。已存在就跳过——重复播种不该覆盖别人改过的口令。 */
function ensureAccounts(password: string): { created: number; existing: number } {
  const repository = getWorkflowRepository();
  let created = 0;
  let existing = 0;
  for (const account of SEED_ACCOUNTS) {
    if (repository.findStoredUserByUsername(account.username)) {
      existing += 1;
      continue;
    }
    repository.provisionProductionUser({
      username: account.username,
      displayName: account.displayName,
      password,
      roles: account.roles,
    });
    created += 1;
  }
  return { created, existing };
}

async function walk(call: Caller, seed: SeedManuscript): Promise<string> {
  const created = (await call('/api/workbench', 'POST', {
    title: seed.title,
    sourceType: seed.sourceType,
    coverageTopic: seed.coverageTopic,
    sourceText: seed.sourceText,
  })) as { manuscript: { id: string; status: string } };
  const id = created.manuscript.id;
  if (seed.stopAt === 'admission') return id;

  const move = (to: string, role: string, reason?: string) =>
    call(`/api/workbench/${id}/transition`, 'POST', { to, role, ...(reason ? { reason } : {}) });

  // 「要理由」那一档要先补依据才走得动。
  if (created.manuscript.status === 'admission-reason-required') {
    await move('admitted', 'editor', seed.reason ?? '已获授权发布，见当日通报。');
  }

  await move('generated', 'editor');
  if (seed.stopAt === 'generated') return id;

  // 改稿只在 generated / revision 允许（mutation-policy.ts），所以先改再预检。
  if (seed.revise) await reviseClosingSentence(call, id);

  await move('preflight', 'editor');
  if (seed.stopAt === 'preflight') return id;

  await move('first-review', 'editor');
  await move('second-review', 'editor');
  if (seed.stopAt === 'second-review') return id;

  if (seed.bounce) {
    // 退回统一落 `revision`（复核修改），编辑改完再走 revision → preflight
    // 重新预检——一次退回一步到位，不用点两次（轨道 A 的 5.10）。
    // 退回必须带理由，理由进审计；重走一轮，看板才有非零退回率。
    await move('revision', 'department-head', BOUNCE_REASON);
    // 系统要求退回后必须真改过内容才放行重新预检——空手走回去不算「复核修改」。
    await reviseClosingSentence(call, id, '经复核，相关数据已与发布口径核对一致。');
    await move('preflight', 'editor');
    await move('first-review', 'editor');
    await move('second-review', 'editor');
  }

  await move('final-review', 'department-head');
  await move('signed', 'supervising-leader');
  await move('published', 'supervising-leader');
  return id;
}

/** 只改末句收尾话——它本身不命中任何规则，改它不会顺手把禁用词一起改掉。 */
async function reviseClosingSentence(
  call: Caller,
  id: string,
  replacement: string = REVISED_CLOSING,
): Promise<void> {
  const view = (await call(`/api/workbench/${id}`)) as {
    artifacts: Array<{ artifact: { id: string }; segments: Array<{ text: string }> }>;
  };
  const artifact = view.artifacts[0];
  if (!artifact || artifact.segments.length === 0) return;
  const sentences = artifact.segments.map((segment) => segment.text);
  sentences[sentences.length - 1] = replacement;
  await call(`/api/workbench/${id}/artifacts/${artifact.artifact.id}/revise`, 'POST', {
    role: 'editor',
    content: sentences.join('\n'),
  });
}

export async function seedDemoData(password: string): Promise<void> {
  if (config.databasePath === ':memory:') {
    throw new Error('seed:demo requires a persistent DATABASE_PATH');
  }

  const accounts = ensureAccounts(password);
  log(`账号：新建 ${accounts.created}，已存在 ${accounts.existing}`);

  const removed = getWorkflowRepository().deleteAllManuscripts();
  if (removed > 0) log(`清空旧稿件 ${removed} 篇`);

  // 张敏持有全部三个流程角色，一个会话就能走完整条链。
  const call = callerFor(await login('zhangmin', password));

  for (const seed of SEED_MANUSCRIPTS) {
    await walk(call, seed);
    log(`  ✓ ${seed.label}　${seed.title}`);
  }

  const overview = (await call('/api/monitor/overview')) as {
    totals: { manuscripts: number; signed: number; traceEvents: number };
    overallAiShare: number | null;
  };
  log(
    `完成：稿件 ${overview.totals.manuscripts} 篇，已签发 ${overview.totals.signed}，` +
      `留痕 ${overview.totals.traceEvents} 条，全台 AI 参与度 ` +
      `${overview.overallAiShare == null ? '未测量' : `${(overview.overallAiShare * 100).toFixed(1)}%`}`,
  );
}

async function main(): Promise<void> {
  const password = process.env.SEED_PASSWORD?.trim() || DEFAULT_SEED_PASSWORD;
  try {
    await seedDemoData(password);
  } finally {
    closeWorkflowRepository();
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'seeding failed';
    process.stderr.write(`seed:demo failed: ${message}\n`);
    process.exitCode = 1;
  });
}
