import { describe, expect, it } from 'vitest';
import { evaluateGuardrails } from '../src/lib/guardrails.js';
import { applyPreset, defaultPolicy, normalize, resetPolicy } from '../src/lib/policy.js';
import type { Finding } from '../src/types.js';

const pii = (): Finding => ({ id: 'x', ts: 0, severity: 'high', category: 'pii', title: 't', detail: 'd' });

describe('policy normalize', () => {
  it('coerces partial / invalid input to a valid policy', () => {
    const p = normalize({ enterprise: '  ', denyTerms: ['a', '', '  b '], denyAction: 'nope' as never });
    expect(p.enterprise).toBe('默认企业');
    expect(p.denyTerms).toEqual(['a', 'b']);
    expect(p.denyAction).toBe('block'); // invalid → default
    expect(Object.keys(p.rules)).toHaveLength(5);
  });
});

describe('policy presets', () => {
  it('金融合规 tightens PII to block', () => {
    const p = applyPreset('金融合规（严格）');
    expect(p?.rules.pii.action).toBe('block');
    resetPolicy();
  });
  it('unknown preset returns null', () => {
    expect(applyPreset('不存在')).toBeNull();
  });
});

describe('policy-driven guardrails', () => {
  it('a disabled category produces no guardrail', () => {
    const policy = defaultPolicy();
    policy.rules.pii.enabled = false;
    expect(evaluateGuardrails([pii()], 'u', { message: '', reply: '' }, policy).action).toBe('none');
  });

  it('a custom deny term trips a guardrail on the reply', () => {
    const policy = defaultPolicy();
    policy.denyTerms = ['项目北斗'];
    policy.denyAction = 'block';
    const v = evaluateGuardrails([], 'u', { message: '进展如何', reply: '项目北斗已上线' }, policy);
    expect(v.action).toBe('block');
    expect(v.events[0]?.guardrail).toBe('自定义拦截词');
    expect(v.matchedTerms).toContain('项目北斗');
  });

  it('allow-listed users are downgraded to flag but still logged', () => {
    const policy = defaultPolicy();
    policy.allowUsers = ['财务负责人'];
    const v = evaluateGuardrails([pii()], '财务负责人', { message: '', reply: '' }, policy);
    expect(v.action).toBe('flag');
    expect(v.events).toHaveLength(1);
  });
});
