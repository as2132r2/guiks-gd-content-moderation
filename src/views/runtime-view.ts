// 薄荷监理台 · AuditGate — runtime monitoring console (dark), the post-deploy
// sibling of the pre-deploy red-team dashboard in ./console.ts.
//
// Self-contained HTML document: all CSS + JS inline, zero external resources
// (no CDN, no web fonts, no remote images) so it renders offline on congested
// conference WiFi. System fonts only.
//
// Purpose — what enterprises want to see AFTER deployment:
//   1. 谁用了多少 token   (per-user token accounting)
//   2. 触发了哪些 guardrail (what got blocked / redacted / flagged, by whom)

/** Escape a string for safe interpolation into HTML text/attribute context. */
function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render the runtime monitoring dashboard as a complete HTML document string.
 *
 * The page boots by GET /api/usage (a UsageSnapshot), then subscribes to
 * /events (SSE) for named events: usage, guardrail, status. The
 * 「模拟用户使用」 button drives POST /api/runtime/simulate; results stream
 * back over SSE. A back-link points to `/` (the pre-deploy audit dashboard).
 */
export function renderRuntime(opts: { targetLabel: string }): string {
  const targetLabel = escapeHtml(opts.targetLabel ?? '');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<title>薄荷监理台 · 运行时监控</title>
<style>
  :root {
    --bg:#0E1512; --panel:#141D19; --panel-2:#18231E; --ink:#E9F0EB; --muted:#9DB0A5; --faint:#6C7E74;
    --line:rgba(233,240,235,.11); --line-strong:rgba(233,240,235,.2);
    --accent:#33D6A2; --accent-deep:#7FEBCB; --accent-soft:rgba(51,214,162,.13);
    --block:#F0705F; --block-soft:rgba(240,112,95,.15);
    --redact:#E0A94A; --redact-soft:rgba(224,169,74,.14);
    --flag:#9DB0A5;
    --mono: ui-monospace,'SF Mono',Menlo,Consolas,monospace;
    --sans: system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;
    --serif: 'Songti SC','Noto Serif SC',serif;
    --radius:12px;
  }

  * { box-sizing:border-box; }
  html,body { margin:0; padding:0; }
  body {
    background:var(--bg);
    color:var(--ink);
    font-family:var(--sans);
    font-size:14px;
    line-height:1.5;
    -webkit-font-smoothing:antialiased;
    text-rendering:optimizeLegibility;
    min-height:100vh;
    background-image:
      radial-gradient(1200px 600px at 78% -8%, rgba(51,214,162,.05), transparent 60%),
      radial-gradient(900px 500px at 8% 108%, rgba(51,214,162,.035), transparent 55%);
    background-attachment:fixed;
  }

  .mono { font-family:var(--mono); font-variant-numeric:tabular-nums; }
  .nums { font-variant-numeric:tabular-nums; }

  /* ---------- Header ---------- */
  header.topbar {
    position:sticky; top:0; z-index:20;
    display:flex; align-items:center; gap:20px; flex-wrap:wrap;
    padding:14px 22px;
    background:linear-gradient(180deg, rgba(20,29,25,.96), rgba(20,29,25,.86));
    backdrop-filter:blur(10px);
    border-bottom:1px solid var(--line-strong);
  }
  .brand { display:flex; flex-direction:column; gap:2px; min-width:0; }
  .brand .name {
    font-family:var(--serif);
    font-size:19px; font-weight:600; letter-spacing:.3px;
    display:flex; align-items:center; gap:10px;
  }
  .brand .name .dot {
    width:9px; height:9px; border-radius:50%;
    background:var(--accent);
    box-shadow:0 0 0 4px var(--accent-soft), 0 0 12px rgba(51,214,162,.6);
  }
  .brand .sub {
    font-family:var(--mono); font-size:11px; letter-spacing:.6px;
    color:var(--faint); text-transform:uppercase;
  }

  .target-field {
    display:flex; align-items:center; gap:10px;
    padding:7px 12px;
    background:var(--panel-2);
    border:1px solid var(--line); border-radius:10px;
    max-width:360px; min-width:0;
  }
  .target-field .lbl {
    font-size:11px; color:var(--faint); font-family:var(--mono);
    text-transform:uppercase; letter-spacing:.6px; white-space:nowrap;
  }
  .target-field .val {
    font-family:var(--mono); font-size:13px; color:var(--accent-deep);
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  }

  .actions { display:flex; align-items:center; gap:12px; margin-left:auto; flex-wrap:wrap; }

  a.backlink {
    font-family:var(--mono); font-size:12px; letter-spacing:.3px;
    color:var(--muted); text-decoration:none;
    padding:8px 12px; border-radius:9px;
    border:1px solid var(--line); background:var(--panel-2);
    transition:color .15s ease, border-color .15s ease, background .15s ease;
    white-space:nowrap;
  }
  a.backlink:hover { color:var(--accent-deep); border-color:rgba(51,214,162,.35); background:#20302A; }

  button.btn {
    font-family:var(--sans); font-size:13px; font-weight:500;
    color:var(--ink);
    padding:9px 16px;
    background:var(--panel-2);
    border:1px solid var(--line-strong);
    border-radius:10px;
    cursor:pointer;
    transition:background .15s ease, border-color .15s ease, transform .06s ease, opacity .15s ease;
    white-space:nowrap;
  }
  button.btn:hover { background:#20302A; border-color:var(--accent); }
  button.btn:active { transform:translateY(1px); }
  button.btn:disabled { opacity:.5; cursor:default; }
  button.btn.primary {
    background:linear-gradient(180deg, rgba(51,214,162,.22), rgba(51,214,162,.12));
    border-color:rgba(51,214,162,.5); color:var(--accent-deep);
  }
  button.btn.primary:hover { background:linear-gradient(180deg, rgba(51,214,162,.3), rgba(51,214,162,.16)); }

  .pill {
    display:inline-flex; align-items:center; gap:8px;
    font-family:var(--mono); font-size:12px; letter-spacing:.4px;
    padding:7px 13px; border-radius:999px;
    border:1px solid var(--line-strong);
    background:var(--panel-2); color:var(--muted);
    white-space:nowrap;
  }
  .pill .beacon {
    width:8px; height:8px; border-radius:50%; background:var(--faint);
    box-shadow:0 0 0 3px rgba(108,126,116,.18);
  }
  .pill[data-state="monitoring"] { color:var(--accent-deep); border-color:rgba(51,214,162,.4); }
  .pill[data-state="monitoring"] .beacon { background:var(--accent); box-shadow:0 0 0 3px var(--accent-soft); animation:pulse 1.4s ease-in-out infinite; }
  .pill[data-state="done"] { color:var(--accent-deep); border-color:rgba(51,214,162,.4); }
  .pill[data-state="done"] .beacon { background:var(--accent); box-shadow:0 0 0 3px var(--accent-soft); }

  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.35; } }

  /* ---------- Summary tiles ---------- */
  #summary {
    display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:14px;
    padding:18px 22px 2px;
    max-width:1560px; margin:0 auto;
  }
  .tile {
    position:relative; overflow:hidden;
    background:var(--panel);
    border:1px solid var(--line);
    border-radius:var(--radius);
    padding:15px 17px;
    display:flex; flex-direction:column; gap:8px; min-width:0;
  }
  .tile::before {
    content:''; position:absolute; left:0; top:0; height:2px; width:100%;
    background:linear-gradient(90deg, var(--accent-soft), transparent 70%);
  }
  .tile .tlabel {
    display:flex; align-items:center; gap:8px;
    font-family:var(--mono); font-size:10px; letter-spacing:1px;
    text-transform:uppercase; color:var(--faint);
  }
  .tile .tlabel .en { color:var(--faint); opacity:.7; }
  .tile .tnum {
    font-family:var(--mono); font-size:30px; font-weight:600; line-height:1;
    font-variant-numeric:tabular-nums; color:var(--ink);
  }
  .tile .tsub {
    font-family:var(--mono); font-size:11.5px; color:var(--muted);
    font-variant-numeric:tabular-nums; letter-spacing:.3px;
  }
  .tile .tsub .up { color:var(--accent-deep); }
  .tile.guard .tnum.hot { color:var(--block); }
  .tile.guard.hot::before { background:linear-gradient(90deg, var(--block-soft), transparent 70%); }

  /* ---------- Layout ---------- */
  main {
    display:grid;
    grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);
    gap:16px;
    padding:16px 22px 40px;
    max-width:1560px; margin:0 auto;
    align-items:start;
  }

  .panel {
    background:var(--panel);
    border:1px solid var(--line);
    border-radius:var(--radius);
    overflow:hidden;
    display:flex; flex-direction:column;
    min-width:0;
  }
  .panel > .head {
    display:flex; align-items:center; gap:10px;
    padding:12px 16px;
    border-bottom:1px solid var(--line);
    background:linear-gradient(180deg, rgba(24,35,30,.6), transparent);
  }
  .panel > .head h2 {
    margin:0; font-family:var(--serif); font-size:15px; font-weight:600; letter-spacing:.4px;
  }
  .panel > .head .en {
    font-family:var(--mono); font-size:10px; color:var(--faint);
    text-transform:uppercase; letter-spacing:1px;
  }
  .panel > .head .count {
    margin-left:auto; font-family:var(--mono); font-size:11px; color:var(--muted);
    background:var(--panel-2); border:1px solid var(--line);
    padding:3px 9px; border-radius:999px;
  }
  .panel > .body { padding:0; overflow:auto; }
  .user-body { max-height:calc(100vh - 300px); min-height:180px; }
  .feed-body { max-height:calc(100vh - 300px); min-height:180px; }

  .empty {
    padding:34px 20px; text-align:center; color:var(--faint);
    font-family:var(--mono); font-size:12px; letter-spacing:.5px;
  }

  /* ---------- User usage table ---------- */
  table.users { width:100%; border-collapse:collapse; }
  table.users thead th {
    position:sticky; top:0; z-index:1;
    font-family:var(--mono); font-size:10px; letter-spacing:.6px; text-transform:uppercase;
    color:var(--faint); font-weight:600; text-align:right;
    padding:10px 14px;
    background:var(--panel-2);
    border-bottom:1px solid var(--line-strong);
    white-space:nowrap;
  }
  table.users thead th.h-user { text-align:left; }
  table.users tbody td {
    padding:9px 14px;
    border-bottom:1px solid var(--line);
    font-variant-numeric:tabular-nums;
    white-space:nowrap;
  }
  table.users tbody tr:hover td { background:rgba(255,255,255,.018); }
  table.users tbody tr:last-child td { border-bottom:none; }
  td.c-user { font-family:var(--mono); font-size:12.5px; color:var(--ink); text-align:left; }
  td.c-num { text-align:right; font-family:var(--mono); font-size:12.5px; color:var(--muted); }
  td.c-in { color:var(--muted); }
  td.c-out { color:var(--muted); }
  td.c-total {
    position:relative; text-align:right;
    font-family:var(--mono); font-size:13px; font-weight:600; color:var(--ink);
    min-width:132px;
  }
  td.c-total .share {
    position:absolute; left:12px; top:50%; transform:translateY(-50%);
    height:62%; border-radius:5px;
    background:linear-gradient(90deg, var(--accent-soft), rgba(51,214,162,.05));
    border:1px solid rgba(51,214,162,.22);
    z-index:0; pointer-events:none;
    transition:width .5s cubic-bezier(.22,.61,.36,1);
  }
  td.c-total .tv { position:relative; z-index:1; }
  td.c-hits { text-align:right; font-family:var(--mono); font-size:12.5px; color:var(--faint); }
  td.c-hits.hot { color:var(--block); font-weight:600; }

  /* ---------- Guardrail feed ---------- */
  .g-card {
    padding:11px 16px;
    border-bottom:1px solid var(--line);
    border-left:3px solid var(--flag);
  }
  .g-card.act-block { border-left-color:var(--block); background:var(--block-soft); }
  .g-card.act-redact { border-left-color:var(--redact); background:var(--redact-soft); }
  .g-card.act-flag { border-left-color:var(--flag); }
  .g-card .g-top { display:flex; align-items:center; gap:10px; margin-bottom:5px; flex-wrap:wrap; }
  .g-card .g-time { font-family:var(--mono); font-size:11.5px; color:var(--faint); font-variant-numeric:tabular-nums; }
  .g-card .g-user { font-family:var(--mono); font-size:12px; color:var(--accent-deep); }
  .g-card .g-chip {
    margin-left:auto;
    font-family:var(--mono); font-size:10px; font-weight:600; letter-spacing:.6px;
    padding:2px 9px; border-radius:7px;
    border:1px solid var(--line-strong); color:var(--muted);
    white-space:nowrap;
  }
  .g-card .g-chip.block { color:#FFC7BD; background:var(--block-soft); border-color:rgba(240,112,95,.55); }
  .g-card .g-chip.redact { color:#F3DDAE; background:var(--redact-soft); border-color:rgba(224,169,74,.55); }
  .g-card .g-chip.flag { color:var(--muted); background:var(--panel-2); }
  .g-card .g-mid { display:flex; align-items:baseline; gap:9px; flex-wrap:wrap; }
  .g-card .g-name { font-size:13px; font-weight:600; color:var(--ink); }
  .g-card .g-cat { font-family:var(--mono); font-size:11px; color:var(--faint); letter-spacing:.4px; }
  .g-card .g-ev {
    margin-top:7px; font-family:var(--mono); font-size:11.5px; color:var(--accent-deep);
    background:#0C1310; border:1px solid var(--line); border-radius:8px;
    padding:7px 10px; overflow-x:auto; white-space:pre-wrap; word-break:break-word;
  }

  @media (prefers-reduced-motion:no-preference) {
    .g-card.enter { animation:cardIn .32s cubic-bezier(.22,.61,.36,1); }
  }
  @keyframes cardIn {
    from { opacity:0; transform:translateY(-8px); }
    to { opacity:1; transform:translateY(0); }
  }

  /* ---------- Responsive ---------- */
  @media (max-width:900px) {
    #summary { grid-template-columns:repeat(2, minmax(0,1fr)); }
    main { grid-template-columns:1fr; }
    .user-body, .feed-body { max-height:none; }
    header.topbar { gap:12px; }
    .target-field { max-width:100%; order:3; flex:1 1 100%; }
    .actions { width:100%; }
  }
  @media (max-width:560px) {
    #summary { grid-template-columns:1fr; }
    table.users thead th.h-in, table.users thead th.h-out,
    table.users tbody td.c-in, table.users tbody td.c-out { display:none; }
  }
  ::-webkit-scrollbar { width:10px; height:10px; }
  ::-webkit-scrollbar-thumb { background:rgba(233,240,235,.12); border-radius:99px; border:2px solid transparent; background-clip:padding-box; }
  ::-webkit-scrollbar-thumb:hover { background:rgba(233,240,235,.2); background-clip:padding-box; }
</style>
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <div class="name"><span class="dot"></span>薄荷监理台 · AuditGate</div>
      <div class="sub">运行时监控 · 部署后保障</div>
    </div>
    <div class="target-field" title="监控目标">
      <span class="lbl">监控目标</span>
      <span class="val" id="target-label">${targetLabel}</span>
    </div>
    <div class="actions">
      <a class="backlink" href="/" title="返回采购体检面板">← 采购体检</a>
      <a class="backlink" href="/policy" title="配置企业安全护栏策略">安全护栏策略 →</a>
      <span class="pill" id="status-pill" data-state="idle"><span class="beacon"></span><span id="status-text">idle</span></span>
      <button class="btn primary" id="btn-simulate" type="button">模拟用户使用</button>
    </div>
  </header>

  <section id="summary" aria-label="企业用量概览">
    <div class="tile">
      <div class="tlabel">活跃用户 <span class="en">Active Users</span></div>
      <div class="tnum" id="m-users">0</div>
      <div class="tsub" id="m-users-sub">当前接入的终端用户</div>
    </div>
    <div class="tile">
      <div class="tlabel">总请求 <span class="en">Requests</span></div>
      <div class="tnum" id="m-requests">0</div>
      <div class="tsub" id="m-requests-sub">已代理的推理请求</div>
    </div>
    <div class="tile">
      <div class="tlabel">总 Token <span class="en">Tokens</span></div>
      <div class="tnum" id="m-tokens">0</div>
      <div class="tsub" id="m-tokens-sub"><span id="m-tokens-in">0</span>↓ 输入 · <span class="up" id="m-tokens-out">0</span>↑ 输出</div>
    </div>
    <div class="tile guard" id="tile-guard">
      <div class="tlabel">安全护栏触发 <span class="en">Guardrails</span></div>
      <div class="tnum" id="m-guard">0</div>
      <div class="tsub" id="m-guard-sub">拦截 / 打码 / 标记累计</div>
    </div>
  </section>

  <main>
    <section class="panel col-left">
      <div class="head">
        <h2>用户用量</h2><span class="en">Who Used What</span>
        <span class="count" id="user-count">0</span>
      </div>
      <div class="body user-body">
        <table class="users">
          <thead>
            <tr>
              <th class="h-user">用户</th>
              <th>请求数</th>
              <th class="h-in">Token 输入 ↓</th>
              <th class="h-out">Token 输出 ↑</th>
              <th>合计</th>
              <th>安全护栏命中</th>
            </tr>
          </thead>
          <tbody id="user-rows"></tbody>
        </table>
        <div class="empty" id="user-empty">暂无用户流量 · 点击「模拟用户使用」生成样本</div>
      </div>
    </section>

    <section class="panel col-right">
      <div class="head">
        <h2>安全护栏触发流</h2><span class="en">Guardrail Feed</span>
        <span class="count" id="feed-count">0</span>
      </div>
      <div class="body feed-body">
        <div id="guardrail-feed"></div>
        <div class="empty" id="feed-empty">暂无安全护栏触发</div>
      </div>
    </section>
  </main>

<script>
(function () {
  'use strict';

  // ---------- helpers ----------
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtTime(ts) {
    var n = Number(ts);
    if (!isFinite(n)) return '--:--:--';
    var d = new Date(n);
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : Number(v) || 0; }
  function fmtNum(v) {
    var n = num(v);
    var neg = n < 0;
    n = Math.abs(Math.round(n));
    var s = String(n), out = '', c = 0;
    for (var i = s.length - 1; i >= 0; i--) {
      out = s.charAt(i) + out;
      if (++c % 3 === 0 && i > 0) out = ',' + out;
    }
    return neg ? '-' + out : out;
  }
  function totalTokens(u) { return num(u && u.tokensIn) + num(u && u.tokensOut); }

  var $ = function (id) { return document.getElementById(id); };

  // ---------- element refs ----------
  var userRows = $('user-rows');
  var userEmpty = $('user-empty');
  var userCount = $('user-count');
  var feed = $('guardrail-feed');
  var feedEmpty = $('feed-empty');
  var feedCount = $('feed-count');
  var statusPill = $('status-pill');
  var statusText = $('status-text');
  var tileGuard = $('tile-guard');
  var guardNumEl = $('m-guard');

  var seenGuardIds = Object.create(null);
  var feedN = 0;

  // ---------- summary tiles ----------
  function deriveTotals(users) {
    var t = { users: 0, requests: 0, tokensIn: 0, tokensOut: 0, guardrailHits: 0 };
    if (!users) return t;
    t.users = users.length;
    for (var i = 0; i < users.length; i++) {
      var u = users[i] || {};
      t.requests += num(u.requests);
      t.tokensIn += num(u.tokensIn);
      t.tokensOut += num(u.tokensOut);
      t.guardrailHits += num(u.guardrailHits);
    }
    return t;
  }

  function renderTiles(tot) {
    if (!tot || typeof tot !== 'object') tot = {};
    var tin = num(tot.tokensIn), tout = num(tot.tokensOut);
    var hits = num(tot.guardrailHits);
    $('m-users').textContent = fmtNum(tot.users);
    $('m-requests').textContent = fmtNum(tot.requests);
    $('m-tokens').textContent = fmtNum(tin + tout);
    $('m-tokens-in').textContent = fmtNum(tin);
    $('m-tokens-out').textContent = fmtNum(tout);
    guardNumEl.textContent = fmtNum(hits);
    if (hits > 0) { guardNumEl.classList.add('hot'); tileGuard.classList.add('hot'); }
    else { guardNumEl.classList.remove('hot'); tileGuard.classList.remove('hot'); }
  }

  // ---------- user usage table ----------
  function renderUsers(users) {
    var arr = (users && users.length) ? users.slice() : [];
    try { arr.sort(function (a, b) { return totalTokens(b) - totalTokens(a); }); } catch (e) {}

    var max = 0;
    for (var i = 0; i < arr.length; i++) {
      var t = totalTokens(arr[i]);
      if (t > max) max = t;
    }

    userRows.innerHTML = '';
    userCount.textContent = String(arr.length);
    if (!arr.length) { userEmpty.style.display = ''; return; }
    userEmpty.style.display = 'none';

    for (var j = 0; j < arr.length; j++) {
      var u = arr[j] || {};
      var tin = num(u.tokensIn), tout = num(u.tokensOut), tt = tin + tout;
      var hits = num(u.guardrailHits);
      var pct = max > 0 ? Math.max(2, Math.round((tt / max) * 100)) : 0;

      var tr = el('tr');

      var cUser = el('td', 'c-user'); cUser.textContent = u.user || '—'; tr.appendChild(cUser);
      var cReq = el('td', 'c-num'); cReq.textContent = fmtNum(u.requests); tr.appendChild(cReq);
      var cIn = el('td', 'c-num c-in'); cIn.textContent = fmtNum(tin); tr.appendChild(cIn);
      var cOut = el('td', 'c-num c-out'); cOut.textContent = fmtNum(tout); tr.appendChild(cOut);

      var cTotal = el('td', 'c-num c-total');
      var share = el('span', 'share'); share.style.width = 'calc(' + pct + '% - 12px)';
      var tv = el('span', 'tv'); tv.textContent = fmtNum(tt);
      cTotal.appendChild(share); cTotal.appendChild(tv);
      tr.appendChild(cTotal);

      var cHits = el('td', 'c-num c-hits' + (hits > 0 ? ' hot' : ''));
      cHits.textContent = fmtNum(hits);
      tr.appendChild(cHits);

      userRows.appendChild(tr);
    }
  }

  // ---------- guardrail feed ----------
  var ACTIONS = {
    block: { cls: 'block', label: '已拦截' },
    redact: { cls: 'redact', label: '已打码' },
    flag: { cls: 'flag', label: '已标记' }
  };

  function renderGuardrail(g, animate) {
    if (!g || typeof g !== 'object') return;
    if (g.id) {
      if (seenGuardIds[g.id]) return;
      seenGuardIds[g.id] = true;
    }
    var act = ACTIONS[g.action] || ACTIONS.flag;
    var sev = g.severity || 'info';
    var card = el('div', 'g-card sev-' + sev + ' act-' + act.cls + (animate ? ' enter' : ''));

    var top = el('div', 'g-top');
    var time = el('span', 'g-time'); time.textContent = fmtTime(g.ts); top.appendChild(time);
    var user = el('span', 'g-user'); user.textContent = g.user || '—'; top.appendChild(user);
    var chip = el('span', 'g-chip ' + act.cls); chip.textContent = act.label; top.appendChild(chip);
    card.appendChild(top);

    var mid = el('div', 'g-mid');
    var name = el('span', 'g-name'); name.textContent = g.guardrail || '(未命名规则)'; mid.appendChild(name);
    var cat = el('span', 'g-cat'); cat.textContent = g.category || ''; mid.appendChild(cat);
    card.appendChild(mid);

    if (g.evidence) {
      var ev = el('div', 'g-ev'); ev.textContent = g.evidence; card.appendChild(ev);
    }

    feed.insertBefore(card, feed.firstChild);
    feedN++;
    feedCount.textContent = String(feedN);
    if (feedEmpty) feedEmpty.style.display = 'none';
  }

  function setStatus(state, message) {
    var s = String(state || 'idle');
    statusPill.setAttribute('data-state', s);
    statusText.textContent = message ? (s + ' · ' + message) : s;
  }

  // ---------- snapshot application ----------
  function applySnapshot(snap) {
    if (!snap || typeof snap !== 'object') return;
    var users = snap.users || [];
    var totals = snap.totals || deriveTotals(users);
    renderTiles(totals);
    renderUsers(users);

    // Guardrail feed from the snapshot (newest first). Render oldest → newest
    // by prepending so the newest ends on top and dedup stays consistent.
    var events = snap.guardrailEvents || [];
    for (var i = events.length - 1; i >= 0; i--) {
      renderGuardrail(events[i], false);
    }
  }

  // ---------- initial state ----------
  function loadUsage() {
    fetch('/api/usage', { headers: { 'accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (snap) { if (snap) { try { applySnapshot(snap); } catch (e) {} } })
      .catch(function () { /* offline-friendly: ignore */ });
  }

  // ---------- SSE ----------
  function safeParse(raw) {
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  function connectEvents() {
    if (typeof EventSource === 'undefined') return;
    var src;
    try { src = new EventSource('/events'); } catch (e) { return; }

    src.addEventListener('usage', function (e) {
      var d = safeParse(e.data);
      if (d) { try { renderTiles(d.totals || deriveTotals(d.users || [])); renderUsers(d.users || []); } catch (err) {} }
    });
    src.addEventListener('guardrail', function (e) {
      var d = safeParse(e.data);
      if (d) { try { renderGuardrail(d, true); } catch (err) {} }
    });
    src.addEventListener('status', function (e) {
      var d = safeParse(e.data);
      if (d) { try { setStatus(d.state, d.message); } catch (err) {} }
    });
    // EventSource auto-reconnects on error; nothing to do here.
    src.onerror = function () { /* transient — browser will retry */ };
  }

  // ---------- actions ----------
  function busy(btn, ms) {
    if (!btn) return;
    btn.disabled = true;
    setTimeout(function () { btn.disabled = false; }, ms || 1600);
  }

  var btnSimulate = $('btn-simulate');
  btnSimulate.addEventListener('click', function () {
    busy(btnSimulate, 1600);
    setStatus('monitoring', '');
    fetch('/api/runtime/simulate', { method: 'POST' }).catch(function () {});
  });

  // ---------- boot ----------
  loadUsage();
  connectEvents();
})();
</script>
</body>
</html>`;
}
