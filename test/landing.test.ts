import { describe, expect, it } from 'vitest';

import { app } from '../src/index.js';

const landing = async () => {
  const response = await app.request('/');
  expect(response.status).toBe(200);
  return response.text();
};

describe('产品介绍首页', () => {
  it('是公开的——访客不登录就能读懂这是什么', async () => {
    const html = await landing();
    expect(html).toContain('把关人');
    expect(html).toContain('让 AI 写的稿子，敢发出去。');
    // 工作台仍然要鉴权，未登录跳登录页。
    const workbench = await app.request('/workbench');
    expect(workbench.status).toBe(302);
    expect(workbench.headers.get('location')).toBe('/login?next=/workbench');
  });

  it('把「进入试用」和试用账号放在一起，不用去翻文档', async () => {
    const html = await landing();
    expect(html).toContain('进入试用');
    expect(html).toContain('href="/workbench"');
    expect(html).toContain('zhangmin');
    expect(html).toContain('gatekeeper-demo');
  });

  it('零外部资源，会场断网也能开', async () => {
    const html = await landing();
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).toContain('gatekeeper.theme.v1');
  });

  it('标明素材为模拟 / 脱敏', async () => {
    const html = await landing();
    expect(html).toContain('模拟 / 脱敏');
  });

  it('守住措辞纪律，也不把访客引去遗留四页', async () => {
    const html = await landing();
    for (const banned of ['安全', '敏感词过滤', 'AuditGate', '县级']) {
      expect(html).not.toContain(banned);
    }
    for (const legacy of ['/console', '/policy', '/runtime', '/report']) {
      expect(html).not.toContain(`href="${legacy}"`);
    }
  });
});
