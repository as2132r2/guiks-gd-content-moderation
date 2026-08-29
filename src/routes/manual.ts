/**
 * 试用手册的在线版。
 *
 * **公开，不要求登录**——它是给还没登录的人看的：介绍页上那个按钮在登录之前，
 * 试用账号和口令本来就写在手册里（`docs/deploy/README.md` 解释了为什么口令
 * 是公开的：对外试用要让人拿来就能登）。
 *
 * 内容的唯一事实来源是 [docs/deploy/user-manual.html](../../docs/deploy/user-manual.html)，
 * 和 `user-manual.md` 同源。**这里不重写一份文案**，改手册只改那两份。
 *
 * 构建时由 `scripts/copy-assets.mjs` 拷进 `dist/assets/`——部署只带 `dist/`，
 * 直接读 `docs/` 在服务器上是空的。
 */
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';

export const manualRoutes = new Hono();

/**
 * 候选路径：构建产物优先，其次是仓库原件（`npm run dev` 直接跑 TS 时用）。
 * 找不到不抛——手册缺失不该让整个服务起不来，但要说清楚缺的是什么。
 */
const CANDIDATES = [
  new URL('../assets/user-manual.html', import.meta.url),
  new URL('../../docs/deploy/user-manual.html', import.meta.url),
];

function loadManual(): string | undefined {
  for (const candidate of CANDIDATES) {
    try {
      return readFileSync(candidate, 'utf8');
    } catch {
      // 试下一个
    }
  }
  return undefined;
}

const manual = loadManual();

const MISSING = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>试用手册未随本次构建发布</title></head><body style="font:16px/1.7 system-ui;max-width:38rem;margin:4rem auto;padding:0 1.5rem">
<h1 style="font-size:1.4rem">试用手册未随本次构建发布</h1>
<p>这次构建里没有 <code>dist/assets/user-manual.html</code>。构建时应由
<code>npm run build</code> 调用 <code>scripts/copy-assets.mjs</code> 拷贝，
请检查发布流程是否跳过了这一步。</p>
<p>手册原件在仓库的 <code>docs/deploy/user-manual.md</code>。</p>
<p><a href="/">返回首页</a></p></body></html>`;

manualRoutes.get('/manual', (c) =>
  manual ? c.html(manual) : c.html(MISSING, 503),
);
