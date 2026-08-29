// 把关人 · 全流程监控看板（6.21）
//
// Self-contained HTML: CSS + JS inline, zero external resources — same rule as
// the workbench, so it renders on congested conference WiFi.
//
// 它回答的是「这个台最近在怎么写稿」，不是「这一篇怎么走的」。后者在工作台第 ⑥ 屏。

import { renderThemeControl, themeBootstrap, themeStyles } from './theme.js';

export function renderOversight(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark light" />
<title>把关人 · 全流程监控</title>
${themeBootstrap}<style>${themeStyles}
  :root {
    --mono: ui-monospace,'SF Mono',Menlo,Consolas,monospace;
    --sans:var(--theme-sans);
    --serif:var(--theme-sans);
    --radius:12px;
  }
  * { box-sizing:border-box; }
  html,body { margin:0; padding:0; }
  body { background:var(--bg-effect); color:var(--ink); font-family:var(--sans); font-size:14px; line-height:1.6; -webkit-font-smoothing:antialiased; }

  header.topbar { display:flex; align-items:center; gap:18px; flex-wrap:wrap; padding:12px 22px; border-bottom:1px solid var(--line-strong); background:var(--panel); }
  .brand { display:flex; flex-direction:column; gap:1px; }
  .brand .name { font-family:var(--serif); font-size:19px; font-weight:600; display:flex; align-items:center; gap:10px; }
  .brand .name .dot { width:9px; height:9px; border-radius:50%; background:var(--accent); box-shadow:0 0 0 4px var(--accent-soft); }
  .brand .sub { font-family:var(--mono); font-size:11px; letter-spacing:.6px; color:var(--faint); text-transform:uppercase; }
  .demo-badge { font-size:11px; color:var(--warn); border:1px dashed var(--warn); border-radius:6px; padding:3px 9px; background:var(--warn-soft); }
  .nav { margin-left:auto; display:flex; gap:8px; align-items:center; }
  .nav a, .nav button {
    font-family:var(--sans); font-size:13px; color:var(--muted); text-decoration:none;
    padding:7px 14px; background:var(--panel-2); border:1px solid var(--line); border-radius:9px; cursor:pointer;
  }
  .nav a:hover, .nav button:hover { border-color:var(--accent); color:var(--ink); }
  .nav .stamp { font-family:var(--mono); font-size:11px; color:var(--faint); }

  main { max-width:1180px; margin:0 auto; padding:22px; display:flex; flex-direction:column; gap:26px; }
  h2.hd { font-size:11px; font-family:var(--mono); letter-spacing:.7px; color:var(--faint); text-transform:uppercase; margin:0 0 12px; font-weight:500; }
  .note { font-size:12.5px; color:var(--faint); margin:8px 0 0; }

  .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:1px; background:var(--line); border:1px solid var(--line); border-radius:var(--radius); overflow:hidden; }
  .kpi { background:var(--panel); padding:16px 18px; }
  .kpi .n { font-family:var(--mono); font-size:30px; font-weight:600; line-height:1.05; font-variant-numeric:tabular-nums; }
  .kpi .k { font-size:12px; color:var(--muted); margin-top:3px; }
  .kpi.hot .n { color:var(--warn); }
  .kpi.ok .n { color:var(--accent-deep); }
  .kpi.bad .n { color:var(--block); }

  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:16px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); padding:16px 18px; }

  .bars { display:flex; flex-direction:column; gap:9px; }
  .bar { display:grid; grid-template-columns:minmax(84px,auto) 1fr 46px; gap:10px; align-items:center; font-size:13px; }
  .bar .lbl { color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .bar .track { background:var(--panel-3); border-radius:3px; height:12px; overflow:hidden; }
  .bar .fill { height:100%; background:var(--accent); border-radius:3px; }
  .bar .fill.warn { background:var(--warn); }
  .bar .fill.block { background:var(--block); }
  .bar .fill.info { background:var(--info); }
  .bar .val { font-family:var(--mono); font-size:12px; text-align:right; color:var(--ink); font-variant-numeric:tabular-nums; }

  .stack { display:flex; height:26px; border-radius:6px; overflow:hidden; background:var(--panel-3); }
  .stack i { display:block; }
  .legend { display:flex; gap:14px; flex-wrap:wrap; font-size:11px; color:var(--faint); margin-top:10px; }
  .legend i { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:5px; vertical-align:middle; }

  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; font-weight:500; font-size:11px; font-family:var(--mono); letter-spacing:.5px; color:var(--faint); text-transform:uppercase; padding:0 10px 8px 0; border-bottom:1px solid var(--line-strong); }
  td { padding:9px 10px 9px 0; border-bottom:1px solid var(--line); }
  td.num { font-family:var(--mono); font-variant-numeric:tabular-nums; text-align:right; }
  td.t { max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .scroll { overflow-x:auto; }
  .pill { font-size:11px; font-family:var(--mono); padding:2px 8px; border-radius:20px; border:1px solid var(--line-strong); color:var(--faint); white-space:nowrap; }
  .pill.ok { color:var(--accent-deep); background:var(--accent-soft); border-color:var(--accent); }
  .pill.hot { color:var(--warn); background:var(--warn-soft); border-color:var(--warn); }
  .empty { color:var(--faint); font-size:13px; padding:12px 0; }
  a.drill { color:var(--ink); text-decoration:none; border-bottom:1px dotted var(--line-strong); }
  a.drill:hover { color:var(--accent-deep); border-bottom-color:var(--accent); }

  .gap { border:1px dashed var(--line-strong); border-radius:var(--radius); padding:16px 18px; color:var(--faint); font-size:13px; line-height:1.8; }
  .gap b { color:var(--muted); }
</style>
</head>
<body>

<header class="topbar">
  <div class="brand">
    <div class="name"><span class="dot"></span>把关人 · 全流程监控</div>
    <div class="sub">converged media · oversight</div>
  </div>
  <span class="demo-badge">模拟 / 脱敏素材</span>
  <div class="nav">
    <span class="stamp" id="stamp"></span>
    ${renderThemeControl()}
    <button id="refresh">刷新</button>
    <a href="/workbench">回工作台</a>
  </div>
</header>

<main id="root"><div class="empty">正在取数…</div></main>

<script>
(function () {
  'use strict';

  var STATUS = {
    'draft':'草稿','admission-blocked':'已拒绝','admission-reason-required':'待填选题依据',
    'admitted':'已准入','generated':'已生成','preflight':'预检完成','revision':'复核修改',
    'countersign':'待会签','first-review':'待初审','second-review':'待复审',
    'final-review':'待终审','signed':'已签发','published':'已发布'
  };
  var ORIGIN = { 'ai':'AI 生成','ai-edited':'AI 生成·人改过','human':'人新写','source':'原文引用' };
  var ORIGIN_COLOR = { 'ai':'var(--ai)','ai-edited':'var(--ai-edited)','human':'var(--human)','source':'var(--source)' };
  var STAGE = {
    'admission':'入口准入','preflight':'输出预检','editor':'初审 · 编辑',
    'department-head':'复审 · 部门主任','supervising-leader':'终审 · 分管领导'
  };
  var CATEGORY = {
    'typo':'错别字与用词','punctuation':'标点差错','format':'格式规范','banned-term':'禁用词',
    'caution-term':'慎用词','leader-title':'领导表述规范','inconsistency':'与原通稿不一致',
    'ai-label':'AI 生成内容标识','judgment':'导向与事实判断','party-name':'当事人姓名'
  };
  var ADMISSION = { 'blocked':'硬拦','reason-required':'要理由','admitted-logged':'仅留痕' };
  var TOPIC = {
    'politics':'时政','livelihood':'民生','economy':'经济',
    'agriculture':'三农','culture':'文化教育','other':'其他'
  };

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function pct(v) { return (v * 100).toFixed(1).replace(/\\.0$/, '') + '%'; }
  function dur(ms) {
    if (ms < 1000) return ms + ' ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + ' 秒';
    if (ms < 3600000) return (ms / 60000).toFixed(1) + ' 分';
    return (ms / 3600000).toFixed(1) + ' 小时';
  }
  function clock(ms) {
    var d = new Date(ms), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function bars(list, label, tone) {
    if (!list.length) return '<div class="empty">暂无数据</div>';
    var max = list.reduce(function (m, r) { return Math.max(m, r.count); }, 0) || 1;
    return '<div class="bars">' + list.map(function (r) {
      return '<div class="bar"><span class="lbl">' + esc(label(r.key)) + '</span>' +
        '<span class="track"><i class="fill ' + (tone ? tone(r.key) : '') +
        '" style="width:' + (r.count / max * 100) + '%"></i></span>' +
        '<span class="val">' + r.count + '</span></div>';
    }).join('') + '</div>';
  }

  function render(d) {
    var seg = d.origins.reduce(function (n, r) { return n + r.count; }, 0);
    var out = '';

    out += '<div class="kpis">' +
      kpi(d.totals.manuscripts, '稿件总数') +
      kpi(d.totals.signed, '已签发 / 已发布', 'ok') +
      kpi(d.totals.blocked, '入口硬拦', d.totals.blocked > 0 ? 'bad' : '') +
      kpi(d.overallAiShare == null ? '未测量' : pct(d.overallAiShare), '全台 AI 参与度',
          d.overallAiShare != null && d.overallAiShare >= 0.9 ? 'hot' : 'ok') +
      kpi(d.totals.traceEvents, '留痕条数') +
      kpi(d.model.calls, '模型调用次数') +
      '</div>';

    out += '<div class="grid">';

    // 来源构成
    out += '<div class="card"><h2 class="hd">句级来源构成（' + seg + ' 句）</h2>';
    if (seg === 0) out += '<div class="empty">还没有可测量的句子。未测量不等于 0。</div>';
    else {
      out += '<div class="stack">' + ['ai','ai-edited','human','source'].map(function (k) {
        var row = d.origins.filter(function (r) { return r.key === k; })[0];
        var n = row ? row.count : 0;
        return n ? '<i style="width:' + (n / seg * 100) + '%;background:' + ORIGIN_COLOR[k] + '"></i>' : '';
      }).join('') + '</div><div class="legend">' + ['ai','ai-edited','human','source'].map(function (k) {
        var row = d.origins.filter(function (r) { return r.key === k; })[0];
        return '<span><i style="background:' + ORIGIN_COLOR[k] + '"></i>' + ORIGIN[k] + ' ' + (row ? row.count : 0) + '</span>';
      }).join('') + '</div>';
      out += '<p class="note">口径：(ai + ai-edited×0.5) / 总句数。每次流转由系统逐句比对上一版重算。</p>';
    }
    out += '</div>';

    // 稿件状态
    out += '<div class="card"><h2 class="hd">稿件状态分布</h2>' +
      bars(d.statuses, function (k) { return STATUS[k] || k; },
           function (k) { return k === 'admission-blocked' ? 'block' : (k === 'signed' || k === 'published' ? '' : 'info'); }) +
      '</div>';

    // 入口准入三档
    out += '<div class="card"><h2 class="hd">入口准入三档</h2>' +
      bars(d.admissions, function (k) { return ADMISSION[k] || k; },
           function (k) { return k === 'blocked' ? 'block' : (k === 'reason-required' ? 'warn' : ''); }) +
      '<p class="note">硬拦那一档模型完全没被调用——那是整条链路上唯一免费的一档。</p></div>';

    // 规则命中
    out += '<div class="card"><h2 class="hd">规则命中排行</h2>' +
      bars(d.ruleHits, function (k) { return CATEGORY[k] || k; },
           function (k) { return k === 'banned-term' ? 'block' : (k === 'inconsistency' ? 'warn' : 'info'); }) +
      '<p class="note">从留痕里实时展开，没有另存一份表——另存一份迟早和留痕对不上。</p></div>';

    // 报道方向（6.19）
    out += '<div class="card"><h2 class="hd">报道方向</h2>' +
      bars(d.topics, function (k) { return k ? (TOPIC[k] || k) : '未分类'; },
           function (k) { return k ? '' : 'info'; }) +
      '<p class="note">由编辑投料时手选。<strong>未分类不等于「其他」</strong>——' +
      '老稿件在这个字段之前建的。自动分类要过模型，归赛后。</p></div>';

    // 审核维度
    out += '<div class="card"><h2 class="hd">各级审核与退回率</h2>';
    out += d.reviews.length === 0 ? '<div class="empty">还没有审核记录。</div>' :
      '<div class="scroll"><table><thead><tr><th>环节</th><th style="text-align:right">通过</th>' +
      '<th style="text-align:right">退回</th><th style="text-align:right">退回率</th></tr></thead><tbody>' +
      d.reviews.map(function (r) {
        var hot = r.returnRate != null && r.returnRate >= 0.3;
        return '<tr><td>' + esc(STAGE[r.stage] || r.stage) + '</td>' +
          '<td class="num">' + r.approved + '</td><td class="num">' + r.returned + '</td>' +
          '<td class="num"><span class="pill ' + (hot ? 'hot' : '') + '">' +
          (r.returnRate == null ? '—' : pct(r.returnRate)) + '</span></td></tr>';
      }).join('') + '</tbody></table></div>';
    out += '</div>';

    // 环节停留
    out += '<div class="card"><h2 class="hd">环节平均停留</h2>';
    out += d.dwell.length === 0 ? '<div class="empty">还没有足够的流转样本。</div>' :
      '<div class="scroll"><table><thead><tr><th>停留在</th><th style="text-align:right">平均</th>' +
      '<th style="text-align:right">样本</th></tr></thead><tbody>' +
      d.dwell.map(function (r) {
        return '<tr><td>' + esc(STATUS[r.status] || r.status) + '</td>' +
          '<td class="num">' + dur(r.averageMs) + '</td><td class="num">' + r.samples + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="note">样本少时这个数只能看趋势。演示环境里流转是连点出来的，停留时间不代表真实工时。</p>';
    out += '</div>';

    // 模型调用
    out += '<div class="card"><h2 class="hd">模型调用</h2>';
    if (d.model.calls === 0) out += '<div class="empty">还没有模型调用记录。</div>';
    else {
      out += '<div class="scroll"><table><tbody>' +
        row2('调用次数', d.model.calls) +
        row2('输入 tokens', d.model.inputTokens) +
        row2('输出 tokens', d.model.outputTokens) +
        row2('平均耗时', dur(d.model.averageLatencyMs)) +
        '</tbody></table></div>' +
        (d.model.models.length ? '<div style="margin-top:12px">' +
          bars(d.model.models, function (k) { return k; }) + '</div>' : '') +
        '<p class="note">来自每次调用的 model-requested / model-completed 留痕——AI 参与度因此是有调用凭证的数，不只是算出来的数。</p>';
    }
    out += '</div>';

    out += '</div>'; // grid

    // 内容生产者（6.20）
    out += '<section><h2 class="hd">内容生产者</h2>';
    out += d.producers.length === 0 ? '<div class="empty">还没有可归属的操作。</div>' :
      '<div class="card scroll"><table><thead><tr><th>人</th>' +
      '<th style="text-align:right">建稿</th><th style="text-align:right">改稿</th>' +
      '<th style="text-align:right">审批</th><th style="text-align:right">其中退回</th>' +
      '</tr></thead><tbody>' +
      d.producers.map(function (r) {
        return '<tr><td>' + esc(r.displayName) + '</td>' +
          '<td class="num">' + r.created + '</td><td class="num">' + r.revised + '</td>' +
          '<td class="num">' + r.reviewed + '</td><td class="num">' + r.returned + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    out += '<p class="note"><strong>认人不认角色</strong>——按 actor_user_id 归并。' +
      '角色是「以什么身份行使」，人才是责任主体；一人多岗时按角色分会把同一个人拆成三个。</p></section>';

    // 趋势
    out += '<section><h2 class="hd">按日趋势</h2>';
    out += d.trend.length === 0 ? '<div class="empty">还没有数据。</div>' :
      '<div class="card scroll"><table><thead><tr><th>日期</th>' +
      '<th style="text-align:right">建稿</th><th style="text-align:right">当日签发的平均 AI 参与度</th>' +
      '</tr></thead><tbody>' +
      d.trend.map(function (r) {
        var hot = r.signedAiShare != null && r.signedAiShare >= 0.9;
        return '<tr><td>' + esc(r.day) + '</td><td class="num">' + r.manuscripts + '</td>' +
          '<td class="num">' + (r.signedAiShare == null ? '<span class="empty">当日无签发</span>' :
            '<span class="pill ' + (hot ? 'hot' : 'ok') + '">' + pct(r.signedAiShare) + '</span>') +
          '</td></tr>';
      }).join('') + '</tbody></table></div>';
    out += '<p class="note">这条线是给台领导看的：<strong>如果签发时的 AI 参与度长期贴着 100%，' +
      '说明三审三校在走过场。</strong></p></section>';

    // 按稿件下钻
    out += '<section><h2 class="hd">按稿件下钻（AI 参与度）</h2>';
    out += d.shares.length === 0 ? '<div class="empty">还没有稿件。</div>' :
      '<div class="card scroll"><table><thead><tr><th>稿件</th><th>状态</th>' +
      '<th style="text-align:right">句数</th><th style="text-align:right">AI 参与度</th>' +
      '<th style="width:34%">构成</th></tr></thead><tbody>' +
      d.shares.map(function (r) {
        var hot = r.aiShare != null && r.aiShare >= 0.9;
        return '<tr><td class="t"><a class="drill" href="/workbench#' + esc(r.id) + '" title="到工作台看这篇的句级来源">' +
          esc(r.title) + '</a></td>' +
          '<td><span class="pill">' + esc(STATUS[r.status] || r.status) + '</span></td>' +
          '<td class="num">' + r.segmentCount + '</td>' +
          '<td class="num"><span class="pill ' + (hot ? 'hot' : (r.aiShare == null ? '' : 'ok')) + '">' +
          (r.aiShare == null ? '未测量' : pct(r.aiShare)) + '</span></td>' +
          '<td>' + (r.aiShare == null ? '<span class="empty">—</span>' :
            '<span class="track" style="display:block;background:var(--panel-3);border-radius:3px;height:10px;overflow:hidden">' +
            '<i style="display:block;height:100%;width:' + (r.aiShare * 100) + '%;background:' +
            (hot ? 'var(--warn)' : 'var(--accent)') + '"></i></span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    out += '<p class="note">点稿件名到工作台看它的句级来源与责任链。签发时仍接近 100% 的，值得看一眼——那说明三审三校可能没人真看过。</p></section>';

    // 诚实说明缺什么
    out += '<section><h2 class="hd">这一版还没有的</h2><div class="gap">' +
      '<b>报道方向靠手选</b>——不是从通稿自动分类。自动分类要过模型，' +
      '而且分错了会污染统计，归赛后。<br>' +
      '<b>停留时长只在演示环境有意义</b>——这里的流转是连点出来的，不代表真实工时。<br>' +
      '宁可少一个维度，也不让看板显示一个编出来的维度。</div></section>';

    return out;
  }

  function kpi(v, k, tone) {
    return '<div class="kpi ' + (tone || '') + '"><div class="n">' + esc(v) + '</div><div class="k">' + esc(k) + '</div></div>';
  }
  function row2(k, v) {
    return '<tr><td>' + esc(k) + '</td><td class="num">' + esc(v) + '</td></tr>';
  }

  function load() {
    fetch('/api/monitor/overview').then(function (r) {
      // 未登录时后端返 401，正文是错误体不是快照——直接拿去渲染会炸在 reduce 上。
      if (r.status === 401) {
        location.href = '/login?next=' + encodeURIComponent(location.pathname);
        throw new Error('请先登录');
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      document.getElementById('root').innerHTML = render(d);
      document.getElementById('stamp').textContent = '取数 ' + clock(d.generatedAt);
    }).catch(function (e) {
      document.getElementById('root').innerHTML = '<div class="empty">取数失败：' + esc(e.message) + '</div>';
    });
  }

  document.getElementById('refresh').addEventListener('click', load);
  try {
    var es = new EventSource('/events');
    var t = null;
    var bump = function () { clearTimeout(t); t = setTimeout(load, 800); };
    es.addEventListener('workflow', bump);
    es.addEventListener('trace', bump);
    es.addEventListener('manuscript', bump);
  } catch (e) { /* SSE 只是锦上添花 */ }

  load();
})();
</script>
</body>
</html>`;
}
