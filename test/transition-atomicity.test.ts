import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { config } from '../src/config.js';
import { createDatabase, type DatabaseHandle } from '../src/db/client.js';
import { getWorkflowRepository, WorkflowRepository } from '../src/db/repository.js';
import { app } from '../src/index.js';
import { authenticatedRequest, loginAs } from './helpers/auth.js';

const ACTOR_ID = 'user_atomic_transition';

function insertActor(database: DatabaseHandle): void {
  const now = Date.now();
  database.sqlite
    .prepare(
      `INSERT INTO users (
        id, username, display_name, password_hash, roles_json, is_demo,
        disabled, session_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, 0, 1, ?, ?)`,
    )
    .run(ACTOR_ID, 'atomic-test', '原子迁移测试', 'unused-test-hash', '["editor"]', now, now);
}

function generatedArtifact(kind: 'broadcast-script' | 'short-video-copy', text: string) {
  return {
    kind,
    content: text,
    origin: 'ai' as const,
    model: 'atomic-test-model',
    metadata: { aiGenerated: true, aiLabel: '人工智能生成' },
    segments: [{ text, origin: 'ai' as const }],
  };
}

describe('canonical SQLite transition transaction', () => {
  let database: DatabaseHandle;
  let repository: WorkflowRepository;

  beforeEach(() => {
    database = createDatabase(':memory:');
    insertActor(database);
    repository = new WorkflowRepository(database);
  });

  afterEach(() => repository.close());

  function createAt(status: 'admitted' | 'generated' | 'first-review') {
    const manuscript = repository.createManuscript({
      title: '原子迁移故障注入稿',
      sourceType: 'notice',
      sourceText: '模拟素材：县里召开项目推进会。',
    });
    repository.updateStatus(manuscript.id, status, '测试准备');
    return manuscript.id;
  }

  it('rolls back the first artifact when the second artifact insert fails', () => {
    const id = createAt('admitted');
    database.sqlite.exec(`
      CREATE TRIGGER fail_second_artifact
      BEFORE INSERT ON content_artifacts
      WHEN (
        SELECT COUNT(*) FROM content_artifacts WHERE manuscript_id = NEW.manuscript_id
      ) = 1
      BEGIN
        SELECT RAISE(ABORT, 'injected-second-artifact');
      END;
    `);

    expect(() =>
      repository.commitCanonicalTransition({
        manuscriptId: id,
        expectedFrom: 'admitted',
        to: 'generated',
        actor: '编辑·原子迁移测试',
        actorUserId: ACTOR_ID,
        generatedArtifacts: [
          generatedArtifact('broadcast-script', '第一份模型稿。'),
          generatedArtifact('short-video-copy', '第二份模型稿。'),
        ],
      }),
    ).toThrow(/injected-second-artifact/);

    const after = repository.getAggregate(id)!;
    expect(after.manuscript.status).toBe('admitted');
    expect(after.artifacts).toEqual([]);
    expect(after.segments).toEqual([]);
    expect(after.trace.filter((event) => event.kind === 'artifact-created')).toEqual([]);
    expect(
      after.trace.filter(
        (event) =>
          event.kind === 'status-changed' &&
          event.data.from === 'admitted' &&
          event.data.to === 'generated',
      ),
    ).toEqual([]);
  });

  it('rolls back both artifacts preflight mutations when the second rule trace fails', () => {
    const id = createAt('generated');
    const first = repository.addArtifact(
      id,
      generatedArtifact('broadcast-script', '第一份模型稿。'),
    )!;
    const second = repository.addArtifact(
      id,
      generatedArtifact('short-video-copy', '第二份模型稿。'),
    )!;
    const before = repository.getAggregate(id)!;

    database.sqlite.exec(`
      CREATE TRIGGER fail_second_rule_trace
      BEFORE INSERT ON trace_events
      WHEN NEW.kind = 'rule-hit' AND (
        SELECT COUNT(*) FROM trace_events
        WHERE manuscript_id = NEW.manuscript_id AND kind = 'rule-hit'
      ) = 1
      BEGIN
        SELECT RAISE(ABORT, 'injected-second-rule-trace');
      END;
    `);

    expect(() =>
      repository.commitCanonicalTransition({
        manuscriptId: id,
        expectedFrom: 'generated',
        to: 'preflight',
        actor: '编辑·原子迁移测试',
        actorUserId: ACTOR_ID,
        preflightMutations: [first, second].map((artifact) => ({
          artifactId: artifact.id,
          replacementSegments: [
            { text: artifact.content, origin: 'ai' as const },
            { text: '本内容由人工智能生成，已经人工审核。', origin: 'ai' as const },
          ],
          metadata: {
            aiGenerated: true,
            aiLabel: '人工智能生成',
            labeledAt: 123,
          },
          traceData: {
            artifactId: artifact.id,
            kind: artifact.kind,
            block: 0,
            redact: 0,
            flag: 1,
            rules: ['ai-label'],
            proofreadPasses: ['third'],
            autoFixed: ['ai-label'],
          },
        })),
        review: {
          mode: 'append-system',
          stage: 'preflight',
          decision: 'approved',
        },
      }),
    ).toThrow(/injected-second-rule-trace/);

    expect(repository.getAggregate(id)).toEqual(before);
  });

  it('rolls back the review when the final status trace insert fails', () => {
    const id = createAt('first-review');
    database.sqlite.exec(`
      CREATE TRIGGER fail_second_review_status_trace
      BEFORE INSERT ON trace_events
      WHEN NEW.kind = 'status-changed'
        AND json_extract(NEW.data_json, '$.to') = 'second-review'
      BEGIN
        SELECT RAISE(ABORT, 'injected-review-status-trace');
      END;
    `);

    expect(() =>
      repository.commitCanonicalTransition({
        manuscriptId: id,
        expectedFrom: 'first-review',
        to: 'second-review',
        actor: '编辑·原子迁移测试',
        actorUserId: ACTOR_ID,
        review: {
          mode: 'idempotent-human',
          stage: 'editor',
          decision: 'approved',
        },
      }),
    ).toThrow(/injected-review-status-trace/);

    const after = repository.getAggregate(id)!;
    expect(after.manuscript.status).toBe('first-review');
    expect(after.reviews.filter((review) => review.stage === 'editor')).toEqual([]);
    expect(
      after.trace.filter(
        (event) => event.kind === 'review-recorded' && event.data.stage === 'editor',
      ),
    ).toEqual([]);
    expect(
      after.trace.filter(
        (event) =>
          event.kind === 'status-changed' && event.data.to === 'second-review',
      ),
    ).toEqual([]);
  });
});

const mutableConfig = config as unknown as { upstreamUrl: string; upstreamKey: string };
const originalUpstream = { url: config.upstreamUrl, key: config.upstreamKey };
let request: ReturnType<typeof authenticatedRequest>;

beforeAll(async () => {
  request = authenticatedRequest(app, await loginAs(app));
});

afterEach(() => {
  mutableConfig.upstreamUrl = originalUpstream.url;
  mutableConfig.upstreamKey = originalUpstream.key;
  vi.unstubAllGlobals();
});

describe('generation preparation before the transaction', () => {
  it('writes no manuscript side effect when the second model call fails', async () => {
    mutableConfig.upstreamUrl = 'https://controlled-upstream.example/v1';
    mutableConfig.upstreamKey = 'test-key';
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        if (calls === 2) return new Response('', { status: 503 });
        return new Response(
          JSON.stringify({ choices: [{ message: { content: '第一份完整模型稿。' } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );

    const created = await request('/api/workbench', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '第二次模型调用失败稿',
        sourceType: 'notice',
        sourceText: '模拟素材：县里召开项目推进会。',
      }),
    });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { manuscript: { id: string } }).manuscript.id;

    const failed = await request(`/api/workbench/${id}/transition`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'generated', role: 'editor' }),
    });
    expect(failed.status).toBe(502);
    expect(calls).toBe(2);

    const after = getWorkflowRepository().getAggregate(id)!;
    expect(after.manuscript.status).toBe('admitted');
    expect(after.artifacts).toEqual([]);
    expect(after.segments).toEqual([]);
    expect(after.trace.filter((event) => event.kind === 'artifact-created')).toEqual([]);
  });
});
