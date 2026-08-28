// 薄荷监理台 · AuditGate — per-enterprise 安全护栏 policy configuration (dark).
// The settings sibling of the pre-deploy red-team dashboard (./console.ts) and
// the post-deploy runtime monitor (./runtime-view.ts).
//
// Self-contained HTML document: all CSS + JS inline, zero external resources
// (no CDN, no web fonts, no remote images) so it renders offline on congested
// conference WiFi. System fonts only.
//
// Purpose — where an enterprise admin tunes its 安全护栏 policy:
//   1. which built-in 安全护栏 are on and what each does (block / redact / flag)
//   2. a 拦截清单 (deny list), 敏感话题 (sensitive topics), 放行清单 (allow list)
// Changes PUT to /api/policy and take effect on the runtime dashboard.

/** Escape a string for safe interpolation into HTML text/attribute context. */
function escapeHtml(input: string): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The five built-in guardrail categories, in canonical order. Trusted constants. */
const CATEGORIES: Array<{ key: string; name: string }> = [
  { key: 'secret', name: '密钥外泄防护' },
  { key: 'pii', name: '个人信息防护' },
  { key: 'data-leak', name: '机密数据防护' },
  { key: 'injection', name: '提示注入拦截' },
  { key: 'policy-bypass', name: '越权/设定读取' },
];

/**
 * Render the per-enterprise 安全护栏 policy configuration page as a complete
 * HTML document string.
 *
 * Boot: GET /api/policy (a GuardrailPolicy → fills the form) and
 * GET /api/policy/presets ({ presets } → the preset dropdown). Saving PUTs the
 * assembled GuardrailPolicy to /api/policy; switching presets POSTs
 * /api/policy/preset then refills the whole form from the returned policy.
 */
export function renderPolicy(opts: { targetLabel: string }): string {
  const targetLabel = escapeHtml(opts?.targetLabel ?? '');

  const categoryRows = CATEGORIES.map(
    (c) => `        <div class="cat-row" data-key="${c.key}">
          <div class="cat-meta">
            <div class="cat-name">${c.name}</div>
            <div class="cat-key mono">${c.key}</div>
          </div>
          <label class="switch" title="启用 / 停用此安全护栏">
            <input type="checkbox" class="cat-enabled" data-key="${c.key}" aria-label="${c.name} 启用" />
            <span class="track"><span class="thumb"></span></span>
          </label>
          <select class="fld act cat-action" data-key="${c.key}" aria-label="${c.name} 命中动作">
            <option value="block">拦截</option>
            <option value="redact">打码</option>
            <option value="flag">标记</option>
          </select>
        </div>`
  ).join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<title>薄荷监理台 · 安全护栏策略</title>
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
    max-width:340px; min-width:0;
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

  a.navlink {
    font-family:var(--mono); font-size:12px; letter-spacing:.3px;
    color:var(--muted); text-decoration:none;
    padding:8px 12px; border-radius:9px;
    border:1px solid var(--line); background:var(--panel-2);
    transition:color .15s ease, border-color .15s ease, background .15s ease;
    white-space:nowrap;
  }
  a.navlink:hover { color:var(--accent-deep); border-color:rgba(51,214,162,.35); background:#20302A; }

  .pill {
    display:inline-flex; align-items:center; gap:8px;
    font-family:var(--mono); font-size:12px; letter-spacing:.4px;
    padding:7px 13px; border-radius:999px;
    border:1px solid var(--line-strong);
    background:var(--panel-2); color:var(--muted);
    white-space:nowrap; transition:color .2s ease, border-color .2s ease;
  }
  .pill .beacon {
    width:8px; height:8px; border-radius:50%; background:var(--faint);
    box-shadow:0 0 0 3px rgba(108,126,116,.18);
  }
  .pill[data-state="saving"] { color:var(--accent-deep); border-color:rgba(51,214,162,.4); }
  .pill[data-state="saving"] .beacon { background:var(--accent); box-shadow:0 0 0 3px var(--accent-soft); animation:pulse 1.4s ease-in-out infinite; }
  .pill[data-state="done"] { color:var(--accent-deep); border-color:rgba(51,214,162,.4); }
  .pill[data-state="done"] .beacon { background:var(--accent); box-shadow:0 0 0 3px var(--accent-soft); }
  .pill[data-state="error"] { color:#FFC7BD; border-color:rgba(240,112,95,.55); }
  .pill[data-state="error"] .beacon { background:var(--block); box-shadow:0 0 0 3px var(--block-soft); }

  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.35; } }

  /* ---------- Layout: centered single column ---------- */
  .wrap {
    max-width:900px; margin:0 auto;
    padding:22px 22px 56px;
    display:flex; flex-direction:column; gap:16px;
  }

  .lead {
    color:var(--muted); font-size:13px; line-height:1.6;
    max-width:66ch;
  }
  .lead b { color:var(--ink); font-weight:600; }

  .card {
    background:var(--panel);
    border:1px solid var(--line);
    border-radius:var(--radius);
    overflow:hidden;
  }
  .card > .card-head {
    display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;
    padding:13px 18px;
    border-bottom:1px solid var(--line);
    background:linear-gradient(180deg, rgba(24,35,30,.6), transparent);
  }
  .card > .card-head h2 {
    margin:0; font-family:var(--serif); font-size:15px; font-weight:600; letter-spacing:.4px;
  }
  .card > .card-head .en {
    font-family:var(--mono); font-size:10px; color:var(--faint);
    text-transform:uppercase; letter-spacing:1px;
  }
  .card > .card-head .hint {
    margin-left:auto; font-size:12px; color:var(--faint);
  }
  .card > .card-body { padding:16px 18px; display:flex; flex-direction:column; gap:14px; }

  .helper {
    font-size:12px; color:var(--faint); line-height:1.6;
  }
  .helper b { color:var(--muted); font-weight:600; }

  /* ---------- Form fields ---------- */
  label.field-label {
    display:block; font-family:var(--mono); font-size:11px; letter-spacing:.6px;
    text-transform:uppercase; color:var(--faint); margin-bottom:7px;
  }
  .fld {
    font-family:var(--sans); font-size:14px; color:var(--ink);
    background:var(--panel-2);
    border:1px solid var(--line);
    border-radius:10px;
    padding:10px 12px;
    width:100%;
    transition:border-color .15s ease, box-shadow .15s ease, background .15s ease;
    -webkit-appearance:none; appearance:none;
  }
  .fld:focus {
    outline:none;
    border-color:var(--accent);
    box-shadow:0 0 0 3px var(--accent-soft);
    background:#0F1713;
  }
  .fld::placeholder { color:var(--faint); }

  textarea.fld {
    font-family:var(--mono); font-size:13px; line-height:1.7;
    min-height:118px; resize:vertical; white-space:pre; overflow:auto;
  }

  select.fld {
    cursor:pointer;
    background-image:
      linear-gradient(45deg, transparent 50%, var(--muted) 50%),
      linear-gradient(135deg, var(--muted) 50%, transparent 50%);
    background-position:calc(100% - 17px) center, calc(100% - 12px) center;
    background-size:5px 5px, 5px 5px;
    background-repeat:no-repeat;
    padding-right:34px;
  }

  /* Action selects tint by chosen value for quick scanning. */
  select.act[data-act="block"]  { color:#FFC7BD; border-color:rgba(240,112,95,.5);  background-color:var(--block-soft); }
  select.act[data-act="redact"] { color:#F3DDAE; border-color:rgba(224,169,74,.5);  background-color:var(--redact-soft); }
  select.act[data-act="flag"]   { color:var(--muted); }
  select.act option { color:var(--ink); background:var(--panel-2); }

  .enterprise-row {
    display:grid;
    grid-template-columns:minmax(0,1fr) minmax(200px,260px);
    gap:14px; align-items:end;
  }

  /* ---------- Built-in guardrail rows ---------- */
  .cat-list { display:flex; flex-direction:column; }
  .cat-row {
    display:grid;
    grid-template-columns:minmax(0,1fr) auto minmax(96px,124px);
    align-items:center; gap:14px;
    padding:12px 2px;
    border-bottom:1px solid var(--line);
    transition:opacity .18s ease;
  }
  .cat-row:last-child { border-bottom:none; }
  .cat-meta { min-width:0; transition:opacity .18s ease; }
  .cat-name { font-size:14px; font-weight:600; color:var(--ink); }
  .cat-key { font-size:11px; color:var(--faint); letter-spacing:.4px; margin-top:2px; }
  .cat-row.off .cat-meta { opacity:.42; }
  .cat-row.off .cat-action { opacity:.42; }

  /* toggle switch */
  .switch { position:relative; display:inline-flex; align-items:center; cursor:pointer; }
  .switch input { position:absolute; opacity:0; width:0; height:0; }
  .switch .track {
    width:42px; height:24px; border-radius:999px;
    background:var(--panel-2); border:1px solid var(--line-strong);
    display:inline-flex; align-items:center; padding:2px;
    transition:background .18s ease, border-color .18s ease;
  }
  .switch .thumb {
    width:18px; height:18px; border-radius:50%;
    background:var(--faint);
    transition:transform .18s cubic-bezier(.22,.61,.36,1), background .18s ease;
  }
  .switch input:checked + .track {
    background:var(--accent-soft); border-color:rgba(51,214,162,.5);
  }
  .switch input:checked + .track .thumb { transform:translateX(18px); background:var(--accent); }
  .switch input:focus-visible + .track { box-shadow:0 0 0 3px var(--accent-soft); }

  /* ---------- Footer actions ---------- */
  .footer-actions {
    display:flex; align-items:center; gap:16px; flex-wrap:wrap;
    padding-top:2px;
  }
  button.btn {
    font-family:var(--sans); font-size:14px; font-weight:600;
    color:var(--ink);
    padding:11px 22px;
    background:var(--panel-2);
    border:1px solid var(--line-strong);
    border-radius:11px;
    cursor:pointer;
    transition:background .15s ease, border-color .15s ease, transform .06s ease, opacity .15s ease;
    white-space:nowrap;
  }
  button.btn:hover { background:#20302A; border-color:var(--accent); }
  button.btn:active { transform:translateY(1px); }
  button.btn:disabled { opacity:.5; cursor:default; }
  button.btn.primary {
    background:linear-gradient(180deg, rgba(51,214,162,.24), rgba(51,214,162,.12));
    border-color:rgba(51,214,162,.5); color:var(--accent-deep);
  }
  button.btn.primary:hover { background:linear-gradient(180deg, rgba(51,214,162,.32), rgba(51,214,162,.16)); }
  .footer-actions .foot-hint { font-size:12.5px; color:var(--faint); line-height:1.5; }
  .footer-actions .foot-hint b { color:var(--muted); font-weight:600; }

  @media (max-width:640px) {
    .enterprise-row { grid-template-columns:1fr; }
    .cat-row { grid-template-columns:minmax(0,1fr) auto; grid-template-rows:auto auto; }
    .cat-row .cat-action { grid-column:1 / -1; }
    header.topbar { gap:12px; }
    .target-field { max-width:100%; order:3; flex:1 1 100%; }
    .actions { width:100%; }
  }

  @media (prefers-reduced-motion:reduce) {
    * { transition:none !important; animation:none !important; }
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
      <div class="sub">安全护栏策略 · 每企业可配</div>
    </div>
    <div class="target-field" title="配置目标">
      <span class="lbl">配置目标</span>
      <span class="val" id="target-label">${targetLabel}</span>
    </div>
    <div class="actions">
      <a class="navlink" href="/" title="返回采购体检面板">← 采购体检</a>
      <a class="navlink" href="/runtime" title="前往运行时监控">运行时监控 →</a>
      <span class="pill" id="status-pill" data-state="idle"><span class="beacon"></span><span id="status-text">未保存</span></span>
    </div>
  </header>

  <div class="wrap">
    <p class="lead">
      为本企业调校 <b>安全护栏</b>：哪些内置护栏开启、命中后做什么（拦截 / 打码 / 标记），
      再补上 <b>拦截清单</b>、<b>敏感话题</b> 与 <b>放行清单</b>。保存后即刻对运行时生效。
    </p>

    <!-- 企业 row -->
    <section class="card">
      <div class="card-head">
        <h2>企业</h2><span class="en">Enterprise</span>
        <span class="hint">选择预设可一键套用一套策略</span>
      </div>
      <div class="card-body">
        <div class="enterprise-row">
          <div>
            <label class="field-label" for="enterprise-input">企业名称</label>
            <input class="fld" id="enterprise-input" type="text" autocomplete="off"
                   spellcheck="false" placeholder="例如：贵州薄荷教育科技" />
          </div>
          <div>
            <label class="field-label" for="preset-select">策略预设</label>
            <select class="fld" id="preset-select" aria-label="策略预设">
              <option value="">选择预设…</option>
            </select>
          </div>
        </div>
      </div>
    </section>

    <!-- 内置安全护栏 -->
    <section class="card">
      <div class="card-head">
        <h2>内置安全护栏</h2><span class="en">Built-in Safeguards</span>
        <span class="hint">开关 + 命中动作，逐条可调</span>
      </div>
      <div class="card-body">
        <div class="cat-list" id="cat-list">
${categoryRows}
        </div>
        <div class="helper">
          动作含义：<b>拦截</b> 整条响应对用户屏蔽 · <b>打码</b> 掩码敏感片段后放行 · <b>标记</b> 放行但留痕告警。停用的护栏整行变暗。
        </div>
      </div>
    </section>

    <!-- 拦截清单 -->
    <section class="card">
      <div class="card-head">
        <h2>拦截清单</h2><span class="en">Deny List</span>
      </div>
      <div class="card-body">
        <div>
          <label class="field-label" for="deny-terms">拦截词（每行一个）</label>
          <textarea class="fld" id="deny-terms" spellcheck="false" autocomplete="off"
                    placeholder="每行一个词或短语&#10;例如：内部定价&#10;例如：源代码"></textarea>
        </div>
        <div>
          <label class="field-label" for="deny-action">命中动作</label>
          <select class="fld act" id="deny-action" aria-label="拦截清单命中动作">
            <option value="block">拦截</option>
            <option value="redact">打码</option>
            <option value="flag">标记</option>
          </select>
        </div>
        <div class="helper">命中即触发「自定义拦截词」安全护栏。</div>
      </div>
    </section>

    <!-- 敏感话题 -->
    <section class="card">
      <div class="card-head">
        <h2>敏感话题</h2><span class="en">Sensitive Topics</span>
      </div>
      <div class="card-body">
        <div>
          <label class="field-label" for="topic-terms">话题关键词（每行一个）</label>
          <textarea class="fld" id="topic-terms" spellcheck="false" autocomplete="off"
                    placeholder="每行一个话题&#10;例如：裁员&#10;例如：并购"></textarea>
        </div>
        <div>
          <label class="field-label" for="topic-action">命中动作</label>
          <select class="fld act" id="topic-action" aria-label="敏感话题命中动作">
            <option value="block">拦截</option>
            <option value="redact">打码</option>
            <option value="flag">标记</option>
          </select>
        </div>
        <div class="helper">命中即触发「敏感话题」安全护栏。</div>
      </div>
    </section>

    <!-- 放行清单 -->
    <section class="card">
      <div class="card-head">
        <h2>放行清单</h2><span class="en">Allow List</span>
      </div>
      <div class="card-body">
        <div>
          <label class="field-label" for="allow-users">豁免用户（每行一个）</label>
          <textarea class="fld" id="allow-users" spellcheck="false" autocomplete="off"
                    placeholder="每行一个用户标识&#10;例如：ceo@corp&#10;例如：security-lead"></textarea>
        </div>
        <div class="helper">名单内用户豁免拦截 / 打码（降级为标记，仍留痕）。</div>
      </div>
    </section>

    <!-- Footer -->
    <div class="footer-actions">
      <button class="btn primary" id="btn-save" type="button">保存策略</button>
      <span class="foot-hint">保存后到「<b>运行时监控</b>」点「<b>模拟用户使用</b>」查看效果。</span>
    </div>
  </div>

<script>
(function () {
  'use strict';

  var CATS = ['secret', 'pii', 'data-leak', 'injection', 'policy-bypass'];
  var ACTIONS = { block: 1, redact: 1, flag: 1 };

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  var $ = function (id) { return document.getElementById(id); };
  function q(sel) { return document.querySelector(sel); }
  function qa(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function safeAction(a) { return ACTIONS[a] ? a : 'flag'; }

  // Serialize a textarea: one item per line, trimmed, blanks dropped.
  function splitLines(text) {
    if (!text) return [];
    var lines = String(text).split(/\\r?\\n/);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].replace(/^\\s+|\\s+$/g, '');
      if (t) out.push(t);
    }
    return out;
  }
  function joinLines(arr) {
    if (!arr || !arr.length) return '';
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (v === null || v === undefined) continue;
      out.push(String(v));
    }
    return out.join('\\n');
  }

  // ---------- status pill ----------
  var statusPill = $('status-pill');
  var statusText = $('status-text');
  function setStatus(state, message) {
    if (statusPill) statusPill.setAttribute('data-state', String(state || 'idle'));
    if (statusText) statusText.textContent = message == null ? '' : String(message);
  }

  // ---------- action-select tinting ----------
  function tint(sel) {
    if (!sel) return;
    sel.setAttribute('data-act', safeAction(sel.value));
  }
  function tintAll() { qa('select.act').forEach(tint); }

  // ---------- category row dim ----------
  function syncRow(row) {
    if (!row) return;
    var cb = row.querySelector('.cat-enabled');
    if (cb && cb.checked) row.classList.remove('off');
    else row.classList.add('off');
  }
  function syncAllRows() { qa('.cat-row').forEach(syncRow); }

  // ---------- fill the form from a GuardrailPolicy ----------
  function fillForm(policy) {
    if (!policy || typeof policy !== 'object') policy = {};

    var entInput = $('enterprise-input');
    if (entInput) entInput.value = policy.enterprise ? String(policy.enterprise) : '';

    var rules = (policy.rules && typeof policy.rules === 'object') ? policy.rules : {};
    for (var i = 0; i < CATS.length; i++) {
      var key = CATS[i];
      var rule = (rules[key] && typeof rules[key] === 'object') ? rules[key] : {};
      var cb = q('.cat-enabled[data-key="' + key + '"]');
      var sel = q('.cat-action[data-key="' + key + '"]');
      if (cb) cb.checked = rule.enabled !== false; // default on if unspecified
      if (sel) sel.value = safeAction(rule.action);
    }

    var denyTerms = $('deny-terms');
    if (denyTerms) denyTerms.value = joinLines(policy.denyTerms);
    var denyAction = $('deny-action');
    if (denyAction) denyAction.value = safeAction(policy.denyAction);

    var topicTerms = $('topic-terms');
    if (topicTerms) topicTerms.value = joinLines(policy.sensitiveTopics);
    var topicAction = $('topic-action');
    if (topicAction) topicAction.value = safeAction(policy.topicAction);

    var allowUsers = $('allow-users');
    if (allowUsers) allowUsers.value = joinLines(policy.allowUsers);

    tintAll();
    syncAllRows();
  }

  // ---------- assemble a GuardrailPolicy from the form ----------
  function readForm() {
    var entInput = $('enterprise-input');
    var rules = {};
    for (var i = 0; i < CATS.length; i++) {
      var key = CATS[i];
      var cb = q('.cat-enabled[data-key="' + key + '"]');
      var sel = q('.cat-action[data-key="' + key + '"]');
      rules[key] = {
        enabled: cb ? !!cb.checked : true,
        action: safeAction(sel ? sel.value : 'flag')
      };
    }
    return {
      enterprise: entInput ? entInput.value.replace(/^\\s+|\\s+$/g, '') : '',
      rules: rules,
      denyTerms: splitLines($('deny-terms') ? $('deny-terms').value : ''),
      denyAction: safeAction($('deny-action') ? $('deny-action').value : 'flag'),
      sensitiveTopics: splitLines($('topic-terms') ? $('topic-terms').value : ''),
      topicAction: safeAction($('topic-action') ? $('topic-action').value : 'flag'),
      allowUsers: splitLines($('allow-users') ? $('allow-users').value : '')
    };
  }

  // ---------- network (all wrapped, never throws) ----------
  function parseJson(raw) {
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  function getJson(url) {
    return fetch(url, { headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (t) { return t == null ? null : parseJson(t); })
      .catch(function () { return null; });
  }
  function sendJson(method, url, body) {
    var payload;
    try { payload = JSON.stringify(body); } catch (e) { payload = '{}'; }
    return fetch(url, {
      method: method,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: payload
    })
      .then(function (r) {
        return r.text().then(function (t) {
          return { ok: r.ok, data: t == null ? null : parseJson(t) };
        });
      })
      .catch(function () { return { ok: false, data: null }; });
  }

  // ---------- boot loads ----------
  function loadPolicy() {
    return getJson('/api/policy').then(function (p) {
      if (p) { try { fillForm(p); } catch (e) {} }
    });
  }

  function loadPresets() {
    return getJson('/api/policy/presets').then(function (res) {
      var sel = $('preset-select');
      if (!sel) return;
      var names = (res && res.presets && res.presets.length) ? res.presets : [];
      // keep the leading placeholder <option value="">
      while (sel.options.length > 1) sel.remove(1);
      for (var i = 0; i < names.length; i++) {
        var name = names[i];
        if (name === null || name === undefined) continue;
        var opt = document.createElement('option');
        opt.value = String(name);
        opt.textContent = String(name);
        sel.appendChild(opt);
      }
    });
  }

  // ---------- save ----------
  var btnSave = $('btn-save');
  function save() {
    if (btnSave) btnSave.disabled = true;
    setStatus('saving', '保存中…');
    var policy = readForm();
    sendJson('PUT', '/api/policy', policy).then(function (res) {
      if (btnSave) btnSave.disabled = false;
      if (res && res.ok && res.data && res.data.ok) {
        if (res.data.policy) { try { fillForm(res.data.policy); } catch (e) {} }
        setStatus('done', '已保存');
      } else {
        setStatus('error', '保存失败，请重试');
      }
    });
  }

  // ---------- preset switch ----------
  function applyPreset(name) {
    if (!name) return;
    setStatus('saving', '套用预设…');
    sendJson('POST', '/api/policy/preset', { name: name }).then(function (res) {
      if (res && res.ok && res.data && res.data.ok && res.data.policy) {
        try { fillForm(res.data.policy); } catch (e) {}
        setStatus('done', '已套用「' + name + '」');
      } else {
        setStatus('error', '套用失败');
      }
    });
  }

  // ---------- wire events ----------
  qa('select.act').forEach(function (sel) {
    sel.addEventListener('change', function () { tint(sel); setStatus('idle', '未保存'); });
  });
  qa('.cat-enabled').forEach(function (cb) {
    cb.addEventListener('change', function () {
      var row = cb.closest ? cb.closest('.cat-row') : null;
      syncRow(row);
      setStatus('idle', '未保存');
    });
  });
  qa('#enterprise-input, #deny-terms, #topic-terms, #allow-users').forEach(function (elm) {
    elm.addEventListener('input', function () { setStatus('idle', '未保存'); });
  });
  var presetSel = $('preset-select');
  if (presetSel) {
    presetSel.addEventListener('change', function () {
      var name = presetSel.value;
      if (name) applyPreset(name);
    });
  }
  if (btnSave) btnSave.addEventListener('click', save);

  // ---------- initial paint + boot ----------
  tintAll();
  syncAllRows();
  loadPolicy();
  loadPresets();
})();
</script>
</body>
</html>`;
}
