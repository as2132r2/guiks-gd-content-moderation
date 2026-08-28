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

  it('persists the admission verdict independently from the active term list', () => {
    const manuscript = repository.createManuscript({
      title: '准入固化',
      sourceType: 'notice',
      sourceText: '模拟素材。',
    });
    repository.saveAdmissionResult(manuscript.id, {
      decision: 'reason-required',
      reasonCode: 'sensitive-topic',
      message: '请填写选题依据。',
      hits: [{ ruleId: 'AD-R-TEST', evidence: '事故' }],
    });

    expect(repository.getAdmissionResult(manuscript.id)).toEqual({
      decision: 'reason-required',
      reasonCode: 'sensitive-topic',
      message: '请填写选题依据。',
      hits: [{ ruleId: 'AD-R-TEST', evidence: '事故' }],
    });
  });

  it('derives AI 参与度 from sentence origins and recomputes it on a rewrite', () => {
    const manuscript = repository.createManuscript({
      title: '句级来源测试',
      sourceType: 'notice',
      sourceText: '模拟素材原文。',
    });

    const artifact = repository.addArtifact(manuscript.id, {
      kind: 'broadcast-script',
      content: '三句全新生成，一句引自原文。',
      origin: 'ai',
      aiShare: 0.1, // ignored: the sentences are the authority
      model: 'test-model',
      segments: [
        { text: '第一句由模型生成。', origin: 'ai' },
        { text: '第二句由模型生成。', origin: 'ai' },
        { text: '第三句由模型生成。', origin: 'ai' },
        { text: '第四句引自原通稿。', origin: 'source', sourceRef: '原文第 2 段' },
      ],
    });

    expect(artifact?.aiShare).toBe(0.75);
    // Declared 'ai', but one sentence is quoted: the sentences win.
    expect(artifact?.origin).toBe('mixed');

    const rewritten = repository.replaceArtifactSegments(manuscript.id, artifact!.id, {
      actor: '编辑甲',
      segments: [
        { text: '第一句由模型生成。', origin: 'ai' },
        { text: '第二句编辑改过。', origin: 'ai-edited' },
        { text: '第三句编辑重写。', origin: 'human' },
        { text: '第四句引自原通稿。', origin: 'source', sourceRef: '原文第 2 段' },
      ],
    });

    expect(rewritten?.artifact.aiShare).toBe(0.375);
    expect(rewritten?.artifact.origin).toBe('mixed');

    const aggregate = repository.getAggregate(manuscript.id);
    expect(aggregate?.artifacts[0]?.aiShare).toBe(0.375);
    expect(aggregate?.artifacts[0]?.origin).toBe('mixed');
    expect(aggregate?.segments.map((segment) => segment.ordinal)).toEqual([0, 1, 2, 3]);
    expect(aggregate?.segments.map((segment) => segment.origin)).toEqual([
      'ai',
      'ai-edited',
      'human',
      'source',
    ]);
    expect(aggregate?.segments[3]?.sourceRef).toBe('原文第 2 段');


    const recorded = aggregate?.trace.find((event) => event.kind === 'segments-recorded');
    expect(recorded?.actor).toBe('编辑甲');
    expect(recorded?.data).toMatchObject({
      aiShare: 0.375,
      previousAiShare: 0.75,
      origin: 'mixed',
      previousOrigin: 'mixed',
    });
  });

  it('relabels an artifact as human once no AI sentence survives', () => {
    const manuscript = repository.createManuscript({
      title: '全部重写',
      sourceType: 'notice',
      sourceText: '模拟素材原文。',
    });
    const artifact = repository.addArtifact(manuscript.id, {
      kind: 'broadcast-script',
      content: '模型初稿。',
      origin: 'human',
      model: 'test-model',
      segments: [{ text: '第一句由模型生成。', origin: 'ai' }],
    });
    expect(artifact?.origin).toBe('ai');
    expect(artifact?.aiShare).toBe(1);

    const rewritten = repository.replaceArtifactSegments(manuscript.id, artifact!.id, {
      actor: '分管领导',
      segments: [
        { text: '这一句领导重写。', origin: 'human' },
        { text: '这一句引自原通稿。', origin: 'source' },
      ],
    });
    expect(rewritten?.artifact.origin).toBe('human');
    expect(rewritten?.artifact.aiShare).toBe(0);
  });

  it('will not rewrite sentences of an artifact from another manuscript', () => {
    const owner = repository.createManuscript({
      title: '甲稿',
      sourceType: 'notice',
      sourceText: '甲稿原文。',
    });
    const other = repository.createManuscript({
      title: '乙稿',
      sourceType: 'notice',
      sourceText: '乙稿原文。',
    });
    const artifact = repository.addArtifact(owner.id, {
      kind: 'short-video-copy',
      content: '甲稿文案。',
      origin: 'ai',
      segments: [{ text: '甲稿文案。', origin: 'ai' }],
    });

    expect(
      repository.replaceArtifactSegments(other.id, artifact!.id, {
        actor: '编辑乙',
        segments: [{ text: '越权改写。', origin: 'human' }],
      }),
    ).toBeUndefined();
    expect(repository.listArtifactSegments(artifact!.id).map((s) => s.origin)).toEqual(['ai']);
  });
});
