import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { config } from '../config.js';
import { migrateDatabase } from './migrations.js';
import { schema } from './schema.js';

export type WorkflowDatabase = BetterSQLite3Database<typeof schema>;

export interface DatabaseHandle {
  orm: WorkflowDatabase;
  sqlite: BetterSqlite3.Database;
  close: () => void;
}

export function createDatabase(databasePath = config.databasePath): DatabaseHandle {
  if (databasePath !== ':memory:' && !databasePath.startsWith('file:')) {
    mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  }

  const sqlite = new BetterSqlite3(databasePath);
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  if (databasePath !== ':memory:') sqlite.pragma('journal_mode = WAL');
  migrateDatabase(sqlite);

  return {
    orm: drizzle(sqlite, { schema }),
    sqlite,
    close: () => sqlite.close(),
  };
}
