import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { app } from '../src/index.js';

/**
 * 介绍页上「试用手册」那个按钮指着 `/manual`。这组用例挡的是两种坏法：
 * 手册没随构建发布（按钮点开是死的），以及手册和仓库里那份说法不一致。
 */
describe('试用手册在线版', () => {
  it('is public, because the button sits before the login wall', async () => {
    const response = await app.request('/manual');
    expect(response.status).toBe(200);
  });

  it('serves the same document the repo keeps, not a second copy of the copy', async () => {
    const html = await (await app.request('/manual')).text();
    const source = readFileSync('docs/deploy/user-manual.html', 'utf8');
    // 只比正文特征，不比整串——构建时会拷贝，行尾可能被规范化。
    expect(html).toContain('把关人 · 试用手册');
    expect(source).toContain('把关人 · 试用手册');
    expect(html.length).toBeGreaterThan(source.length * 0.9);
  });

  it('carries the trial accounts, which is what the button promises', async () => {
    // 按钮的提示语是「试用账号和口令都写在手册里」。这条兑现它。
    const html = await (await app.request('/manual')).text();
    for (const account of ['zhangmin', 'lijianguo', 'wangzhiyuan', 'stationadmin', 'chenxue']) {
      expect(html, `手册缺 ${account}`).toContain(account);
    }
    expect(html).toContain('gatekeeper-demo');
  });

  it('loads nothing from the network', async () => {
    const html = await (await app.request('/manual')).text();
    expect(html.match(/https?:\/\/(?!www\.w3\.org)[^"')\s]+/g) ?? []).toEqual([]);
  });
});
