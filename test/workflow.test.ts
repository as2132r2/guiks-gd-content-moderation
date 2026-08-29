import { describe, expect, it } from 'vitest';
import {
  checkTransition,
  nextActions,
  primaryAction,
  proofreadResponsibilities,
  stageOf,
  transitions,
  waitingOn,
} from '../src/domain/workflow.js';

describe('稿件状态机', () => {
  it('declares one proofread responsibility for each review stage', () => {
    expect(proofreadResponsibilities.map((item) => item.pass)).toEqual([
      'first',
      'second',
      'third',
    ]);
    expect(proofreadResponsibilities.map((item) => item.stage)).toEqual([
      'editor',
      'department-head',
      'supervising-leader',
    ]);
    expect(proofreadResponsibilities.every((item) => item.responsibilities.length > 0)).toBe(true);
  });

  it('refuses the jump the workbench exists to prevent', () => {
    const refusal = checkTransition({ from: 'draft', to: 'signed', actor: 'editor' });
    expect(refusal?.code).toBe('illegal_transition');
  });

  it('keeps a terminal status terminal', () => {
    expect(checkTransition({ from: 'admission-blocked', to: 'admitted', actor: 'editor' })?.code).toBe(
      'terminal_status',
    );
    expect(checkTransition({ from: 'published', to: 'signed', actor: 'supervising-leader' })?.code).toBe(
      'terminal_status',
    );
  });

  it('holds each stage to its own role', () => {
    expect(checkTransition({ from: 'final-review', to: 'signed', actor: 'supervising-leader' })).toBeNull();

    const wrong = checkTransition({ from: 'final-review', to: 'signed', actor: 'editor' });
    expect(wrong?.code).toBe('wrong_role');
    expect(wrong && 'expected' in wrong && wrong.expected).toEqual(['supervising-leader']);
  });

  it('will not let a manuscript be returned without a reason', () => {
    expect(
      checkTransition({ from: 'second-review', to: 'revision', actor: 'department-head' })?.code,
    ).toBe('reason_required');

    expect(
      checkTransition({
        from: 'second-review',
        to: 'revision',
        actor: 'department-head',
        reason: '第二段数字与原通稿不符，请核对后再报。',
      }),
    ).toBeNull();
  });

  it('requires 选题依据 before the 要理由 gate opens', () => {
    expect(
      checkTransition({ from: 'admission-reason-required', to: 'admitted', actor: 'editor' })?.code,
    ).toBe('reason_required');

    expect(
      checkTransition({
        from: 'admission-reason-required',
        to: 'admitted',
        actor: 'editor',
        reason: '市应急管理局已授权发布。',
      }),
    ).toBeNull();
  });

  it('offers one primary action except for the explicit optional countersign branch', () => {
    for (const status of ['admitted', 'generated', 'preflight', 'first-review', 'final-review', 'revision'] as const) {
      const owner = waitingOn(status);
      expect(owner).toBeDefined();
      const advances = nextActions(status, owner!).filter((move) => move.kind === 'advance');
      expect(advances).toHaveLength(1);
      expect(primaryAction(status, owner!)).toBeDefined();
    }

    expect(
      nextActions('second-review', 'department-head')
        .filter((move) => move.kind === 'advance')
        .map((move) => move.to),
    ).toEqual(['final-review', 'countersign']);
  });

  it('gives a role nothing to do when it is not their turn', () => {
    expect(nextActions('second-review', 'editor')).toEqual([]);
    expect(waitingOn('second-review')).toBe('department-head');
  });

  it('maps every status onto a workbench stage', () => {
    expect(stageOf('draft')).toBe('source');
    expect(stageOf('admission-blocked')).toBe('admission');
    expect(stageOf('preflight')).toBe('preflight');
    expect(stageOf('final-review')).toBe('review');
    expect(stageOf('countersign')).toBe('review');
    expect(stageOf('revision')).toBe('review');
    expect(stageOf('published')).toBe('trace');
  });

  it('returns every review level to revision and then reruns preflight', () => {
    for (const [from, actor] of [
      ['first-review', 'editor'],
      ['second-review', 'department-head'],
      ['countersign', 'department-head'],
      ['final-review', 'supervising-leader'],
    ] as const) {
      expect(checkTransition({ from, to: 'revision', actor, reason: '请复核。' })).toBeNull();
    }
    expect(checkTransition({ from: 'revision', to: 'preflight', actor: 'editor' })).toBeNull();
  });

  it('records a review stage on every human handoff', () => {
    const humanMoves = transitions.filter((move) => move.actor !== 'system' && move.to !== 'published');
    for (const move of humanMoves) {
      if (move.from === 'admitted' || move.from === 'preflight') continue; // 生产步骤不算审次
      expect(move.stage).toBeDefined();
    }
  });
});
