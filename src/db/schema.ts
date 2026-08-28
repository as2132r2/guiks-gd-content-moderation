import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const manuscripts = sqliteTable(
  'manuscripts',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    sourceType: text('source_type').notNull(),
    sourceText: text('source_text').notNull(),
    status: text('status').notNull(),
    reviewRound: integer('review_round').notNull().default(1),
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
    metadataJson: text('metadata_json'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('content_artifacts_manuscript_idx').on(table.manuscriptId, table.createdAt)],
);


export const sentenceSegments = sqliteTable(
  'sentence_segments',
  {
    id: text('id').primaryKey(),
    manuscriptId: text('manuscript_id')
      .notNull()
      .references(() => manuscripts.id, { onDelete: 'cascade' }),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => contentArtifacts.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    text: text('text').notNull(),
    origin: text('origin').notNull(),
    sourceRef: text('source_ref'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('sentence_segments_artifact_idx').on(table.artifactId, table.ordinal),
    index('sentence_segments_manuscript_idx').on(table.manuscriptId, table.createdAt),
  ],
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
    round: integer('round').notNull().default(1),
    countersignParty: text('countersign_party'),
    opinion: text('opinion'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('review_records_manuscript_idx').on(table.manuscriptId, table.createdAt)],
);

export const admissionResults = sqliteTable('admission_results', {
  manuscriptId: text('manuscript_id')
    .primaryKey()
    .references(() => manuscripts.id, { onDelete: 'cascade' }),
  decision: text('decision').notNull(),
  reasonCode: text('reason_code').notNull(),
  message: text('message').notNull(),
  hitsJson: text('hits_json').notNull(),
  offDutyUse: integer('off_duty_use', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
});

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


export const schema = {
  manuscripts,
  admissionResults,
  contentArtifacts,
  sentenceSegments,
  reviewRecords,
  traceEvents,
};
