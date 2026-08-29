/**
 * 生产构建的路由面。
 *
 * 遗留的六组路由（策略 / 靶场 / 红队 / runtime / 报告 / 内存态播种）**一个
 * `requireAuth` 都没有**。它们在 `APP_MODE=demo` 下是本地工具，公网上就是
 * 无凭据可达的接口，其中三个还会消耗真实模型额度——所以生产下根本不挂载。
 *
 * 这个文件钉的是那条边界：`/api/demo/*` 与遗留页面在生产下必须不存在，而
 * 只读的示例素材必须存在且要登录。**「填入示例通稿」是手册第 2 步就要点的
 * 按钮**，它跟着 demo 路由组一起消失过一次，这里不让它再消失。
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { MAIN_NOTICE } from '../src/routes/demo-fixtures.js';

const strongSecret = () => `base64:${randomBytes(32).toString('base64')}`;

type App = { request: (input: string, init?: RequestInit) => Response | Promise<Response> };

let app: App;
let closeRepository: () => void;
let cookie: string;

beforeAll(async () => {
  vi.resetModules();
  vi.stubEnv('APP_MODE', 'production');
  vi.stubEnv('ALLOW_MOCK_UPSTREAM', 'true');
  vi.stubEnv('DATABASE_PATH', ':memory:');
  vi.stubEnv('SEED_DEMO_USERS', 'false');
  vi.stubEnv('SESSION_SECRET', strongSecret());
  vi.stubEnv('GATEWAY_TOKEN', strongSecret());

  const [indexModule, repositoryModule] = await Promise.all([
    import('../src/index.js'),
    import('../src/db/repository.js'),
  ]);
  app = indexModule.app as App;
  closeRepository = repositoryModule.closeWorkflowRepository;

  repositoryModule.getWorkflowRepository().provisionProductionUser({
    username: 'prod-editor',
    displayName: '生产编辑',
    password: 'production-password',
    roles: ['editor'],
  });
  const login = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'prod-editor', password: 'production-password' }),
  });
  expect(login.status).toBe(200);
  cookie = login.headers.get('set-cookie')!.split(';', 1)[0]!;
});

afterAll(() => {
  closeRepository();
  vi.unstubAllEnvs();
  vi.resetModules();
});

const asUser = (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set('cookie', cookie);
  return app.request(path, { ...init, headers });
};

describe('生产下不该存在的端点', () => {
  // 清空整库的两个。它们留在生产里，一次误点就带走试用者的稿件和责任链。
  it.each([
    ['POST', '/api/demo/reset'],
    ['POST', '/api/demo/seed'],
  ])('%s %s 不存在', async (method, path) => {
    expect((await asUser(path, { method })).status).toBe(404);
  });

  // 遗留六组。带凭据都打不通，才说明是没挂载，而不是碰巧被鉴权挡住。
  it.each([
    ['GET', '/policy'],
    ['GET', '/api/policy'],
    ['GET', '/api/policy/presets'],
    ['GET', '/runtime'],
    ['GET', '/api/usage'],
    ['GET', '/report'],
    ['GET', '/target/info'],
    ['POST', '/api/monitor/start'],
    ['POST', '/api/redteam/run'],
  ])('%s %s 不存在', async (method, path) => {
    expect((await asUser(path, { method })).status).toBe(404);
  });

  it('anonymous 也拿不到它们——线上实测过的正是这条路', async () => {
    for (const path of ['/policy', '/runtime', '/report', '/target/info', '/api/usage']) {
      expect((await app.request(path)).status, path).toBe(404);
    }
  });
});

describe('生产下必须存在的端点', () => {
  it('serves the sample notice the 手册第 2 步 tells the visitor to click', async () => {
    const response = await asUser('/api/fixtures');
    expect(response.status).toBe(200);
    const data = (await response.json()) as { mainNotice: { title: string }; cases: unknown[] };
    expect(data.mainNotice.title).toBe(MAIN_NOTICE.title);
    expect(data.cases).toHaveLength(3);
  });

  it('still requires a session for it', async () => {
    expect((await app.request('/api/fixtures')).status).toBe(401);
  });

  it('keeps the monitor board mounted but authenticated, unlike the legacy pages', async () => {
    // 401 而不是 404：这一组是「挂着且受保护」，与上面那组的区别正在这里。
    expect((await app.request('/api/monitor/overview')).status).toBe(401);
  });
});

describe('生产工作台不摆演示夹具的按钮', () => {
  it('drops the controls whose first step is wiping the database', async () => {
    const html = await (await asUser('/workbench')).text();
    expect(html).toContain('id="nf-sample"');
    expect(html).not.toContain('id="seed-btn"');
    expect(html).not.toContain('id="present-open"');
    expect(html).not.toContain('id="present-seed"');
    expect(html).toContain('var DEMO_TOOLS = false;');
  });
});
