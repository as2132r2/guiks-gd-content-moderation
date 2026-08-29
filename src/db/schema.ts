import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    rolesJson: text('roles_json').notNull(),
    isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
    disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
    sessionVersion: integer('session_version').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [uniqueIndex('users_username_idx').on(table.username)],
);

export const manuscripts = sqliteTable(
  'manuscripts',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    sourceType: text('source_type').notNull(),
    coverageTopic: text('coverage_topic'),
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
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
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
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    dataJson: text('data_json').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('trace_events_manuscript_idx').on(table.manuscriptId, table.createdAt)],
);


/**
 * 判定依据（词表）。运行时读的是这张表，`src/rules/terms.ts` 是它的内置基线定义。
 *
 * `source`（出处）NOT NULL 是刻意的：判定依据说不出出处，整个「说得清」就塌了。
 */
export const ruleTerms = sqliteTable(
  'rule_terms',
  {
    ruleId: text('rule_id').primaryKey(),
    scope: text('scope').notNull(),
    term: text('term').notNull(),
    source: text('source').notNull(),
    origin: text('origin').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    admissionBucket: text('admission_bucket'),
    category: text('category'),
    action: text('action'),
    title: text('title'),
    detail: text('detail'),
    suggestion: text('suggestion'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('rule_terms_scope_idx').on(table.scope, table.enabled)],
);

/** 词表改动留痕。只 INSERT——判定依据被谁改过必须查得到。 */
export const ruleChangeLog = sqliteTable(
  'rule_change_log',
  {
    id: text('id').primaryKey(),
    rulesetVersion: integer('ruleset_version').notNull(),
    ruleId: text('rule_id').notNull(),
    action: text('action').notNull(),
    beforeJson: text('before_json'),
    afterJson: text('after_json'),
    reason: text('reason').notNull(),
    acknowledgedWarning: text('acknowledged_warning'),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actor: text('actor').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('rule_change_log_rule_idx').on(table.ruleId, table.createdAt),
    index('rule_change_log_time_idx').on(table.createdAt),
  ],
);

/** 单行：词表整体的版本号。写进准入与预检的留痕，用来回答「当时按哪一版判的」。 */
export const rulesetMeta = sqliteTable('ruleset_meta', {
  id: integer('id').primaryKey(),
  version: integer('version').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** 单行：全台统一的每日上限。两个字段都可空，空即不限。 */
export const usageLimits = sqliteTable('usage_limits', {
  id: integer('id').primaryKey(),
  dailyCalls: integer('daily_calls'),
  dailyTokens: integer('daily_tokens'),
  updatedAt: integer('updated_at').notNull(),
  updatedBy: text('updated_by'),
});

/** 逐账号逐日用量。落库而不是内存——重启清零的计数不是配额。 */
export const usageCounters = sqliteTable(
  'usage_counters',
  {
    day: text('day').notNull(),
    userId: text('user_id').notNull(),
    calls: integer('calls').notNull().default(0),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.day, table.userId] })],
);

/** 超限留痕。只 INSERT，且与准入结论分表——资源判定不是内容判定。 */
export const usageLimitEvents = sqliteTable(
  'usage_limit_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    actor: text('actor').notNull(),
    manuscriptId: text('manuscript_id'),
    kind: text('kind').notNull(),
    used: integer('used').notNull(),
    limitValue: integer('limit_value').notNull(),
    day: text('day').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('usage_limit_events_time_idx').on(table.createdAt)],
);

export const schema = {
  users,
  manuscripts,
  admissionResults,
  contentArtifacts,
  sentenceSegments,
  reviewRecords,
  traceEvents,
  ruleTerms,
  ruleChangeLog,
  rulesetMeta,
  usageLimits,
  usageCounters,
  usageLimitEvents,
};
