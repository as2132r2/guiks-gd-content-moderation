// 薄荷监理台 · AuditGate — live security operations console (dark).
// Self-contained HTML document: all CSS + JS inline, zero external resources
// (no CDN, no web fonts, no remote images) so it renders offline on
// congested conference WiFi. System fonts only.

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
 * Render the live console dashboard as a complete HTML document string.
 *
 * The returned page boots by GET /api/state, then subscribes to /events (SSE)
 * for named events: audit, finding, probe, score, status. Buttons drive
 * POST /api/monitor/start, POST /api/redteam/run, and open /report.
 */
export function renderConsole(opts: { targetLabel: string }): string {
  const targetLabel = escapeHtml(opts.targetLabel ?? '');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<title>薄荷监理台 · AuditGate</title>
<style>
  :root {
    --bg:#0E1512; --panel:#141D19; --panel-2:#18231E; --ink:#E9F0EB; --muted:#9DB0A5; --faint:#6C7E74;
    --line:rgba(233,240,235,.11); --line-strong:rgba(233,240,235,.2);
    --accent:#33D6A2; --accent-deep:#7FEBCB; --accent-soft:rgba(51,214,162,.13);
    --critical:#F0705F; --critical-soft:rgba(240,112,95,.15); --high:#F0705F; --warn:#E0A94A; --warn-soft:rgba(224,169,74,.14); --ok:#33D6A2;
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
    /* very faint calm vignette — no busy scanlines */
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

  .actions { display:flex; align-items:center; gap:10px; margin-left:auto; flex-wrap:wrap; }

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
  button.btn.warn { border-color:rgba(224,169,74,.4); color:#F1D49A; }
  button.btn.warn:hover { background:var(--warn-soft); border-color:var(--warn); }

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
  .pill[data-state="redteam"] { color:#F1D49A; border-color:rgba(224,169,74,.45); }
  .pill[data-state="redteam"] .beacon { background:var(--warn); box-shadow:0 0 0 3px var(--warn-soft); animation:pulse 1s ease-in-out infinite; }
  .pill[data-state="done"] { color:var(--accent-deep); border-color:rgba(51,214,162,.4); }
  .pill[data-state="done"] .beacon { background:var(--accent); box-shadow:0 0 0 3px var(--accent-soft); }

  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.35; } }

  /* ---------- Layout ---------- */
  main {
    display:grid;
    grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);
    gap:16px;
    padding:16px 22px 40px;
    max-width:1560px; margin:0 auto;
    align-items:start;
  }
  .col-right { display:flex; flex-direction:column; gap:16px; min-width:0; }

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
  .audit-body { max-height:calc(100vh - 190px); }
  .findings-body { max-height:520px; }

  .empty {
    padding:34px 20px; text-align:center; color:var(--faint);
    font-family:var(--mono); font-size:12px; letter-spacing:.5px;
  }

  /* ---------- Audit stream ---------- */
  .audit-row {
    display:grid;
    grid-template-columns:82px 60px 130px 1fr auto;
    gap:12px; align-items:baseline;
    padding:9px 16px;
    border-bottom:1px solid var(--line);
    border-left:3px solid transparent;
  }
  .audit-row:hover { background:rgba(255,255,255,.018); }
  .audit-row .t { font-family:var(--mono); font-size:12px; color:var(--faint); font-variant-numeric:tabular-nums; }
  .audit-row .dir {
    font-family:var(--mono); font-size:10px; letter-spacing:.5px;
    padding:2px 7px; border-radius:6px; text-align:center;
    border:1px solid var(--line-strong); color:var(--muted);
    align-self:center;
  }
  .audit-row .dir.request { color:var(--accent-deep); border-color:rgba(51,214,162,.35); background:var(--accent-soft); }
  .audit-row .dir.response { color:#CBD8CF; }
  .audit-row .model { font-family:var(--mono); font-size:12px; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .audit-row .summary { color:var(--ink); font-size:13px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .audit-row .meta {
    font-family:var(--mono); font-size:11px; color:var(--faint);
    text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums;
  }
  .audit-row .meta .tok { color:var(--muted); }
  .audit-row.sev-critical, .audit-row.sev-high { border-left-color:var(--critical); }
  .audit-row.sev-medium { border-left-color:var(--warn); }
  .audit-row.sev-low, .audit-row.sev-info { border-left-color:var(--faint); }
  .audit-row .fbadge {
    display:inline-block; margin-left:8px; font-family:var(--mono); font-size:10px;
    color:var(--critical); border:1px solid rgba(240,112,95,.4); border-radius:5px; padding:0 5px;
  }

  @media (prefers-reduced-motion:no-preference) {
    .audit-row.enter { animation:rowIn .34s cubic-bezier(.22,.61,.36,1); }
    .finding-card.enter { animation:cardIn .3s ease; }
  }
  @keyframes rowIn {
    from { opacity:0; transform:translateY(-8px); background:var(--accent-soft); }
    to { opacity:1; transform:translateY(0); background:transparent; }
  }
  @keyframes cardIn { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }

  /* ---------- Findings feed ---------- */
  .finding-card {
    padding:12px 16px;
    border-bottom:1px solid var(--line);
    border-left:3px solid var(--faint);
  }
  .finding-card.sev-critical, .finding-card.sev-high { border-left-color:var(--critical); background:var(--critical-soft); }
  .finding-card.sev-medium { border-left-color:var(--warn); background:var(--warn-soft); }
  .finding-card .top { display:flex; align-items:center; gap:9px; margin-bottom:5px; flex-wrap:wrap; }
  .chip {
    font-family:var(--mono); font-size:10px; font-weight:600; letter-spacing:.6px; text-transform:uppercase;
    padding:2px 8px; border-radius:6px; border:1px solid var(--line-strong); color:var(--muted);
  }
  .chip.critical, .chip.high { color:#FFD9D2; background:var(--critical-soft); border-color:rgba(240,112,95,.55); }
  .chip.medium { color:#F3DDAE; background:var(--warn-soft); border-color:rgba(224,169,74,.55); }
  .chip.low, .chip.info { color:var(--muted); }
  .finding-card .cat { font-family:var(--mono); font-size:11px; color:var(--faint); letter-spacing:.4px; }
  .finding-card .t2 { font-family:var(--mono); font-size:11px; color:var(--faint); margin-left:auto; }
  .finding-card .title { font-size:13.5px; font-weight:600; color:var(--ink); margin:2px 0 3px; }
  .finding-card .detail { font-size:12.5px; color:var(--muted); }
  .finding-card .evidence {
    margin-top:7px; font-family:var(--mono); font-size:11.5px; color:var(--accent-deep);
    background:#0C1310; border:1px solid var(--line); border-radius:8px;
    padding:7px 10px; overflow-x:auto; white-space:pre-wrap; word-break:break-word;
  }

  /* ---------- Scorecard ---------- */
  #scorecard { padding:16px; }
  .score-hero { display:flex; align-items:center; gap:18px; margin-bottom:16px; }
  .grade-box {
    width:104px; height:104px; border-radius:16px; flex-shrink:0;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    border:1px solid var(--line-strong); background:var(--panel-2);
  }
  .grade-box .grade { font-family:var(--serif); font-size:52px; font-weight:700; line-height:1; }
  .grade-box .glabel { font-family:var(--mono); font-size:9px; letter-spacing:1.5px; color:var(--faint); text-transform:uppercase; margin-top:4px; }
  .grade-box.g-good { background:var(--accent-soft); border-color:rgba(51,214,162,.45); }
  .grade-box.g-good .grade { color:var(--accent-deep); }
  .grade-box.g-mid { background:var(--warn-soft); border-color:rgba(224,169,74,.45); }
  .grade-box.g-mid .grade { color:#F1D49A; }
  .grade-box.g-bad { background:var(--critical-soft); border-color:rgba(240,112,95,.5); }
  .grade-box.g-bad .grade { color:#FFC7BD; }

  .score-num { display:flex; flex-direction:column; gap:2px; min-width:0; }
  .score-num .big { font-family:var(--mono); font-size:44px; font-weight:600; line-height:1; font-variant-numeric:tabular-nums; }
  .score-num .big .slash { color:var(--faint); font-size:22px; }
  .score-num .lab { font-family:var(--mono); font-size:11px; color:var(--faint); letter-spacing:.6px; text-transform:uppercase; }
  .score-num .tstamp { font-family:var(--mono); font-size:10.5px; color:var(--faint); }

  .dims { display:flex; flex-direction:column; gap:11px; margin-bottom:16px; }
  .dim .drow { display:flex; align-items:baseline; gap:8px; margin-bottom:4px; }
  .dim .dname { font-size:12.5px; color:var(--ink); }
  .dim .dnote { font-family:var(--mono); font-size:10.5px; color:var(--faint); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .dim .dval { margin-left:auto; font-family:var(--mono); font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums; }
  .bar { height:7px; border-radius:99px; background:var(--panel-2); overflow:hidden; border:1px solid var(--line); }
  .bar > i { display:block; height:100%; border-radius:99px; background:linear-gradient(90deg, var(--accent), var(--accent-deep)); transition:width .5s cubic-bezier(.22,.61,.36,1); }
  .bar.mid > i { background:linear-gradient(90deg, #C9922F, var(--warn)); }
  .bar.bad > i { background:linear-gradient(90deg, #C24A3B, var(--critical)); }

  .sev-counts { display:flex; gap:8px; flex-wrap:wrap; }
  .sev-counts .sc {
    display:flex; flex-direction:column; align-items:center; gap:1px;
    flex:1 1 0; min-width:56px;
    padding:8px 6px; border-radius:9px;
    border:1px solid var(--line); background:var(--panel-2);
  }
  .sev-counts .sc .n { font-family:var(--mono); font-size:19px; font-weight:600; font-variant-numeric:tabular-nums; }
  .sev-counts .sc .k { font-family:var(--mono); font-size:9.5px; letter-spacing:.5px; text-transform:uppercase; color:var(--faint); }
  .sev-counts .sc.critical .n, .sev-counts .sc.high .n { color:var(--critical); }
  .sev-counts .sc.medium .n { color:var(--warn); }
  .sev-counts .sc.low .n, .sev-counts .sc.info .n { color:var(--muted); }

  /* ---------- Red-team grid ---------- */
  #redteam-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(200px,1fr)); gap:10px; padding:14px; }
  .probe-cell {
    padding:11px 12px; border-radius:10px;
    background:var(--panel-2); border:1px solid var(--line);
    display:flex; flex-direction:column; gap:5px;
    transition:border-color .2s ease, background .2s ease;
  }
  .probe-cell.hit { border-color:rgba(240,112,95,.5); background:var(--critical-soft); }
  .probe-cell.safe { border-color:rgba(51,214,162,.35); background:var(--accent-soft); }
  .probe-cell .pid { font-family:var(--mono); font-size:11px; color:var(--faint); letter-spacing:.4px; }
  .probe-cell .pcat { font-family:var(--mono); font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:.6px; }
  .probe-cell .ptitle { font-size:12.5px; color:var(--ink); font-weight:500; line-height:1.35; }
  .probe-cell .pstate {
    align-self:flex-start; margin-top:2px;
    font-family:var(--mono); font-size:11px; font-weight:600; letter-spacing:.4px;
    padding:3px 9px; border-radius:7px; border:1px solid var(--line-strong);
  }
  .probe-cell .pstate.hit { color:#FFC7BD; background:var(--critical-soft); border-color:rgba(240,112,95,.55); }
  .probe-cell .pstate.safe { color:var(--accent-deep); background:var(--accent-soft); border-color:rgba(51,214,162,.45); }
  .probe-cell .pstate.pending { color:var(--muted); }

  /* ---------- Responsive ---------- */
  @media (max-width:900px) {
    main { grid-template-columns:1fr; }
    .audit-body { max-height:none; }
    .audit-row { grid-template-columns:70px 54px 1fr auto; }
    .audit-row .model { display:none; }
    header.topbar { gap:12px; }
    .target-field { max-width:100%; order:3; flex:1 1 100%; }
    .actions { width:100%; }
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
      <div class="sub">AI 安全监理 · 红队体检</div>
    </div>
    <div class="target-field" title="接管目标">
      <span class="lbl">接管目标</span>
      <span class="val" id="target-label">${targetLabel}</span>
    </div>
    <div class="actions">
      <span class="pill" id="status-pill" data-state="idle"><span class="beacon"></span><span id="status-text">idle</span></span>
      <button class="btn primary" id="btn-monitor" type="button">开始监理</button>
      <button class="btn warn" id="btn-redteam" type="button">跑红队</button>
      <button class="btn" id="btn-report" type="button">导出报告</button>
      <a class="btn" href="/runtime" style="text-decoration:none;display:inline-flex;align-items:center">运行时监控 →</a>
    </div>
  </header>

  <main>
    <section class="panel col-left">
      <div class="head">
        <h2>审计流</h2><span class="en">Audit Stream</span>
        <span class="count" id="audit-count">0</span>
      </div>
      <div class="body audit-body">
        <div id="audit-stream"></div>
        <div class="empty" id="audit-empty">等待流量 · 点击「开始监理」接入目标</div>
      </div>
    </section>

    <div class="col-right">
      <section class="panel">
        <div class="head">
          <h2>风险告警</h2><span class="en">Findings</span>
          <span class="count" id="findings-count">0</span>
        </div>
        <div class="body findings-body">
          <div id="findings-feed"></div>
          <div class="empty" id="findings-empty">暂无风险发现</div>
        </div>
      </section>

      <section class="panel">
        <div class="head">
          <h2>红队 &amp; 评分卡</h2><span class="en">Red-team · Scorecard</span>
        </div>
        <div class="body">
          <div id="scorecard">
            <div class="empty" id="score-empty">尚未评分 · 点击「跑红队」生成评分卡</div>
          </div>
          <div id="redteam-grid"></div>
        </div>
      </section>
    </div>
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
  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : 0; }
  function clamp(v, lo, hi) { v = num(v); return v < lo ? lo : (v > hi ? hi : v); }

  var SEV_RANK = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
  function topSeverity(findings) {
    if (!findings || !findings.length) return null;
    var best = null, bestRank = 0;
    for (var i = 0; i < findings.length; i++) {
      var s = findings[i] && findings[i].severity;
      var r = SEV_RANK[s] || 0;
      if (r > bestRank) { bestRank = r; best = s; }
    }
    return best;
  }

  // ---------- element refs ----------
  var $ = function (id) { return document.getElementById(id); };
  var auditStream = $('audit-stream');
  var auditEmpty = $('audit-empty');
  var auditCount = $('audit-count');
  var findingsFeed = $('findings-feed');
  var findingsEmpty = $('findings-empty');
  var findingsCount = $('findings-count');
  var redteamGrid = $('redteam-grid');
  var scorecardEl = $('scorecard');
  var scoreEmpty = $('score-empty');
  var statusPill = $('status-pill');
  var statusText = $('status-text');

  var seenAuditIds = Object.create(null);
  var seenFindingIds = Object.create(null);
  var probeCells = Object.create(null); // probe.id -> element
  var auditN = 0;
  var findingN = 0;

  // ---------- rendering ----------
  function renderAudit(ev, animate) {
    if (!ev || !ev.id) return;
    if (seenAuditIds[ev.id]) return;
    seenAuditIds[ev.id] = true;

    var sev = topSeverity(ev.findings);
    var row = el('div', 'audit-row' + (sev ? ' sev-' + sev : '') + (animate ? ' enter' : ''));

    var t = el('div', 't'); t.textContent = fmtTime(ev.ts); row.appendChild(t);

    var dir = el('div', 'dir ' + (ev.direction === 'request' ? 'request' : 'response'));
    dir.textContent = ev.direction === 'request' ? '请求' : '响应';
    row.appendChild(dir);

    var model = el('div', 'model'); model.textContent = ev.model || '—'; row.appendChild(model);

    var summary = el('div', 'summary');
    summary.textContent = ev.summary || '';
    if (ev.findings && ev.findings.length) {
      var fb = el('span', 'fbadge');
      fb.textContent = '风险 ' + ev.findings.length;
      summary.appendChild(fb);
    }
    row.appendChild(summary);

    var meta = el('div', 'meta');
    var parts = [];
    if (ev.tokens && (ev.tokens.in != null || ev.tokens.out != null)) {
      parts.push('<span class="tok">' + num(ev.tokens.in) + '↓/' + num(ev.tokens.out) + '↑ tok</span>');
    }
    if (ev.latencyMs != null) parts.push(num(ev.latencyMs) + 'ms');
    meta.innerHTML = parts.join(' · ');
    row.appendChild(meta);

    auditStream.insertBefore(row, auditStream.firstChild);
    auditN++;
    auditCount.textContent = String(auditN);
    if (auditEmpty) auditEmpty.style.display = 'none';

    // fold in any inline findings
    if (ev.findings && ev.findings.length) {
      for (var i = 0; i < ev.findings.length; i++) renderFinding(ev.findings[i], animate);
    }
  }

  function renderFinding(f, animate) {
    if (!f) return;
    if (f.id) {
      if (seenFindingIds[f.id]) return;
      seenFindingIds[f.id] = true;
    }
    var sev = f.severity || 'info';
    var card = el('div', 'finding-card sev-' + sev + (animate ? ' enter' : ''));

    var top = el('div', 'top');
    var chip = el('span', 'chip ' + sev); chip.textContent = sev; top.appendChild(chip);
    var cat = el('span', 'cat'); cat.textContent = f.category || ''; top.appendChild(cat);
    var t2 = el('span', 't2'); t2.textContent = fmtTime(f.ts); top.appendChild(t2);
    card.appendChild(top);

    var title = el('div', 'title'); title.textContent = f.title || '(未命名风险)'; card.appendChild(title);
    if (f.detail) { var d = el('div', 'detail'); d.textContent = f.detail; card.appendChild(d); }
    if (f.evidence) { var ev = el('div', 'evidence'); ev.textContent = f.evidence; card.appendChild(ev); }

    findingsFeed.insertBefore(card, findingsFeed.firstChild);
    findingN++;
    findingsCount.textContent = String(findingN);
    if (findingsEmpty) findingsEmpty.style.display = 'none';
  }

  function probeStateClass(passed) { return passed ? 'hit' : 'safe'; }
  function probeStateLabel(passed) { return passed ? '命中(有洞)' : '未命中(安全)'; }

  function renderProbe(p) {
    if (!p || !p.probe || !p.probe.id) return;
    var id = p.probe.id;
    var cell = probeCells[id];
    var isNew = !cell;
    if (isNew) { cell = el('div', 'probe-cell'); probeCells[id] = cell; }

    cell.className = 'probe-cell ' + probeStateClass(p.passed);
    cell.innerHTML =
      '<div class="pid">' + esc(id) + '</div>' +
      '<div class="pcat">' + esc(p.probe.category || '') + '</div>' +
      '<div class="ptitle">' + esc(p.probe.title || '') + '</div>' +
      '<div class="pstate ' + probeStateClass(p.passed) + '">' + probeStateLabel(p.passed) + '</div>';

    if (isNew) redteamGrid.appendChild(cell);

    // roll probe findings into the findings feed too
    if (p.findings && p.findings.length) {
      for (var i = 0; i < p.findings.length; i++) renderFinding(p.findings[i], true);
    }
  }

  function gradeBucket(grade, overall) {
    var g = String(grade || '').toUpperCase();
    if (g === 'A' || g === 'B') return 'g-good';
    if (g === 'C') return 'g-mid';
    if (g === 'D' || g === 'F') return 'g-bad';
    // fallback by score
    var s = num(overall);
    if (s >= 80) return 'g-good';
    if (s >= 60) return 'g-mid';
    return 'g-bad';
  }
  function barClass(score) {
    var s = num(score);
    if (s >= 75) return 'bar';
    if (s >= 50) return 'bar mid';
    return 'bar bad';
  }

  var SEV_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

  function renderScore(sc) {
    if (!sc) return;
    if (scoreEmpty) scoreEmpty.style.display = 'none';

    var bucket = gradeBucket(sc.grade, sc.overall);
    var html = '';
    html += '<div class="score-hero">';
    html += '  <div class="grade-box ' + bucket + '"><div class="grade">' + esc(sc.grade || '?') + '</div><div class="glabel">Grade</div></div>';
    html += '  <div class="score-num">';
    html += '    <div class="lab">总体安全评分</div>';
    html += '    <div class="big">' + clamp(sc.overall, 0, 100) + '<span class="slash"> / 100</span></div>';
    html += '    <div class="tstamp">评估于 ' + esc(fmtTime(sc.ts)) + '</div>';
    html += '  </div>';
    html += '</div>';

    // dimensions
    var dims = sc.dimensions || [];
    html += '<div class="dims">';
    for (var i = 0; i < dims.length; i++) {
      var dm = dims[i] || {};
      var val = clamp(dm.score, 0, 100);
      html += '<div class="dim">';
      html += '  <div class="drow"><span class="dname">' + esc(dm.label || dm.key || '') + '</span>';
      html += '    <span class="dnote">' + esc(dm.note || '') + '</span>';
      html += '    <span class="dval">' + val + '</span></div>';
      html += '  <div class="' + barClass(val) + '"><i style="width:' + val + '%"></i></div>';
      html += '</div>';
    }
    html += '</div>';

    // severity counts
    var counts = sc.findingCounts || {};
    html += '<div class="sev-counts">';
    for (var j = 0; j < SEV_ORDER.length; j++) {
      var k = SEV_ORDER[j];
      html += '<div class="sc ' + k + '"><div class="n">' + num(counts[k]) + '</div><div class="k">' + k + '</div></div>';
    }
    html += '</div>';

    scorecardEl.innerHTML = html;
  }

  function setStatus(state, message) {
    var s = String(state || 'idle');
    statusPill.setAttribute('data-state', s);
    statusText.textContent = message ? (s + ' · ' + message) : s;
  }

  // ---------- initial state ----------
  function loadState() {
    fetch('/api/state', { headers: { 'accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (state) {
        if (!state) return;
        if (state.target && !document.getElementById('target-label').textContent) {
          document.getElementById('target-label').textContent = state.target;
        }
        var audits = state.audits || [];
        // server gives some order; render so newest ends on top.
        // Sort ascending by ts, then prepend each → newest on top.
        try { audits = audits.slice().sort(function (a, b) { return num(a.ts) - num(b.ts); }); } catch (e) {}
        for (var i = 0; i < audits.length; i++) renderAudit(audits[i], false);

        var findings = state.findings || [];
        try { findings = findings.slice().sort(function (a, b) { return num(a.ts) - num(b.ts); }); } catch (e2) {}
        for (var j = 0; j < findings.length; j++) renderFinding(findings[j], false);

        if (state.lastScore) {
          renderScore(state.lastScore);
          var prs = state.lastScore.probeResults || [];
          for (var k = 0; k < prs.length; k++) renderProbe(prs[k]);
        }
      })
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

    src.addEventListener('audit', function (e) {
      var d = safeParse(e.data); if (d) try { renderAudit(d, true); } catch (err) {}
    });
    src.addEventListener('finding', function (e) {
      var d = safeParse(e.data); if (d) try { renderFinding(d, true); } catch (err) {}
    });
    src.addEventListener('probe', function (e) {
      var d = safeParse(e.data); if (d) try { renderProbe(d); } catch (err) {}
    });
    src.addEventListener('score', function (e) {
      var d = safeParse(e.data); if (d) try { renderScore(d); } catch (err) {}
    });
    src.addEventListener('status', function (e) {
      var d = safeParse(e.data); if (d) try { setStatus(d.state, d.message); } catch (err) {}
    });
    // EventSource auto-reconnects on error; nothing to do.
    src.onerror = function () { /* transient — browser will retry */ };
  }

  // ---------- actions ----------
  function busy(btn, ms) {
    if (!btn) return;
    btn.disabled = true;
    setTimeout(function () { btn.disabled = false; }, ms || 1200);
  }

  var btnMonitor = $('btn-monitor');
  var btnRedteam = $('btn-redteam');
  var btnReport = $('btn-report');

  btnMonitor.addEventListener('click', function () {
    busy(btnMonitor, 1400);
    setStatus('monitoring', '');
    fetch('/api/monitor/start', { method: 'POST' }).catch(function () {});
  });

  btnRedteam.addEventListener('click', function () {
    busy(btnRedteam, 1800);
    setStatus('redteam', '');
    // clear grid at the start of a run
    redteamGrid.innerHTML = '';
    probeCells = Object.create(null);
    fetch('/api/redteam/run', { method: 'POST' }).catch(function () {});
  });

  btnReport.addEventListener('click', function () {
    try { window.open('/report', '_blank'); } catch (e) {}
  });

  // ---------- boot ----------
  loadState();
  connectEvents();
})();
</script>
</body>
</html>`;
}
