// 把关人 · 稿件工作台 —— 六步主链的单页宿主。
//
// Self-contained HTML document: all CSS + JS inline, zero external resources
// (no CDN, no web fonts, no remote images) so it renders offline on congested
// conference WiFi. System fonts only, same as the legacy console.
//
// The page holds no workflow rules of its own. It asks GET /api/workbench/:id
// for a finished view model — including which moves each role may make — and
// renders whatever it is told. 一条路走到黑，没有分支.

import { proofreadResponsibilities } from '../domain/workflow.js';

/**
 * Render the manuscript workbench as a complete HTML document string.
 *
 * Boots by GET /api/workbench (list), then GET /api/workbench/:id per
 * manuscript, and subscribes to /events (SSE) for live 留痕 updates.
 */
export function renderWorkbench(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<title>把关人 · 稿件工作台</title>
<style>
  :root {
    --bg:#0E1512; --panel:#141D19; --panel-2:#18231E; --panel-3:#1D2A24;
    --ink:#E9F0EB; --muted:#9DB0A5; --faint:#6C7E74;
    --line:rgba(233,240,235,.11); --line-strong:rgba(233,240,235,.2);
    --accent:#33D6A2; --accent-deep:#7FEBCB; --accent-soft:rgba(51,214,162,.13);
    --block:#F0705F; --block-soft:rgba(240,112,95,.15);
    --warn:#E0A94A; --warn-soft:rgba(224,169,74,.14);
    --info:#6FA8DC; --info-soft:rgba(111,168,220,.14);
    --ai:#6FA8DC; --ai-edited:#33D6A2; --human:#E0A94A; --source:#8E9E95;
    --mono: ui-monospace,'SF Mono',Menlo,Consolas,monospace;
    --sans: system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;
    --serif: 'Songti SC','Noto Serif SC',serif;
    --radius:12px;
  }
  * { box-sizing:border-box; }
  html,body { margin:0; padding:0; height:100%; }
  body {
    background:var(--bg); color:var(--ink); font-family:var(--sans);
    font-size:14px; line-height:1.6; -webkit-font-smoothing:antialiased;
    display:flex; flex-direction:column; min-height:100vh;
  }
  .mono { font-family:var(--mono); font-variant-numeric:tabular-nums; }

  /* ---------- Header ---------- */
  header.topbar {
    display:flex; align-items:center; gap:18px; flex-wrap:wrap;
    padding:12px 22px; border-bottom:1px solid var(--line-strong);
    background:var(--panel);
  }
  .brand { display:flex; flex-direction:column; gap:1px; }
  .brand .name {
    font-family:var(--serif); font-size:19px; font-weight:600;
    display:flex; align-items:center; gap:10px;
  }
  .brand .name .dot {
    width:9px; height:9px; border-radius:50%; background:var(--accent);
    box-shadow:0 0 0 4px var(--accent-soft);
  }
  .brand .sub {
    font-family:var(--mono); font-size:11px; letter-spacing:.6px;
    color:var(--faint); text-transform:uppercase;
  }
  .demo-badge {
    font-size:11px; color:var(--warn); border:1px dashed var(--warn);
    border-radius:6px; padding:3px 9px; background:var(--warn-soft);
  }
  .roles { display:flex; gap:6px; margin-left:auto; align-items:center; }
  .roles .lbl { font-size:11px; color:var(--faint); font-family:var(--mono); margin-right:4px; }
  .role-btn {
    font-family:var(--sans); font-size:13px; color:var(--muted);
    padding:7px 14px; background:var(--panel-2);
    border:1px solid var(--line); border-radius:9px; cursor:pointer;
  }
  .role-btn:hover { border-color:var(--accent); color:var(--ink); }
  .role-btn[aria-pressed="true"] {
    background:var(--accent-soft); border-color:var(--accent); color:var(--accent-deep);
  }

  /* ---------- Layout ---------- */
  main { display:grid; grid-template-columns:250px minmax(0,1fr) 320px; flex:1; min-height:0; }
  aside, section.stage, aside.side { padding:18px; overflow-y:auto; }
  aside.list { border-right:1px solid var(--line); background:var(--panel); }
  aside.side { border-left:1px solid var(--line); background:var(--panel); }
  h2.hd {
    font-size:11px; font-family:var(--mono); letter-spacing:.7px; color:var(--faint);
    text-transform:uppercase; margin:0 0 12px; font-weight:500;
  }
  h2.hd + h2.hd, section > h2.hd:not(:first-child) { margin-top:22px; }

  /* ---------- Buttons ---------- */
  button.btn {
    font-family:var(--sans); font-size:13px; font-weight:500; color:var(--ink);
    padding:9px 16px; background:var(--panel-2); border:1px solid var(--line-strong);
    border-radius:10px; cursor:pointer;
  }
  button.btn:hover:not(:disabled) { background:var(--panel-3); border-color:var(--accent); }
  button.btn:disabled { opacity:.45; cursor:not-allowed; }
  button.btn.primary {
    background:var(--accent-soft); border-color:var(--accent); color:var(--accent-deep);
    font-weight:600; padding:11px 22px; font-size:14px;
  }
  button.btn.danger { border-color:var(--block); color:var(--block); }
  button.btn.wide { width:100%; }

  /* ---------- Manuscript list ---------- */
  .ms { padding:10px 12px; border-radius:10px; cursor:pointer; margin-bottom:6px; border:1px solid transparent; }
  .ms:hover { background:var(--panel-2); }
  .ms[aria-current="true"] { background:var(--panel-2); border-color:var(--accent); }
  .ms .t { font-size:13px; line-height:1.4; margin-bottom:5px; }
  .ms .s { font-size:11px; color:var(--faint); font-family:var(--mono); }
  .empty { color:var(--faint); font-size:13px; padding:14px 0; }

  /* ---------- Stage rail ---------- */
  .rail { display:flex; gap:4px; margin-bottom:22px; flex-wrap:wrap; }
  .rail .step {
    display:flex; align-items:center; gap:7px; font-size:12px; color:var(--faint);
    padding:6px 12px; border-radius:20px; border:1px solid var(--line); white-space:nowrap;
  }
  .rail .step .n {
    width:18px; height:18px; border-radius:50%; background:var(--panel-3);
    display:grid; place-items:center; font-size:10px; font-family:var(--mono);
  }
  .rail .step.done { color:var(--muted); border-color:var(--line-strong); }
  .rail .step.done .n { background:var(--accent-soft); color:var(--accent-deep); }
  .rail .step.now { color:var(--accent-deep); border-color:var(--accent); background:var(--accent-soft); }
  .rail .step.now .n { background:var(--accent); color:#0E1512; font-weight:700; }

  /* ---------- Cards & forms ---------- */
  .card { background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); padding:18px; margin-bottom:16px; }
  .card.block { border-color:var(--block); background:linear-gradient(180deg,var(--block-soft),transparent 70%); }
  .card.warn  { border-color:var(--warn);  background:linear-gradient(180deg,var(--warn-soft),transparent 70%); }
  .card.ok    { border-color:var(--accent);background:linear-gradient(180deg,var(--accent-soft),transparent 70%); }
  .card h3 { margin:0 0 8px; font-size:16px; font-family:var(--serif); font-weight:600; }
  .card p  { margin:0 0 10px; color:var(--muted); }
  .card p.lead { color:var(--ink); }

  label.f { display:block; margin-bottom:14px; }
  label.f > span { display:block; font-size:12px; color:var(--faint); margin-bottom:6px; font-family:var(--mono); }
  input.f, textarea.f, select.f {
    width:100%; font-family:var(--sans); font-size:14px; color:var(--ink);
    background:var(--panel-2); border:1px solid var(--line-strong);
    border-radius:9px; padding:10px 12px; resize:vertical;
  }
  input.f:focus, textarea.f:focus, select.f:focus { outline:none; border-color:var(--accent); }
  textarea.f { min-height:150px; line-height:1.7; }

  .actions-bar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top:6px; }
  .hint { font-size:12px; color:var(--faint); }
  .err { color:var(--block); font-size:13px; margin-top:10px; }

  /* ---------- Evidence strip (硬拦那一档的证据) ---------- */
  .evidence {
    display:flex; gap:18px; flex-wrap:wrap; font-family:var(--mono); font-size:12px;
    padding:10px 14px; border-radius:9px; background:rgba(0,0,0,.28); margin:12px 0 4px;
  }
  .evidence b { color:var(--accent-deep); font-weight:600; }
  .chips { display:flex; gap:6px; flex-wrap:wrap; margin-top:10px; }
  .chip {
    font-family:var(--mono); font-size:11px; color:var(--muted);
    border:1px solid var(--line-strong); border-radius:20px; padding:3px 10px;
  }

  /* ---------- Two-column preflight ---------- */
  .cols { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  @media (max-width:1180px) { .cols { grid-template-columns:1fr; } main { grid-template-columns:200px minmax(0,1fr) 280px; } }
  .doc { background:var(--panel-2); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
  .doc h4 { margin:0 0 10px; font-size:13px; color:var(--muted); font-weight:500; display:flex; justify-content:space-between; align-items:center; gap:10px; }
  .doc .body { font-family:var(--serif); font-size:15px; line-height:2; }
  .doc.src .body { color:var(--muted); white-space:pre-wrap; }

  /* ---------- Sentence provenance ---------- */
  .sent { border-left:3px solid transparent; padding-left:8px; margin-bottom:6px; display:block; }
  .sent.o-ai { border-left-color:var(--ai); }
  .sent.o-ai-edited { border-left-color:var(--ai-edited); }
  .sent.o-human { border-left-color:var(--human); }
  .sent.o-source { border-left-color:var(--source); }
  .an { border-radius:3px; padding:1px 2px; }
  .an-block  { background:var(--block-soft); border-bottom:2px solid var(--block); }
  .an-redact { background:var(--warn-soft);  border-bottom:2px solid var(--warn); }
  .an-flag   { background:var(--info-soft);  border-bottom:2px dotted var(--info); }

  .legend { display:flex; gap:14px; flex-wrap:wrap; font-size:11px; color:var(--faint); margin-bottom:10px; }
  .legend i { display:inline-block; width:10px; height:3px; border-radius:2px; margin-right:5px; vertical-align:middle; }

  /* ---------- Annotation list ---------- */
  .ann { border-left:3px solid var(--line-strong); padding:9px 12px; margin-bottom:8px; background:var(--panel-2); border-radius:0 8px 8px 0; }
  .ann.a-block { border-left-color:var(--block); }
  .ann.a-redact { border-left-color:var(--warn); }
  .ann.a-flag { border-left-color:var(--info); }
  .ann .top { display:flex; gap:8px; align-items:baseline; flex-wrap:wrap; }
  .ann .tag { font-family:var(--mono); font-size:10px; padding:1px 7px; border-radius:20px; border:1px solid var(--line-strong); color:var(--faint); }
  .ann .ttl { font-size:13px; font-weight:500; }
  .ann .dt { font-size:12px; color:var(--muted); margin-top:4px; }
  .ann .sg { font-size:12px; color:var(--accent-deep); margin-top:4px; font-family:var(--mono); }

  /* ---------- Side rail ---------- */
  .share { text-align:center; padding:16px 0 6px; }
  .share .big { font-family:var(--mono); font-size:46px; font-weight:600; line-height:1; color:var(--accent-deep); font-variant-numeric:tabular-nums; }
  .share .big.dropped { color:var(--ai-edited); }
  .share .delta { font-family:var(--mono); font-size:13px; margin-top:8px; height:18px; color:var(--warn); }
  .share .formula { font-size:11px; color:var(--faint); margin-top:10px; font-family:var(--mono); }
  .share .none { font-size:13px; color:var(--faint); }
  .counts { display:flex; gap:8px; justify-content:center; flex-wrap:wrap; margin-top:12px; }
  .counts span { font-size:11px; font-family:var(--mono); color:var(--muted); }
  .counts i { display:inline-block; width:8px; height:8px; border-radius:2px; margin-right:4px; }

  .tl { border-left:1px solid var(--line-strong); padding-left:14px; margin-left:5px; }
  .tl .ev { position:relative; padding-bottom:14px; }
  .tl .ev::before {
    content:''; position:absolute; left:-19px; top:6px; width:8px; height:8px;
    border-radius:50%; background:var(--panel-3); border:1px solid var(--line-strong);
  }
  .tl .ev.sys::before { background:var(--info); border-color:var(--info); }
  .tl .ev.ai::before  { background:var(--ai); border-color:var(--ai); }
  .tl .ev.hum::before { background:var(--accent); border-color:var(--accent); }
  .tl .k { font-size:12px; }
  .tl .m { font-size:11px; color:var(--faint); font-family:var(--mono); margin-top:2px; }
  .tl .d { font-size:11px; color:var(--muted); font-family:var(--mono); margin-top:3px; line-height:1.45; }

  .placeholder { border:1px dashed var(--line-strong); border-radius:var(--radius); padding:22px; color:var(--faint); }
  .placeholder h3 { color:var(--muted); font-family:var(--serif); margin:0 0 8px; font-size:15px; }

  /* ---------- ⑥ 追溯图谱 ---------- */
  .signoff {
    display:grid; grid-template-columns:1fr 1fr; gap:18px;
    background:var(--panel); border:1px solid var(--accent);
    border-radius:var(--radius); padding:18px 20px; margin-bottom:16px;
    background-image:linear-gradient(180deg,var(--accent-soft),transparent 70%);
  }
  .signoff.hot { border-color:var(--warn); background-image:linear-gradient(180deg,var(--warn-soft),transparent 70%); }
  .signoff .so-k { font-size:11px; font-family:var(--mono); letter-spacing:.6px; color:var(--faint); text-transform:uppercase; }
  .signoff .so-v { font-family:var(--serif); font-size:20px; margin-top:3px; }
  .signoff .so-v.big { font-family:var(--mono); font-size:30px; font-variant-numeric:tabular-nums; color:var(--accent-deep); }
  .signoff.hot .so-v.big { color:var(--warn); }
  .signoff .so-t { font-size:12px; color:var(--muted); margin-top:5px; }
  @media (max-width:820px) { .signoff { grid-template-columns:1fr; } }

  .chart { background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); padding:10px 6px; color:var(--ink); }
  .chart svg { display:block; width:100%; height:auto; }
  .chart .fill { fill:var(--accent-soft); stroke:none; }
  .chart .line { fill:none; stroke:var(--accent); stroke-width:2; stroke-linejoin:round; }
  .chart .dot { fill:var(--panel); stroke:var(--accent); stroke-width:2; }
  .chart .dot.last { fill:var(--accent); }
  .chart .ax, .chart .cap { font-family:var(--mono); font-size:10px; fill:var(--faint); }
  .chart .cap.dim { fill:var(--faint); opacity:.7; }
  .chart .val { font-family:var(--mono); font-size:12px; font-weight:600; fill:var(--accent-deep); }

  .smap { background:var(--panel-2); border:1px solid var(--line); border-radius:10px; padding:12px 14px; margin-bottom:10px; }
  .smap-hd { display:flex; justify-content:space-between; gap:12px; font-size:12px; margin-bottom:9px; }
  .smap-hd .dim { color:var(--faint); font-family:var(--mono); }
  .cells { display:flex; flex-wrap:wrap; gap:4px; }
  .cell { width:26px; height:14px; border-radius:3px; display:block; cursor:help; }
  .cell.o-ai { background:var(--ai); }
  .cell.o-ai-edited { background:var(--ai-edited); }
  .cell.o-human { background:var(--human); }
  .cell.o-source { background:var(--source); }

  .chain { display:flex; flex-wrap:wrap; gap:8px; }
  .link {
    flex:1 1 190px; background:var(--panel-2); border:1px solid var(--line);
    border-left:3px solid var(--accent); border-radius:0 8px 8px 0; padding:10px 13px;
  }
  .link.back { border-left-color:var(--warn); }
  .link .stage { font-size:12px; color:var(--faint); font-family:var(--mono); }
  .link .actor { font-size:14px; margin-top:2px; }
  .link .verdict { font-size:12px; color:var(--muted); margin-top:3px; font-family:var(--mono); }
  .link .reason { font-size:12px; color:var(--warn); margin-top:6px; line-height:1.5; }

  .hit { background:var(--panel-2); border:1px solid var(--line); border-radius:8px; padding:10px 13px; margin-bottom:8px; }
  .hit .top { display:flex; gap:9px; align-items:baseline; flex-wrap:wrap; }
  .hit .tag { font-family:var(--mono); font-size:10px; padding:1px 7px; border-radius:20px; border:1px solid var(--line-strong); color:var(--faint); }
  .hit .ttl { font-size:13px; font-weight:500; }
  .hit .dim { color:var(--faint); font-family:var(--mono); font-size:11px; margin-left:auto; }
  .hit .dt { font-size:12px; color:var(--muted); margin-top:4px; }
  .hit .dt b { color:var(--ink); font-family:var(--mono); }
  .hit .dt b.warn { color:var(--warn); }
  .hit code { font-family:var(--mono); font-size:11px; color:var(--accent-deep); }

  /* ---------- ⑤ 三审三校 ---------- */
  .passes { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:12px; margin-bottom:8px; }
  .pass {
    background:var(--panel); border:1px solid var(--line);
    border-top:3px solid var(--line-strong); border-radius:0 0 10px 10px;
    padding:14px 16px; display:flex; flex-direction:column; gap:9px;
  }
  .pass.done { border-top-color:var(--accent); }
  .pass.live { border-top-color:var(--warn); background:linear-gradient(180deg,var(--warn-soft),transparent 60%); }
  .pass-hd { display:flex; align-items:baseline; gap:10px; }
  .pass-n { font-family:var(--serif); font-size:16px; font-weight:600; }
  .pass-who { font-size:12px; color:var(--faint); font-family:var(--mono); margin-top:-6px; }
  .st { margin-left:auto; font-size:11px; font-family:var(--mono); padding:2px 9px; border-radius:20px; white-space:nowrap; }
  .st.ok { color:var(--accent-deep); background:var(--accent-soft); }
  .st.back { color:var(--warn); background:var(--warn-soft); }
  .st.now { color:var(--warn); background:var(--warn-soft); border:1px solid var(--warn); }
  .st.idle { color:var(--faint); border:1px solid var(--line); }
  .duties { display:flex; flex-wrap:wrap; gap:5px; }
  .duty {
    font-size:11px; color:var(--muted); background:var(--panel-2);
    border:1px solid var(--line); border-radius:5px; padding:2px 8px;
  }
  .pass-ann { font-size:12px; color:var(--muted); line-height:1.9; }
  .pass-ann b { color:var(--ink); font-family:var(--mono); }
  .pass-ann .dim { color:var(--faint); }
  .mini {
    display:inline-block; font-size:11px; margin:0 4px 0 0; padding:1px 7px;
    border-radius:4px; background:var(--panel-2); border-left:2px solid var(--line-strong);
  }
  .mini.a-block { border-left-color:var(--block); }
  .mini.a-redact { border-left-color:var(--warn); }
  .mini.a-flag { border-left-color:var(--info); }
  .pass-rec {
    font-size:12px; color:var(--muted); font-family:var(--mono);
    border-top:1px solid var(--line); padding-top:8px; margin-top:auto;
  }
  .pass-reason { color:var(--warn); font-family:var(--sans); margin-top:5px; line-height:1.6; }
  .countersign { border-left:3px solid var(--warn); }
  .cs-fields { display:grid; grid-template-columns:minmax(180px,.7fr) minmax(260px,1.3fr); gap:12px; margin:12px 0; }
  .cs-record { background:var(--panel-2); border:1px solid var(--line); border-radius:9px; padding:10px 12px; margin-top:8px; }
  @media (max-width:820px) { .cs-fields { grid-template-columns:1fr; } }

  /* ---------- 对照组 ---------- */
  .vs {
    display:grid; grid-template-columns:auto 1fr 1fr; gap:1px;
    background:var(--line); border:1px solid var(--line);
    border-radius:var(--radius); overflow:hidden; margin-bottom:18px;
  }
  .vs-hd {
    grid-column:span 1; padding:10px 16px; background:var(--panel-2);
    font-size:12px; font-family:var(--mono); letter-spacing:.5px;
  }
  .vs-hd:first-child { grid-column:2; }
  .vs-hd.off { color:var(--block); }
  .vs-hd.on { color:var(--accent-deep); }
  .vs-k {
    padding:12px 16px; background:var(--panel-2); font-size:13px;
    color:var(--faint); white-space:nowrap;
  }
  .vs-c { padding:12px 16px; background:var(--panel); font-size:14px; }
  .vs-c.off { color:var(--block); }
  .vs-c.on { color:var(--ink); }
  @media (max-width:860px) {
    .vs { grid-template-columns:1fr 1fr; }
    .vs-k { grid-column:span 2; padding-bottom:2px; background:var(--panel); }
    .vs-hd:first-child { grid-column:1; }
  }

  .doc.ship { border-color:var(--block); margin-bottom:10px; }
  .doc.ship h4 { color:var(--block); }
  .doc.ship h4 .dim { color:var(--faint); font-family:var(--mono); font-size:11px; font-weight:400; }
  .doc.ship .body { white-space:pre-wrap; font-family:var(--serif); }

  .closer {
    margin-top:18px; padding:16px 20px; border-radius:var(--radius);
    background:var(--panel-2); border-left:3px solid var(--accent);
    font-family:var(--serif); font-size:16px; line-height:1.8;
  }
  .closer b { color:var(--accent-deep); }
</style>
</head>
<body>

<header class="topbar">
  <div class="brand">
    <div class="name"><span class="dot"></span>把关人 · 稿件工作台</div>
    <div class="sub">county media · production &amp; gatekeeping</div>
  </div>
  <span class="demo-badge">模拟 / 脱敏素材</span>
  <div class="roles">
    <span class="lbl">当前身份</span>
    <button class="role-btn" data-role="editor" aria-pressed="true">编辑 / 记者</button>
    <button class="role-btn" data-role="department-head" aria-pressed="false">部门主任</button>
    <button class="role-btn" data-role="supervising-leader" aria-pressed="false">分管领导</button>
  </div>
</header>

<main>
  <aside class="list">
    <h2 class="hd">稿件</h2>
    <button class="btn wide" id="new-btn">＋ 新建稿件</button>
    <button class="btn wide" id="seed-btn" style="margin-top:6px">演示准备（重置并建样例）</button>
    <div id="ms-list" style="margin-top:12px"></div>
  </aside>

  <section class="stage">
    <div class="rail" id="rail"></div>
    <div id="panel"></div>
  </section>

  <aside class="side">
    <h2 class="hd">AI 参与度</h2>
    <div id="share"></div>
    <h2 class="hd">留痕</h2>
    <div class="tl" id="timeline"></div>
  </aside>
</main>

<script>
(function () {
  'use strict';

  // 校次职责由契约注入，页面不另抄一份 (src/domain/workflow.ts 的 5.9)。
  var PASSES = ${JSON.stringify(proofreadResponsibilities)};

  var STAGES = [
    { key:'source',     label:'素材入口' },
    { key:'admission',  label:'入口准入' },
    { key:'generate',   label:'稿件生成' },
    { key:'preflight',  label:'输出预检' },
    { key:'review',     label:'三审流转' },
    { key:'trace',      label:'AI 参与度追溯' }
  ];
  var ROLE_LABEL = {
    'editor':'编辑 / 记者',
    'department-head':'部门主任',
    'supervising-leader':'分管领导'
  };
  var ORIGIN_LABEL = { 'ai':'AI 生成', 'ai-edited':'AI 生成·人改过', 'human':'人新写', 'source':'原文引用' };
  var ORIGIN_COLOR = { 'ai':'var(--ai)', 'ai-edited':'var(--ai-edited)', 'human':'var(--human)', 'source':'var(--source)' };
  var ACTION_LABEL = { 'block':'拦下不让播', 'redact':'标红待复核', 'flag':'放行留痕' };
  var TRACE_LABEL = {
    'manuscript-created':'稿件建立',
    'status-changed':'状态流转',
    'model-requested':'调用模型',
    'model-completed':'模型返回',
    'artifact-created':'产物生成',
    'rule-hit':'规则命中',
    'segments-recorded':'句级来源重算',
    'review-recorded':'审核留痕',
    'signed':'签发'
  };

  var state = { list:[], view:null, role:'editor', currentId:null, prevShare:null, editing:null, error:'', contrast:null, showContrast:false };

  var $ = function (id) { return document.getElementById(id); };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function pct(value) { return (value * 100).toFixed(1).replace(/\\.0$/, '') + '%'; }
  function clock(ms) {
    var d = new Date(ms);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function api(path, options) {
    return fetch(path, options).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) throw new Error(body.message || body.error || ('HTTP ' + response.status));
        return body;
      });
    });
  }

  // ——————————————————— data ———————————————————

  function loadList() {
    return api('/api/workbench').then(function (data) {
      state.list = data.items || [];
      renderList();
    });
  }

  function openManuscript(id) {
    state.currentId = id;
    state.editing = null;
    state.error = '';
    state.showContrast = false;
    state.contrast = null;
    return api('/api/workbench/' + encodeURIComponent(id)).then(function (view) {
      applyView(view);
    });
  }

  function applyView(view) {
    var previous = state.view;
    if (previous && previous.manuscript.id === view.manuscript.id) {
      state.prevShare = previous.aiShare == null ? null : previous.aiShare;
    } else {
      state.prevShare = null;
    }
    state.view = view;
    state.currentId = view.manuscript.id;
    render();
    renderList();
  }

  function showNew() {
    state.currentId = null;
    state.view = null;
    state.error = '';
    render();
    renderList();
  }

  // ——————————————————— render ———————————————————

  function render() {
    renderRail();
    renderPanel();
    renderSide();
  }

  function renderList() {
    var host = $('ms-list');
    if (state.list.length === 0) {
      host.innerHTML = '<div class="empty">还没有稿件。点上面新建，粘贴一份通稿开始。</div>';
      return;
    }
    host.innerHTML = state.list.map(function (item) {
      var current = item.id === state.currentId ? 'true' : 'false';
      return '<div class="ms" data-id="' + esc(item.id) + '" aria-current="' + current + '">' +
        '<div class="t">' + esc(item.title) + '</div>' +
        '<div class="s">' + esc(statusLabel(item.status)) + ' · ' + clock(item.updatedAt) + '</div>' +
        '</div>';
    }).join('');
  }

  var STATUS_LABEL = {
    'draft':'草稿', 'admission-blocked':'已拒绝', 'admission-reason-required':'待填选题依据',
    'admitted':'已准入', 'generated':'已生成', 'preflight':'预检完成',
    'first-review':'待初审', 'second-review':'待复审', 'final-review':'待终审',
    'signed':'已签发', 'published':'已发布'
  };
  function statusLabel(status) { return STATUS_LABEL[status] || status; }

  function renderRail() {
    var activeIndex = state.view ? indexOfStage(state.view.stage) : 0;
    $('rail').innerHTML = STAGES.map(function (stage, index) {
      var cls = index === activeIndex && state.view ? 'now' : (index < activeIndex ? 'done' : '');
      return '<div class="step ' + cls + '"><span class="n">' + (index + 1) + '</span>' + stage.label + '</div>';
    }).join('');
  }
  function indexOfStage(key) {
    for (var i = 0; i < STAGES.length; i += 1) if (STAGES[i].key === key) return i;
    return 0;
  }

  function renderPanel() {
    var host = $('panel');
    if (!state.view) { host.innerHTML = newForm(); return; }
    var view = state.view;
    var parts = [];
    if (view.stage === 'source' || view.stage === 'admission') parts.push(admissionPanel(view));
    if (view.stage === 'generate' || view.stage === 'preflight') parts.push(productionPanel(view));
    if (view.stage === 'review') parts.push(reviewPanel(view));
    if (view.stage === 'trace') parts.push(tracePanel(view));
    parts.push(actionsBar(view));
    host.innerHTML = parts.join('');
  }

  function newForm() {
    return '<div class="card">' +
      '<h3>① 素材入口</h3>' +
      '<p>粘贴上级通稿或会议材料。不做爬虫、不接外部采集系统——县级台编辑每天上午的活就是从一份通稿开始。</p>' +
      '<label class="f"><span>标题</span><input class="f" id="nf-title" placeholder="例：全县乡村振兴现场推进会召开" /></label>' +
      '<label class="f"><span>素材类型</span><select class="f" id="nf-type">' +
        '<option value="notice">通知 / 会议材料</option>' +
        '<option value="public-relations">政务通稿</option>' +
        '<option value="script">脚本</option>' +
        '<option value="novel">文学作品</option>' +
        '<option value="other">其他</option>' +
      '</select></label>' +
      '<label class="f"><span>正文</span><textarea class="f" id="nf-text" placeholder="把通稿全文粘到这里…"></textarea></label>' +
      '<div class="actions-bar">' +
        '<button class="btn primary" id="nf-submit">提交入口准入</button>' +
        '<button class="btn" id="nf-sample">填入示例通稿</button>' +
        '<span class="hint">提交后先判定这次调用该不该发生，再决定要不要让模型碰它。</span>' +
      '</div>' +
      (state.error ? '<div class="err">' + esc(state.error) + '</div>' : '') +
      '</div>';
  }

  function admissionPanel(view) {
    var admission = view.admission;
    var cls = admission.decision === 'blocked' ? 'block'
            : admission.decision === 'reason-required' ? 'warn' : 'ok';
    var heading = admission.decision === 'blocked' ? '② 入口准入 · 硬拦'
                : admission.decision === 'reason-required' ? '② 入口准入 · 要理由'
                : '② 入口准入 · 仅留痕';

    var out = '<div class="card ' + cls + '">' +
      '<h3>' + heading + '</h3>' +
      '<p class="lead">' + esc(admission.message) + '</p>';

    if (admission.decision === 'blocked') {
      // 输入侧拦掉，什么都没发生 —— 这一行是那个论点的证据，不是修辞。
      out += '<div class="evidence">' +
        '<span>模型调用 <b>0 次</b></span>' +
        '<span>消耗 <b>0 tokens</b></span>' +
        '<span>产生内容 <b>无</b></span>' +
        '</div>';
    }
    if (admission.offDutyUse) {
      out += '<p class="hint">另标：本次调用疑似非业务用途（公器私用）。只标不拦，已计入本台使用情况报表。</p>';
    }
    if (admission.hits.length > 0) {
      out += '<div class="chips">' + admission.hits.map(function (hit) {
        return '<span class="chip">' + esc(hit.ruleId) + ' · ' + esc(hit.evidence) + '</span>';
      }).join('') + '</div>';
    }
    out += '</div>';

    out += '<div class="card"><h4 style="margin:0 0 8px;font-size:13px;color:var(--muted);font-weight:500">原通稿</h4>' +
      '<div class="doc src"><div class="body">' + esc(view.manuscript.sourceText) + '</div></div></div>';
    return out;
  }

  function productionPanel(view) {
    if (view.artifacts.length === 0) {
      return '<div class="card"><h3>③ 稿件生成</h3>' +
        '<p>按本台风格，从这份通稿生成播报稿与短视频文案。生成走把关人网关，业务代码拿不到模型密钥，所以这次调用一定会被审计到。</p>' +
        '</div>';
    }

    var showAnnotations = view.stage === 'preflight';
    var out = '';

    if (showAnnotations) {
      out += '<div class="card"><h3>④ 输出预检</h3>' +
        '<p>预检的产出是<strong>标注</strong>，不是闸门。除入口那一层的硬拦外，一律标出来让人决定。</p>' +
        '<div class="evidence">' +
          '<span>拦下不让播 <b>' + view.preflight.block + '</b></span>' +
          '<span>标红待复核 <b>' + view.preflight.redact + '</b></span>' +
          '<span>放行留痕 <b>' + view.preflight.flag + '</b></span>' +
        '</div></div>';
    }

    out += '<div class="legend">' +
      Object.keys(ORIGIN_LABEL).map(function (key) {
        return '<span><i style="background:' + ORIGIN_COLOR[key] + '"></i>' + ORIGIN_LABEL[key] + '</span>';
      }).join('') +
      '</div>';

    out += '<div class="cols">' +
      '<div class="doc src"><h4>原通稿</h4><div class="body">' + esc(view.manuscript.sourceText) + '</div></div>' +
      '<div>' + view.artifacts.map(function (item) { return artifactBlock(item, showAnnotations); }).join('') + '</div>' +
      '</div>';

    if (showAnnotations) {
      var all = [];
      view.artifacts.forEach(function (item) {
        item.annotations.forEach(function (annotation) { all.push(annotation); });
      });
      out += '<h2 class="hd">预检标注（' + all.length + '）</h2>' +
        (all.length === 0
          ? '<div class="empty">这一版没有命中任何规则。</div>'
          : all.map(annotationBlock).join(''));
    }
    return out;
  }

  var KIND_LABEL = { 'broadcast-script':'播报稿', 'short-video-copy':'短视频文案', 'source':'原文' };

  function artifactBlock(item, showAnnotations) {
    var artifact = item.artifact;
    var editing = state.editing === artifact.id;
    var head = '<h4><span>' + esc(KIND_LABEL[artifact.kind] || artifact.kind) + '</span>' +
      (editing
        ? '<span><button class="btn" data-save="' + esc(artifact.id) + '">保存改动</button> ' +
          '<button class="btn" data-cancel="1">取消</button></span>'
        : '<span><button class="btn" data-edit="' + esc(artifact.id) + '">改稿</button></span>') +
      '</h4>';

    if (editing) {
      var raw = item.segments.length > 0
        ? item.segments.map(function (segment) { return segment.text; }).join('\\n')
        : artifact.content;
      return '<div class="doc">' + head +
        '<textarea class="f" id="edit-' + esc(artifact.id) + '" style="min-height:220px">' + esc(raw) + '</textarea>' +
        '<div class="hint" style="margin-top:8px">一行一句。保存后由系统逐句比对上一版，自动判定哪几句被改过——句子来源不由填报的人决定。</div>' +
        '</div>';
    }

    var body = item.segments.length > 0
      ? item.segments.map(function (segment) {
          return '<span class="sent o-' + esc(segment.origin) + '" title="' + esc(ORIGIN_LABEL[segment.origin] || segment.origin) + '">' +
            markSentence(segment.text, showAnnotations ? annotationsFor(item, segment.ordinal) : []) +
            '</span>';
        }).join('')
      : esc(artifact.content);

    return '<div class="doc">' + head + '<div class="body">' + body + '</div></div>';
  }

  function annotationsFor(item, ordinal) {
    return item.annotations.filter(function (annotation) {
      return annotation.segmentOrdinal === ordinal && annotation.end > annotation.start;
    });
  }

  /** Wrap each annotated span, walking left to right so ranges never overlap. */
  function markSentence(text, annotations) {
    if (annotations.length === 0) return esc(text);
    var sorted = annotations.slice().sort(function (a, b) { return a.start - b.start; });
    var out = '';
    var cursor = 0;
    sorted.forEach(function (annotation) {
      if (annotation.start < cursor) return;
      out += esc(text.slice(cursor, annotation.start));
      out += '<mark class="an an-' + esc(annotation.action) + '" title="' + esc(annotation.title) + '">' +
        esc(text.slice(annotation.start, annotation.end)) + '</mark>';
      cursor = annotation.end;
    });
    return out + esc(text.slice(cursor));
  }

  function annotationBlock(annotation) {
    return '<div class="ann a-' + esc(annotation.action) + '">' +
      '<div class="top">' +
        '<span class="tag">' + esc(annotation.tier) + '</span>' +
        '<span class="tag">' + esc(ACTION_LABEL[annotation.action] || annotation.action) + '</span>' +
        '<span class="ttl">' + esc(annotation.title) + '</span>' +
      '</div>' +
      '<div class="dt">' + esc(annotation.detail) + '</div>' +
      (annotation.suggestion ? '<div class="sg">建议改为：' + esc(annotation.suggestion) + '</div>' : '') +
      '</div>';
  }

  // ——————————————————— ⑤ 三审三校 ———————————————————

  var REVIEW_LABEL = {
    'editor':'初审', 'department-head':'复审', 'supervising-leader':'终审'
  };

  /** 审核轮次由服务端契约给出；退回复核后即使尚未再审，也要显示新一轮。 */
  function groupRounds(reviews, currentRound) {
    var chain = reviews.filter(function (r) { return REVIEW_LABEL[r.stage]; });
    var count = Math.max(1, Number(currentRound) || 1);
    var rounds = [];
    for (var i = 0; i < count; i += 1) rounds.push([]);
    chain.forEach(function (r) {
      var index = Math.max(0, Math.min(rounds.length - 1, (Number(r.round) || 1) - 1));
      rounds[index].push(r);
    });
    return rounds;
  }

  function reviewPanel(view) {
    var annotations = view.artifacts.reduce(function (all, item) {
      return all.concat(item.annotations);
    }, []);
    var rounds = groupRounds(view.reviews, view.manuscript.reviewRound);
    var lastRound = rounds.length - 1;

    var out = '<div class="card"><h3>⑤ 三审三校流转</h3>' +
      '<p>我们没有发明新流程。把三审三校里<strong>机械的那部分</strong>自动化了，' +
      '<strong>判断的那部分</strong>留给人，并且让全程可追溯、责任到人。</p>' +
      '<p class="hint" style="margin:0">一个人可以同时持有多个角色（县级台常常只有两个人），' +
      '但每一次审批仍然分别留痕——<strong>合并的是人，不是责任</strong>。退回必须写明理由，理由进审计。</p>' +
      '</div>';

    rounds.forEach(function (round, index) {
      if (rounds.length > 1) {
        out += '<h2 class="hd">第 ' + (index + 1) + ' 轮' +
          (index < lastRound ? '（已退回）' : '') + '</h2>';
      }
      out += '<div class="passes">' + PASSES.map(function (pass) {
        return passCard(pass, round, annotations, index === lastRound, view);
      }).join('') + '</div>';
    });

    out += countersignPanel(view);
    return out;
  }

  function countersignPanel(view) {
    var records = view.reviews.filter(function (record) { return record.stage === 'countersign'; });
    if (view.manuscript.status !== 'countersign' && records.length === 0) return '';

    var body = records.map(function (record) {
      return '<div class="cs-record"><b>第 ' + esc(record.round || 1) + ' 轮</b> · ' +
        esc(record.actor) + ' · ' + clock(record.createdAt) +
        (record.countersignParty ? '<div>会签方：' + esc(record.countersignParty) + '</div>' : '') +
        (record.opinion ? '<div>会签意见：' + esc(record.opinion) + '</div>' : '') +
        (record.reason ? '<div>退回理由：' + esc(record.reason) + '</div>' : '') +
        '</div>';
    }).join('');

    return '<div class="card countersign" style="margin-top:14px"><h3>会签 · 征求意见</h3>' +
      (view.manuscript.status === 'countersign'
        ? '<p class="hint">会签是复审与终审之间的可选分支。请由部门主任填写会签方和意见后报送终审。</p>'
        : '') + body + '</div>';
  }

  function passCard(pass, round, annotations, isLive, view) {
    var record = null;
    for (var i = 0; i < round.length; i += 1) {
      if (round[i].stage === pass.stage) record = round[i];
    }
    var mine = annotations.filter(function (a) {
      return a.proofreadPass === pass.pass;
    });
    var waiting = isLive && !record && view.waitingOn === pass.stage;

    var status;
    if (record && (record.decision === 'changes-requested' || record.decision === 'rejected')) {
      status = '<span class="st back">⟲ 退回</span>';
    } else if (record) {
      status = '<span class="st ok">✓ 通过</span>';
    } else if (waiting) {
      status = '<span class="st now">待处理</span>';
    } else {
      status = '<span class="st idle">未到</span>';
    }

    return '<div class="pass' + (waiting ? ' live' : '') + (record ? ' done' : '') + '">' +
      '<div class="pass-hd">' +
        '<span class="pass-n">' + esc(REVIEW_LABEL[pass.stage] + ' + ' + pass.label) + '</span>' +
        status +
      '</div>' +
      '<div class="pass-who">' + esc(roleNameOf(pass.stage)) + '</div>' +
      '<div class="duties">' + pass.responsibilities.map(function (d) {
        return '<span class="duty">' + esc(d) + '</span>';
      }).join('') + '</div>' +
      '<div class="pass-ann">' +
        (mine.length === 0
          ? '<span class="dim">本校次没有待看的标注</span>'
          : '<b>' + mine.length + ' 处</b>待看：' + distinctTitles(mine)) +
      '</div>' +
      (record
        ? '<div class="pass-rec">' + esc(record.actor) + ' · ' + clock(record.createdAt) +
          (record.reason ? '<div class="pass-reason">' + esc(record.reason) + '</div>' : '') +
          '</div>'
        : '') +
      '</div>';
  }

  /**
   * 同一条规则会在两个产物上各命中一次。逐条列出来只会看到重复的标题，
   * 所以按标题合并、带上次数。
   */
  function distinctTitles(list) {
    var order = [];
    var seen = {};
    list.forEach(function (a) {
      if (seen[a.title]) { seen[a.title].n += 1; return; }
      seen[a.title] = { n: 1, action: a.action };
      order.push(a.title);
    });
    var shown = order.slice(0, 3).map(function (title) {
      var e = seen[title];
      return '<span class="mini a-' + esc(e.action) + '">' + esc(title) +
        (e.n > 1 ? ' ×' + e.n : '') + '</span>';
    }).join('');
    return shown + (order.length > 3 ? '<span class="dim"> 等 ' + order.length + ' 类</span>' : '');
  }

  function roleNameOf(stage) {
    return { 'editor':'编辑 / 记者', 'department-head':'部门主任', 'supervising-leader':'分管领导' }[stage] || stage;
  }

  // ——————————————————— ⑥ 追溯图谱 ———————————————————

  var STAGE_LABEL = {
    'admission':'入口准入', 'preflight':'输出预检',
    'editor':'初审 · 编辑', 'department-head':'复审 · 部门主任', 'supervising-leader':'终审 · 分管领导'
  };
  var DECISION_LABEL = {
    'approved':'通过', 'changes-requested':'退回', 'rejected':'拒绝',
    'reason-required':'补充依据后放行', 'pending-human-review':'待人工复核', 'blocked':'不予受理'
  };

  /**
   * AI 参与度的折线。少数几个点，所以画成带标注的阶梯，而不是一条抽象曲线——
   * 每个拐点都要说清是谁、在哪一步把它推低的。
   */
  function shareChart(points) {
    if (points.length === 0) return '';
    var W = 660, H = 150, padX = 46, padTop = 22, padBottom = 40;
    var innerW = W - padX * 2, innerH = H - padTop - padBottom;
    var n = points.length;
    var px = function (i) { return n === 1 ? padX + innerW / 2 : padX + innerW * (i / (n - 1)); };
    var py = function (v) { return padTop + innerH * (1 - v); };

    var grid = [0, 0.5, 1].map(function (v) {
      return '<line x1="' + padX + '" y1="' + py(v) + '" x2="' + (W - padX) + '" y2="' + py(v) +
             '" stroke="currentColor" stroke-opacity=".14" stroke-dasharray="' + (v === 0 || v === 1 ? '0' : '3 4') + '"/>' +
             '<text x="' + (padX - 8) + '" y="' + (py(v) + 4) + '" text-anchor="end" class="ax">' + (v * 100) + '%</text>';
    }).join('');

    var path = points.map(function (p, i) { return (i === 0 ? 'M' : 'L') + px(i) + ' ' + py(p.share); }).join(' ');
    var area = path + ' L' + px(n - 1) + ' ' + py(0) + ' L' + px(0) + ' ' + py(0) + ' Z';

    var dots = points.map(function (p, i) {
      var last = i === n - 1;
      return '<circle cx="' + px(i) + '" cy="' + py(p.share) + '" r="' + (last ? 5.5 : 4) + '" class="dot' + (last ? ' last' : '') + '"/>' +
        '<text x="' + px(i) + '" y="' + (py(p.share) - 12) + '" text-anchor="middle" class="val">' + pct(p.share) + '</text>' +
        '<text x="' + px(i) + '" y="' + (H - 20) + '" text-anchor="middle" class="cap">' +
          esc(p.event === 'generated' ? 'AI 生成' : '人工改稿') + '</text>' +
        '<text x="' + px(i) + '" y="' + (H - 7) + '" text-anchor="middle" class="cap dim">' + esc(p.actor) + '</text>';
    }).join('');

    return '<div class="chart"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
      'aria-label="AI 参与度从 ' + pct(points[0].share) + ' 变化到 ' + pct(points[n - 1].share) + '">' +
      grid +
      (n > 1 ? '<path d="' + area + '" class="fill"/>' : '') +
      '<path d="' + path + '" class="line"/>' + dots +
      '</svg></div>';
  }

  /** 每句一格。一眼看出这篇稿子里人到底动了多少。 */
  function sentenceMap(view) {
    if (view.artifacts.length === 0) return '<div class="empty">还没有产物。</div>';
    return view.artifacts.map(function (item) {
      if (item.segments.length === 0) return '';
      var counts = {};
      item.segments.forEach(function (s) { counts[s.origin] = (counts[s.origin] || 0) + 1; });
      return '<div class="smap">' +
        '<div class="smap-hd"><span>' + esc(KIND_LABEL[item.artifact.kind] || item.artifact.kind) + '</span>' +
          '<span class="dim">' + item.segments.length + ' 句 · AI 参与度 ' +
          (item.artifact.aiShare == null ? '未测量' : pct(item.artifact.aiShare)) + '</span></div>' +
        '<div class="cells">' + item.segments.map(function (s) {
          return '<i class="cell o-' + esc(s.origin) + '" title="' +
            esc((ORIGIN_LABEL[s.origin] || s.origin) + '：' + s.text) + '"></i>';
        }).join('') + '</div>' +
        '</div>';
    }).join('');
  }

  /** 责任链：谁在哪一级放行的，退回理由是什么。 */
  function responsibility(view) {
    if (view.reviews.length === 0) return '<div class="empty">还没有审核记录。</div>';
    return '<div class="chain">' + view.reviews.map(function (r) {
      var cls = r.decision === 'changes-requested' || r.decision === 'rejected' ? 'back' : 'fwd';
      return '<div class="link ' + cls + '">' +
        '<div class="stage">' + esc(STAGE_LABEL[r.stage] || r.stage) + '</div>' +
        '<div class="actor">' + esc(r.actor) + '</div>' +
        '<div class="verdict">' + esc(DECISION_LABEL[r.decision] || r.decision) + ' · ' + clock(r.createdAt) + '</div>' +
        (r.reason ? '<div class="reason">' + esc(r.reason) + '</div>' : '') +
        '</div>';
    }).join('') + '</div>';
  }

  /** 规则命中：准入那一路和预检那一路分开讲，因为它们的后果不一样。 */
  function ruleHits(view) {
    var hits = (view.trace || []).filter(function (e) { return e.kind === 'rule-hit'; });
    if (hits.length === 0) return '<div class="empty">没有规则命中。</div>';
    return hits.map(function (e) {
      var d = e.data || {};
      if (e.actor === '入口准入') {
        var verdict = d.decision === 'blocked' ? '硬拦，模型未被调用'
                    : d.decision === 'reason-required' ? '要理由' : '仅留痕放行';
        return '<div class="hit"><div class="top"><span class="tag">入口准入</span>' +
          '<span class="ttl">' + esc(verdict) + '</span><span class="dim">' + clock(e.createdAt) + '</span></div>' +
          '<div class="dt">判定 <code>' + esc(String(d.reasonCode || '')) + '</code>' +
          '　模型调用 <b>' + (d.modelInvoked ? '1 次' : '0 次') + '</b>' +
          (d.offDutyUse ? '　<b class="warn">另标：非业务用途</b>' : '') + '</div>' +
          ((d.hits || []).length ? '<div class="dt dim">命中 ' + esc((d.hits || []).join('、')) + '</div>' : '') +
          '</div>';
      }
      var rules = (d.rules || []);
      var tally = {};
      rules.forEach(function (r) { tally[r] = (tally[r] || 0) + 1; });
      return '<div class="hit"><div class="top"><span class="tag">输出预检</span>' +
        '<span class="ttl">' + esc(KIND_LABEL[d.kind] || d.kind || '') + '</span>' +
        '<span class="dim">' + clock(e.createdAt) + '</span></div>' +
        '<div class="dt">拦下 <b>' + (d.block || 0) + '</b>　标红 <b>' + (d.redact || 0) +
        '</b>　留痕 <b>' + (d.flag || 0) + '</b></div>' +
        (rules.length ? '<div class="dt dim">' + Object.keys(tally).map(function (k) {
          return esc(CATEGORY_LABEL[k] || k) + ' ×' + tally[k];
        }).join('　') + '</div>' : '') +
        '</div>';
    }).join('');
  }

  var CATEGORY_LABEL = {
    'typo':'错别字与用词', 'punctuation':'标点差错', 'format':'格式规范',
    'banned-term':'禁用词', 'caution-term':'慎用词', 'leader-title':'领导表述规范',
    'inconsistency':'与原通稿不一致', 'privacy-name':'当事人姓名保护',
    'ai-label':'AI 生成内容标识', 'judgment':'导向与事实判断'
  };

  function tracePanel(view) {
    if (state.showContrast) return contrastPanel(view);
    var out = '<div class="card"><h3>⑥ AI 参与度追溯</h3>' +
      '<p>整条链路的收口：每句话谁写的、命中过哪些规则、被谁在哪一级放行、谁最终签发。' +
      '这些数字只有站在生产现场才拿得到——拿到成品的审校产品给不出它们。</p></div>';

    // 签发卡。签发时的 AI 参与度是给台领导的抓手，不是合规记录。
    if (view.signOff) {
      var s = view.signOff.aiShare;
      var hot = s != null && s >= 0.9;
      out += '<div class="signoff' + (hot ? ' hot' : '') + '">' +
        '<div class="so-main"><div class="so-k">签发</div>' +
          '<div class="so-v">' + esc(view.signOff.actor) + '</div>' +
          '<div class="so-t">' + clock(view.signOff.at) + '</div></div>' +
        '<div class="so-main"><div class="so-k">签发时 AI 参与度</div>' +
          '<div class="so-v big">' + (s == null ? '未测量' : pct(s)) + '</div>' +
          '<div class="so-t">' + (hot
            ? '几乎没人改过——三审三校是否走过场，这个数字说了算。'
            : '人工确实介入过，责任链可查。') + '</div></div>' +
        '</div>';
    }

    out += '<h2 class="hd">AI 参与度怎么变的</h2>';
    out += view.provenance.length > 0
      ? shareChart(view.provenance) +
        '<p class="hint">口径：(ai + ai-edited×0.5) / 总句数。每次流转由系统逐句比对上一版重算，' +
        '句子来源不由填报的人决定。</p>'
      : '<div class="empty">还没有可测量的变动。</div>';

    out += '<h2 class="hd">句级来源图谱</h2>' +
      '<div class="legend">' + Object.keys(ORIGIN_LABEL).map(function (key) {
        return '<span><i style="background:' + ORIGIN_COLOR[key] + '"></i>' + ORIGIN_LABEL[key] + '</span>';
      }).join('') + '</div>' + sentenceMap(view);

    out += '<h2 class="hd">责任链</h2>' + responsibility(view);
    out += '<h2 class="hd">规则命中</h2>' + ruleHits(view);
    out += '<div class="actions-bar" style="margin-top:18px">' +
      '<button class="btn" id="contrast-on">对照组：关掉把关人会怎样</button>' +
      '<span class="hint">同一份通稿，减去把关。收口那一镜。</span></div>';
    return out;
  }

  // ——————————————————— 对照组（演示脚本 2:50）———————————————————

  var CONTRAST_ROWS = [
    {
      k: '这次调用该不该发生',
      off: function () { return '没人问'; },
      on: function (c) {
        var label = { 'blocked':'硬拦，模型完全没被调用',
                      'reason-required':'要理由，填了选题依据才放行',
                      'admitted-logged':'仅留痕放行' }[c['with'].admissionDecision];
        return label || c['with'].admissionDecision;
      }
    },
    {
      k: '稿子里的问题',
      off: function (c) {
        var n = c.without.issuesShipped;
        return n === 0 ? '没有检查' : n + ' 处直接播出去';
      },
      on: function (c) {
        var fixed = c['with'].issuesCaught - c['with'].issuesRemaining;
        return '当场抓到 ' + c['with'].issuesCaught + ' 处（拦下 ' + c['with'].block +
          '　标红 ' + c['with'].redact + '　留痕 ' + c['with'].flag + '）' +
          (fixed > 0 ? '，流程已处理 ' + fixed + ' 处' : '');
      }
    },
    {
      k: '哪几句是 AI 写的',
      off: function () { return '不知道'; },
      on: function (c) {
        return c['with'].aiShare == null
          ? '未测量'
          : c['with'].segmentCount + ' 句逐句可查，AI 参与度 ' + pct(c['with'].aiShare);
      }
    },
    {
      k: '有没有 AI 生成内容标识',
      off: function () { return '没有'; },
      on: function (c) {
        return c.without.aiLabelled === false && c['with'].flag > 0
          ? '预检已标出缺失并给出补写建议'
          : '已按《标识办法》检查';
      }
    },
    {
      k: '出事找谁',
      off: function () { return '查不到'; },
      on: function (c) {
        var who = c['with'].accountableActors + ' 人签字';
        return c['with'].signedBy ? who + '，签发人 ' + c['with'].signedBy : who;
      }
    },
    {
      k: '留下了什么记录',
      off: function () { return '无'; },
      on: function (c) { return c['with'].traceEvents + ' 条留痕'; }
    }
  ];

  var KIND_LABEL_C = { 'broadcast-script':'播报稿', 'short-video-copy':'短视频文案' };

  function contrastPanel(view) {
    var c = state.contrast;
    if (!c) return '<div class="empty">正在取对照数据…</div>';

    var out = '<div class="card"><h3>对照组 · 关掉把关人</h3>' +
      '<p>同一份通稿，减去把关。下面每个数字都指回真实留痕，不是模拟出来的。</p></div>';

    out += '<div class="vs">' +
      '<div class="vs-hd off">关掉把关人</div><div class="vs-hd on">把关人</div>' +
      CONTRAST_ROWS.map(function (row) {
        return '<div class="vs-k">' + esc(row.k) + '</div>' +
          '<div class="vs-c off">' + esc(row.off(c)) + '</div>' +
          '<div class="vs-c on">' + esc(row.on(c)) + '</div>';
      }).join('') +
      '</div>';

    if (c.without.issuesShipped > 0) {
      out += '<h2 class="hd">本来会播出去的稿子</h2>' +
        '<p class="hint">这是模型<strong>原样写出来</strong>的那一版。关掉把关人就没有预检标注，' +
        '编辑根本不知道要改哪里——所以下面这些问题直接进了播出流程：' +
        '禁用词 ' + c.without.bannedTermsShipped +
        ' 处、与原通稿不符 ' + c.without.inconsistenciesShipped +
        ' 处、一校差错 ' + c.without.proofreadIssuesShipped + ' 处。</p>' +
        c.wouldShip.map(function (item) {
          return '<div class="doc ship"><h4>' + esc(KIND_LABEL_C[item.kind] || item.kind) +
            '<span class="dim">未经预检 · 无 AI 标识 · 无来源记录</span></h4>' +
            '<div class="body">' + esc(item.content) + '</div></div>';
        }).join('');
    }

    out += '<div class="closer">私有化解决不了这个，外挂的内容审核 API 也解决不了' +
      '——<b>因为它们都看不见生产过程。</b></div>';

    out += '<div class="actions-bar" style="margin-top:16px">' +
      '<button class="btn" id="contrast-off">返回追溯图谱</button></div>';
    return out;
  }

  function actionsBar(view) {
    var mine = view.actions[state.role] || [];
    if (mine.length === 0) {
      var owner = view.waitingOn;
      return '<div class="card"><p style="margin:0">' +
        (owner
          ? '这一步由<strong>' + esc(ROLE_LABEL[owner] || owner) + '</strong>处理。切换右上角身份即可继续。'
          : '「' + esc(view.statusLabel) + '」是终态，流程到此结束。') +
        '</p></div>';
    }
    var buttons = mine.map(function (transition) {
      var cls = transition.kind === 'return' ? 'btn danger' : 'btn primary';
      return '<button class="' + cls + '" data-to="' + esc(transition.to) + '"' +
        ' data-reason="' + (transition.requiresReason ? '1' : '0') + '">' + esc(transition.label) + '</button>';
    }).join('');

    var reasonBox = mine.some(function (t) { return t.requiresReason; })
      ? '<label class="f" style="margin-top:12px"><span>选题依据 / 退回理由（进审计）</span>' +
        '<textarea class="f" id="reason" style="min-height:76px" placeholder="例：县应急管理局已授权发布，见 8 月 27 日通报"></textarea></label>'
      : '';

    var countersignBox = view.manuscript.status === 'countersign'
      ? '<div class="cs-fields">' +
          '<label class="f"><span>会签方</span><input class="f" id="countersign-party" maxlength="100" placeholder="例：县应急管理局"></label>' +
          '<label class="f"><span>会签意见</span><textarea class="f" id="countersign-opinion" style="min-height:76px" maxlength="2000" placeholder="填写会签意见，内容将进入审核留痕"></textarea></label>' +
        '</div>'
      : '';

    return '<div class="card"><h2 class="hd" style="margin-top:0">下一步 · ' + esc(ROLE_LABEL[state.role]) + '</h2>' +
      countersignBox +
      reasonBox +
      '<div class="actions-bar">' + buttons + '</div>' +
      (state.error ? '<div class="err">' + esc(state.error) + '</div>' : '') +
      '</div>';
  }

  function renderSide() {
    renderTimeline();

    var host = $('share');
    var view = state.view;
    if (!view || view.aiShare == null) {
      host.innerHTML = '<div class="share"><div class="none">还没有可测量的句子。<br>未测量不等于 0。</div></div>';
      return;
    }
    var dropped = state.prevShare != null && view.aiShare < state.prevShare;
    var delta = dropped ? '↓ ' + pct(state.prevShare - view.aiShare) + '（人改过了）' : '';
    var counts = {};
    (view.artifacts || []).forEach(function (item) {
      item.segments.forEach(function (segment) { counts[segment.origin] = (counts[segment.origin] || 0) + 1; });
    });

    host.innerHTML = '<div class="share">' +
      '<div class="big' + (dropped ? ' dropped' : '') + '">' + pct(view.aiShare) + '</div>' +
      '<div class="delta">' + esc(delta) + '</div>' +
      '<div class="counts">' + Object.keys(ORIGIN_LABEL).map(function (key) {
        return '<span><i style="background:' + ORIGIN_COLOR[key] + '"></i>' + ORIGIN_LABEL[key] + ' ' + (counts[key] || 0) + '</span>';
      }).join('') + '</div>' +
      '<div class="formula">(ai + ai-edited×0.5) / ' + view.segmentCount + ' 句</div>' +
      '</div>';
  }

  /** 留痕 starts at 稿件建立, well before there is anything to measure. */
  function traceDetail(event) {
    if (event.kind !== 'model-requested' && event.kind !== 'model-completed') return '';
    var data = event.data || {};
    var operation = KIND_LABEL[data.operation] || data.operation || '模型任务';
    var model = data.servedModel || data.requestedModel || event.actor;
    if (event.kind === 'model-requested') {
      return operation + ' · ' + model + ' · 已送入统一网关';
    }
    if (data.outcome === 'error') {
      return operation + ' · ' + model + ' · 调用失败（' + (data.errorCode || 'upstream_failure') + '）';
    }
    var input = typeof data.inputTokens === 'number' ? data.inputTokens : 0;
    var output = typeof data.outputTokens === 'number' ? data.outputTokens : 0;
    var latency = typeof data.latencyMs === 'number' ? Math.round(data.latencyMs) : 0;
    var estimate = data.usageSource === 'estimated' ? '约 ' : '';
    return operation + ' · ' + model + ' · ' + estimate + input + '↓ / ' + output + '↑ tokens · ' + latency + 'ms';
  }

  function renderTimeline() {
    var trace = state.view ? (state.view.trace || []) : [];
    $('timeline').innerHTML = trace.length === 0
      ? '<div class="empty">还没有留痕。</div>'
      : trace.slice().reverse().map(function (event) {
          var cls = event.actorType === 'system' ? 'sys' : (event.actorType === 'ai' ? 'ai' : 'hum');
          return '<div class="ev ' + cls + '">' +
            '<div class="k">' + esc(TRACE_LABEL[event.kind] || event.kind) + '</div>' +
            '<div class="m">' + clock(event.createdAt) + ' · ' + esc(event.actor) + '</div>' +
            (traceDetail(event) ? '<div class="d">' + esc(traceDetail(event)) + '</div>' : '') +
            '</div>';
        }).join('');
  }

  // ——————————————————— actions ———————————————————

  function submitNew() {
    var payload = {
      title: $('nf-title').value.trim(),
      sourceType: $('nf-type').value,
      sourceText: $('nf-text').value.trim()
    };
    if (!payload.title || !payload.sourceText) {
      state.error = '标题和正文都要填。';
      renderPanel();
      return;
    }
    api('/api/workbench', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (data) {
      return loadList().then(function () { return openManuscript(data.manuscript.id); });
    }).catch(function (error) {
      state.error = error.message;
      renderPanel();
    });
  }

  function advance(to, needsReason) {
    var reasonField = $('reason');
    var reason = reasonField ? reasonField.value.trim() : '';
    if (needsReason && !reason) {
      state.error = '这一步必须写明理由，理由进审计。';
      renderPanel();
      return;
    }
    state.error = '';
    var body = { to: to, role: state.role };
    if (reason) body.reason = reason;
    if (state.view && state.view.manuscript.status === 'countersign' && to === 'final-review') {
      var partyField = $('countersign-party');
      var opinionField = $('countersign-opinion');
      var party = partyField ? partyField.value.trim() : '';
      var opinion = opinionField ? opinionField.value.trim() : '';
      if (!party || !opinion) {
        state.error = '完成会签必须填写会签方和会签意见。';
        renderPanel();
        return;
      }
      body.countersignParty = party;
      body.opinion = opinion;
    }

    api('/api/workbench/' + encodeURIComponent(state.currentId) + '/transition', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (data) {
      applyView(data.view);
      return loadList();
    }).catch(function (error) {
      state.error = error.message;
      renderPanel();
    });
  }

  function saveRevision(artifactId) {
    var field = $('edit-' + artifactId);
    if (!field) return;
    api('/api/workbench/' + encodeURIComponent(state.currentId) +
        '/artifacts/' + encodeURIComponent(artifactId) + '/revise', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: state.role, content: field.value })
    }).then(function (data) {
      state.editing = null;
      applyView(data.view);
    }).catch(function (error) {
      state.error = error.message;
      renderPanel();
    });
  }

  // ——————————————————— wiring ———————————————————

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!(target instanceof Element)) return;

    var roleBtn = target.closest('.role-btn');
    if (roleBtn) {
      state.role = roleBtn.getAttribute('data-role');
      Array.prototype.forEach.call(document.querySelectorAll('.role-btn'), function (btn) {
        btn.setAttribute('aria-pressed', String(btn === roleBtn));
      });
      state.error = '';
      renderPanel();
      return;
    }

    if (target.closest('#new-btn')) { showNew(); return; }

    if (target.closest('#nf-sample')) {
      api('/api/demo/fixtures').then(function (data) {
        var t = $('nf-title'), y = $('nf-type'), x = $('nf-text');
        if (t) t.value = data.mainNotice.title;
        if (y) y.value = data.mainNotice.sourceType;
        if (x) x.value = data.mainNotice.sourceText;
      }).catch(function (error) { state.error = error.message; renderPanel(); });
      return;
    }

    if (target.closest('#seed-btn')) {
      // 彩排要反复重来。重置会清空全部稿件，所以问一次。
      if (!window.confirm('将清空全部稿件，并重建三组准入样例。继续？')) return;
      api('/api/demo/seed', { method: 'POST' }).then(function () {
        state.view = null; state.currentId = null; state.contrast = null; state.showContrast = false;
        return loadList().then(render);
      }).catch(function (error) { state.error = error.message; renderPanel(); });
      return;
    }
    if (target.closest('#nf-submit')) { submitNew(); return; }

    var row = target.closest('.ms');
    if (row) { openManuscript(row.getAttribute('data-id')); return; }

    var edit = target.closest('[data-edit]');
    if (edit) { state.editing = edit.getAttribute('data-edit'); renderPanel(); return; }

    var cancel = target.closest('[data-cancel]');
    if (cancel) { state.editing = null; renderPanel(); return; }

    var save = target.closest('[data-save]');
    if (save) { saveRevision(save.getAttribute('data-save')); return; }

    if (target.closest('#contrast-on')) {
      api('/api/workbench/' + encodeURIComponent(state.currentId) + '/contrast')
        .then(function (data) { state.contrast = data; state.showContrast = true; renderPanel(); })
        .catch(function (error) { state.error = error.message; renderPanel(); });
      return;
    }
    if (target.closest('#contrast-off')) { state.showContrast = false; renderPanel(); return; }

    var move = target.closest('[data-to]');
    if (move) { advance(move.getAttribute('data-to'), move.getAttribute('data-reason') === '1'); return; }
  });

  // Live 留痕: the same SSE channel the legacy console uses.
  try {
    var events = new EventSource('/events');
    var refresh = function () {
      if (state.currentId) {
        api('/api/workbench/' + encodeURIComponent(state.currentId)).then(applyView).catch(function () {});
      }
    };
    events.addEventListener('trace', refresh);
    events.addEventListener('manuscript', function () { loadList(); });
  } catch (error) { /* SSE is a nicety; the page works without it */ }

  loadList().then(function () { render(); });
})();
</script>
</body>
</html>`;
}
