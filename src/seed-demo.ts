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
 * **只增不删。** 播种不会碰库里已有的任何东西：账号已存在就跳过，稿件按标题
 * 判重、已播过就跳过。**要清库是另一条命令**（`npm run reset:demo -- --yes`），
 * 而且必须显式确认——播种和删数据是两件事，不能一个动作顺手把另一件也做了。
 */

import { config } from './config.js';
import { isDirectRun } from './lib/entrypoint.js';
import { closeWorkflowRepository, getWorkflowRepository } from './db/repository.js';
import {
  ALL_SEED_MANUSCRIPTS,
  BOUNCE_REASON,
  REVISED_CLOSING,
  SEED_ACCOUNTS,
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

export interface AccountOutcome {
  created: number;
  existing: number;
  /** 被 demo 账号占了名字、已重建的。 */
  replaced: number;
}

/**
 * 建账号。已存在就跳过——重复播种不该覆盖别人改过的口令。
 *
 * **除非它是 demo 账号。** 只要这个库被 `APP_MODE=demo` 跑过一次，
 * `ensureDemoUsers()` 就会用同样的用户名建出 `is_demo=1` 的账号；而生产登录
 * 明确拒绝 demo 账号（[auth.ts](routes/auth.ts)）。跳过它们的话，播种会在
 * 后面登录时挂掉，还报「用户名或密码不正确」——错得让人查不到方向。
 * 所以在生产模式下直接重建：一个登不进去的账号留着没有意义。
 */
function ensureAccounts(password: string): AccountOutcome {
  const repository = getWorkflowRepository();
  const outcome: AccountOutcome = { created: 0, existing: 0, replaced: 0 };

  for (const account of SEED_ACCOUNTS) {
    const stored = repository.findStoredUserByUsername(account.username);
    const unusableHere = stored && config.appMode === 'production' && stored.isDemo;

    if (stored && !unusableHere) {
      outcome.existing += 1;
      continue;
    }
    if (unusableHere) {
      repository.deleteUserByUsername(account.username);
      outcome.replaced += 1;
    } else {
      outcome.created += 1;
    }
    repository.provisionProductionUser({
      username: account.username,
      displayName: account.displayName,
      password,
      roles: account.roles,
    });
  }
  return outcome;
}

/**
 * 一篇稿件用到的三个操作者。
 *
 * `solo` 时三个指向同一个人（张敏一人多岗），`team` 时分给三个账号。
 * **分开不是为了好看**——监控看板的生产量那一栏按 `actor_user_id` 归并，
 * 全用一个账号播种，那一栏就只有一行，「认人不认角色」这句话在界面上看不出来。
 */
interface Crew {
  editor: Caller;
  head: Caller;
  leader: Caller;
}

/**
 * 这次要播的稿件 —— 全集减去库里已有的。
 *
 * 判重用标题。**只增不删**是定好的规矩：播种脚本永远不删别人的数据，
 * 重复跑一次应该是空操作，而不是把库推平重来。
 *
 * 抽成纯函数是为了能测——真跑一次播种需要一个持久库，测试里跑不了。
 */
export function pendingManuscripts(
  existingTitles: Iterable<string>,
  seeds: readonly SeedManuscript[] = ALL_SEED_MANUSCRIPTS,
): SeedManuscript[] {
  const existing = new Set(existingTitles);
  return seeds.filter((seed) => !existing.has(seed.title));
}

async function walk(crew: Crew, seed: SeedManuscript): Promise<string> {
  const call = crew.editor;
  const created = (await call('/api/workbench', 'POST', {
    title: seed.title,
    sourceType: seed.sourceType,
    coverageTopic: seed.coverageTopic,
    sourceText: seed.sourceText,
  })) as { manuscript: { id: string; status: string } };
  const id = created.manuscript.id;
  if (seed.stopAt === 'admission') return id;

  const move = (to: string, role: string, reason?: string) => {
    const as = role === 'department-head' ? crew.head : role === 'supervising-leader' ? crew.leader : call;
    return as(`/api/workbench/${id}/transition`, 'POST', { to, role, ...(reason ? { reason } : {}) });
  };

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
  log(
    `账号：新建 ${accounts.created}，已存在 ${accounts.existing}` +
      (accounts.replaced > 0 ? `，重建 ${accounts.replaced}（原为 demo 账号，生产下登不进去）` : ''),
  );

  const repository = getWorkflowRepository();
  const pending = pendingManuscripts(repository.listManuscriptTitles());
  const already = ALL_SEED_MANUSCRIPTS.length - pending.length;
  log(`稿件：待播 ${pending.length}，已存在 ${already}（只增不删，不动库里已有的数据）`);
  // 全都播过就什么也不做——但仍然把汇总打出来，运维要看的是「现在库里是什么样」。
  if (pending.length === 0) log('  （无需播种。要推倒重来请先跑 npm run reset:demo -- --yes）');

  // 张敏持有全部三个流程角色，一个会话就能走完整条链；另外三个各司其职。
  const zhangmin = callerFor(await login('zhangmin', password));
  const chenxue = callerFor(await login('chenxue', password));
  const lijianguo = callerFor(await login('lijianguo', password));
  const wangzhiyuan = callerFor(await login('wangzhiyuan', password));

  for (const seed of pending) {
    const editor = seed.author === 'chenxue' ? chenxue : zhangmin;
    // 独走只有张敏能做——三个流程角色她一个人全有。陈雪只是编辑，
    // 标了 solo 也得有人接审批，落回三人分工。
    const solo = seed.crew !== 'team' && seed.author !== 'chenxue';
    const crew: Crew = solo
      ? { editor, head: editor, leader: editor }
      : { editor, head: lijianguo, leader: wangzhiyuan };

    const id = await walk(crew, seed);
    // 走完再挪日期：挪的是整条时间线，篇内间隔不动（见 shiftManuscriptHistory）。
    if (seed.dayOffset) repository.shiftManuscriptHistory(id, seed.dayOffset);
    log(`  ✓ ${seed.label}　${seed.title}`);
  }

  const overview = (await zhangmin('/api/monitor/overview')) as {
    totals: { manuscripts: number; signed: number; traceEvents: number };
    overallAiShare: number | null;
  };
  log(
    `完成：全库稿件 ${overview.totals.manuscripts} 篇，已签发 ${overview.totals.signed}，` +
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

if (isDirectRun(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'seeding failed';
    process.stderr.write(`seed:demo failed: ${message}\n`);
    process.exitCode = 1;
  });
}
