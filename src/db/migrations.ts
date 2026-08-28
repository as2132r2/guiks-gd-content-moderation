import type BetterSqlite3 from 'better-sqlite3';

interface Migration {
  id: string;
  sql: string;
}

const migrations: Migration[] = [
  {
    id: '0001_workflow_foundation',
    sql: `
      CREATE TABLE IF NOT EXISTS manuscripts (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_text TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS manuscripts_updated_at_idx
        ON manuscripts(updated_at);

      CREATE TABLE IF NOT EXISTS content_artifacts (
        id TEXT PRIMARY KEY NOT NULL,
        manuscript_id TEXT NOT NULL REFERENCES manuscripts(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        origin TEXT NOT NULL,
        ai_share REAL,
        model TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS content_artifacts_manuscript_idx
        ON content_artifacts(manuscript_id, created_at);

      CREATE TABLE IF NOT EXISTS review_records (
        id TEXT PRIMARY KEY NOT NULL,
        manuscript_id TEXT NOT NULL REFERENCES manuscripts(id) ON DELETE CASCADE,
        stage TEXT NOT NULL,
        decision TEXT NOT NULL,
        actor TEXT NOT NULL,
        reason TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS review_records_manuscript_idx
        ON review_records(manuscript_id, created_at);

      CREATE TABLE IF NOT EXISTS trace_events (
        id TEXT PRIMARY KEY NOT NULL,
        manuscript_id TEXT NOT NULL REFERENCES manuscripts(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS trace_events_manuscript_idx
        ON trace_events(manuscript_id, created_at);
    `,
  },
  {
    id: '0002_sentence_origin',
    sql: `
      CREATE TABLE IF NOT EXISTS sentence_segments (
        id TEXT PRIMARY KEY NOT NULL,
        manuscript_id TEXT NOT NULL REFERENCES manuscripts(id) ON DELETE CASCADE,
        artifact_id TEXT NOT NULL REFERENCES content_artifacts(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL,
        text TEXT NOT NULL,
        origin TEXT NOT NULL,
        source_ref TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sentence_segments_artifact_idx
        ON sentence_segments(artifact_id, ordinal);
      CREATE INDEX IF NOT EXISTS sentence_segments_manuscript_idx
        ON sentence_segments(manuscript_id, created_at);
    `,
  },
];

export function migrateDatabase(sqlite: BetterSqlite3.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const applied = sqlite.prepare('SELECT 1 FROM app_migrations WHERE id = ?');
  const markApplied = sqlite.prepare('INSERT INTO app_migrations (id, applied_at) VALUES (?, ?)');

  const apply = sqlite.transaction((migration: Migration) => {
    sqlite.exec(migration.sql);
    markApplied.run(migration.id, Date.now());
  });

  for (const migration of migrations) {
    if (!applied.get(migration.id)) apply(migration);
  }
}
