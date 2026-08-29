// 把关人 · 判定依据管理
//
// Self-contained HTML: CSS + JS inline, zero external resources — 和工作台、
// 监控看板同一条规矩，会场网络挤的时候页面还得能开。
//
// 这一屏回答的是「这套系统凭什么这么判」。工作台答「这一篇怎么走的」，
// 监控看板答「这个台最近在怎么写稿」。

import { renderThemeControl, themeBootstrap, themeStyles } from './theme.js';

export function renderRules(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark light" />
<title>把关人 · 判定依据</title>
${themeBootstrap}<style>${themeStyles}
  :root {
    --mono: ui-monospace,'SF Mono',Menlo,Consolas,monospace;
    --sans:var(--theme-sans);
    --radius:12px;
  }
  * { box-sizing:border-box; }
  html,body { margin:0; padding:0; }
  body { background:var(--bg-effect); color:var(--ink); font-family:var(--sans); font-size:14px; line-height:1.6; -webkit-font-smoothing:antialiased; }

  header.topbar { display:flex; align-items:center; gap:18px; flex-wrap:wrap; padding:12px 22px; border-bottom:1px solid var(--line-strong); background:var(--panel); }
  .brand { display:flex; flex-direction:column; gap:1px; }
  .brand .name { font-size:19px; font-weight:600; display:flex; align-items:center; gap:10px; }
  .brand .name .dot { width:9px; height:9px; border-radius:50%; background:var(--accent); box-shadow:0 0 0 4px var(--accent-soft); }
  .brand .sub { font-family:var(--mono); font-size:11px; letter-spacing:.6px; color:var(--faint); text-transform:uppercase; }
  .nav { margin-left:auto; display:flex; gap:8px; align-items:center; }
  .nav a, .nav button {
    font-family:var(--sans); font-size:13px; color:var(--muted); text-decoration:none;
    padding:7px 14px; background:var(--panel-2); border:1px solid var(--line); border-radius:9px; cursor:pointer;
  }
  .nav a:hover, .nav button:hover { border-color:var(--accent); color:var(--ink); }
  .version { font-family:var(--mono); font-size:12px; color:var(--faint); }

  main { max-width:1200px; margin:0 auto; padding:22px; display:flex; flex-direction:column; gap:22px; }
  h2.hd { font-size:11px; font-family:var(--mono); letter-spacing:.7px; color:var(--faint); text-transform:uppercase; margin:0 0 12px; font-weight:500; }
  .note { font-size:12.5px; color:var(--faint); margin:8px 0 0; }
  .note strong { color:var(--muted); }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); padding:16px 18px; }
  .empty { color:var(--faint); font-size:13px; padding:14px 0; }

  .banner { border:1px solid var(--line-strong); border-radius:var(--radius); padding:14px 18px; background:var(--panel); display:flex; gap:18px; align-items:flex-start; flex-wrap:wrap; }
  .banner .big { font-family:var(--mono); font-size:28px; font-weight:600; line-height:1.1; }
  .banner .why { flex:1 1 420px; font-size:13px; color:var(--muted); }
  .banner .why b { color:var(--ink); }
  .readonly-hint { border:1px dashed var(--line-strong); border-radius:9px; padding:9px 13px; font-size:12.5px; color:var(--muted); background:var(--panel-2); }

  .tabs { display:flex; gap:6px; flex-wrap:wrap; }
  .tab { font:inherit; font-size:13px; color:var(--muted); padding:8px 15px; background:var(--panel-2); border:1px solid var(--line); border-radius:9px; cursor:pointer; }
  .tab[aria-selected="true"] { color:var(--on-accent); background:var(--accent); border-color:var(--accent); }

  .toolbar { display:flex; gap:9px; align-items:center; flex-wrap:wrap; margin-bottom:12px; }
  .toolbar input[type="search"], .toolbar select {
    font:inherit; font-size:13px; color:var(--ink); background:var(--panel-2);
    border:1px solid var(--line); border-radius:9px; padding:7px 11px;
  }
  .toolbar .count { margin-left:auto; font-family:var(--mono); font-size:12px; color:var(--faint); }

  .scroll { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th, td { text-align:left; padding:9px 11px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-size:11px; font-family:var(--mono); letter-spacing:.5px; color:var(--faint); text-transform:uppercase; font-weight:500; white-space:nowrap; }
  tr.off td { opacity:.5; }
  td.rid { font-family:var(--mono); font-size:12px; color:var(--faint); white-space:nowrap; }
  td.term { font-weight:600; }
  td.src { color:var(--muted); font-size:12.5px; max-width:320px; }
  td.act { white-space:nowrap; text-align:right; }

  .pill { display:inline-block; font-size:11.5px; padding:2px 9px; border-radius:999px; background:var(--panel-3); color:var(--muted); white-space:nowrap; }
  .pill.block { background:var(--block-soft); color:var(--block); }
  .pill.warn { background:var(--warn-soft); color:var(--warn); }
  .pill.info { background:var(--info-soft); color:var(--info); }
  .pill.base { border:1px solid var(--line-strong); background:transparent; }

  button.mini { font:inherit; font-size:12px; color:var(--muted); padding:4px 10px; background:var(--panel-2); border:1px solid var(--line); border-radius:7px; cursor:pointer; margin-left:5px; }
  button.mini:hover { border-color:var(--accent); color:var(--ink); }
  button.mini.danger:hover { border-color:var(--block); color:var(--block); }
  button.primary { font:inherit; font-size:13px; color:var(--on-accent); padding:8px 17px; background:var(--accent); border:1px solid var(--accent); border-radius:9px; cursor:pointer; }
  button.primary[disabled] { opacity:.45; cursor:not-allowed; }
  button.ghost { font:inherit; font-size:13px; color:var(--muted); padding:8px 17px; background:var(--panel-2); border:1px solid var(--line); border-radius:9px; cursor:pointer; }

  .modal { position:fixed; inset:0; z-index:80; display:flex; align-items:center; justify-content:center; padding:20px; background:rgba(0,0,0,.42); }
  .modal[hidden] { display:none; }
  .dialog { width:min(620px,100%); max-height:88vh; overflow:auto; background:var(--panel-solid); border:1px solid var(--line-strong); border-radius:15px; box-shadow:var(--shadow); padding:20px 22px; }
  .dialog h3 { margin:0 0 4px; font-size:17px; }
  .dialog .lede { margin:0 0 16px; font-size:12.5px; color:var(--faint); }
  .field { display:flex; flex-direction:column; gap:5px; margin-bottom:13px; }
  .field label { font-size:12px; color:var(--muted); }
  .field label .req { color:var(--block); }
  .field input, .field select, .field textarea {
    font:inherit; font-size:13.5px; color:var(--ink); background:var(--panel-2);
    border:1px solid var(--line); border-radius:9px; padding:8px 11px; width:100%;
  }
  .field textarea { min-height:66px; resize:vertical; }
  .field .hint { font-size:11.5px; color:var(--faint); }
  .row2 { display:grid; grid-template-columns:1fr 1fr; gap:13px; }
  .dialog-actions { display:flex; gap:9px; justify-content:flex-end; margin-top:6px; }
  .alert { border:1px solid var(--warn); background:var(--warn-soft); color:var(--warn); border-radius:10px; padding:12px 14px; font-size:13px; margin-bottom:14px; }
  .alert b { display:block; margin-bottom:5px; }
  .alert label { display:flex; gap:8px; align-items:flex-start; margin-top:10px; color:var(--ink); font-size:12.5px; }
  .alert input[type="checkbox"] { margin-top:3px; }
  .err { color:var(--block); font-size:12.5px; margin-bottom:12px; }

  .change { border-bottom:1px solid var(--line); padding:11px 0; font-size:13px; }
  .change:last-child { border-bottom:0; }
  .change .top { display:flex; gap:9px; align-items:baseline; flex-wrap:wrap; }
  .change .who { font-weight:600; }
  .change .when { font-family:var(--mono); font-size:11.5px; color:var(--faint); }
  .change .why { color:var(--muted); margin-top:4px; }
  .change .diff { font-family:var(--mono); font-size:12px; color:var(--faint); margin-top:4px; }
  .change .ack { margin-top:6px; font-size:12px; color:var(--warn); }

  .engine td.reason { color:var(--faint); font-size:12.5px; }

  @media (max-width:720px) {
    main { padding:16px; }
    .row2 { grid-template-columns:1fr; }
  }
</style>
</head>
<body>
<header class="topbar">
  <div class="brand">
    <div class="name"><span class="dot"></span>把关人 · 判定依据</div>
    <div class="sub">guiks-gd-content-moderation · ruleset</div>
  </div>
  <div class="nav">
    <span class="version" id="version">—</span>
    ${renderThemeControl()}
    <button id="refresh">刷新</button>
    <a href="/monitor">全流程监控</a>
    <a href="/workbench">回工作台</a>
  </div>
</header>

<main id="root"><div class="empty">正在取数…</div></main>

<div class="modal" id="modal" hidden>
  <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
    <h3 id="dialog-title">新增词条</h3>
    <p class="lede" id="dialog-lede"></p>
    <div id="dialog-body"></div>
  </section>
</div>

<script>
(function () {
  'use strict';

  var BUCKET = { 'block':'硬拦', 'reason':'要理由', 'off-duty':'公器私用' };
  var BUCKET_TONE = { 'block':'block', 'reason':'warn', 'off-duty':'info' };
  var ACTION = { 'block':'拦下不让播', 'redact':'标红待复核', 'flag':'放行留痕' };
  var ACTION_TONE = { 'block':'block', 'redact':'warn', 'flag':'' };
  var CATEGORY = {
    'typo':'错别字与用词','punctuation':'标点差错','format':'格式规范','banned-term':'禁用词',
    'caution-term':'慎用词','leader-title':'领导表述规范','inconsistency':'与原通稿不一致',
    'privacy-name':'当事人姓名保护','ai-label':'AI 生成内容标识','judgment':'导向与事实判断'
  };
  /** 界面上只让人在这四个类目里选：其余类目由内置逻辑产出，不是词条能表达的。 */
  var TERM_CATEGORIES = ['banned-term','caution-term','leader-title','typo'];
  var CHANGE = { 'created':'新增','updated':'修改','enabled':'启用','disabled':'停用','deleted':'删除' };

  var state = { data:null, tab:'admission', q:'', bucket:'', changes:[], usage:null, saved:'' };

  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function stamp(ms) {
    var d = new Date(ms), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function pill(text, tone) {
    return '<span class="pill ' + (tone || '') + '">' + esc(text) + '</span>';
  }

  function api(path, init) {
    return fetch(path, Object.assign({ headers:{ 'content-type':'application/json' } }, init || {}))
      .then(function (r) {
        if (r.status === 401) {
          location.href = '/login?next=' + encodeURIComponent(location.pathname);
          throw new Error('请先登录');
        }
        return r.json().catch(function () { return {}; }).then(function (body) {
          if (!r.ok) throw new Error(body.message || body.error || ('HTTP ' + r.status));
          return body;
        });
      });
  }

  // ————————————————————————— 渲染 —————————————————————————

  function banner(d) {
    return '<div class="banner">' +
      '<div><div class="big">第 ' + d.version + ' 版</div>' +
      '<div class="sub" style="font-size:11.5px;color:var(--faint)">当前判定依据</div></div>' +
      '<div class="why"><b>每一次判定的留痕都带着这个版本号。</b>' +
      '词表可以改，所以「这一篇当时按什么判的」不能只靠规则编号回答——' +
      '编号会被改档位、改词面，版本号加上下面的改动史才能把那一版原样重建出来。' +
      (d.version === 0 ? '<br>第 0 版的含义是：未经任何人工改动，全是内置基线。' : '') +
      '</div>' +
      (d.canWrite ? '' :
        '<div class="readonly-hint">当前账号为<b>只读</b>。改判定依据与使用限制归<b>台领导</b>——' +
        '判定依据谁都能改，就等于谁都不负责。</div>') +
      '</div>';
  }

  function tabs() {
    var items = [
      ['admission','入口准入'],
      ['preflight','输出预检'],
      ['engine','内置判定逻辑'],
      ['changes','改动史'],
      ['usage','使用限制']
    ];
    return '<div class="tabs">' + items.map(function (it) {
      return '<button class="tab" data-tab="' + it[0] + '" aria-selected="' +
        (state.tab === it[0]) + '">' + it[1] + '</button>';
    }).join('') + '</div>';
  }

  function matches(rule) {
    if (state.q) {
      var hay = (rule.term + ' ' + rule.ruleId + ' ' + rule.source + ' ' + (rule.title || '')).toLowerCase();
      if (hay.indexOf(state.q.toLowerCase()) === -1) return false;
    }
    if (!state.bucket) return true;
    return state.tab === 'admission' ? rule.admissionBucket === state.bucket : rule.action === state.bucket;
  }

  function toolbar(total, shown) {
    var opts = state.tab === 'admission'
      ? [['','全部档位'],['block','硬拦'],['reason','要理由'],['off-duty','公器私用']]
      : [['','全部动作'],['block','拦下不让播'],['redact','标红待复核'],['flag','放行留痕']];
    return '<div class="toolbar">' +
      '<input type="search" id="q" placeholder="搜词面、编号或出处" value="' + esc(state.q) + '" />' +
      '<select id="bucket">' + opts.map(function (o) {
        return '<option value="' + o[0] + '"' + (state.bucket === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select>' +
      (state.data.canWrite ? '<button class="primary" id="add">新增词条</button>' : '') +
      '<span class="count">' + shown + ' / ' + total + ' 条</span>' +
      '</div>';
  }

  function ruleRows(rules) {
    var write = state.data.canWrite;
    return rules.map(function (r) {
      var lane = state.tab === 'admission'
        ? pill(BUCKET[r.admissionBucket] || r.admissionBucket, BUCKET_TONE[r.admissionBucket])
        : pill(ACTION[r.action] || r.action, ACTION_TONE[r.action]) + ' ' +
          pill(CATEGORY[r.category] || r.category, 'info');
      return '<tr class="' + (r.enabled ? '' : 'off') + '">' +
        '<td class="rid">' + esc(r.ruleId) + '</td>' +
        '<td class="term">' + esc(r.term) +
          (r.suggestion ? '<div class="hint" style="font-weight:400;color:var(--faint);font-size:12px">建议改为「' + esc(r.suggestion) + '」</div>' : '') +
        '</td>' +
        '<td>' + lane + '</td>' +
        '<td class="src">' + esc(r.source) + '</td>' +
        '<td>' + (r.origin === 'builtin' ? pill('内置基线','base') : pill('本台自加','info')) +
          (r.enabled ? '' : ' ' + pill('已停用')) + '</td>' +
        '<td class="act">' +
          '<button class="mini" data-history="' + esc(r.ruleId) + '">改动史</button>' +
          (write ? '<button class="mini" data-edit="' + esc(r.ruleId) + '">编辑</button>' : '') +
          (write ? '<button class="mini" data-toggle="' + esc(r.ruleId) + '">' + (r.enabled ? '停用' : '启用') + '</button>' : '') +
          (write && r.origin === 'custom' ? '<button class="mini danger" data-remove="' + esc(r.ruleId) + '">删除</button>' : '') +
        '</td></tr>';
    }).join('');
  }

  function ruleTable() {
    var all = state.data.rules.filter(function (r) { return r.scope === state.tab; });
    var shown = all.filter(matches);
    var out = toolbar(all.length, shown.length);
    if (state.tab === 'admission') {
      out += '<p class="note" style="margin:0 0 12px">' +
        '入口准入判的不是词，是<strong>这次调用该不该发生</strong>。' +
        '<strong>硬拦</strong>那一档模型完全不碰，是整条链路上唯一免费的一档，所以它只认' +
        '「话术 / 教程 / 方法」这类<strong>操作指令式措辞</strong>——' +
        '「制毒」「传销」「洗钱」都是台里正经在写的稿子，按题材硬拦会把正常选题拦死。</p>';
    } else {
      out += '<p class="note" style="margin:0 0 12px">' +
        '输出预检产出的是<strong>标注</strong>，不是闸门。除入口那一层的硬拦外一律标出来让人决定——' +
        '人少，阻断就是卡死，卡死就是弃用。</p>';
    }
    out += shown.length === 0 ? '<div class="empty">没有匹配的词条。</div>' :
      '<div class="card scroll"><table><thead><tr>' +
      '<th>编号</th><th>词面</th><th>' + (state.tab === 'admission' ? '档位' : '动作 / 类目') + '</th>' +
      '<th>出处</th><th>来源</th><th style="text-align:right">操作</th>' +
      '</tr></thead><tbody>' + ruleRows(shown) + '</tbody></table></div>';
    return out;
  }

  function engineTable() {
    return '<p class="note" style="margin:0 0 12px">' +
      '这些<strong>不落库、只能改代码</strong>，但必须列在这里——' +
      '看不见会让人以为词表就是判定的全部，那反而是新的误导。</p>' +
      '<div class="card scroll"><table class="engine"><thead><tr>' +
      '<th>编号</th><th>判什么</th><th>说明</th><th>为什么不能在这里改</th>' +
      '</tr></thead><tbody>' +
      state.data.engineRules.map(function (r) {
        return '<tr><td class="rid">' + esc(r.ruleId) + '</td>' +
          '<td class="term">' + esc(r.label) + '</td>' +
          '<td class="src">' + esc(r.detail) + '</td>' +
          '<td class="reason">' + esc(r.reason) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function diffLine(before, after) {
    if (!before || !after) return '';
    var keys = ['term','admissionBucket','action','category','source','suggestion','enabled'];
    var parts = keys.filter(function (k) { return String(before[k]) !== String(after[k]); })
      .map(function (k) { return k + '：' + String(before[k]) + ' → ' + String(after[k]); });
    return parts.length ? '<div class="diff">' + esc(parts.join('　·　')) + '</div>' : '';
  }

  function changeList() {
    if (!state.changes.length) {
      return '<div class="card"><div class="empty">还没有任何改动——当前是未经改动的内置基线。</div></div>';
    }
    return '<div class="card">' + state.changes.map(function (c) {
      var rule = c.after || c.before || {};
      return '<div class="change"><div class="top">' +
        pill(CHANGE[c.action] || c.action, c.action === 'deleted' ? 'block' : (c.action === 'created' ? 'info' : '')) +
        '<span class="who">' + esc(c.actor) + '</span>' +
        '<span class="rid" style="font-family:var(--mono);font-size:12px;color:var(--faint)">' +
        esc(c.ruleId) + (rule.term ? '　' + esc(rule.term) : '') + '</span>' +
        '<span class="when">' + stamp(c.createdAt) + '　→ 第 ' + c.rulesetVersion + ' 版</span>' +
        '</div>' +
        '<div class="why">理由：' + esc(c.reason) + '</div>' +
        diffLine(c.before, c.after) +
        (c.acknowledgedWarning ? '<div class="ack">已确认警示：' + esc(c.acknowledgedWarning) + '</div>' : '') +
        '</div>';
    }).join('') + '</div>' +
    '<p class="note">改动记录<strong>只增不改</strong>，也删不掉。判定依据是判定的凭据，' +
    '凭据被谁改过必须查得到——这和整个产品「说得清」是同一件事。</p>';
  }

  // ————————————————————————— 使用限制 —————————————————————————

  function num(v) { return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  function usagePanel() {
    var u = state.usage;
    if (!u) return '<div class="empty">正在取数…</div>';
    var write = u.canWrite;

    var out = '<p class="note" style="margin:0 0 14px">' +
      '<strong>这一屏和词表判的不是一回事。</strong>' +
      '入口准入判的是<strong>这次调用该不该发生</strong>（看内容），' +
      '使用限制判的是<strong>这个账号今天还能不能调</strong>（看用量）。' +
      '超限时稿件状态<strong>一步不动</strong>，编辑收到的话也写明「这不是内容判定」——' +
      '两套结论混在一起，留痕里就会长出「因为超限所以被判违规」这种说不清的东西。</p>';

    out += '<div class="card" style="margin-bottom:16px"><h2 class="hd">每个账号每天的上限</h2>' +
      '<div class="row2">' +
      '<div class="field"><label>调用次数</label>' +
      '<input id="u-calls" type="number" min="1" max="100000" placeholder="留空 = 不限" value="' +
      (u.limits.dailyCalls == null ? '' : u.limits.dailyCalls) + '"' + (write ? '' : ' disabled') + ' />' +
      '<span class="hint">一次生成产两份产物，算<strong>两次</strong>调用。</span></div>' +
      '<div class="field"><label>token 用量</label>' +
      '<input id="u-tokens" type="number" min="1000" max="100000000" placeholder="留空 = 不限" value="' +
      (u.limits.dailyTokens == null ? '' : u.limits.dailyTokens) + '"' + (write ? '' : ' disabled') + ' />' +
      '<span class="hint">输入 + 输出之和。</span></div>' +
      '</div>' +
      (write
        ? '<div class="dialog-actions" style="justify-content:flex-start"><button class="primary" id="u-save">保存上限</button>' +
          '<span class="hint" id="u-status" style="align-self:center;color:var(--faint);font-size:12.5px">' +
          esc(state.saved) + '</span></div>'
        : '<div class="readonly-hint">当前账号为只读。改使用限制归台领导。</div>') +
      '<p class="note">' +
      (u.limits.updatedAt ? '上次改动：' + stamp(u.limits.updatedAt) +
        (u.limits.updatedBy ? '　' + esc(u.limits.updatedBy) : '') + '。' : '还没有设过上限，当前两项都不限。') +
      '<strong>次日按本地时间零点重置。</strong>上游失败（余额不足、超时）不吃额度——' +
      '因为供应商出问题而惩罚编辑说不过去。</p></div>';

    out += '<div class="card" style="margin-bottom:16px"><h2 class="hd">今日用量 · ' + esc(u.day) + '</h2>';
    out += u.today.length === 0 ? '<div class="empty">今天还没有人调过模型。</div>' :
      '<div class="scroll"><table><thead><tr><th>人</th>' +
      '<th style="text-align:right">调用次数</th><th style="text-align:right">输入 tokens</th>' +
      '<th style="text-align:right">输出 tokens</th><th style="text-align:right">合计 tokens</th>' +
      '</tr></thead><tbody>' + u.today.map(function (r) {
        var total = r.tokensIn + r.tokensOut;
        var hotCalls = u.limits.dailyCalls != null && r.calls >= u.limits.dailyCalls;
        var hotTokens = u.limits.dailyTokens != null && total >= u.limits.dailyTokens;
        return '<tr><td class="term">' + esc(r.displayName || r.userId) +
          (r.username ? '<span class="rid" style="font-weight:400"> @' + esc(r.username) + '</span>' : '') + '</td>' +
          '<td class="act">' + (hotCalls ? pill(num(r.calls), 'block') : num(r.calls)) + '</td>' +
          '<td class="act">' + num(r.tokensIn) + '</td>' +
          '<td class="act">' + num(r.tokensOut) + '</td>' +
          '<td class="act">' + (hotTokens ? pill(num(total), 'block') : num(total)) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    out += '<p class="note">这份数<strong>落库</strong>，进程重启不清零——' +
      '重启就能续杯的计数不叫配额。它和遗留控制台的 <code>/api/usage</code> 不是同一份数据。</p></div>';

    out += '<div class="card"><h2 class="hd">最近的超限</h2>';
    out += u.blocked.length === 0 ? '<div class="empty">还没有人被额度挡下过。</div>' :
      '<div class="scroll"><table><thead><tr><th>人</th><th>挡在哪一项</th>' +
      '<th style="text-align:right">当时用量 / 上限</th><th>时间</th></tr></thead><tbody>' +
      u.blocked.map(function (r) {
        return '<tr><td class="term">' + esc(r.actor) + '</td>' +
          '<td>' + pill(r.kind === 'tokens' ? 'token 用量' : '调用次数', 'warn') + '</td>' +
          '<td class="act">' + num(r.used) + ' / ' + num(r.limit) + '</td>' +
          '<td class="rid">' + stamp(r.createdAt) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    out += '<p class="note">超限单独留痕，<strong>不写进入口准入的结论</strong>；' +
      '有稿件上下文时追溯图谱上也是单独一条 <code>quota-blocked</code>，' +
      'actor 写「使用限制」而不是「入口准入」。</p></div>';

    return out;
  }

  function saveLimits() {
    var calls = document.getElementById('u-calls').value.trim();
    var tokens = document.getElementById('u-tokens').value.trim();
    var status = document.getElementById('u-status');
    status.textContent = '保存中…';
    api('/api/usage-limits', {
      method:'PUT',
      body: JSON.stringify({
        dailyCalls: calls === '' ? null : Number(calls),
        dailyTokens: tokens === '' ? null : Number(tokens)
      })
    }).then(function () {
      // 提示存进 state：loadUsage() 会重建整块 DOM，直接写 textContent 当场被冲掉。
      state.saved = '已保存。上限即刻生效，明天零点按本地时间重置。';
      loadUsage();
    }).catch(function (e) {
      state.saved = '';
      status.textContent = '保存失败：' + e.message;
    });
  }

  function render() {
    var d = state.data;
    $('version').textContent = '判定依据 v' + d.version;
    var out = banner(d) + tabs();
    if (state.tab === 'engine') out += engineTable();
    else if (state.tab === 'changes') out += changeList();
    else if (state.tab === 'usage') out += usagePanel();
    else out += ruleTable();
    $('root').innerHTML = out;
    bind();
  }

  // ————————————————————————— 表单 —————————————————————————

  function closeModal() { $('modal').hidden = true; $('dialog-body').innerHTML = ''; }

  function field(label, control, hint, required) {
    return '<div class="field"><label>' + esc(label) +
      (required ? ' <span class="req">*</span>' : '') + '</label>' + control +
      (hint ? '<span class="hint">' + hint + '</span>' : '') + '</div>';
  }

  function select(id, options, current) {
    return '<select id="' + id + '">' + options.map(function (o) {
      return '<option value="' + o[0] + '"' + (current === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select>';
  }

  var BUCKET_OPTS = [['reason','要理由 — 涉敏感题材，填选题依据后放行留痕'],
                     ['off-duty','公器私用 — 不违法但不是业务用途，只标不拦'],
                     ['block','硬拦 — 模型完全不碰（只放操作指令式措辞）']];
  var ACTION_OPTS = [['flag','放行留痕'],['redact','标红待复核'],['block','拦下不让播']];
  var CATEGORY_OPTS = TERM_CATEGORIES.map(function (k) { return [k, CATEGORY[k]]; });

  function openEditor(rule) {
    var creating = !rule;
    var scope = rule ? rule.scope : state.tab;
    if (scope !== 'admission' && scope !== 'preflight') scope = 'admission';
    $('dialog-title').textContent = creating ? '新增词条' : ('编辑 ' + rule.ruleId);
    $('dialog-lede').textContent = creating
      ? '出处与理由都必填——说不出出处的判定依据不该存在，说不清理由的改动不该发生。'
      : (rule.origin === 'builtin'
          ? '内置基线：词面与出处不可修改（改了它就不是那条基线了）。可以改档位或停用。'
          : '本台自加的词条。改完写清理由。');

    var locked = !creating && rule.origin === 'builtin';
    var body = '<div id="warn-slot"></div><div id="form-error" class="err" hidden></div>';
    body += field('作用层', creating
      ? select('f-scope', [['admission','入口准入 — 判这次调用该不该发生'],['preflight','输出预检 — 判产出有没有问题']], scope)
      : '<input value="' + (scope === 'admission' ? '入口准入' : '输出预检') + '" disabled />', '', true);
    body += field('词面', '<input id="f-term" value="' + esc(rule ? rule.term : '') + '"' +
      (locked ? ' disabled' : '') + ' maxlength="60" />',
      locked ? '内置基线的词面不可改。' : '按字面匹配，不做分词。', true);
    body += '<div id="lane-slot"></div>';
    body += field('出处', '<input id="f-source" value="' + esc(rule ? rule.source : '') + '"' +
      (locked ? ' disabled' : '') + ' maxlength="300" />',
      locked ? '内置基线的出处不可改。' : '写清依据的名字，例如某份规范的标题与版本。<b>说不出出处的宁可不加</b>。', true);
    body += field('本次改动的理由', '<textarea id="f-reason" maxlength="500" placeholder="为什么要做这次改动"></textarea>',
      '会连同你的姓名与时间一起写进改动记录，删不掉。', true);
    body += '<div class="dialog-actions"><button class="ghost" id="f-cancel">取消</button>' +
      '<button class="primary" id="f-save">' + (creating ? '新增' : '保存') + '</button></div>';
    $('dialog-body').innerHTML = body;
    $('modal').hidden = false;

    function renderLane() {
      var s = creating ? $('f-scope').value : scope;
      $('lane-slot').innerHTML = s === 'admission'
        ? field('档位', select('f-bucket', BUCKET_OPTS, rule ? rule.admissionBucket : 'reason'),
            '<b>硬拦只认操作指令式措辞</b>——任何题材都可能是新闻。', true)
        : field('动作', select('f-action', ACTION_OPTS, rule ? rule.action : 'flag'), '', true) +
          field('类目', select('f-category', CATEGORY_OPTS, rule ? rule.category : 'caution-term'), '', true) +
          field('标注标题', '<input id="f-title" maxlength="120" value="' + esc(rule ? (rule.title || '') : '') + '" />', '编辑在预检里看到的那一行。') +
          field('说明', '<textarea id="f-detail" maxlength="500">' + esc(rule ? (rule.detail || '') : '') + '</textarea>', '为什么这么判，写给编辑看。') +
          field('建议改为', '<input id="f-suggestion" maxlength="120" value="' + esc(rule ? (rule.suggestion || '') : '') + '" />', '留空表示不给替换建议。');
    }
    renderLane();
    if (creating) $('f-scope').addEventListener('change', renderLane);
    $('f-cancel').addEventListener('click', closeModal);
    $('f-save').addEventListener('click', function () { submit(rule, creating); });
  }

  function collect(creating, rule) {
    var scope = creating ? $('f-scope').value : rule.scope;
    var payload = { reason: $('f-reason').value.trim() };
    if (creating) {
      payload.scope = scope;
      payload.term = $('f-term').value.trim();
      payload.source = $('f-source').value.trim();
    } else if (rule.origin !== 'builtin') {
      payload.term = $('f-term').value.trim();
      payload.source = $('f-source').value.trim();
    }
    if (scope === 'admission') payload.admissionBucket = $('f-bucket').value;
    else {
      payload.action = $('f-action').value;
      payload.category = $('f-category').value;
      var title = $('f-title').value.trim();
      var detail = $('f-detail').value.trim();
      var suggestion = $('f-suggestion').value.trim();
      if (title) payload.title = title;
      if (detail) payload.detail = detail;
      if (suggestion) payload.suggestion = suggestion;
    }
    var ack = document.getElementById('f-ack');
    if (ack && ack.checked) payload.acknowledge = true;
    return payload;
  }

  function showError(message) {
    var box = $('form-error');
    box.hidden = false;
    box.textContent = message;
  }

  /** 硬拦档的题材词警示。不禁止——但要求勾选确认，并把确认原文写进改动记录。 */
  function showWarning(message) {
    $('warn-slot').innerHTML = '<div class="alert"><b>确认一下再提交</b>' + esc(message) +
      '<label><input type="checkbox" id="f-ack" />我知道这可能把正常选题拦死，仍要这么设。' +
      '这次确认会记进改动记录。</label></div>';
  }

  function submit(rule, creating) {
    $('form-error').hidden = true;
    var payload = collect(creating, rule);
    var request = creating
      ? api('/api/rules', { method:'POST', body:JSON.stringify(payload) })
      : api('/api/rules/' + encodeURIComponent(rule.ruleId), { method:'PATCH', body:JSON.stringify(payload) });
    request.then(function () { closeModal(); load(); }).catch(function (e) {
      if (/拦死|操作指令|要理由/.test(e.message)) showWarning(e.message);
      else showError(e.message);
    });
  }

  function askReason(title, lede, confirmLabel, run) {
    $('dialog-title').textContent = title;
    $('dialog-lede').textContent = lede;
    $('dialog-body').innerHTML =
      '<div id="form-error" class="err" hidden></div>' +
      field('理由', '<textarea id="f-reason" maxlength="500"></textarea>',
        '会写进改动记录，删不掉。', true) +
      '<div class="dialog-actions"><button class="ghost" id="f-cancel">取消</button>' +
      '<button class="primary" id="f-save">' + esc(confirmLabel) + '</button></div>';
    $('modal').hidden = false;
    $('f-cancel').addEventListener('click', closeModal);
    $('f-save').addEventListener('click', function () {
      $('form-error').hidden = true;
      run($('f-reason').value.trim())
        .then(function () { closeModal(); load(); })
        .catch(function (e) { showError(e.message); });
    });
  }

  function openHistory(ruleId) {
    $('dialog-title').textContent = ruleId + ' 的改动史';
    $('dialog-lede').textContent = '只增不改，也删不掉。';
    $('dialog-body').innerHTML = '<div class="empty">正在取数…</div>';
    $('modal').hidden = false;
    api('/api/rules/changes?ruleId=' + encodeURIComponent(ruleId)).then(function (d) {
      var saved = state.changes;
      state.changes = d.changes;
      var html = d.changes.length ? changeList() : '<div class="empty">这一条还没有被改过。</div>';
      state.changes = saved;
      $('dialog-body').innerHTML = html +
        '<div class="dialog-actions"><button class="ghost" id="f-cancel">关闭</button></div>';
      $('f-cancel').addEventListener('click', closeModal);
    });
  }

  function ruleById(id) {
    return state.data.rules.filter(function (r) { return r.ruleId === id; })[0];
  }

  function bind() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (b) {
      b.addEventListener('click', function () {
        state.tab = b.getAttribute('data-tab');
        state.bucket = '';
        state.saved = '';
        if (state.tab === 'changes') loadChanges();
        else if (state.tab === 'usage') loadUsage();
        else render();
      });
    });
    var q = $('q');
    if (q) q.addEventListener('input', function () { state.q = q.value; render(); q = $('q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } });
    var bucket = $('bucket');
    if (bucket) bucket.addEventListener('change', function () { state.bucket = bucket.value; render(); });
    var add = $('add');
    if (add) add.addEventListener('click', function () { openEditor(null); });
    var save = $('u-save');
    if (save) save.addEventListener('click', saveLimits);

    Array.prototype.forEach.call(document.querySelectorAll('[data-edit]'), function (b) {
      b.addEventListener('click', function () { openEditor(ruleById(b.getAttribute('data-edit'))); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-history]'), function (b) {
      b.addEventListener('click', function () { openHistory(b.getAttribute('data-history')); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-toggle]'), function (b) {
      b.addEventListener('click', function () {
        var rule = ruleById(b.getAttribute('data-toggle'));
        askReason(
          (rule.enabled ? '停用 ' : '启用 ') + rule.ruleId,
          rule.enabled
            ? '停用后这条不再参与判定。基线条目删不掉，但可以停用——停用也留痕。'
            : '启用后这条重新参与判定。',
          rule.enabled ? '停用' : '启用',
          function (why) {
            return api('/api/rules/' + encodeURIComponent(rule.ruleId), {
              method:'PATCH',
              body: JSON.stringify({ reason: why, enabled: !rule.enabled })
            });
          }
        );
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-remove]'), function (b) {
      b.addEventListener('click', function () {
        var rule = ruleById(b.getAttribute('data-remove'));
        askReason('删除 ' + rule.ruleId, '「' + rule.term + '」将不再参与判定。改动记录会保留这条词曾经存在过。',
          '删除', function (why) {
            return api('/api/rules/' + encodeURIComponent(rule.ruleId), {
              method:'DELETE', body: JSON.stringify({ reason: why })
            });
          });
      });
    });
  }

  function loadUsage() {
    api('/api/usage-limits').then(function (d) {
      state.usage = d;
      render();
    }).catch(function (e) {
      $('root').innerHTML = '<div class="empty">取数失败：' + esc(e.message) + '</div>';
    });
  }

  function loadChanges() {
    api('/api/rules/changes').then(function (d) {
      state.changes = d.changes;
      render();
    }).catch(function (e) {
      $('root').innerHTML = '<div class="empty">取数失败：' + esc(e.message) + '</div>';
    });
  }

  function load() {
    api('/api/rules').then(function (d) {
      state.data = d;
      if (state.tab === 'changes') loadChanges();
      else if (state.tab === 'usage') loadUsage();
      else render();
    }).catch(function (e) {
      $('root').innerHTML = '<div class="empty">取数失败：' + esc(e.message) + '</div>';
    });
  }

  $('refresh').addEventListener('click', load);
  $('modal').addEventListener('click', function (event) {
    if (event.target === $('modal')) closeModal();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !$('modal').hidden) closeModal();
  });

  load();
})();
</script>
</body>
</html>`;
}
