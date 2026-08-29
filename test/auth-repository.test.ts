import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { createDatabase, type DatabaseHandle } from '../src/db/client.js';
import { migrations, migrateDatabase } from '../src/db/migrations.js';
import { buildOversight } from '../src/db/oversight.js';
import { WorkflowRepository } from '../src/db/repository.js';
import { verifyPassword } from '../src/domain/auth.js';

describe('track C migration and account repository', () => {
  let database: DatabaseHandle | undefined;
  afterEach(() => database?.close());

  it('replays every migration from an empty database', () => {
    const sqlite = new BetterSqlite3(':memory:');
    migrateDatabase(sqlite);
    const ids = sqlite
      .prepare('SELECT id FROM app_migrations ORDER BY applied_at, id')
      .all() as Array<{ id: string }>;
    expect(ids.map((row) => row.id)).toEqual([
      '0001_workflow_foundation',
      '0002_sentence_origin',
      '0003_track_c_accounts',
      '0004_track_a_workflow',
      '0005_coverage_topic',
      '0006_managed_ruleset',
    ]);
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'users'").get()).toBeTruthy();
    const userColumns = sqlite.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
    expect(userColumns.map((column) => column.name)).toContain('is_demo');
    migrateDatabase(sqlite);
    const replayed = sqlite
      .prepare('SELECT id FROM app_migrations ORDER BY applied_at, id')
      .all() as Array<{ id: string }>;
    expect(replayed).toEqual(ids);
    sqlite.close();
  });

  it('adds reserved 0003 to a database that already applied 0004', () => {
    const sqlite = new BetterSqlite3(':memory:');
    sqlite.exec('CREATE TABLE app_migrations (id TEXT PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL)');
    const insert = sqlite.prepare('INSERT INTO app_migrations (id, applied_at) VALUES (?, ?)');
    for (const migration of migrations.filter((item) => item.id !== '0003_track_c_accounts')) {
      sqlite.exec(migration.sql);
      insert.run(migration.id, Date.now());
    }

    migrateDatabase(sqlite);
    expect(
      sqlite.prepare("SELECT id FROM app_migrations WHERE id = '0003_track_c_accounts'").get(),
    ).toBeTruthy();
    const reviewColumns = sqlite.prepare('PRAGMA table_info(review_records)').all() as Array<{
      name: string;
    }>;
    expect(reviewColumns.map((column) => column.name)).toContain('actor_user_id');
    sqlite.close();
  });

  it('seeds four demo accounts idempotently with hashed passwords', async () => {
    database = createDatabase(':memory:');
    const repository = new WorkflowRepository(database);
    repository.ensureDemoUsers();
    repository.ensureDemoUsers();
    const count = database.sqlite.prepare('SELECT COUNT(*) AS count FROM users').get() as {
      count: number;
    };
    expect(count.count).toBe(4);
    const zhangmin = repository.findStoredUserByUsername('zhangmin');
    expect(zhangmin).toMatchObject({
      displayName: '张敏',
      roles: ['editor', 'department-head', 'supervising-leader'],
      isDemo: true,
    });
    expect(zhangmin!.passwordHash).not.toContain('gatekeeper-demo');
    expect(await verifyPassword('gatekeeper-demo', zhangmin!.passwordHash)).toBe(true);
  });

  it.each(['[]', '["editor","unknown"]', '{"role":"editor"}', 'not-json'])(
    'fails closed when a stored account has invalid roles_json: %s',
    (rolesJson) => {
      database = createDatabase(':memory:');
      const repository = new WorkflowRepository(database);
      repository.ensureDemoUsers();
      database.sqlite
        .prepare('UPDATE users SET roles_json = ? WHERE id = ?')
        .run(rolesJson, 'user_demo_zhangmin');
      expect(repository.findUserById('user_demo_zhangmin')).toBeUndefined();
      expect(repository.findStoredUserByUsername('zhangmin')).toBeUndefined();
    },
  );

  it('provisions an enabled non-demo account with strict roles and a salted password', async () => {
    database = createDatabase(':memory:');
    const repository = new WorkflowRepository(database);
    const first = repository.provisionProductionUser({
      username: 'news-editor',
      displayName: '生产编辑',
      password: 'one-strong-password',
      roles: ['editor'],
    });
    const second = repository.provisionProductionUser({
      username: 'news-head',
      displayName: '生产主任',
      password: 'another-strong-password',
      roles: ['department-head'],
    });

    expect(first).toMatchObject({ username: 'news-editor', roles: ['editor'], isDemo: false });
    expect(repository.hasEnabledProductionUser()).toBe(true);
    const storedFirst = repository.findStoredUserByUsername('news-editor')!;
    const storedSecond = repository.findStoredUserByUsername('news-head')!;
    expect(await verifyPassword('one-strong-password', storedFirst.passwordHash)).toBe(true);
    expect(storedFirst.passwordHash).not.toBe(storedSecond.passwordHash);
    expect(() =>
      repository.provisionProductionUser({
        username: 'bad-role',
        displayName: '坏角色',
        password: 'one-strong-password',
        roles: ['unknown' as never],
      }),
    ).toThrow('roles');
  });
});

describe('demo 账号转正', () => {
  let database: DatabaseHandle | undefined;
  afterEach(() => database?.close());

  const promotable = () => {
    database = createDatabase(':memory:');
    const repository = new WorkflowRepository(database);
    repository.ensureDemoUsers();
    return repository;
  };

  const input = {
    username: 'zhangmin',
    displayName: '张敏',
    password: 'gatekeeper-demo',
    roles: ['editor' as const, 'department-head' as const, 'supervising-leader' as const],
  };

  it('keeps the user id, so nothing that points at it goes dangling', async () => {
    const repository = promotable();
    const before = repository.findStoredUserByUsername('zhangmin')!;
    const after = repository.promoteDemoUserToProduction(input);

    expect(after.id).toBe(before.id);
    expect(after.isDemo).toBe(false);
    expect(repository.hasEnabledProductionUser()).toBe(true);
    // 会话版本加一：demo 模式下签发的 cookie 不该跨到生产继续用。
    expect(after.sessionVersion).toBe(before.sessionVersion + 1);
    const stored = repository.findStoredUserByUsername('zhangmin')!;
    expect(stored.passwordHash).not.toBe(before.passwordHash);
    expect(await verifyPassword('gatekeeper-demo', stored.passwordHash)).toBe(true);
  });

  it('carries the whole 责任链 across the switch, which deleting the account would not', () => {
    // 这条是这次改动存在的全部理由。删账号重建会把 actor_user_id 置空
    //（ON DELETE SET NULL），监控看板「内容生产者」那一栏就把这个人做过的
    // 事全塌进「（无署名）」——换个部署模式不该让历史归并掉一块。
    const repository = promotable();
    const author = repository.findStoredUserByUsername('zhangmin')!;
    const manuscript = repository.createManuscript(
      { title: '全市乡村振兴现场推进会召开', sourceType: 'public-relations', sourceText: '模拟素材。' },
      { label: '张敏 · 编辑', userId: author.id },
    );
    repository.appendTrace(manuscript.id, {
      kind: 'review-recorded',
      actorType: 'human',
      actor: '张敏 · 编辑',
      actorUserId: author.id,
    });

    const attributed = () =>
      buildOversight(database!.sqlite).producers.map((row) => row.displayName);
    expect(attributed()).toContain('张敏');

    repository.promoteDemoUserToProduction(input);
    expect(attributed()).toContain('张敏');
    expect(attributed()).not.toContain('（无署名）');

    // 对照：删掉账号就是旧做法的结果，那一栏当场塌掉。
    repository.deleteUserByUsername('zhangmin');
    expect(attributed()).toEqual(['（无署名）']);
  });

  it('refuses anything that is not a demo account waiting to be promoted', () => {
    const repository = promotable();
    expect(() =>
      repository.promoteDemoUserToProduction({ ...input, username: 'nobody' }),
    ).toThrow('not found');
    repository.promoteDemoUserToProduction(input);
    expect(() => repository.promoteDemoUserToProduction(input)).toThrow('already a production');
  });

  it('validates its input exactly like provisioning does', () => {
    const repository = promotable();
    expect(() => repository.promoteDemoUserToProduction({ ...input, password: 'short' })).toThrow(
      'password',
    );
    expect(() =>
      repository.promoteDemoUserToProduction({ ...input, roles: ['unknown' as never] }),
    ).toThrow('roles');
    // 校验失败不能留下半个改动。
    expect(repository.findStoredUserByUsername('zhangmin')!.isDemo).toBe(true);
  });
});
