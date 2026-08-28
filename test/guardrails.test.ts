import { beforeEach, describe, expect, it } from 'vitest';
import { applyGuardrail, evaluateGuardrails, redactText } from '../src/lib/guardrails.js';
import { PLANTED } from '../src/lib/planted.js';
import { resetPolicy } from '../src/lib/policy.js';
import type { Finding, FindingCategory, Severity } from '../src/types.js';

const f = (category: FindingCategory, severity: Severity = 'high'): Finding => ({
  id: 'x',
  ts: 0,
  severity,
  category,
  title: 't',
  detail: 'd',
});

describe('evaluateGuardrails (default policy)', () => {
  beforeEach(() => resetPolicy());

  it('maps categories to actions and records who tripped them', () => {
    expect(evaluateGuardrails([f('pii')], 'u1').action).toBe('redact');
    expect(evaluateGuardrails([f('secret', 'critical')], 'u1').action).toBe('block');
    expect(evaluateGuardrails([f('injection')], 'u1').action).toBe('flag');
    const v = evaluateGuardrails([f('pii')], '赵雪');
    expect(v.events[0]?.user).toBe('赵雪');
    expect(v.events[0]?.guardrail).toBe('个人信息防护');
  });

  it('picks the strictest action when several fire', () => {
    const v = evaluateGuardrails([f('injection'), f('pii'), f('secret', 'critical')], 'u');
    expect(v.action).toBe('block');
    expect(v.events.length).toBe(3);
  });

  it('returns none when there is nothing to act on', () => {
    expect(evaluateGuardrails([], 'u').action).toBe('none');
  });
});

describe('redactText', () => {
  it('masks planted secrets, PII, and extra terms', () => {
    const raw = `密钥 ${PLANTED.apiKey}，手机 ${PLANTED.customers[0]!.phone}，代号 北斗`;
    const out = redactText(raw, ['北斗']);
    expect(out).not.toContain(PLANTED.apiKey);
    expect(out).not.toContain(PLANTED.customers[0]!.phone);
    expect(out).not.toContain('北斗');
  });
});

describe('applyGuardrail', () => {
  it('blocks by withholding the reply', () => {
    const out = applyGuardrail('这是密钥 sk-x', { action: 'block', events: [], matchedTerms: [] });
    expect(out).toContain('已被企业安全护栏拦截');
  });
  it('redacts PII and matched terms in place', () => {
    const out = applyGuardrail(`手机 ${PLANTED.customers[0]!.phone} 竞品驰安`, {
      action: 'redact',
      events: [],
      matchedTerms: ['驰安'],
    });
    expect(out).not.toContain(PLANTED.customers[0]!.phone);
    expect(out).not.toContain('驰安');
  });
  it('passes a clean reply through on flag/none', () => {
    expect(applyGuardrail('您好', { action: 'flag', events: [], matchedTerms: [] })).toBe('您好');
    expect(applyGuardrail('您好', { action: 'none', events: [], matchedTerms: [] })).toBe('您好');
  });
});
