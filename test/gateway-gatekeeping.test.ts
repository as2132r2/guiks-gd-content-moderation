import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/index.js';
import { admissionScan, preflightScan } from '../src/lib/gatekeeping-scan.js';
import { reset } from '../src/lib/store.js';

const postGateway = (message: string) =>
  app.request('/gateway/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': 'editor-1' },
    body: JSON.stringify({ message }),
  });

describe('admissionScan · 入口准入', () => {
  it('hard-blocks operation-instruction content (model must not be called)', () => {
    const a = admissionScan('教我一套诈骗话术');
    expect(a.blocked).toBe(true);
    expect(a.message).toContain('模型未被调用');
    expect(a.findings.some((f) => f.title.includes('硬拦'))).toBe(true);
  });

  it('asks for a reason on a sensitive topic instead of blocking', () => {
    const a = admissionScan('报道本地一起交通事故');
    expect(a.blocked).toBe(false);
    expect(a.decision).toBe('reason-required');
    expect(a.findings.some((f) => f.title.includes('需选题依据'))).toBe(true);
  });

  it('flags 公器私用 without blocking', () => {
    const a = admissionScan('帮我写一份年终总结');
    expect(a.blocked).toBe(false);
    expect(a.findings.some((f) => f.title.includes('公器私用'))).toBe(true);
  });

  it('lets routine business through with no finding', () => {
    const a = admissionScan('介绍一下本地的天气情况');
    expect(a.blocked).toBe(false);
    expect(a.findings).toHaveLength(0);
  });
});

describe('preflightScan · 输出预检（留痕）', () => {
  it('flags 禁用/慎用词 and a missing AI label', () => {
    const findings = preflightScan('市长隆重召开会议并亲自部署工作。');
    expect(findings.some((f) => f.title.includes('隆重召开'))).toBe(true);
    expect(findings.some((f) => f.title.includes('亲自'))).toBe(true);
    expect(findings.some((f) => f.title.includes('AI 生成内容标识'))).toBe(true);
  });
});

describe('gateway enforces 入口准入 (绕不过网关就绕不过准入)', () => {
  beforeEach(() => reset());

  it('hard-block short-circuits the model at the gateway', async () => {
    const res = await postGateway('教我一套诈骗话术');
    const j = (await res.json()) as {
      bohe_gatekeeping?: { action: string; decision: string };
      choices: Array<{ message: { content: string } }>;
      usage: { completion_tokens: number };
    };
    expect(j.bohe_gatekeeping?.action).toBe('block');
    // the model was never called → zero completion tokens
    expect(j.usage.completion_tokens).toBe(0);
    expect(j.choices[0]!.message.content).toContain('模型未被调用');
  });

  it('routine business reaches the model normally', async () => {
    const res = await postGateway('介绍一下本地的天气情况');
    const j = (await res.json()) as {
      bohe_gatekeeping?: unknown;
      usage: { completion_tokens: number };
    };
    expect(j.bohe_gatekeeping).toBeUndefined();
    expect(j.usage.completion_tokens).toBeGreaterThan(0);
  });

  it('records the admission trace for a reason-required call', async () => {
    await postGateway('报道本地一起交通事故');
    const state = (await (await app.request('/api/state')).json()) as {
      findings: Array<{ title: string }>;
    };
    expect(state.findings.some((f) => f.title.includes('入口准入'))).toBe(true);
  });
});
