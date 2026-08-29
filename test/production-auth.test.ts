import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const strongSecret = () => `base64:${randomBytes(32).toString('base64')}`;

interface ProbeResult {
  readyStatus: number;
  readyBody: { status: string; checks: { authentication: string; gatewayAuth: string } };
  demoLoginStatus: number;
  demoLoginBody: { error: string };
  demoUserPresent: boolean;
  readyAfterProvisionStatus?: number;
  legacyWriteStatus: number;
  gatewayMissingStatus: number;
  gatewayWrongStatus: number;
  gatewayValidStatus?: number;
  productionLoginStatus?: number;
}

async function runProductionProbe(
  sessionSecret?: string,
  gatewayToken = strongSecret(),
  provision = false,
): Promise<ProbeResult> {
  vi.resetModules();
  vi.stubEnv('APP_MODE', 'production');
  vi.stubEnv('ALLOW_MOCK_UPSTREAM', 'true');
  vi.stubEnv('DATABASE_PATH', ':memory:');
  vi.stubEnv('SEED_DEMO_USERS', 'false');
  vi.stubEnv('SESSION_SECRET', sessionSecret ?? '');
  vi.stubEnv('GATEWAY_TOKEN', gatewayToken);

  const [{ app }, { closeWorkflowRepository, getWorkflowRepository }] = await Promise.all([
    import('../src/index.js'),
    import('../src/db/repository.js'),
  ]);
  const ready = await app.request('/readyz');
  const demoLogin = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'zhangmin', demo: true }),
  });
  const legacyWrite = await app.request('/api/monitor/start', { method: 'POST' });
  const gatewayBody = JSON.stringify({ message: '生产机器调用' });
  const gatewayMissing = await app.request('/gateway/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: gatewayBody,
  });
  const gatewayWrong = await app.request('/gateway/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer wrong-key' },
    body: gatewayBody,
  });
  let readyAfterProvisionStatus: number | undefined;
  let gatewayValidStatus: number | undefined;
  let productionLoginStatus: number | undefined;
  if (provision) {
    getWorkflowRepository().provisionProductionUser({
      username: 'prod-editor',
      displayName: '生产编辑',
      password: 'production-password',
      roles: ['editor'],
    });
    readyAfterProvisionStatus = (await app.request('/readyz')).status;
    productionLoginStatus = (
      await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'prod-editor', password: 'production-password' }),
      })
    ).status;
    gatewayValidStatus = (
      await app.request('/gateway/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': gatewayToken },
        body: gatewayBody,
      })
    ).status;
  }
  const result: ProbeResult = {
    readyStatus: ready.status,
    readyBody: (await ready.json()) as ProbeResult['readyBody'],
    demoLoginStatus: demoLogin.status,
    demoLoginBody: (await demoLogin.json()) as ProbeResult['demoLoginBody'],
    demoUserPresent: Boolean(
      getWorkflowRepository().findUserById('user_demo_zhangmin'),
    ),
    ...(readyAfterProvisionStatus === undefined ? {} : { readyAfterProvisionStatus }),
    legacyWriteStatus: legacyWrite.status,
    gatewayMissingStatus: gatewayMissing.status,
    gatewayWrongStatus: gatewayWrong.status,
    ...(gatewayValidStatus === undefined ? {} : { gatewayValidStatus }),
    ...(productionLoginStatus === undefined ? {} : { productionLoginStatus }),
  };
  closeWorkflowRepository();
  return result;
}

describe('production authentication boundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('makes readiness fail closed when SESSION_SECRET is missing', async () => {
    const probe = await runProductionProbe();
    expect(probe.readyStatus).toBe(503);
    expect(probe.readyBody).toMatchObject({
      status: 'not-ready',
      checks: { authentication: 'missing' },
    });
    expect(probe.legacyWriteStatus).toBe(404);
  });

  it.each([
    'x'.repeat(64),
    `base64:${Buffer.alloc(32).toString('base64')}`,
    `base64:${Buffer.from('abcdefghijklmnopqrstuvwxyz123456').toString('base64')}`,
  ])(
    'rejects a production secret that is long but predictably weak: %s',
    async (weakSecret) => {
      const probe = await runProductionProbe(weakSecret);
      expect(probe.readyStatus).toBe(503);
      expect(probe.readyBody.checks.authentication).toBe('missing');
    },
  );

  it('requires a production account, rejects demo login, and protects the HTTP gateway', async () => {
    const gatewayToken = strongSecret();
    const probe = await runProductionProbe(strongSecret(), gatewayToken, true);
    expect(probe.readyStatus).toBe(503);
    expect(probe.readyAfterProvisionStatus).toBe(200);
    expect(probe.demoLoginStatus).toBe(403);
    expect(probe.demoLoginBody).toEqual({
      error: 'demo_login_disabled',
      message: '当前环境不允许快捷登录。',
    });
    expect(probe.demoUserPresent).toBe(false);
    expect(probe.legacyWriteStatus).toBe(404);
    expect(probe.gatewayMissingStatus).toBe(401);
    expect(probe.gatewayWrongStatus).toBe(401);
    expect(probe.gatewayValidStatus).toBe(200);
    expect(probe.productionLoginStatus).toBe(200);
  });

  it('returns 503 from the production HTTP gateway when its machine key is unavailable', async () => {
    const probe = await runProductionProbe(strongSecret(), '');
    expect(probe.gatewayMissingStatus).toBe(503);
    expect(probe.gatewayWrongStatus).toBe(503);
  });

  it('rejects reusing the session secret as the production machine key', async () => {
    const reusedSecret = strongSecret();
    const probe = await runProductionProbe(reusedSecret, reusedSecret);
    expect(probe.readyStatus).toBe(503);
    expect(probe.readyBody.checks.gatewayAuth).toBe('missing');
    expect(probe.gatewayMissingStatus).toBe(503);
  });

  it('refuses a persisted demo account after the database switches to production', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'gatekeeper-demo-switch-'));
    const databasePath = join(directory, 'app.db');
    const sharedSessionSecret = strongSecret();
    try {
      vi.resetModules();
      vi.stubEnv('APP_MODE', 'demo');
      vi.stubEnv('DATABASE_PATH', databasePath);
      vi.stubEnv('SEED_DEMO_USERS', 'true');
      vi.stubEnv('SESSION_SECRET', sharedSessionSecret);
      const [{ app: demoApp }, demoRepository] = await Promise.all([
        import('../src/index.js'),
        import('../src/db/repository.js'),
      ]);
      expect(demoRepository.getWorkflowRepository().findUserById('user_demo_zhangmin')).toBeTruthy();
      const demoLogin = await demoApp.request('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'zhangmin', demo: true }),
      });
      expect(demoLogin.status).toBe(200);
      const oldDemoCookie = demoLogin.headers.get('set-cookie')!.split(';', 1)[0]!;
      demoRepository.closeWorkflowRepository();

      vi.resetModules();
      vi.stubEnv('APP_MODE', 'production');
      vi.stubEnv('ALLOW_MOCK_UPSTREAM', 'true');
      vi.stubEnv('DATABASE_PATH', databasePath);
      vi.stubEnv('SEED_DEMO_USERS', 'false');
      vi.stubEnv('SESSION_SECRET', sharedSessionSecret);
      vi.stubEnv('GATEWAY_TOKEN', strongSecret());
      const [{ app }, productionRepository] = await Promise.all([
        import('../src/index.js'),
        import('../src/db/repository.js'),
      ]);
      try {
        const login = await app.request('/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: 'zhangmin', password: 'gatekeeper-demo' }),
        });
        expect(login.status).toBe(401);
        const oldSession = await app.request('/api/auth/me', {
          headers: { cookie: oldDemoCookie },
        });
        expect(oldSession.status).toBe(401);
      } finally {
        productionRepository.closeWorkflowRepository();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});
