import { describe, expect, it } from 'vitest';
import {
  checkTransition,
  nextActions,
  primaryAction,
  stageOf,
  transitions,
  waitingOn,
} from '../src/domain/workflow.js';

describe('稿件状态机', () => {
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
      checkTransition({ from: 'second-review', to: 'first-review', actor: 'department-head' })?.code,
    ).toBe('reason_required');

    expect(
      checkTransition({
        from: 'second-review',
        to: 'first-review',
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
        reason: '县应急管理局已授权发布。',
      }),
    ).toBeNull();
  });

  it('offers exactly one primary action per role, so the page has one button', () => {
    for (const status of ['admitted', 'generated', 'preflight', 'first-review', 'second-review', 'final-review'] as const) {
      const owner = waitingOn(status);
      expect(owner).toBeDefined();
      const advances = nextActions(status, owner!).filter((move) => move.kind === 'advance');
      expect(advances).toHaveLength(1);
      expect(primaryAction(status, owner!)).toBeDefined();
    }
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
    expect(stageOf('published')).toBe('trace');
  });

  it('records a review stage on every human handoff', () => {
    const humanMoves = transitions.filter((move) => move.actor !== 'system' && move.to !== 'published');
    for (const move of humanMoves) {
      if (move.from === 'admitted' || move.from === 'preflight') continue; // 生产步骤不算审次
      expect(move.stage).toBeDefined();
    }
  });
});
