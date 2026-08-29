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
<meta name="color-scheme" content="dark light" />
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
    position:relative;
    font-family:var(--sans); font-size:13px; color:var(--muted);
    padding:7px 14px; background:var(--panel-2);
    border:1px solid var(--line); border-radius:9px; cursor:pointer;
    transition:background-color .16s ease, border-color .16s ease, color .16s ease;
  }
  .role-btn:hover { border-color:var(--accent); color:var(--ink); }
  .role-btn[aria-pressed="true"] {
    background:var(--accent-soft); border-color:var(--accent); color:var(--accent-deep);
  }
  .visually-hidden {
    position:absolute !important; width:1px !important; height:1px !important;
    padding:0 !important; margin:-1px !important; overflow:hidden !important;
    clip:rect(0,0,0,0) !important; white-space:nowrap !important; border:0 !important;
  }
  .account { display:flex; align-items:center; gap:8px; margin-left:10px; padding-left:12px; border-left:1px solid var(--line); }
  .account-name { font-size:12px; color:var(--muted); }
  .logout-btn { border:0; background:transparent; color:var(--faint); font-size:12px; cursor:pointer; }
  .logout-btn:hover { color:var(--block); }

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
  .model-picker {
    display:grid; grid-template-columns:minmax(160px,1fr) minmax(240px,2fr); gap:12px;
    align-items:end; margin:12px 0; padding:12px 14px; border:1px solid var(--line-strong);
    border-radius:10px; background:var(--panel-2);
  }
  .model-picker label { margin:0; }
  .model-picker .model-note { font-size:12px; line-height:1.6; color:var(--muted); padding-bottom:2px; }
  @media (max-width:720px) { .model-picker { grid-template-columns:1fr; } }
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
  .cols.editing-open { grid-template-columns:1fr; }
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

  /* ---------- Assisted newsroom editor ---------- */
  .revision-brief {
    display:grid; grid-template-columns:auto minmax(0,1fr); gap:12px 16px;
    margin-bottom:14px; padding:16px 18px; border:1px solid var(--warn);
    border-radius:var(--radius); background:var(--warn-soft);
  }
  .revision-brief .mark { font-size:24px; color:var(--warn); line-height:1; }
  .revision-brief h3 { margin:0 0 4px; font-size:16px; }
  .revision-brief p { margin:0; color:var(--ink); }
  .revision-brief .meta { margin-top:6px; color:var(--muted); font-size:12px; }
  .editor-workspace {
    display:grid; grid-template-columns:minmax(0,1fr) 330px; gap:0;
    border:1px solid var(--line-strong); border-radius:10px; overflow:hidden;
    background:var(--panel-2);
  }
  .editor-canvas { min-width:0; padding:14px; background:var(--panel-2); }
  .editor-canvas textarea.f {
    min-height:360px; margin:0; background:var(--panel); border-color:var(--line-strong);
    font-family:var(--sans); line-height:1.85;
  }
  .editor-help {
    display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;
    margin-top:8px; color:var(--faint); font-size:12px;
  }
  .editor-issues {
    min-width:0; max-height:480px; overflow:auto; padding:14px;
    border-left:1px solid var(--line-strong); background:var(--panel);
  }
  .editor-issues-head {
    display:flex; align-items:baseline; justify-content:space-between; gap:10px;
    margin-bottom:10px;
  }
  .editor-issues-head strong { font-size:14px; }
  .editor-issues-head span { color:var(--muted); font:12px var(--mono); }
  .editor-issue {
    padding:12px; margin-bottom:10px; border:1px solid var(--line);
    border-left:4px solid var(--line-strong); border-radius:8px; background:var(--panel-2);
    transition:border-color .16s ease, background-color .16s ease;
  }
  .editor-issue.a-block { border-left-color:var(--block); }
  .editor-issue.a-redact { border-left-color:var(--warn); }
  .editor-issue.a-flag { border-left-color:var(--info); }
  .editor-issue.is-active { border-color:var(--accent); background:var(--accent-soft); }
  .editor-issue.is-applied { border-left-color:var(--accent); }
  .editor-issue-head { display:flex; align-items:flex-start; gap:8px; }
  .editor-issue-num {
    display:grid; place-items:center; flex:0 0 auto; width:24px; height:24px;
    border-radius:50%; background:var(--panel-3); color:var(--muted); font:700 11px var(--mono);
  }
  .editor-issue-title { font-size:13px; font-weight:700; line-height:1.45; }
  .editor-issue-meta { margin-top:2px; color:var(--faint); font:11px var(--mono); }
  .editor-issue-snippet {
    margin:9px 0; padding:8px 10px; border-radius:6px; background:var(--panel);
    color:var(--muted); font-size:12px; line-height:1.65;
  }
  .editor-issue-detail { color:var(--muted); font-size:12px; line-height:1.55; }
  .editor-suggestion {
    margin-top:8px; padding:8px 10px; border-left:3px solid var(--accent);
    background:var(--accent-soft); color:var(--ink); font-size:12px;
  }
  .editor-issue-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
  .editor-issue-actions .btn { padding:6px 10px; font-size:12px; border-radius:7px; }
  .editor-applied { color:var(--accent-deep); font-size:12px; font-weight:700; }
  .editor-empty { padding:18px 10px; color:var(--muted); text-align:center; }
  @media (max-width:1024px) {
    .editor-workspace { grid-template-columns:1fr; }
    .editor-issues { max-height:none; border-left:0; border-top:1px solid var(--line-strong); }
  }

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
  .review-desk {
    background:var(--panel); border:1px solid var(--line-strong);
    border-radius:var(--radius); padding:18px; margin-bottom:16px;
  }
  .review-desk-head {
    display:flex; align-items:flex-start; gap:14px; margin-bottom:14px;
  }
  .review-desk-head h3 { margin:0; font-size:18px; }
  .review-desk-head p { margin:5px 0 0; color:var(--muted); line-height:1.55; }
  .review-focus {
    margin-left:auto; flex:0 0 auto; padding:6px 10px; border:1px solid var(--warn);
    border-radius:6px; background:var(--warn-soft); color:var(--warn);
    font-family:var(--mono); font-size:12px; font-weight:700;
  }
  .review-docs {
    display:grid; grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr);
    grid-template-areas:'source outputs'; gap:12px; align-items:start;
  }
  .review-source { grid-area:source; }
  .review-outputs { grid-area:outputs; min-width:0; }
  .review-output { border-color:var(--line-strong); }
  .review-output h4 { color:var(--ink); }
  .review-doc-meta {
    margin-left:auto; font-family:var(--mono); font-size:11px; font-weight:600;
    color:var(--warn); white-space:nowrap;
  }
  .review-pending {
    margin-top:12px; padding-top:10px; border-top:1px solid var(--line);
    color:var(--muted); font-size:12px; line-height:1.7;
  }
  .review-pending strong { color:var(--ink); }
  .review-pending .mini { margin-top:4px; }
  @media (max-width:1179px) {
    .review-docs { grid-template-columns:1fr; grid-template-areas:'outputs' 'source'; }
  }
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

  /* ---------- Guided presentation mode ---------- */
  button:focus-visible, [role="button"]:focus-visible, input:focus-visible,
  textarea:focus-visible, select:focus-visible, summary:focus-visible {
    outline:3px solid var(--accent); outline-offset:3px;
  }
  .present-launch { margin-left:4px; }
  .present-controls { display:none; align-items:center; gap:8px; flex-wrap:wrap; margin-left:auto; }
  .present-mode-badge {
    display:inline-flex; align-items:center; gap:8px; padding:7px 12px;
    border:1px solid var(--line-strong); border-radius:999px;
    font-size:12px; font-weight:700; color:var(--accent-deep); background:var(--accent-soft);
  }
  .present-mode-badge::before { content:'●'; font-size:10px; }
  .display-switch { display:flex; gap:4px; padding:3px; border:1px solid var(--line-strong); border-radius:10px; }
  .display-switch button {
    border:0; border-radius:7px; padding:6px 10px; cursor:pointer;
    font:600 12px var(--sans); color:var(--muted); background:transparent;
  }
  .display-switch button[aria-pressed="true"] { color:var(--ink); background:var(--panel-3); }

  .present-summary, .present-guide, .present-warning, .present-drawer-tools { display:none; }
  .present-scrim {
    position:fixed; inset:0; z-index:48; border:0; padding:0;
    background:rgba(3,10,7,.58); opacity:0; pointer-events:none; transition:opacity .16s ease;
  }

  .present-modal[hidden] { display:none; }
  .present-modal {
    position:fixed; inset:0; z-index:100; display:grid; place-items:center;
    padding:24px; background:rgba(3,10,7,.72);
  }
  .present-dialog {
    width:min(680px,100%); max-height:calc(100vh - 48px); overflow:auto;
    border:1px solid var(--line-strong); border-radius:16px; background:var(--panel);
    padding:24px;
  }
  .present-dialog-head { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; }
  .present-dialog h2 { margin:0; font:700 24px/1.25 var(--sans); }
  .present-dialog p { color:var(--muted); }
  .icon-btn {
    width:40px; height:40px; display:grid; place-items:center; flex:0 0 auto;
    border:1px solid var(--line-strong); border-radius:10px; color:var(--ink);
    background:var(--panel-2); cursor:pointer; font-size:20px;
  }
  .setup-display { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:20px 0; }
  .setup-choice {
    text-align:left; border:1px solid var(--line-strong); border-radius:12px;
    background:var(--panel-2); color:var(--ink); padding:16px; cursor:pointer;
  }
  .setup-choice[aria-pressed="true"] { border:2px solid var(--accent); padding:15px; background:var(--accent-soft); }
  .setup-choice strong { display:block; font-size:16px; margin-bottom:4px; }
  .setup-choice span { display:block; color:var(--muted); font-size:13px; line-height:1.5; }
  .setup-warning {
    margin:16px 0; padding:14px 16px; border-left:4px solid var(--warn);
    background:var(--warn-soft); color:var(--ink);
  }
  .setup-status { min-height:24px; margin:12px 0; color:var(--muted); }
  .setup-status.ok { color:var(--accent-deep); font-weight:700; }
  .setup-status.error { color:var(--block); font-weight:700; }
  .setup-actions { display:flex; gap:10px; flex-wrap:wrap; justify-content:flex-end; }

  body.is-present {
    font-size:18px; line-height:1.6; background-image:none;
    --present-stage-max:1280px;
  }
  body.is-present[data-display="led"] {
    color-scheme:dark;
    --bg:#09110E; --panel:#121D18; --panel-2:#1A2821; --panel-3:#22342A;
    --ink:#F7FAF8; --muted:#C6D2CB; --faint:#A7B8AE;
    --line:rgba(247,250,248,.16); --line-strong:rgba(247,250,248,.3);
    --accent:#33D6A2; --accent-deep:#8AF2D2; --accent-soft:rgba(51,214,162,.16);
    --block:#FF8C7A; --block-soft:rgba(255,140,122,.16);
    --warn:#F3C66C; --warn-soft:rgba(243,198,108,.16);
    --info:#8EC5F4; --info-soft:rgba(142,197,244,.16);
    --ai:#8EC5F4; --ai-edited:#33D6A2; --human:#F3C66C; --source:#A7B8AE;
  }
  body.is-present[data-display="projector"] {
    color-scheme:light;
    --bg:#F2F0E8; --panel:#FAF9F4; --panel-2:#E8ECE6; --panel-3:#DCE4DD;
    --ink:#10211A; --muted:#3F554A; --faint:#5C7166;
    --line:#B8C3BB; --line-strong:#7E9185;
    --accent:#087A55; --accent-deep:#075E43; --accent-soft:rgba(8,122,85,.12);
    --block:#B3261E; --block-soft:rgba(179,38,30,.1);
    --warn:#8A5B00; --warn-soft:rgba(138,91,0,.11);
    --info:#285D8F; --info-soft:rgba(40,93,143,.1);
    --ai:#285D8F; --ai-edited:#087A55; --human:#8A5B00; --source:#5C7166;
  }
  body.is-present header.topbar {
    position:sticky; top:0; z-index:40; padding:12px 24px; gap:14px;
    background:var(--panel); border-bottom:2px solid var(--line-strong);
  }
  body.is-present .brand .name { font-family:var(--sans); font-size:24px; font-weight:800; letter-spacing:-.3px; }
  body.is-present .brand .sub { font-size:14px; color:var(--muted); }
  body.is-present .demo-badge, body.is-present .present-launch { display:none; }
  body.is-present .present-controls { display:flex; }
  body.is-present .roles { margin-left:0; }
  body.is-present .roles .lbl { font-size:14px; color:var(--muted); }
  body.is-present .role-btn { font-size:16px; padding:9px 14px; border-width:2px; }
  body.is-present .role-btn.role-needed:not([aria-pressed="true"]) {
    border-color:var(--warn); color:var(--warn); box-shadow:0 0 0 3px var(--warn-soft);
  }
  body.is-present .role-btn.role-leaving {
    animation:role-release .32s cubic-bezier(.2,.8,.2,1) both;
  }
  body.is-present .role-btn.role-switching {
    z-index:3; animation:role-receive .76s cubic-bezier(.16,1,.3,1) both;
  }
  body.is-present .role-btn.role-switching::after {
    content:'身份已切换'; position:absolute; top:calc(100% + 9px); left:50%;
    transform:translateX(-50%); padding:5px 9px; border-radius:6px;
    background:var(--warn); color:#fff; white-space:nowrap; pointer-events:none;
    font-size:14px; font-weight:800; line-height:1.2;
    animation:role-handoff-label .76s cubic-bezier(.16,1,.3,1) both;
  }
  body.is-present[data-display="led"] .role-btn.role-switching::after { color:#09110E; }
  @keyframes role-release {
    0% { opacity:1; }
    100% { opacity:.62; }
  }
  @keyframes role-receive {
    0% { transform:scale(.96); background:var(--warn-soft); border-color:var(--warn); color:var(--warn); box-shadow:0 0 0 0 var(--warn-soft); }
    38% { transform:scale(1.06); background:var(--warn-soft); border-color:var(--warn); color:var(--warn); box-shadow:0 0 0 7px var(--warn-soft); }
    100% { transform:scale(1); background:var(--accent-soft); border-color:var(--accent); color:var(--accent-deep); box-shadow:0 0 0 0 var(--warn-soft); }
  }
  @keyframes role-handoff-label {
    0% { opacity:0; transform:translate(-50%,-5px); }
    22%, 68% { opacity:1; transform:translate(-50%,0); }
    100% { opacity:0; transform:translate(-50%,3px); }
  }
  body.is-present main {
    width:100%; max-width:1740px; margin:0 auto; padding:20px 24px 48px;
    display:grid; grid-template-columns:minmax(0,var(--present-stage-max)) 360px;
    justify-content:center; gap:20px; align-items:start; min-height:auto;
  }
  body.is-present section.stage { padding:0; overflow:visible; min-width:0; }
  body.is-present aside.side {
    padding:20px; overflow:auto; position:sticky; top:98px; max-height:calc(100vh - 118px);
    border:2px solid var(--line-strong); border-radius:12px; background:var(--panel);
  }
  body.is-present aside.list {
    position:fixed; inset:0 auto 0 0; z-index:60; width:min(390px,92vw);
    padding:24px; border:0; border-right:2px solid var(--line-strong); background:var(--panel);
    transform:translateX(-102%); transition:transform .18s ease; overflow-y:auto;
  }
  body.is-present.present-list-open aside.list { transform:translateX(0); }
  body.is-present.present-list-open .present-scrim,
  body.is-present.present-evidence-open .present-scrim { opacity:1; pointer-events:auto; }
  body.is-present aside.list .present-drawer-tools { display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; }
  body.is-present aside.list > h2.hd { display:none; }
  body.is-present aside.list #new-btn, body.is-present aside.list #seed-btn { display:none; }
  body.is-present .present-drawer-tools h2 { margin:0; font-size:22px; }
  body.is-present .present-drawer-tools .icon-btn { display:grid; }

  body.is-present .present-warning {
    padding:14px 18px; margin-bottom:16px; border:2px solid var(--warn);
    border-radius:10px; background:var(--warn-soft); color:var(--ink); font-weight:700;
  }
  body.is-present .present-warning:not([hidden]) { display:block; }
  body.is-present .present-summary {
    align-items:center; gap:14px; padding:14px 16px; margin-bottom:16px;
    border:2px solid var(--line-strong); border-radius:12px; background:var(--panel);
  }
  body.is-present .present-summary .metric { font:800 30px/1 var(--mono); color:var(--accent-deep); }
  body.is-present .present-summary .copy { flex:1; min-width:0; color:var(--muted); font-size:14px; }
  body.is-present .present-summary .copy b { color:var(--ink); }
  body.is-present .present-guide {
    margin-bottom:16px; border:2px solid var(--line-strong); border-radius:14px;
    background:var(--panel); overflow:hidden;
  }
  body.is-present .present-guide:not(:empty) { display:block; }
  .guide-head {
    display:flex; align-items:center; gap:12px; padding:12px 18px;
    background:var(--panel-2); border-bottom:2px solid var(--line-strong);
  }
  .guide-head .gate { font-weight:800; font-size:20px; }
  .guide-head .scope { margin-left:auto; font-size:14px; color:var(--muted); }
  .guide-flow { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); }
  .guide-item { position:relative; padding:18px 20px; min-height:142px; }
  .guide-item + .guide-item { border-left:2px solid var(--line-strong); }
  .guide-item .k { display:block; color:var(--faint); font-size:14px; font-weight:700; letter-spacing:.4px; }
  .guide-item strong { display:block; margin:6px 0 4px; font-size:22px; line-height:1.3; color:var(--ink); }
  .guide-item p { margin:0; color:var(--muted); font-size:15px; line-height:1.5; }
  .guide-item.next { background:var(--accent-soft); }
  .guide-item.next strong { color:var(--accent-deep); }
  .guide-return { padding:0 18px 16px; background:var(--accent-soft); }
  .result-card {
    display:grid; grid-template-columns:auto 1fr; gap:12px; align-items:start;
    margin:0 18px 18px; padding:14px 16px; border-left:5px solid var(--accent);
    background:var(--accent-soft); border-radius:8px 0 0 8px; overflow:hidden;
  }
  .result-card .mark { font-size:24px; color:var(--accent-deep); line-height:1; }
  .result-card strong { display:block; font-size:17px; }
  .result-card span { display:block; color:var(--muted); font-size:14px; margin-top:3px; }

  body.is-present .rail { gap:8px; margin-bottom:16px; flex-wrap:nowrap; }
  body.is-present .rail .step {
    position:relative; flex:1 1 0; min-width:0; justify-content:center;
    border-width:2px; border-radius:8px; padding:10px 8px;
    font-size:15px; font-weight:700; color:var(--faint);
  }
  body.is-present .rail .step .n { width:24px; height:24px; flex:0 0 auto; font-size:13px; }
  body.is-present .rail .step.now { color:var(--ink); border-color:var(--accent); }
  body.is-present .rail .step.now::after {
    content:'当前'; position:absolute; top:-11px; right:8px; padding:1px 7px;
    border-radius:99px; background:var(--accent); color:var(--panel); font-size:11px;
  }
  body.is-present[data-display="projector"] .rail .step.now::after { color:#fff; }

  body.is-present .card { padding:22px; margin-bottom:18px; border-width:2px; background-image:none; }
  body.is-present .card h3 { font-family:var(--sans); font-size:24px; font-weight:800; }
  body.is-present .card h4 { font-size:16px !important; }
  body.is-present .card p, body.is-present .doc .body { font-size:18px; }
  body.is-present .doc .body { font-family:var(--sans); font-weight:500; line-height:1.8; }
  body.is-present .btn { font-size:16px; padding:11px 18px; border-width:2px; }
  body.is-present .btn.primary { font-size:18px; padding:13px 24px; }
  body.is-present h2.hd, body.is-present label.f > span, body.is-present .hint,
  body.is-present .legend, body.is-present .chip, body.is-present .tl .m,
  body.is-present .tl .d, body.is-present .pass-who, body.is-present .st,
  body.is-present .duty, body.is-present .pass-ann, body.is-present .pass-rec,
  body.is-present .hit .tag, body.is-present .hit .dim, body.is-present .hit .dt,
  body.is-present .signoff .so-k, body.is-present .signoff .so-t,
  body.is-present .smap-hd, body.is-present .link .stage,
  body.is-present .link .verdict, body.is-present .link .reason { font-size:14px; }
  body.is-present .brand .sub, body.is-present .env, body.is-present .roles .lbl,
  body.is-present .role-btn, body.is-present .present-mode-badge,
  body.is-present .display-switch button, body.is-present .setup-choice span,
  body.is-present .meta, body.is-present .rail .step .n,
  body.is-present .ann .tag, body.is-present .ann .ttl, body.is-present .ann .dt,
  body.is-present .ann .sg, body.is-present .share .delta,
  body.is-present .share .formula, body.is-present .share .none,
  body.is-present .counts span, body.is-present .tl .k,
  body.is-present .chart .ax, body.is-present .chart .cap,
  body.is-present .chart .val, body.is-present .hit code,
  body.is-present .pass-act, body.is-present .other-legal-label { font-size:14px; }
  body.is-present input.f, body.is-present textarea.f, body.is-present select.f { font-size:18px; padding:13px 15px; }
  body.is-present .share .big { font-size:54px; }
  body.is-present .share .formula::after {
    content:'内容来源构成，不代表违规概率'; display:block; margin-top:10px;
    font-family:var(--sans); font-size:14px; color:var(--muted);
  }
  body.is-present .admission-scope {
    margin-top:12px; padding:10px 12px; border:2px solid var(--line-strong);
    border-radius:8px; color:var(--muted); font-weight:700;
  }
  body.is-present .review-desk {
    padding:22px; border-width:2px; margin-bottom:18px;
  }
  body.is-present .review-desk-head h3 { font-size:24px; }
  body.is-present .review-desk-head p { font-size:16px; }
  body.is-present .review-focus, body.is-present .review-doc-meta,
  body.is-present .review-pending { font-size:14px; }
  body.is-present .review-output { border-width:2px; }
  body.is-present .revision-brief { border-width:2px; padding:18px 20px; }
  body.is-present .revision-brief h3 { font-size:22px; }
  body.is-present .revision-brief p { font-size:17px; }
  body.is-present .revision-brief .meta { font-size:14px; }
  body.is-present .editor-workspace { border-width:2px; }
  body.is-present .editor-canvas { padding:18px; }
  body.is-present .editor-canvas textarea.f { min-height:430px; font-size:18px; }
  body.is-present .editor-help, body.is-present .editor-issues-head span,
  body.is-present .editor-issue-meta, body.is-present .editor-issue-detail,
  body.is-present .editor-suggestion, body.is-present .editor-applied { font-size:14px; }
  body.is-present .editor-issues { padding:16px; max-height:590px; border-left-width:2px; }
  body.is-present .editor-issues-head strong { font-size:18px; }
  body.is-present .editor-issue { padding:14px; border-width:2px; border-left-width:5px; }
  body.is-present .editor-issue-title { font-size:16px; }
  body.is-present .editor-issue-snippet { font-size:15px; }
  body.is-present .editor-issue-actions .btn { padding:8px 12px; font-size:14px; }
  body.is-present details.other-actions { margin-top:14px; border-top:2px solid var(--line); padding-top:12px; }
  body.is-present details.other-actions summary { color:var(--muted); cursor:pointer; font-size:14px; font-weight:700; }
  body.is-present details.other-actions .actions-bar { margin-top:12px; }
  .ms-tag { display:none; }
  body.is-present .ms { padding:14px; border-width:2px; margin-bottom:10px; }
  body.is-present .ms .t { font-size:17px; font-weight:700; }
  body.is-present .ms .s { font-size:14px; }
  body.is-present .ms-tag { display:inline-block; margin-left:7px; padding:2px 7px; border-radius:99px; background:var(--accent-soft); color:var(--accent-deep); font-size:14px; }
  body.is-present .rail .step.now::after { font-size:14px; top:-14px; }
  body.is-present[data-display="projector"] .card.warn,
  body.is-present[data-display="projector"] .card.block,
  body.is-present[data-display="projector"] .card.ok,
  body.is-present[data-display="projector"] .pass.live,
  body.is-present[data-display="projector"] .signoff,
  body.is-present[data-display="projector"] .signoff.hot { background-image:none; }

  @media (max-width:1599px) {
    body.is-present main { grid-template-columns:minmax(0,var(--present-stage-max)); }
    body.is-present .present-summary { display:flex; }
    body.is-present aside.side {
      position:fixed; inset:0 0 0 auto; z-index:60; width:min(430px,94vw); max-height:none;
      border:0; border-left:2px solid var(--line-strong); border-radius:0; padding:24px;
      transform:translateX(102%); transition:transform .18s ease; background:var(--panel);
    }
    body.is-present aside.side .present-drawer-tools {
      display:flex; align-items:center; justify-content:space-between; margin-bottom:18px;
    }
    body.is-present.present-evidence-open aside.side { transform:translateX(0); }
  }
  @media (max-width:1179px) {
    body.is-present header.topbar { padding:10px 16px; }
    body.is-present .brand .sub { display:none; }
    body.is-present .present-mode-badge { display:none; }
    body.is-present main { padding:16px; }
    body.is-present .rail { flex-wrap:wrap; }
    body.is-present .rail .step { flex:1 1 calc(33.333% - 8px); }
    body.is-present .guide-item { padding:14px 16px; min-height:132px; }
    body.is-present .guide-item strong { font-size:19px; }
  }
  @media (max-width:860px) {
    .setup-display, .guide-flow { grid-template-columns:1fr; }
    .guide-item + .guide-item { border-left:0; border-top:2px solid var(--line-strong); }
  }
  @media (prefers-reduced-motion:reduce) {
    body.is-present *, body.is-present *::before, body.is-present *::after {
      scroll-behavior:auto !important; transition-duration:.001ms !important; animation-duration:.001ms !important;
    }
  }
</style>
</head>
<body>

<header class="topbar">
  <div class="brand">
    <div class="name"><span class="dot"></span>把关人 · 稿件工作台</div>
    <div class="sub">county media · production &amp; gatekeeping</div>
  </div>
  <span class="demo-badge">模拟 / 脱敏素材</span>
  <button class="btn present-launch" id="present-open" type="button">演示模式</button>
  <div class="present-controls" aria-label="演示显示控制">
    <span class="present-mode-badge">引导演示模式 · 模拟 / 脱敏素材</span>
    <div class="display-switch" aria-label="显示档">
      <button type="button" data-display="projector" aria-pressed="true">低清投影</button>
      <button type="button" data-display="led" aria-pressed="false">LED 大屏</button>
    </div>
    <button class="btn" id="present-fullscreen" type="button">全屏</button>
    <button class="btn" id="present-exit" type="button">退出演示</button>
  </div>
  <div class="roles">
    <span class="lbl">当前身份</span>
    <button class="role-btn" data-role="editor" aria-pressed="false" hidden>编辑 / 记者</button>
    <button class="role-btn" data-role="department-head" aria-pressed="false" hidden>部门主任</button>
    <button class="role-btn" data-role="supervising-leader" aria-pressed="false" hidden>分管领导</button>
    <span class="visually-hidden" id="role-switch-status" aria-live="polite"></span>
  </div>
  <div class="account"><span class="account-name" id="account-name">—</span><button class="logout-btn" id="logout-btn">退出</button></div>
</header>

<div class="present-modal" id="present-modal" hidden>
  <section class="present-dialog" role="dialog" aria-modal="true" aria-labelledby="present-dialog-title">
    <div class="present-dialog-head">
      <div>
        <h2 id="present-dialog-title">准备三分钟引导演示</h2>
        <p>先选择会场显示档，再重建三组准入样例。正式计时从准备好的投料页开始。</p>
      </div>
      <button class="icon-btn" id="present-close" type="button" aria-label="关闭演示准备">×</button>
    </div>
    <div class="setup-display" aria-label="选择显示档">
      <button class="setup-choice" type="button" data-setup-display="projector" aria-pressed="true">
        <strong>低清投影（推荐）</strong>
        <span>新闻纸浅底、深墨文字、2px 关键边界，适合泛白或对焦一般的投影。</span>
      </button>
      <button class="setup-choice" type="button" data-setup-display="led" aria-pressed="false">
        <strong>LED 大屏</strong>
        <span>高对比暗色值班台，适合黑位与亮度可靠的大屏。</span>
      </button>
    </div>
    <div class="setup-warning"><strong>会清空当前全部稿件。</strong>重建后只保留“要理由 / 硬拦 / 公器私用”三组对比样例；主通稿仍由台上现场投料。</div>
    <div class="setup-status" id="present-setup-status" aria-live="polite">尚未准备演示样例。</div>
    <div class="setup-actions">
      <button class="btn warn" id="present-seed" type="button">重建三组样例</button>
      <button class="btn primary" id="present-enter" type="button" disabled>进入引导演示</button>
    </div>
  </section>
</div>

<button class="present-scrim" id="present-scrim" type="button" aria-label="关闭演示抽屉"></button>

<main>
  <aside class="list">
    <div class="present-drawer-tools"><h2>切换稿件</h2><button class="icon-btn" id="present-list-close" type="button" aria-label="关闭稿件列表">×</button></div>
    <h2 class="hd">稿件</h2>
    <button class="btn wide" id="new-btn" hidden>＋ 新建稿件</button>
    <button class="btn wide" id="seed-btn" style="margin-top:6px" hidden>演示准备（重置并建样例）</button>
    <div id="ms-list" style="margin-top:12px"></div>
  </aside>

  <section class="stage">
    <div class="present-warning" id="present-warning" hidden></div>
    <div class="present-summary" id="present-summary"></div>
    <div class="present-guide" id="present-guide"></div>
    <div class="rail" id="rail"></div>
    <div id="panel"></div>
  </section>

  <aside class="side">
    <div class="present-drawer-tools"><h2>AI 参与度与完整留痕</h2><button class="icon-btn" id="present-evidence-close" type="button" aria-label="关闭证据栏">×</button></div>
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

  var query = new URLSearchParams(window.location.search);
  var initialDisplay = query.get('display') === 'led' ? 'led' : 'projector';
  var storedMainId = null;
  try { storedMainId = sessionStorage.getItem('gatekeeper-presentation-main-id'); } catch (error) { /* storage is optional */ }

  var state = {
    list:[], view:null, user:null, role:null, currentId:null, prevShare:null, editing:null,
    models:[], selectedModel:'', modelDefault:'', modelsError:'',
    editDrafts:{}, appliedSuggestions:{}, activeAnnotation:null,
    error:'', contrast:null, showContrast:false,
    present:query.get('present') === '1', display:initialDisplay, setupDisplay:'projector',
    presentPrepared:false, presentFeedback:null, demoFixtures:null, demoFixturesError:'', presentationMainId:storedMainId,
    roleAnimationTimer:null
  };

  var $ = function (id) { return document.getElementById(id); };

  function applyPresentationShell() {
    document.body.classList.toggle('is-present', state.present);
    document.body.setAttribute('data-display', state.display);
    document.body.classList.remove('present-list-open', 'present-evidence-open');
    Array.prototype.forEach.call(document.querySelectorAll('button[data-display]'), function (btn) {
      btn.setAttribute('aria-pressed', String(btn.getAttribute('data-display') === state.display));
    });
    document.title = state.present ? '把关人 · 引导演示模式' : '把关人 · 稿件工作台';
  }

  function writePresentationUrl() {
    var next = new URL(window.location.href);
    if (state.present) {
      next.searchParams.set('present', '1');
      next.searchParams.set('display', state.display);
    } else {
      next.searchParams.delete('present');
      next.searchParams.delete('display');
    }
    window.history.replaceState({}, '', next.pathname + next.search + next.hash);
  }

  function setPresentationDisplay(display) {
    state.display = display === 'led' ? 'led' : 'projector';
    applyPresentationShell();
    writePresentationUrl();
  }

  function closeDrawers() {
    document.body.classList.remove('present-list-open', 'present-evidence-open');
  }

  applyPresentationShell();

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
      if (response.status === 401) { location.href = '/login?next=' + encodeURIComponent(location.pathname); throw new Error('请先登录'); }
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) throw new Error(body.message || body.error || ('HTTP ' + response.status));
        return body;
      });
    });
  }

  function applyUser(user) {
    state.user = user;
    $('account-name').textContent = user.displayName + ' · @' + user.username;
    var roles = (user.roles || []).filter(function (role) { return Boolean(ROLE_LABEL[role]); });
    state.role = roles.length ? roles[0] : null;
    Array.prototype.forEach.call(document.querySelectorAll('.role-btn'), function (button) {
      var allowed = roles.indexOf(button.getAttribute('data-role')) !== -1;
      button.hidden = !allowed;
      button.setAttribute('aria-pressed', String(allowed && button.getAttribute('data-role') === state.role));
    });
    $('new-btn').hidden = roles.indexOf('editor') === -1;
    $('seed-btn').hidden = true;
  }

  // ——————————————————— data ———————————————————

  function loadList() {
    return api('/api/workbench').then(function (data) {
      state.list = data.items || [];
      recoverPresentationMain();
      renderList();
      checkPresentationReadiness();
    });
  }

  function loadModels() {
    return api('/api/workbench-models').then(function (data) {
      state.models = data.items || [];
      state.modelDefault = data.defaultModel || '';
      if (!state.models.some(function (item) { return item.id === state.selectedModel; })) {
        state.selectedModel = state.modelDefault || (state.models[0] && state.models[0].id) || '';
      }
      state.modelsError = '';
    }).catch(function (error) {
      state.models = [];
      state.modelsError = error.message;
    });
  }

  function loadDemoFixtures() {
    return api('/api/demo/fixtures').then(function (data) {
      state.demoFixtures = data;
      state.demoFixturesError = '';
      $('seed-btn').hidden = !state.user || (state.user.roles || []).indexOf('editor') === -1;
      recoverPresentationMain();
      renderList();
      checkPresentationReadiness();
      return data;
    }).catch(function (error) {
      state.demoFixturesError = error.message;
      checkPresentationReadiness();
      return null;
    });
  }

  function compareTitles() {
    return state.demoFixtures && state.demoFixtures.cases
      ? state.demoFixtures.cases.map(function (item) { return item.title; }) : [];
  }

  function recoverPresentationMain() {
    if (state.presentationMainId && state.list.some(function (item) { return item.id === state.presentationMainId; })) return;
    var title = state.demoFixtures && state.demoFixtures.mainNotice && state.demoFixtures.mainNotice.title;
    if (!title) return;
    var match = state.list.find(function (item) { return item.title === title; });
    if (!match) {
      state.presentationMainId = null;
      try { sessionStorage.removeItem('gatekeeper-presentation-main-id'); } catch (error) { /* storage is optional */ }
      return;
    }
    state.presentationMainId = match.id;
    try { sessionStorage.setItem('gatekeeper-presentation-main-id', match.id); } catch (error) { /* storage is optional */ }
  }

  function demoSamplesReady() {
    var titles = compareTitles();
    if (titles.length !== 3) return false;
    return titles.every(function (title) {
      return state.list.some(function (item) { return item.title === title; });
    });
  }

  function checkPresentationReadiness() {
    var warning = $('present-warning');
    if (!warning || !state.present) return;
    if (state.demoFixturesError) {
      warning.hidden = false;
      warning.textContent = '演示素材接口不可用，页面不会自动清空数据。请退出演示并检查当前是否为 demo 环境。';
      return;
    }
    if (!state.demoFixtures) {
      warning.hidden = true;
      warning.textContent = '';
      return;
    }
    if (demoSamplesReady()) {
      warning.hidden = true;
      warning.textContent = '';
      return;
    }
    warning.hidden = false;
    warning.textContent = '演示样例未完整准备。页面不会自动清空数据；请退出演示后运行“演示准备”。';
  }

  function openManuscript(id) {
    state.currentId = id;
    state.editing = null;
    state.editDrafts = {};
    state.appliedSuggestions = {};
    state.activeAnnotation = null;
    state.error = '';
    state.showContrast = false;
    state.contrast = null;
    state.presentFeedback = null;
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
    state.editing = null;
    state.editDrafts = {};
    state.appliedSuggestions = {};
    state.activeAnnotation = null;
    state.error = '';
    state.presentFeedback = null;
    render();
    renderList();
  }

  // ——————————————————— render ———————————————————

  function render() {
    renderRail();
    renderPanel();
    renderSide();
    renderPresentationGuide();
    renderPresentationSummary();
    renderRoleHints();
  }

  function renderList() {
    var host = $('ms-list');
    if (state.list.length === 0) {
      var canCreate = state.user && (state.user.roles || []).indexOf('editor') !== -1;
      host.innerHTML = '<div class="empty">' +
        (canCreate ? '还没有稿件。点上面新建，粘贴一份通稿开始。' : '还没有可查看的稿件。') +
        '</div>';
      return;
    }
    var ordered = state.list.slice();
    if (state.present && state.presentationMainId) {
      ordered.sort(function (a, b) {
        if (a.id === state.presentationMainId) return -1;
        if (b.id === state.presentationMainId) return 1;
        return 0;
      });
    }
    var samples = compareTitles();
    host.innerHTML = ordered.map(function (item) {
      var current = item.id === state.currentId ? 'true' : 'false';
      var tag = item.id === state.presentationMainId
        ? '<span class="ms-tag">演示主线</span>'
        : (samples.indexOf(item.title) >= 0 ? '<span class="ms-tag">对比样例</span>' : '');
      return '<div class="ms" data-id="' + esc(item.id) + '" aria-current="' + current + '">' +
        '<div class="t">' + esc(item.title) + tag + '</div>' +
        '<div class="s">' + esc(statusLabel(item.status)) + ' · ' + clock(item.updatedAt) + '</div>' +
        '</div>';
    }).join('');
  }

  var STATUS_LABEL = {
    'draft':'草稿', 'admission-blocked':'已拒绝', 'admission-reason-required':'待填选题依据',
    'admitted':'已准入', 'generated':'已生成', 'preflight':'预检完成',
    'first-review':'待初审', 'second-review':'待复审', 'countersign':'待会签',
    'final-review':'待终审', 'revision':'复核修改',
    'signed':'已签发', 'published':'已发布'
  };
  function statusLabel(status) { return STATUS_LABEL[status] || status; }

  function expectedRole(view) {
    return view && view.waitingOn ? view.waitingOn : null;
  }

  function recommendedAction(view) {
    if (!view) return null;
    var owner = expectedRole(view) || state.role;
    var actions = view.actions[owner] || [];
    return actions.find(function (action) { return action.kind === 'advance'; }) || actions[0] || null;
  }

  function presentationCopy(view) {
    if (!view) {
      return {
        gate:'① 素材入口', scope:'现场投料',
        goal:'录入一份模拟通稿', goalNote:'让观众先看到台里每天真实处理的素材。',
        judgement:'尚未进入准入判断', judgementNote:'系统还没有调用模型，也没有产生内容。',
        next:'填入示例通稿并提交', nextNote:'提交后先判断这次模型调用该不该发生。'
      };
    }

    var action = recommendedAction(view);
    var owner = expectedRole(view);
    var next = action ? action.label : (view.manuscript.status === 'published' ? '流程已完成' : '查看当前结果');
    if (owner && owner !== state.role) next = '切换为' + (ROLE_LABEL[owner] || owner) + '，再' + next;

    if (state.showContrast) {
      return {
        gate:'⑥ 之后 · 对照收口', scope:'同一份通稿，减去把关',
        goal:'回答“关掉把关人会怎样”', goalNote:'对照使用同一份真实产物，不重跑、不模拟。',
        judgement:'问题会直接进入播出流程', judgementNote:'来源、责任与过程留痕同时消失。',
        next:'用生产过程完成收口', nextNote:'私有化与成品审核都看不见这一条责任链。'
      };
    }

    if (view.stage === 'source' || view.stage === 'admission') {
      var decision = view.admission.decision;
      var verdict = decision === 'blocked' ? '硬拦：模型调用 0 次'
                  : decision === 'reason-required' ? '涉敏题材：先补选题依据'
                  : view.admission.offDutyUse ? '允许调用，但标记非业务用途'
                  : '常规业务：允许进入生成';
      var note = decision === 'blocked' ? '输入侧拦掉，0 tokens，也没有违规内容产生。'
               : decision === 'reason-required' ? '广电日常题材不一刀切，依据会进入责任留痕。'
               : '这次调用已经记入审计，但还没有获得播出许可。';
      return {
        gate:'② 入口准入', scope:'允许模型处理 ≠ 允许播出',
        goal:'判断这次调用该不该发生', goalNote:'判定调用目的和业务边界，不是简单敏感词过滤。',
        judgement:verdict, judgementNote:note,
        next:next, nextNote:owner ? '下一责任角色：' + (ROLE_LABEL[owner] || owner) : '可切换对比稿件查看三档结果。'
      };
    }

    if (view.stage === 'generate') {
      return {
        gate:'③ 稿件生成', scope:'统一网关 · 全量审计',
        goal:'生成两个播出产物', goalNote:'播报稿与短视频文案都必须经过把关人网关。',
        judgement:view.artifacts.length ? '产物已生成并逐句记来源' : '入口已准入，可以调用模型',
        judgementNote:view.artifacts.length ? view.segmentCount + ' 句话已经进入来源追溯。' : '业务代码拿不到模型密钥，因此绕不过准入。',
        next:next, nextNote:'右侧 AI 参与度会随人工改稿重新计算。'
      };
    }

    if (view.stage === 'preflight') {
      return {
        gate:'④ 输出预检', scope:'标注给人，不替人终审',
        goal:'找出播出前必须处理的问题', goalNote:'禁用词、数字不一致与规范问题都落到具体句子。',
        judgement:'拦下 ' + view.preflight.block + ' · 标红 ' + view.preflight.redact + ' · 留痕 ' + view.preflight.flag,
        judgementNote:'标红是待人工复核，预检不会擅自改稿。',
        next:next, nextNote:'改稿后 AI 参与度与预检结论会一起更新。'
      };
    }

    if (view.manuscript.status === 'revision') {
      return {
        gate:'⑤ 三审流转', scope:'退回理由必须落实到新版本',
        goal:'按主管意见修改播出稿', goalNote:'问题标注与退回理由常驻，记者可手改或应用确定性建议。',
        judgement:view.revisionReady ? '已保存实际修改，可以重新预检' : '已退回，等待记者保存修改',
        judgementNote:view.revisionReady ? '新版本及操作者已经写入责任留痕。' : '系统不会把“切回记者”误当成已经完成改稿。',
        next:next, nextNote:view.revisionReady ? '重新预检后从初审开始新一轮。' : '至少保存一处实际修改后才可继续。'
      };
    }

    if (view.stage === 'review') {
      return {
        gate:'⑤ 三审流转', scope:'合并的是人，不是责任',
        goal:'按三审三校完成责任流转', goalNote:'一校看文字，二校看事实，三校看导向与整体。',
        judgement:'当前状态：' + view.statusLabel, judgementNote:owner ? '当前责任角色：' + (ROLE_LABEL[owner] || owner) : '审核链已经完成。',
        next:next, nextNote:'每次通过或退回都会写入责任链。'
      };
    }

    var signed = view.signOff ? '签发人：' + view.signOff.actor : '等待最终签发';
    return {
      gate:'⑥ AI 参与度追溯', scope:'来源、规则、责任三条链收口',
      goal:'回答哪句话由谁写、谁放行', goalNote:'成品审核看不到生产过程，这一屏专门回答过程问题。',
      judgement:signed, judgementNote:view.aiShare == null ? 'AI 参与度尚未测量。' : '当前 AI 参与度 ' + pct(view.aiShare) + '，表示内容来源构成。',
      next:'打开对照组完成收口', nextNote:'同一份通稿，减去把关，直接比较会失去什么。'
    };
  }

  function renderPresentationGuide() {
    var host = $('present-guide');
    if (!host) return;
    if (!state.present) { host.innerHTML = ''; return; }
    var copy = presentationCopy(state.view);
    var canReturn = state.presentationMainId && state.currentId && state.currentId !== state.presentationMainId &&
      state.list.some(function (item) { return item.id === state.presentationMainId; });
    var feedback = state.presentFeedback
      ? '<div class="result-card" aria-live="polite"><div class="mark">✓</div><div><strong>' +
          esc(state.presentFeedback.title) + '</strong><span>' + esc(state.presentFeedback.detail) + '</span></div></div>'
      : '';
    host.innerHTML =
      '<div class="guide-head"><span class="gate">' + esc(copy.gate) + '</span>' +
        '<button class="btn" type="button" data-open-list="1">切换稿件</button>' +
        '<span class="scope">' + esc(copy.scope) + '</span></div>' +
      '<div class="guide-flow">' +
        '<article class="guide-item"><span class="k">当前目标</span><strong>' + esc(copy.goal) + '</strong><p>' + esc(copy.goalNote) + '</p></article>' +
        '<article class="guide-item"><span class="k">系统判断</span><strong>' + esc(copy.judgement) + '</strong><p>' + esc(copy.judgementNote) + '</p></article>' +
        '<article class="guide-item next"><span class="k">允许的下一步</span><strong>' + esc(copy.next) + '</strong><p>' + esc(copy.nextNote) + '</p></article>' +
      '</div>' +
      (canReturn ? '<div class="guide-return"><button class="btn primary" id="present-return-main" type="button">回到主通稿，继续生成</button></div>' : '') +
      feedback;
  }

  function renderPresentationSummary() {
    var host = $('present-summary');
    if (!host) return;
    if (!state.present) { host.innerHTML = ''; return; }
    var view = state.view;
    var metric = view && view.aiShare != null ? pct(view.aiShare) : '未测量';
    var latest = view && view.trace && view.trace.length
      ? view.trace.slice(-3).reverse().map(function (event) { return TRACE_LABEL[event.kind] || event.kind; }).join(' · ')
      : '还没有留痕';
    host.innerHTML = '<div><div class="metric">' + esc(metric) + '</div><div class="copy"><b>AI 参与度</b><br>内容来源构成，不代表违规概率</div></div>' +
      '<div class="copy"><b>最近留痕</b><br>' + esc(latest) + '</div>' +
      '<button class="btn" type="button" data-open-evidence="1">查看完整留痕</button>';
  }

  function renderRoleHints() {
    Array.prototype.forEach.call(document.querySelectorAll('.role-btn'), function (btn) {
      btn.classList.remove('role-needed');
    });
    if (!state.present || !state.view || !state.view.waitingOn) return;
    var needed = document.querySelector('.role-btn[data-role="' + state.view.waitingOn + '"]');
    if (needed) needed.classList.add('role-needed');
  }

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
    if (!state.view) {
      var canCreate = state.user && (state.user.roles || []).indexOf('editor') !== -1;
      host.innerHTML = canCreate ? newForm() : (state.role ? reviewerLanding() : readOnlyLanding());
      return;
    }
    var view = state.view;
    var parts = [];
    if (state.present && view.stage !== 'trace') parts.push(actionsBar(view));
    if (view.stage === 'source' || view.stage === 'admission') parts.push(admissionPanel(view));
    if (view.stage === 'generate' || view.stage === 'preflight') parts.push(productionPanel(view));
    if (view.manuscript.status === 'revision') parts.push(revisionPanel(view));
    else if (view.stage === 'review') parts.push(reviewPanel(view));
    if (view.stage === 'trace') parts.push(tracePanel(view));
    if (!state.present || view.stage === 'trace') parts.push(actionsBar(view));
    host.innerHTML = parts.join('');
  }

  function newForm() {
    return '<div class="card">' +
      '<h3>① 素材入口</h3>' +
      '<p>粘贴上级通稿或会议材料。不做爬虫、不接外部采集系统——台里编辑每天上午的活就是从一份通稿开始。</p>' +
      '<label class="f"><span>标题</span><input class="f" id="nf-title" placeholder="例：全市乡村振兴现场推进会召开" /></label>' +
      '<label class="f"><span>素材类型</span><select class="f" id="nf-type">' +
        '<option value="notice">通知 / 会议材料</option>' +
        '<option value="public-relations">政务通稿</option>' +
        '<option value="script">脚本</option>' +
        '<option value="novel">文学作品</option>' +
        '<option value="other">其他</option>' +
      '</select></label>' +
      '<label class="f"><span>报道方向</span><select class="f" id="nf-topic">' +
        '<option value="politics">时政</option>' +
        '<option value="livelihood">民生</option>' +
        '<option value="economy">经济</option>' +
        '<option value="agriculture">三农</option>' +
        '<option value="culture">文化教育</option>' +
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

  function readOnlyLanding() {
    return '<div class="card"><h3>只读工作台</h3>' +
      '<p>当前账号可查看稿件、追溯与分析，但不能新建、改稿或推进流程。</p></div>';
  }

  function reviewerLanding() {
    return '<div class="card"><h3>等待稿件流转</h3>' +
      '<p>请从左侧选择稿件，系统会在轮到当前职责时显示复审、会签、终审或签发动作；此账号不能新建稿件。</p></div>';
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
    out += '<div class="admission-scope">允许模型处理，不代表允许播出；稿件仍需经过输出预检与三审三校。</div>';
    out += '</div>';

    out += '<div class="card"><h4 style="margin:0 0 8px;font-size:13px;color:var(--muted);font-weight:500">原通稿</h4>' +
      '<div class="doc src"><div class="body">' + esc(view.manuscript.sourceText) + '</div></div></div>';
    return out;
  }

  function revisionPanel(view) {
    var returned = view.reviews.slice().reverse().find(function (record) {
      return record.decision === 'changes-requested' || record.decision === 'rejected';
    });
    var brief = '<section class="revision-brief" aria-labelledby="revision-title">' +
      '<div class="mark" aria-hidden="true">↩</div><div>' +
      '<h3 id="revision-title">主管退回意见</h3>' +
      '<p>' + esc(returned && returned.reason ? returned.reason : '请按审核意见复核并修改稿件。') + '</p>' +
      '<div class="meta">' + esc(returned ? returned.actor + ' · 第 ' + returned.round + ' 轮' : '等待修改') +
      (view.revisionReady ? ' · 已保存新版本' : ' · 尚未保存实际修改') + '</div></div></section>';
    return brief + productionPanel(view);
  }

  function productionPanel(view) {
    if (view.artifacts.length === 0) {
      return '<div class="card"><h3>③ 稿件生成</h3>' +
        '<p>按本台风格，从这份通稿生成播报稿与短视频文案。生成走把关人网关，业务代码拿不到模型密钥，所以这次调用一定会被审计到。</p>' +
        '</div>';
    }

    var isRevision = view.manuscript.status === 'revision';
    var showAnnotations = view.stage === 'preflight' || isRevision;
    var out = '';

    if (showAnnotations) {
      out += '<div class="card"><h3>' + (isRevision ? '退回修改 · 问题常驻' : '④ 输出预检') + '</h3>' +
        '<p>' + (isRevision
          ? '逐条处理主管意见与系统标注。可以直接手改；确定性问题也可以应用建议，保存后重新计算标注与 AI 参与度。'
          : '预检的产出是<strong>标注</strong>，不是闸门。除入口那一层的硬拦外，一律标出来让人决定。') + '</p>' +
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

    out += '<div class="cols' + (state.editing ? ' editing-open' : '') + '">' +
      '<div class="doc src"><h4>原通稿</h4><div class="body">' + esc(view.manuscript.sourceText) + '</div></div>' +
      '<div>' + view.artifacts.map(function (item) { return artifactBlock(item, showAnnotations); }).join('') + '</div>' +
      '</div>';

    if (showAnnotations && !state.editing) {
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

  function rawArtifactText(item) {
    return item.segments.length > 0
      ? item.segments.map(function (segment) { return segment.text; }).join('\\n')
      : item.artifact.content;
  }

  function draftFor(item) {
    var id = item.artifact.id;
    if (!Object.prototype.hasOwnProperty.call(state.editDrafts, id)) {
      state.editDrafts[id] = rawArtifactText(item);
    }
    return state.editDrafts[id];
  }

  function issueSnippet(item, annotation) {
    var segment = item.segments.find(function (candidate) {
      return candidate.ordinal === annotation.segmentOrdinal;
    });
    if (!segment) return '第 ' + (annotation.segmentOrdinal + 1) + ' 句';
    return markSentence(segment.text, [annotation]);
  }

  function editorIssueCard(item, annotation, index) {
    var applied = Boolean(state.appliedSuggestions[annotation.id]);
    var active = state.activeAnnotation === annotation.id;
    return '<article class="editor-issue a-' + esc(annotation.action) +
      (applied ? ' is-applied' : '') + (active ? ' is-active' : '') +
      '" id="issue-' + esc(annotation.id) + '">' +
      '<div class="editor-issue-head"><span class="editor-issue-num">' + (index + 1) + '</span><div>' +
      '<div class="editor-issue-title">' + esc(annotation.title) + '</div>' +
      '<div class="editor-issue-meta">第 ' + (annotation.segmentOrdinal + 1) + ' 句 · ' +
        esc(annotation.tier) + ' · ' + esc(ACTION_LABEL[annotation.action] || annotation.action) + '</div>' +
      '</div></div>' +
      '<div class="editor-issue-snippet">' + issueSnippet(item, annotation) + '</div>' +
      '<div class="editor-issue-detail">' + esc(annotation.detail) + '</div>' +
      (annotation.suggestion
        ? '<div class="editor-suggestion"><strong>建议：</strong>' + esc(annotation.suggestion) + '</div>'
        : '<div class="editor-suggestion"><strong>需要人工判断：</strong>系统不给自动结论。</div>') +
      '<div class="editor-issue-actions">' +
        '<button class="btn" type="button" data-locate-annotation="' + esc(annotation.id) +
          '" data-artifact="' + esc(item.artifact.id) + '">定位到正文</button>' +
        (annotation.suggestion
          ? '<button class="btn primary" type="button" data-apply-suggestion="' + esc(annotation.id) +
              '" data-artifact="' + esc(item.artifact.id) + '"' + (applied ? ' disabled' : '') + '>' +
              (applied ? '已应用' : '应用建议') + '</button>'
          : '') +
        (applied ? '<span class="editor-applied">已写入草稿，保存后重新分析</span>' : '') +
      '</div></article>';
  }

  function artifactBlock(item, showAnnotations) {
    var artifact = item.artifact;
    var editing = state.editing === artifact.id;
    var canEdit = state.role === 'editor' && state.view && state.view.contentEditable;
    var head = '<h4><span>' + esc(KIND_LABEL[artifact.kind] || artifact.kind) + '</span>' +
      (!canEdit
        ? ''
        : editing
        ? '<span><button class="btn" data-save="' + esc(artifact.id) + '">保存改动</button> ' +
          '<button class="btn" data-cancel="1">取消</button></span>'
        : canEdit
          ? '<span><button class="btn" data-edit="' + esc(artifact.id) + '">改稿</button></span>'
          : '<span class="hint">仅编辑 / 记者可改稿</span>') +
      '</h4>';

    if (editing) {
      var raw = draftFor(item);
      var issues = item.annotations || [];
      return '<div class="doc">' + head +
        '<div class="editor-workspace">' +
          '<div class="editor-canvas">' +
            '<textarea class="f" id="edit-' + esc(artifact.id) + '" data-draft-artifact="' + esc(artifact.id) +
              '" aria-label="编辑' + esc(KIND_LABEL[artifact.kind] || artifact.kind) + '">' + esc(raw) + '</textarea>' +
            '<div class="editor-help"><span>可以直接手动修改；点击右侧问题会选中对应文字。</span>' +
              '<span>一行一句 · 保存后逐句重算来源与标注</span></div>' +
          '</div>' +
          '<aside class="editor-issues" aria-label="AI 预检问题">' +
            '<div class="editor-issues-head"><strong>待处理问题</strong><span>' + issues.length + ' 条</span></div>' +
            (issues.length
              ? issues.map(function (annotation, index) { return editorIssueCard(item, annotation, index); }).join('')
              : '<div class="editor-empty">当前没有系统标注。仍可手动修改并保存。</div>') +
          '</aside>' +
        '</div>' +
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
    var currentPass = null;
    for (var passIndex = 0; passIndex < PASSES.length; passIndex += 1) {
      if (PASSES[passIndex].stage === view.waitingOn) currentPass = PASSES[passIndex];
    }
    if (!currentPass) currentPass = PASSES[PASSES.length - 1];

    var out = reviewDesk(view, currentPass) +
      '<div class="card"><h3>⑤ 三审三校流转</h3>' +
      '<p>我们没有发明新流程。把三审三校里<strong>机械的那部分</strong>自动化了，' +
      '<strong>判断的那部分</strong>留给人，并且让全程可追溯、责任到人。</p>' +
      '<p class="hint" style="margin:0">一个人可以同时持有多个角色（小编辑部常常只有两个人），' +
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

  function reviewDesk(view, currentPass) {
    var currentLabel = currentPass.label + ' · ' + (ROLE_LABEL[currentPass.stage] || currentPass.stage);
    var outputs = view.artifacts.map(function (item) {
      return reviewArtifactBlock(item, currentPass);
    }).join('');
    return '<section class="review-desk" aria-labelledby="review-desk-title">' +
      '<div class="review-desk-head"><div><h3 id="review-desk-title">审查台 · ' + esc(currentLabel) + '</h3>' +
        '<p>先审播出内容，再决定流程。系统标注只提供线索，最终判断由当前责任人完成。</p></div>' +
        '<span class="review-focus">当前校次</span></div>' +
      '<div class="review-docs">' +
        '<div class="review-outputs">' + outputs + '</div>' +
        '<div class="doc src review-source"><h4>原通稿 · 事实对照</h4><div class="body">' +
          esc(view.manuscript.sourceText) + '</div></div>' +
      '</div></section>';
  }

  function reviewArtifactBlock(item, currentPass) {
    var artifact = item.artifact;
    var currentHits = item.annotations.filter(function (annotation) {
      return annotation.proofreadPass === currentPass.pass;
    });
    var body = item.segments.length > 0
      ? item.segments.map(function (segment) {
          var segmentHits = currentHits.filter(function (annotation) {
            return annotation.segmentOrdinal === segment.ordinal && annotation.end > annotation.start;
          });
          return '<span class="sent o-' + esc(segment.origin) + '" title="' +
            esc(ORIGIN_LABEL[segment.origin] || segment.origin) + '">' +
            markSentence(segment.text, segmentHits) + '</span>';
        }).join('')
      : esc(artifact.content);
    var pending = currentHits.length === 0
      ? '<span>本校次没有系统标注，仍需按职责通读全文。</span>'
      : '<strong>本校待核 ' + currentHits.length + ' 处：</strong>' + currentHits.map(function (annotation) {
          return '<span class="mini a-' + esc(annotation.action) + '">' + esc(annotation.title) + '</span>';
        }).join('');
    return '<article class="doc review-output"><h4><span>' +
      esc(KIND_LABEL[artifact.kind] || artifact.kind) + '</span><span class="review-doc-meta">' +
      (currentHits.length ? '待核 ' + currentHits.length + ' 处' : '通读确认') + '</span></h4>' +
      '<div class="body">' + body + '</div><div class="review-pending">' + pending + '</div></article>';
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
    'editor':'初审 · 编辑', 'department-head':'复审 · 部门主任', 'countersign':'会签 · 部门主任',
    'supervising-leader':'终审 · 分管领导'
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
    if (!state.role) {
      return '<div class="card"><p style="margin:0">当前账号为只读身份，可查看追溯与分析，但不能操作稿件流程。</p></div>';
    }
    var mine = view.actions[state.role] || [];
    if (mine.length === 0) {
      var owner = view.waitingOn;
      return '<div class="card"><p style="margin:0">' +
        (owner
          ? '下一步由<strong>' + esc(ROLE_LABEL[owner] || owner) + '</strong>处理。切换右上角身份即可继续。'
          : '「' + esc(view.statusLabel) + '」是终态，流程到此结束。') +
        '</p>' +
        (state.present && owner
          ? '<div class="actions-bar"><button class="btn primary" type="button" data-guide-role="' + esc(owner) + '">切换为' + esc(ROLE_LABEL[owner] || owner) + '</button></div>'
          : '') +
        '</div>';
    }

    var actionButton = function (transition, primary) {
      var cls = transition.kind === 'return' ? 'btn danger' : 'btn primary';
      if (!primary && transition.kind !== 'return') cls = 'btn';
      var needsSavedRevision = view.manuscript.status === 'revision' &&
        transition.to === 'preflight' && !view.revisionReady;
      return '<button class="' + cls + '" data-to="' + esc(transition.to) + '"' +
        ' data-label="' + esc(transition.label) + '"' +
        ' data-reason="' + (transition.requiresReason ? '1' : '0') + '"' +
        (needsSavedRevision ? ' disabled title="请先实际修改并保存稿件"' : '') + '>' +
        esc(transition.label) + '</button>';
    };

    var primary = mine.find(function (transition) { return transition.kind === 'advance'; }) || mine[0];
    var others = mine.filter(function (transition) { return transition !== primary; });
    var primaryButtons = actionButton(primary, true);
    var otherButtons = others.map(function (transition) { return actionButton(transition, false); }).join('');

    var reasonBox = function () {
      return '<label class="f" style="margin-top:12px"><span>选题依据 / 退回理由（进审计）</span>' +
        '<textarea class="f" id="reason" style="min-height:76px" placeholder="例：市应急管理局已授权发布，见 8 月 27 日通报"></textarea></label>';
    };
    var primaryReasonBox = primary.requiresReason ? reasonBox() : '';
    var otherReasonBox = !primary.requiresReason && others.some(function (t) { return t.requiresReason; })
      ? reasonBox() : '';
    var legacyReasonBox = mine.some(function (t) { return t.requiresReason; })
      ? '<label class="f" style="margin-top:12px"><span>选题依据 / 退回理由（进审计）</span>' +
        '<textarea class="f" id="reason" style="min-height:76px" placeholder="例：市应急管理局已授权发布，见 8 月 27 日通报"></textarea></label>'
      : '';

    var modelBox = view.manuscript.status === 'admitted' && mine.some(function (t) { return t.to === 'generated'; })
      ? '<div class="model-picker">' +
          '<label class="f"><span>本次生成模型</span><select class="f" id="model-select"' + (state.models.length ? '' : ' disabled') + '>' +
            state.models.map(function (item) {
              return '<option value="' + esc(item.id) + '"' + (item.id === state.selectedModel ? ' selected' : '') + '>' +
                esc(item.label) + ' · ' + esc(item.provider) + '</option>';
            }).join('') +
          '</select></label>' +
          '<div class="model-note">模型按单次生成选择；模型名、token 与耗时会进入统一网关留痕。' +
            (state.modelsError ? '<br><span class="err">模型列表加载失败：' + esc(state.modelsError) + '</span>' : '') + '</div>' +
        '</div>'
      : '';

    var countersignBox = view.manuscript.status === 'countersign'
      ? '<div class="cs-fields">' +
          '<label class="f"><span>会签方</span><input class="f" id="countersign-party" maxlength="100" placeholder="例：市应急管理局"></label>' +
          '<label class="f"><span>会签意见</span><textarea class="f" id="countersign-opinion" style="min-height:76px" maxlength="2000" placeholder="填写会签意见，内容将进入审核留痕"></textarea></label>' +
        '</div>'
      : '';

    if (!state.present) {
      return '<div class="card"><h2 class="hd" style="margin-top:0">下一步 · ' + esc(ROLE_LABEL[state.role]) + '</h2>' +
        modelBox + countersignBox + legacyReasonBox +
        '<div class="actions-bar">' + mine.map(function (transition) { return actionButton(transition, transition.kind !== 'return'); }).join('') + '</div>' +
        (view.manuscript.status === 'revision' && !view.revisionReady
          ? '<div class="hint" style="margin-top:10px">请先修改并保存至少一处内容，再重新预检。</div>'
          : '') +
        (state.error ? '<div class="err">' + esc(state.error) + '</div>' : '') +
        '</div>';
    }

    return '<div class="card present-action-card"><h2 class="hd" style="margin-top:0">推荐下一步 · ' + esc(ROLE_LABEL[state.role]) + '</h2>' +
      modelBox + countersignBox + primaryReasonBox +
      '<div class="actions-bar">' + primaryButtons + '</div>' +
      (view.manuscript.status === 'revision' && !view.revisionReady
        ? '<div class="hint" style="margin-top:10px">先在下方修改并保存至少一处内容，重新预检才会启用。</div>'
        : '') +
      (others.length
        ? '<details class="other-actions"><summary>其他合法操作（' + others.length + '）</summary>' +
            otherReasonBox + '<div class="actions-bar">' + otherButtons + '</div></details>'
        : '') +
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

  function presentationFeedback(title, view, basis) {
    var actor = ROLE_LABEL[state.role] || state.role;
    var next = view && view.waitingOn ? '下一责任人：' + (ROLE_LABEL[view.waitingOn] || view.waitingOn) : '当前状态：' + (view ? view.statusLabel : '已更新');
    return {
      title:title,
      detail:'操作者：' + actor + ' · ' + next + (basis ? ' · 依据：' + basis : '')
    };
  }

  function submitNew() {
    var payload = {
      title: $('nf-title').value.trim(),
      sourceType: $('nf-type').value,
      coverageTopic: $('nf-topic') ? $('nf-topic').value : undefined,
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
      if (state.present) {
        state.presentationMainId = data.manuscript.id;
        try { sessionStorage.setItem('gatekeeper-presentation-main-id', data.manuscript.id); } catch (error) { /* storage is optional */ }
      }
      return loadList().then(function () { return openManuscript(data.manuscript.id); }).then(function () {
        state.presentFeedback = presentationFeedback('入口准入已经完成', state.view, '系统已记录本次调用判定');
        render();
      });
    }).catch(function (error) {
      state.error = error.message;
      renderPanel();
    });
  }

  function advance(to, needsReason, label) {
    var reasonField = $('reason');
    var reason = reasonField ? reasonField.value.trim() : '';
    if (needsReason && !reason) {
      state.error = '这一步必须写明理由，理由进审计。';
      renderPanel();
      return;
    }
    state.error = '';
    var body = { to: to, role: state.role };
    if (to === 'generated') {
      var modelField = $('model-select');
      var selectedModel = modelField ? modelField.value : state.selectedModel;
      if (!selectedModel) {
        state.error = '没有可用的生成模型，请检查服务端模型配置。';
        renderPanel();
        return;
      }
      state.selectedModel = selectedModel;
      body.model = selectedModel;
    }
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
      state.presentFeedback = presentationFeedback(label || '流程状态已经更新', data.view, reason);
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
    state.editDrafts[artifactId] = field.value;
    api('/api/workbench/' + encodeURIComponent(state.currentId) +
        '/artifacts/' + encodeURIComponent(artifactId) + '/revise', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: state.role, content: state.editDrafts[artifactId] })
    }).then(function (data) {
      state.editing = null;
      delete state.editDrafts[artifactId];
      state.appliedSuggestions = {};
      state.activeAnnotation = null;
      state.presentFeedback = presentationFeedback('人工改稿已保存，来源比例已重算', data.view, '系统逐句比对上一版');
      applyView(data.view);
    }).catch(function (error) {
      state.error = error.message;
      renderPanel();
    });
  }

  function artifactItem(artifactId) {
    if (!state.view) return null;
    return state.view.artifacts.find(function (item) { return item.artifact.id === artifactId; }) || null;
  }

  function annotationItem(item, annotationId) {
    return item && item.annotations
      ? item.annotations.find(function (annotation) { return annotation.id === annotationId; }) || null
      : null;
  }

  function annotationRange(item, annotation, draft) {
    var lines = draft.split('\\n');
    var lineIndex = Math.max(0, Math.min(lines.length - 1, annotation.segmentOrdinal));
    var line = lines[lineIndex] || '';
    var sourceSegment = item.segments.find(function (segment) { return segment.ordinal === annotation.segmentOrdinal; });
    var sourceText = sourceSegment ? sourceSegment.text : line;
    var target = sourceText.slice(annotation.start, annotation.end);
    var within = Math.min(annotation.start, line.length);
    if (target && line.slice(within, within + target.length) !== target) within = line.indexOf(target);
    if (within < 0) within = Math.min(annotation.start, line.length);
    var prefix = 0;
    for (var index = 0; index < lineIndex; index += 1) prefix += lines[index].length + 1;
    return { start:prefix + within, end:prefix + within + target.length, target:target };
  }

  function activateIssue(annotationId) {
    state.activeAnnotation = annotationId;
    Array.prototype.forEach.call(document.querySelectorAll('.editor-issue'), function (card) {
      card.classList.toggle('is-active', card.id === 'issue-' + annotationId);
    });
  }

  function locateAnnotation(artifactId, annotationId) {
    var item = artifactItem(artifactId);
    var annotation = annotationItem(item, annotationId);
    var field = $('edit-' + artifactId);
    if (!item || !annotation || !field) return;
    state.editDrafts[artifactId] = field.value;
    var range = annotationRange(item, annotation, field.value);
    activateIssue(annotationId);
    field.focus();
    field.setSelectionRange(range.start, range.end);
  }

  function applySuggestion(artifactId, annotationId) {
    var item = artifactItem(artifactId);
    var annotation = annotationItem(item, annotationId);
    var field = $('edit-' + artifactId);
    if (!item || !annotation || !annotation.suggestion || !field) return;
    var draft = field.value;
    var range = annotationRange(item, annotation, draft);
    var replacement = annotation.suggestion === '（删去）' ? '' : annotation.suggestion;
    var insertAt = range.start;

    if (annotation.start === annotation.end && annotation.category === 'ai-label') {
      if (draft.indexOf(replacement) !== -1) return;
      insertAt = draft.length;
      draft = draft + (draft ? '\\n' : '') + replacement;
      insertAt += draft && insertAt > 0 ? 1 : 0;
    } else {
      draft = draft.slice(0, range.start) + replacement + draft.slice(range.end);
    }

    state.editDrafts[artifactId] = draft;
    state.appliedSuggestions[annotationId] = true;
    state.activeAnnotation = annotationId;
    renderPanel();
    var nextField = $('edit-' + artifactId);
    if (nextField) {
      nextField.focus();
      nextField.setSelectionRange(insertAt, insertAt + replacement.length);
    }
    var card = $('issue-' + annotationId);
    if (card) card.scrollIntoView({ block:'nearest', behavior:'smooth' });
  }

  // ——————————————————— wiring ———————————————————

  function selectRole(role) {
    if (!state.user || (state.user.roles || []).indexOf(role) === -1) return;
    var previousRole = state.role;
    state.role = role;
    if (role !== 'editor' && state.editing) {
      delete state.editDrafts[state.editing];
      state.editing = null;
      state.appliedSuggestions = {};
      state.activeAnnotation = null;
    }
    Array.prototype.forEach.call(document.querySelectorAll('.role-btn'), function (btn) {
      btn.classList.remove('role-switching', 'role-leaving');
      btn.setAttribute('aria-pressed', String(btn.getAttribute('data-role') === role));
    });
    if (state.present && previousRole !== role) {
      var previousButton = document.querySelector('.role-btn[data-role="' + previousRole + '"]');
      var nextButton = document.querySelector('.role-btn[data-role="' + role + '"]');
      if (previousButton) previousButton.classList.add('role-leaving');
      if (nextButton) {
        void nextButton.offsetWidth;
        nextButton.classList.add('role-switching');
      }
      var roleStatus = $('role-switch-status');
      if (roleStatus) roleStatus.textContent = '身份已切换为' + (ROLE_LABEL[role] || role);
      if (state.roleAnimationTimer) window.clearTimeout(state.roleAnimationTimer);
      state.roleAnimationTimer = window.setTimeout(function () {
        if (previousButton) previousButton.classList.remove('role-leaving');
        if (nextButton) nextButton.classList.remove('role-switching');
      }, 900);
    }
    state.error = '';
    renderPanel();
    renderPresentationGuide();
    renderRoleHints();
  }

  function setSetupStatus(message, kind) {
    var host = $('present-setup-status');
    host.textContent = message;
    host.className = 'setup-status' + (kind ? ' ' + kind : '');
  }

  function openPresentationSetup() {
    state.presentPrepared = false;
    state.setupDisplay = 'projector';
    $('present-enter').disabled = true;
    Array.prototype.forEach.call(document.querySelectorAll('[data-setup-display]'), function (btn) {
      btn.setAttribute('aria-pressed', String(btn.getAttribute('data-setup-display') === state.setupDisplay));
    });
    setSetupStatus('尚未准备演示样例。', '');
    $('present-modal').hidden = false;
    loadDemoFixtures().catch(function () {});
    $('present-close').focus();
  }

  function closePresentationSetup() {
    $('present-modal').hidden = true;
    $('present-open').focus();
  }

  function enterPresentation() {
    if (!state.presentPrepared) return;
    state.present = true;
    state.display = state.setupDisplay;
    state.presentFeedback = null;
    applyPresentationShell();
    writePresentationUrl();
    $('present-modal').hidden = true;
    showNew();
    checkPresentationReadiness();
  }

  function exitPresentation() {
    state.present = false;
    state.presentFeedback = null;
    closeDrawers();
    applyPresentationShell();
    writePresentationUrl();
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
    render();
  }

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!(target instanceof Element)) return;

    if (target.closest('#present-open')) { openPresentationSetup(); return; }
    if (target.closest('#present-close') || target === $('present-modal')) { closePresentationSetup(); return; }

    var setupDisplay = target.closest('[data-setup-display]');
    if (setupDisplay) {
      state.setupDisplay = setupDisplay.getAttribute('data-setup-display') === 'led' ? 'led' : 'projector';
      Array.prototype.forEach.call(document.querySelectorAll('[data-setup-display]'), function (btn) {
        btn.setAttribute('aria-pressed', String(btn === setupDisplay));
      });
      return;
    }

    if (target.closest('#present-seed')) {
      var seedButton = $('present-seed');
      seedButton.disabled = true;
      $('present-enter').disabled = true;
      setSetupStatus('正在清理并重建三组样例…', '');
      api('/api/demo/seed', { method:'POST' }).then(function (data) {
        state.view = null; state.currentId = null; state.contrast = null; state.showContrast = false;
        state.presentationMainId = null; state.presentPrepared = true;
        try { sessionStorage.removeItem('gatekeeper-presentation-main-id'); } catch (error) { /* storage is optional */ }
        return loadList().then(function () {
          setSetupStatus('✓ 已重建 ' + ((data.created && data.created.length) || 3) + ' 组准入样例，可以进入演示。', 'ok');
          $('present-enter').disabled = false;
        });
      }).catch(function (error) {
        state.presentPrepared = false;
        setSetupStatus('准备失败：' + error.message, 'error');
      }).finally(function () { seedButton.disabled = false; });
      return;
    }

    if (target.closest('#present-enter')) { enterPresentation(); return; }
    if (target.closest('#present-exit')) { exitPresentation(); return; }
    if (target.closest('#present-fullscreen')) {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(function () {});
      } else if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(function () {});
      }
      return;
    }

    var displayButton = target.closest('button[data-display]');
    if (displayButton) { setPresentationDisplay(displayButton.getAttribute('data-display')); return; }

    if (target.closest('[data-open-list]')) {
      document.body.classList.remove('present-evidence-open');
      document.body.classList.add('present-list-open');
      return;
    }
    if (target.closest('[data-open-evidence]')) {
      document.body.classList.remove('present-list-open');
      document.body.classList.add('present-evidence-open');
      return;
    }
    if (target.closest('#present-list-close') || target.closest('#present-evidence-close') || target.closest('#present-scrim')) { closeDrawers(); return; }
    if (target.closest('#present-return-main') && state.presentationMainId) {
      closeDrawers();
      openManuscript(state.presentationMainId);
      return;
    }

    var guidedRole = target.closest('[data-guide-role]');
    if (guidedRole) { selectRole(guidedRole.getAttribute('data-guide-role')); return; }

    var roleBtn = target.closest('.role-btn');
    if (roleBtn) {
      selectRole(roleBtn.getAttribute('data-role'));
      return;
    }

    if (target.closest('#new-btn')) { showNew(); return; }
    if (target.closest('#nf-sample')) {
      api('/api/demo/fixtures').then(function (data) {
        var t = $('nf-title'), y = $('nf-type'), x = $('nf-text'), k = $('nf-topic');
        if (k && data.mainNotice.coverageTopic) k.value = data.mainNotice.coverageTopic;
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
        state.presentationMainId = null;
        try { sessionStorage.removeItem('gatekeeper-presentation-main-id'); } catch (error) { /* storage is optional */ }
        return loadList().then(render);
      }).catch(function (error) { state.error = error.message; renderPanel(); });
      return;
    }

    if (target.closest('#logout-btn')) {
      fetch('/api/auth/logout', { method:'POST' }).finally(function () { location.href='/login'; });
      return;
    }
    if (target.closest('#nf-submit')) { submitNew(); return; }

    var row = target.closest('.ms');
    if (row) { closeDrawers(); openManuscript(row.getAttribute('data-id')); return; }

    var edit = target.closest('[data-edit]');
    if (edit) {
      var editId = edit.getAttribute('data-edit');
      var editItem = artifactItem(editId);
      if (!editItem) return;
      state.editing = editId;
      state.editDrafts[editId] = rawArtifactText(editItem);
      state.appliedSuggestions = {};
      state.activeAnnotation = null;
      renderPanel();
      var editField = $('edit-' + editId);
      if (editField) editField.focus();
      return;
    }

    var cancel = target.closest('[data-cancel]');
    if (cancel) {
      if (state.editing) delete state.editDrafts[state.editing];
      state.editing = null;
      state.appliedSuggestions = {};
      state.activeAnnotation = null;
      renderPanel();
      return;
    }

    var suggestion = target.closest('[data-apply-suggestion]');
    if (suggestion) {
      applySuggestion(suggestion.getAttribute('data-artifact'), suggestion.getAttribute('data-apply-suggestion'));
      return;
    }

    var locate = target.closest('[data-locate-annotation]');
    if (locate) {
      locateAnnotation(locate.getAttribute('data-artifact'), locate.getAttribute('data-locate-annotation'));
      return;
    }

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
    if (move) {
      advance(move.getAttribute('data-to'), move.getAttribute('data-reason') === '1', move.getAttribute('data-label'));
      return;
    }
  });

  document.addEventListener('input', function (event) {
    var field = event.target && event.target.closest ? event.target.closest('[data-draft-artifact]') : null;
    if (!field) return;
    state.editDrafts[field.getAttribute('data-draft-artifact')] = field.value;
  });

  document.addEventListener('change', function (event) {
    var model = event.target && event.target.closest ? event.target.closest('#model-select') : null;
    if (model) state.selectedModel = model.value;
  });

  document.addEventListener('fullscreenchange', function () {
    var btn = $('present-fullscreen');
    if (btn) btn.textContent = document.fullscreenElement ? '退出全屏' : '全屏';
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

  // 监控看板按 /workbench#<id> 下钻到具体稿件（6.16）。
  function openFromHash() {
    var id = (window.location.hash || '').replace(/^#/, '');
    if (!id) return false;
    openManuscript(id).catch(function () { render(); });
    return true;
  }
  window.addEventListener('hashchange', openFromHash);

  api('/api/auth/me').then(function (data) {
    applyUser(data.user);
    return Promise.all([loadDemoFixtures(), loadList(), loadModels()]);
  }).then(function () {
    if (openFromHash()) return undefined;
    if (state.present && state.presentationMainId) return openManuscript(state.presentationMainId);
    render();
  }).catch(function () { render(); });
})();
</script>
</body>
</html>`;
}
