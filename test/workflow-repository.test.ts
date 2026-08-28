import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '../src/db/client.js';
import { WorkflowRepository } from '../src/db/repository.js';

describe('workflow repository', () => {
  let database: DatabaseHandle;
  let repository: WorkflowRepository;

  beforeEach(() => {
    database = createDatabase(':memory:');
    repository = new WorkflowRepository(database);
  });

  afterEach(() => repository.close());

  it('persists a manuscript, artifacts, reviews and an ordered trace', () => {
    const manuscript = repository.createManuscript({
      title: '测试通稿',
      sourceType: 'notice',
      sourceText: '这是一份脱敏测试素材。',
    });

    const artifact = repository.addArtifact(manuscript.id, {
      kind: 'broadcast-script',
      content: '这里是广播稿。',
      origin: 'mixed',
      aiShare: 0.7,
      model: 'test-model',
    });
    const review = repository.recordReview(manuscript.id, {
      stage: 'editor',
      decision: 'approved',
      actor: '测试编辑',
      reason: '格式和事实项已核对',
    });
    const updated = repository.updateStatus(manuscript.id, 'first-review', '测试编辑');

    expect(artifact?.origin).toBe('mixed');
    expect(review?.decision).toBe('approved');
    expect(updated?.status).toBe('first-review');

    const aggregate = repository.getAggregate(manuscript.id);
    expect(aggregate?.artifacts).toHaveLength(1);
    expect(aggregate?.reviews).toHaveLength(1);
    expect(aggregate?.trace.map((event) => event.kind)).toEqual([
      'manuscript-created',
      'artifact-created',
      'review-recorded',
      'status-changed',
    ]);
  });

  it('does not create child records for an unknown manuscript', () => {
    expect(
      repository.addArtifact('missing', {
        kind: 'short-video-copy',
        content: '不会写入',
        origin: 'ai',
      }),
    ).toBeUndefined();
    expect(repository.getAggregate('missing')).toBeUndefined();
  });
});
