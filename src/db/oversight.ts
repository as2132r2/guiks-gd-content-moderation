/**
 * 全流程监控的跨稿件聚合（6.14）。
 *
 * 其余查询都是单稿件的 `/:id`；这里是唯一一处横着看的地方——**6.7 追溯图谱回答
 * 「这一篇稿子怎么走的」，这里回答「这个台最近在怎么写稿」**，是两件事。
 *
 * 三条约束：
 * 1. **AI 参与度的权重不在 SQL 里。** SQL 只取各来源的句数，比例由
 *    [ai-share.ts](../domain/ai-share.ts) 的 `aiShareWeights` 算——公式只能有一处定义。
 * 2. **规则命中从留痕里捞**，不另存一份表。`trace_events.data_json` 已经记着
 *    `rules[]`，用 JSON1 展开即可；另存一份迟早和留痕对不上。
 * 3. **认人不认角色。** 生产者维度按 `actor_user_id` 归并——角色是「以什么身份
 *    行使」，人才是责任主体。一人多岗时按角色分会把同一个人拆成三个。
 */
import type BetterSqlite3 from 'better-sqlite3';
import { aiShareWeights } from '../domain/ai-share.js';
import type { ManuscriptStatus, SentenceOrigin } from '../domain/contracts.js';

export interface CountRow {
  key: string;
  count: number;
}

export interface ManuscriptShare {
  id: string;
  title: string;
  status: ManuscriptStatus;
  /** 未测量时为 null——未测量不等于 0。 */
  aiShare: number | null;
  segmentCount: number;
}

export interface StageDwell {
  status: ManuscriptStatus;
  /** 平均停留毫秒。样本不足时仍给出，但要连 samples 一起显示。 */
  averageMs: number;
  samples: number;
}

export interface ReviewCell {
  stage: string;
  approved: number;
  returned: number;
  /** 退回率 0..1；该级没有记录时为 null。 */
  returnRate: number | null;
}

export interface ModelUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  averageLatencyMs: number;
  models: CountRow[];
}

export interface ProducerRow {
  /** 稳定真源；用户被删时为 null。 */
  userId: string | null;
  displayName: string;
  created: number;
  revised: number;
  reviewed: number;
  returned: number;
}

export interface TrendPoint {
  day: string;
  manuscripts: number;
  /** 当日签发稿件的平均 AI 参与度；当天没有签发则为 null。 */
  signedAiShare: number | null;
}

export interface OversightSnapshot {
  generatedAt: number;
  totals: {
    manuscripts: number;
    signed: number;
    blocked: number;
    segments: number;
    traceEvents: number;
  };
  statuses: CountRow[];
  /** 按自然日的建稿量，升序。 */
  daily: CountRow[];
  origins: CountRow[];
  /** 全台加权 AI 参与度；没有句子时为 null。 */
  overallAiShare: number | null;
  shares: ManuscriptShare[];
  dwell: StageDwell[];
  reviews: ReviewCell[];
  admissions: CountRow[];
  ruleHits: CountRow[];
  /** 报道方向（6.19）。未填的归 `null` 键，前端显示「未分类」——不等于「其他」。 */
  topics: CountRow[];
  /** 内容生产者（6.20）。按 actor_user_id 归并，认人不认角色。 */
  producers: ProducerRow[];
  trend: TrendPoint[];
  model: ModelUsage;
}

const rows = <T>(db: BetterSqlite3.Database, sql: string): T[] => db.prepare(sql).all() as T[];

export function buildOversight(db: BetterSqlite3.Database): OversightSnapshot {
  const statuses = rows<{ key: string; count: number }>(
    db,
    'SELECT status AS key, COUNT(*) AS count FROM manuscripts GROUP BY status ORDER BY count DESC',
  );

  const daily = rows<{ key: string; count: number }>(
    db,
    `SELECT date(created_at / 1000, 'unixepoch', 'localtime') AS key, COUNT(*) AS count
       FROM manuscripts GROUP BY key ORDER BY key`,
  );

  const origins = rows<{ key: string; count: number }>(
    db,
    'SELECT origin AS key, COUNT(*) AS count FROM sentence_segments GROUP BY origin',
  );

  // 每篇稿件的各来源句数，比例交给 JS 用共享权重算。
  const perManuscript = rows<{
    id: string;
    title: string;
    status: string;
    origin: string | null;
    count: number;
  }>(
    db,
    `SELECT m.id, m.title, m.status, s.origin, COUNT(s.id) AS count
       FROM manuscripts m
       LEFT JOIN sentence_segments s ON s.manuscript_id = m.id
       GROUP BY m.id, s.origin
       ORDER BY m.updated_at DESC`,
  );

  const shareMap = new Map<string, ManuscriptShare & { weighted: number }>();
  for (const row of perManuscript) {
    let entry = shareMap.get(row.id);
    if (!entry) {
      entry = {
        id: row.id,
        title: row.title,
        status: row.status as ManuscriptStatus,
        aiShare: null,
        segmentCount: 0,
        weighted: 0,
      };
      shareMap.set(row.id, entry);
    }
    if (!row.origin) continue;
    entry.segmentCount += row.count;
    entry.weighted += (aiShareWeights[row.origin as SentenceOrigin] ?? 0) * row.count;
  }
  const shares: ManuscriptShare[] = [...shareMap.values()].map((entry) => ({
    id: entry.id,
    title: entry.title,
    status: entry.status,
    segmentCount: entry.segmentCount,
    aiShare:
      entry.segmentCount === 0
        ? null
        : Math.round((entry.weighted / entry.segmentCount) * 10_000) / 10_000,
  }));

  const totalWeighted = [...shareMap.values()].reduce((sum, e) => sum + e.weighted, 0);
  const totalSegments = [...shareMap.values()].reduce((sum, e) => sum + e.segmentCount, 0);

  // 环节停留：相邻两次状态变更的间隔，归到「离开的那个状态」头上。
  const transitions = rows<{ manuscriptId: string; createdAt: number; from: string | null }>(
    db,
    `SELECT manuscript_id AS manuscriptId, created_at AS createdAt,
            json_extract(data_json, '$.from') AS "from"
       FROM trace_events
      WHERE kind IN ('status-changed', 'signed')
      ORDER BY manuscript_id, created_at`,
  );
  const dwellAcc = new Map<string, { total: number; samples: number }>();
  let previous: { id: string; at: number } | null = null;
  for (const row of transitions) {
    if (previous && previous.id === row.manuscriptId && row.from) {
      const entry = dwellAcc.get(row.from) ?? { total: 0, samples: 0 };
      entry.total += row.createdAt - previous.at;
      entry.samples += 1;
      dwellAcc.set(row.from, entry);
    }
    previous = { id: row.manuscriptId, at: row.createdAt };
  }
  const dwell: StageDwell[] = [...dwellAcc.entries()]
    .map(([status, e]) => ({
      status: status as ManuscriptStatus,
      averageMs: Math.round(e.total / e.samples),
      samples: e.samples,
    }))
    .sort((a, b) => b.averageMs - a.averageMs);

  const reviewRows = rows<{ stage: string; decision: string; count: number }>(
    db,
    'SELECT stage, decision, COUNT(*) AS count FROM review_records GROUP BY stage, decision',
  );
  const reviewMap = new Map<string, ReviewCell>();
  for (const row of reviewRows) {
    const cell =
      reviewMap.get(row.stage) ?? { stage: row.stage, approved: 0, returned: 0, returnRate: null };
    if (row.decision === 'changes-requested' || row.decision === 'rejected') cell.returned += row.count;
    else cell.approved += row.count;
    reviewMap.set(row.stage, cell);
  }
  const reviews = [...reviewMap.values()].map((cell) => {
    const total = cell.approved + cell.returned;
    return { ...cell, returnRate: total === 0 ? null : Math.round((cell.returned / total) * 1000) / 1000 };
  });

  const admissions = rows<{ key: string; count: number }>(
    db,
    `SELECT json_extract(data_json, '$.decision') AS key, COUNT(*) AS count
       FROM trace_events
      WHERE kind = 'rule-hit' AND actor = '入口准入'
        AND json_extract(data_json, '$.decision') IS NOT NULL
      GROUP BY key ORDER BY count DESC`,
  );

  // JSON1 展开 rules[]：留痕本来就记着，不另存一份表。
  const ruleHits = rows<{ key: string; count: number }>(
    db,
    `SELECT j.value AS key, COUNT(*) AS count
       FROM trace_events t, json_each(json_extract(t.data_json, '$.rules')) j
      WHERE t.kind = 'rule-hit'
      GROUP BY key ORDER BY count DESC`,
  );

  const topics = rows<{ key: string; count: number }>(
    db,
    'SELECT coverage_topic AS key, COUNT(*) AS count FROM manuscripts GROUP BY key ORDER BY count DESC',
  );

  // 生产者：建稿 / 改稿来自留痕，审批与退回来自审核记录，都按 actor_user_id 归并。
  const producerRows = rows<{
    userId: string | null;
    displayName: string | null;
    created: number;
    revised: number;
  }>(
    db,
    `SELECT t.actor_user_id AS userId, u.display_name AS displayName,
            SUM(CASE WHEN t.kind = 'manuscript-created' THEN 1 ELSE 0 END) AS created,
            SUM(CASE WHEN t.kind = 'segments-recorded' THEN 1 ELSE 0 END) AS revised
       FROM trace_events t
       LEFT JOIN users u ON u.id = t.actor_user_id
      WHERE t.kind IN ('manuscript-created', 'segments-recorded')
      GROUP BY t.actor_user_id`,
  );
  const reviewerRows = rows<{
    userId: string | null;
    displayName: string | null;
    reviewed: number;
    returned: number;
  }>(
    db,
    `SELECT r.actor_user_id AS userId, u.display_name AS displayName,
            COUNT(*) AS reviewed,
            SUM(CASE WHEN r.decision IN ('changes-requested', 'rejected') THEN 1 ELSE 0 END) AS returned
       FROM review_records r
       LEFT JOIN users u ON u.id = r.actor_user_id
      GROUP BY r.actor_user_id`,
  );
  const producerMap = new Map<string, ProducerRow>();
  const producerKey = (id: string | null) => id ?? '__unattributed__';
  const upsert = (userId: string | null, displayName: string | null): ProducerRow => {
    const key = producerKey(userId);
    let entry = producerMap.get(key);
    if (!entry) {
      entry = {
        userId,
        displayName: displayName ?? (userId ? '（账号已删除）' : '（无署名）'),
        created: 0,
        revised: 0,
        reviewed: 0,
        returned: 0,
      };
      producerMap.set(key, entry);
    }
    if (displayName) entry.displayName = displayName;
    return entry;
  };
  for (const row of producerRows) {
    const entry = upsert(row.userId, row.displayName);
    entry.created += row.created;
    entry.revised += row.revised;
  }
  for (const row of reviewerRows) {
    const entry = upsert(row.userId, row.displayName);
    entry.reviewed += row.reviewed;
    entry.returned += row.returned;
  }
  const producers = [...producerMap.values()].sort(
    (a, b) => b.created + b.revised + b.reviewed - (a.created + a.revised + a.reviewed),
  );

  // 趋势：当日建稿量，以及当日签发稿件的平均 AI 参与度。
  const signedByDay = rows<{ day: string; manuscriptId: string }>(
    db,
    `SELECT date(created_at / 1000, 'unixepoch', 'localtime') AS day,
            manuscript_id AS manuscriptId
       FROM trace_events WHERE kind = 'signed'`,
  );
  const shareById = new Map(shares.map((row) => [row.id, row.aiShare]));
  const trendAcc = new Map<string, { total: number; n: number }>();
  for (const row of signedByDay) {
    const share = shareById.get(row.manuscriptId);
    if (share == null) continue;
    const entry = trendAcc.get(row.day) ?? { total: 0, n: 0 };
    entry.total += share;
    entry.n += 1;
    trendAcc.set(row.day, entry);
  }
  const trend: TrendPoint[] = daily.map((row) => {
    const signed = trendAcc.get(row.key);
    return {
      day: row.key,
      manuscripts: row.count,
      signedAiShare: signed ? Math.round((signed.total / signed.n) * 10_000) / 10_000 : null,
    };
  });

  const usage = db
    .prepare(
      `SELECT COUNT(*) AS calls,
              COALESCE(SUM(json_extract(data_json, '$.inputTokens')), 0) AS inputTokens,
              COALESCE(SUM(json_extract(data_json, '$.outputTokens')), 0) AS outputTokens,
              COALESCE(AVG(json_extract(data_json, '$.latencyMs')), 0) AS averageLatencyMs
         FROM trace_events WHERE kind = 'model-completed'`,
    )
    .get() as Omit<ModelUsage, 'models'>;

  const models = rows<{ key: string; count: number }>(
    db,
    `SELECT COALESCE(json_extract(data_json, '$.servedModel'), actor) AS key, COUNT(*) AS count
       FROM trace_events WHERE kind = 'model-completed' GROUP BY key ORDER BY count DESC`,
  );

  const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;

  return {
    generatedAt: Date.now(),
    totals: {
      manuscripts: one('SELECT COUNT(*) AS n FROM manuscripts'),
      signed: one("SELECT COUNT(*) AS n FROM manuscripts WHERE status IN ('signed','published')"),
      blocked: one("SELECT COUNT(*) AS n FROM manuscripts WHERE status = 'admission-blocked'"),
      segments: one('SELECT COUNT(*) AS n FROM sentence_segments'),
      traceEvents: one('SELECT COUNT(*) AS n FROM trace_events'),
    },
    statuses,
    daily,
    origins,
    overallAiShare:
      totalSegments === 0 ? null : Math.round((totalWeighted / totalSegments) * 10_000) / 10_000,
    shares,
    dwell,
    reviews,
    admissions,
    ruleHits,
    topics,
    producers,
    trend,
    model: { ...usage, averageLatencyMs: Math.round(usage.averageLatencyMs), models },
  };
}
