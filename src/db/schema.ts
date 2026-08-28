import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const manuscripts = sqliteTable(
  'manuscripts',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    sourceType: text('source_type').notNull(),
    sourceText: text('source_text').notNull(),
    status: text('status').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('manuscripts_updated_at_idx').on(table.updatedAt)],
);

export const contentArtifacts = sqliteTable(
  'content_artifacts',
  {
    id: text('id').primaryKey(),
    manuscriptId: text('manuscript_id')
      .notNull()
      .references(() => manuscripts.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    content: text('content').notNull(),
    origin: text('origin').notNull(),
    aiShare: real('ai_share'),
    model: text('model'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('content_artifacts_manuscript_idx').on(table.manuscriptId, table.createdAt)],
);

export const reviewRecords = sqliteTable(
  'review_records',
  {
    id: text('id').primaryKey(),
    manuscriptId: text('manuscript_id')
      .notNull()
      .references(() => manuscripts.id, { onDelete: 'cascade' }),
    stage: text('stage').notNull(),
    decision: text('decision').notNull(),
    actor: text('actor').notNull(),
    reason: text('reason'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('review_records_manuscript_idx').on(table.manuscriptId, table.createdAt)],
);

export const traceEvents = sqliteTable(
  'trace_events',
  {
    id: text('id').primaryKey(),
    manuscriptId: text('manuscript_id')
      .notNull()
      .references(() => manuscripts.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    actorType: text('actor_type').notNull(),
    actor: text('actor').notNull(),
    dataJson: text('data_json').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('trace_events_manuscript_idx').on(table.manuscriptId, table.createdAt)],
);

export const schema = { manuscripts, contentArtifacts, reviewRecords, traceEvents };
