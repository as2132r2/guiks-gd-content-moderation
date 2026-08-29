// 把关人 · 产品介绍首页（landing page）。
//
// 这是访客看到的第一屏，所以它必须公开——挂鉴权等于让人先看登录框，再去猜这东西
// 是干什么的。`/` 是介绍，`/workbench` 才是干活的地方。
//
// Self-contained HTML: CSS inline, zero external resources（无 CDN、无网络字体、
// 无远程图片），与工作台和监控看板同一条纪律——会场断网也要能开。
//
// 文案口径不自创：三句话取自 docs/gatekeeper/plan.md 第〇节，能力描述取自
// docs/deploy/user-manual.md。改文案前先读那两份，别在这里另起一套说法。

export function renderLanding(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<meta name="description" content="把关人 · 融媒体中心的稿件生产与监理系统。把三审三校里机械的校对自动化、判断留给人、每一步留痕。" />
<title>把关人 · 融媒体中心稿件生产与监理</title>
<style>
  :root {
    --bg:#0E1512; --panel:#141D19; --panel-2:#18231E; --panel-3:#1D2A24;
    /* --faint 比工作台的 #6C7E74 亮一档：那边是密集操作界面，这里是给访客读的
       长句说明，设计系统要求辅助文字对比度不低于 4.5:1（#6C7E74 只有 4.2:1）。 */
    --ink:#E9F0EB; --muted:#9DB0A5; --faint:#7A8D82;
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
  html,body { margin:0; padding:0; }
  body {
    background:var(--bg); color:var(--ink); font-family:var(--sans);
    font-size:15px; line-height:1.7; -webkit-font-smoothing:antialiased;
  }
  a { color:inherit; }
  .mono { font-family:var(--mono); font-variant-numeric:tabular-nums; }
  :focus-visible { outline:3px solid var(--accent); outline-offset:2px; }

  /* ---------- Header ---------- */
  header.topbar {
    display:flex; align-items:center; gap:18px; flex-wrap:wrap;
    padding:12px 22px; border-bottom:1px solid var(--line-strong); background:var(--panel);
    position:sticky; top:0; z-index:5;
  }
  .brand { display:flex; flex-direction:column; gap:1px; }
  .brand .name { font-family:var(--serif); font-size:19px; font-weight:600; display:flex; align-items:center; gap:10px; }
  .brand .name .dot { width:9px; height:9px; border-radius:50%; background:var(--accent); box-shadow:0 0 0 4px var(--accent-soft); }
  .brand .sub { font-family:var(--mono); font-size:11px; letter-spacing:.6px; color:var(--faint); }
  .demo-badge { font-size:11px; color:var(--warn); border:1px dashed var(--warn); border-radius:6px; padding:3px 9px; background:var(--warn-soft); }
  .nav { margin-left:auto; display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  .nav a {
    font-size:13px; color:var(--muted); text-decoration:none;
    padding:7px 14px; background:var(--panel-2); border:1px solid var(--line); border-radius:9px;
    transition:border-color .16s ease, color .16s ease;
  }
  .nav a:hover { border-color:var(--accent); color:var(--ink); }
  .nav a.primary { background:var(--accent-soft); border-color:var(--accent); color:var(--accent-deep); font-weight:600; }
  .nav a.primary:hover { background:var(--accent); color:#08140F; }

  /* ---------- Layout ---------- */
  main { max-width:1180px; margin:0 auto; padding:22px 22px 8px; display:flex; flex-direction:column; gap:48px; }
  section { display:flex; flex-direction:column; }
  h2.hd {
    font-size:11px; font-family:var(--mono); letter-spacing:.8px; color:var(--faint);
    text-transform:uppercase; margin:0 0 14px; font-weight:500;
  }
  .note { font-size:13px; color:var(--faint); margin:12px 0 0; }

  /* ---------- Hero ---------- */
  .hero { padding:28px 0 44px; border-bottom:1px solid var(--line); }
  .hero .eyebrow { font-family:var(--mono); font-size:12px; letter-spacing:.7px; color:var(--accent); margin:0 0 14px; }
  .hero h1 {
    font-family:var(--serif); font-size:54px; line-height:1.22; margin:0 0 20px;
    font-weight:600; letter-spacing:.01em; max-width:16em;
  }
  .hero .lede { font-size:20px; line-height:1.75; margin:0 0 14px; max-width:34em; }
  .hero .body { font-size:16px; line-height:1.85; color:var(--muted); margin:0; max-width:40em; }
  .hero .body strong { color:var(--ink); font-weight:600; }

  .cta { display:flex; gap:16px; align-items:stretch; flex-wrap:wrap; margin-top:30px; }
  .btn {
    display:inline-flex; align-items:center; justify-content:center; gap:8px;
    font-size:18px; font-weight:600; text-decoration:none; white-space:nowrap;
    padding:15px 32px; border-radius:10px; border:2px solid var(--accent);
    background:var(--accent); color:#08140F;
    transition:background .16s ease, color .16s ease, border-color .16s ease;
  }
  .btn:hover { background:var(--accent-deep); border-color:var(--accent-deep); }
  .btn.ghost { background:transparent; color:var(--accent-deep); border-color:var(--line-strong); font-size:16px; padding:15px 24px; }
  .btn.ghost:hover { background:var(--panel-2); border-color:var(--accent); }
  .cred {
    display:flex; flex-direction:column; justify-content:center; gap:3px;
    border:1px solid var(--line-strong); border-radius:10px; padding:10px 18px; background:var(--panel);
  }
  .cred .line { font-size:15px; }
  .cred .line b { font-family:var(--mono); color:var(--accent-deep); font-weight:600; letter-spacing:.02em; }
  .cred .hint { font-size:12.5px; color:var(--faint); }
  .secondary-links { display:flex; gap:12px; flex-wrap:wrap; margin-top:16px; }

  /* ---------- 因果三段 ---------- */
  .because { display:grid; grid-template-columns:repeat(3,1fr); gap:1px; background:var(--line); border:1px solid var(--line); border-radius:var(--radius); overflow:hidden; }
  .because .step { background:var(--panel); padding:20px; display:flex; flex-direction:column; gap:8px; }
  .because .step .k { font-family:var(--mono); font-size:11px; letter-spacing:.7px; color:var(--faint); }
  .because .step h3 { margin:0; font-size:19px; font-weight:600; }
  .because .step p { margin:0; font-size:14px; color:var(--muted); line-height:1.75; }
  .because .step:last-child { background:var(--panel-2); }
  .because .step:last-child h3 { color:var(--accent-deep); }
  .claim { margin:16px 0 0; font-size:15px; color:var(--muted); }
  .claim strong { color:var(--ink); }

  /* ---------- 六步主链 ---------- */
  .chain { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }
  .chain .stage { background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); padding:16px 18px; display:flex; flex-direction:column; gap:7px; }
  .chain .stage .n { font-family:var(--mono); font-size:12px; color:var(--accent); letter-spacing:.6px; }
  .chain .stage h3 { margin:0; font-size:17px; font-weight:600; }
  .chain .stage p { margin:0; font-size:13.5px; color:var(--muted); line-height:1.7; }

  /* ---------- 入口准入三档 ---------- */
  .tiers { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }
  .tier { background:var(--panel); border:1px solid var(--line); border-left-width:3px; border-radius:var(--radius); padding:16px 18px; display:flex; flex-direction:column; gap:9px; }
  .tier .tag { align-self:flex-start; font-family:var(--mono); font-size:11.5px; letter-spacing:.5px; padding:2px 9px; border-radius:5px; border:1px solid; }
  .tier h3 { margin:0; font-size:17px; font-weight:600; }
  .tier p { margin:0; font-size:13.5px; color:var(--muted); line-height:1.75; }
  .tier.block { border-left-color:var(--block); }
  .tier.block .tag { color:var(--block); border-color:var(--block); background:var(--block-soft); }
  .tier.warn { border-left-color:var(--warn); }
  .tier.warn .tag { color:var(--warn); border-color:var(--warn); background:var(--warn-soft); }
  .tier.pass { border-left-color:var(--accent); }
  .tier.pass .tag { color:var(--accent); border-color:var(--accent); background:var(--accent-soft); }
  .tier .zero { margin-top:auto; font-family:var(--mono); font-size:12.5px; color:var(--block); background:var(--block-soft); border:1px solid var(--block); border-radius:6px; padding:6px 9px; }
  .aside-tier { margin-top:14px; background:var(--panel-2); border:1px solid var(--line); border-radius:var(--radius); padding:14px 18px; font-size:13.5px; color:var(--muted); }
  .aside-tier b { color:var(--ink); }

  /* ---------- 句级来源与 AI 参与度 ---------- */
  .signature { display:grid; grid-template-columns:1.1fr .9fr; gap:20px; align-items:start; }
  .signature .prose h3 { margin:0 0 12px; font-size:26px; font-family:var(--serif); font-weight:600; line-height:1.45; }
  .signature .prose p { margin:0 0 12px; font-size:15px; color:var(--muted); line-height:1.85; }
  .signature .prose p strong { color:var(--ink); }
  .signature .prose p:last-child { margin-bottom:0; }

  .demo-panel { background:var(--panel); border:1px solid var(--line-strong); border-radius:var(--radius); padding:18px 20px; }
  .demo-panel .cap { font-family:var(--mono); font-size:11px; letter-spacing:.7px; color:var(--faint); margin-bottom:12px; }
  .strip { display:flex; gap:3px; margin-bottom:6px; }
  .strip i { flex:1; height:26px; border-radius:3px; display:block; }
  .strip i.ai { background:var(--ai); }
  .strip i.edited { background:var(--ai-edited); }
  .strip i.human { background:var(--human); }
  .strip i.source { background:var(--source); }
  .strip-label { font-size:12.5px; color:var(--faint); display:flex; justify-content:space-between; gap:10px; margin-bottom:18px; flex-wrap:wrap; }
  .strip-label b { font-family:var(--mono); color:var(--ink); font-variant-numeric:tabular-nums; }
  .strip-label b.drop { color:var(--accent-deep); }
  .legend { display:flex; flex-wrap:wrap; gap:10px 16px; border-top:1px solid var(--line); padding-top:14px; }
  .legend span { display:flex; align-items:center; gap:7px; font-size:12.5px; color:var(--muted); }
  .legend span i { width:11px; height:11px; border-radius:3px; display:block; }

  /* ---------- 明确不做 ---------- */
  .scope ul { margin:0; padding:0; list-style:none; display:grid; grid-template-columns:repeat(2,1fr); gap:9px 24px; }
  .scope li { font-size:14px; color:var(--muted); padding-left:20px; position:relative; line-height:1.7; }
  .scope li::before { content:'—'; position:absolute; left:0; color:var(--faint); }
  .scope li b { color:var(--ink); font-weight:600; }

  /* ---------- 底部行动 ---------- */
  .tail {
    background:var(--panel); border:1px solid var(--line-strong); border-radius:var(--radius);
    padding:30px 32px; display:flex; gap:24px; align-items:center; justify-content:space-between; flex-wrap:wrap;
  }
  .tail h3 { margin:0 0 6px; font-size:24px; font-family:var(--serif); font-weight:600; }
  .tail p { margin:0; font-size:14px; color:var(--muted); }

  footer {
    max-width:1180px; margin:44px auto 0; padding:26px 22px 40px;
    border-top:1px solid var(--line);
    font-size:12.5px; color:var(--faint); display:flex; flex-direction:column; gap:6px;
  }
  footer strong { color:var(--muted); }

  /* ---------- 响应式 ---------- */
  @media (max-width:1179px) {
    .signature { grid-template-columns:1fr; }
    .chain, .because, .tiers { grid-template-columns:repeat(2,1fr); }
    .hero h1 { font-size:44px; }
  }
  @media (max-width:768px) {
    main { gap:36px; padding:18px 16px 8px; }
    .chain, .because, .tiers, .scope ul { grid-template-columns:1fr; }
    .hero h1 { font-size:32px; }
    .hero .lede { font-size:17px; }
    .cta { flex-direction:column; align-items:stretch; }
    .btn { width:100%; }
    .tail { padding:24px 22px; }
  }
  @media (prefers-reduced-motion:reduce) {
    * { transition-duration:.01ms !important; animation-duration:.01ms !important; }
  }
</style>
</head>
<body>

<header class="topbar">
  <div class="brand">
    <div class="name"><span class="dot"></span>把关人</div>
    <div class="sub">融媒体中心 · 稿件生产与监理</div>
  </div>
  <span class="demo-badge">模拟 / 脱敏演示环境</span>
  <nav class="nav">
    <a href="/monitor">全流程监控看板</a>
    <a class="primary" href="/workbench">进入试用</a>
  </nav>
</header>

<main>

  <section class="hero">
    <p class="eyebrow">让 AI 写的稿子，敢发出去。</p>
    <h1>无监管，无审核，不AI！</h1>
    <p class="lede">AI 可以写，但署名的是人。稿子出了事，追的是责任人，不是模型。</p>
    <p class="body">
      监管防的是<strong>人滥用 AI</strong>，审核保的是<strong>AI 写的稿子能合规发出去</strong>，
      留痕定的是<strong>出了事谁负责</strong>。三样立住，AI 才敢放开用——一条六步主链，
      从粘贴通稿到签发追溯，十分钟能走完一遍。
    </p>

    <div class="cta">
      <a class="btn" href="/workbench">进入试用</a>
      <div class="cred">
        <div class="line">试用账号 <b>zhangmin</b>　密码 <b>gatekeeper-demo</b></div>
        <div class="hint">这个账号一人持有编辑 / 部门主任 / 分管领导三个角色，可以独自走完全流程。</div>
      </div>
    </div>
    <div class="secondary-links">
      <a class="btn ghost" href="/monitor">看全流程监控看板</a>
    </div>
  </section>

  <section>
    <h2 class="hd">为什么是因果，不是并列</h2>
    <div class="because">
      <div class="step">
        <span class="k">01 · 提速</span>
        <h3>一天五篇变成一天五十篇</h3>
        <p>AI 让稿件生产提速十倍。台里原来一天五篇，三审审得过来。</p>
      </div>
      <div class="step">
        <span class="k">02 · 瓶颈</span>
        <h3>审核当场成瓶颈</h3>
        <p>三审三校还是那几个人。要么卡死，AI 白提速；要么放水，出播出差错。</p>
      </div>
      <div class="step">
        <span class="k">03 · 所以</span>
        <h3>机械校对自动化，判断留给人</h3>
        <p>每一步留痕。审核跟得上生产的速度，提速出来的产能才真的能发出去。</p>
      </div>
    </div>
    <p class="claim">
      监控不是额外加的一层成本，是<strong>产能释放的前提</strong>——拆掉它，AI 提速这件事不成立。
    </p>
  </section>

  <section>
    <h2 class="hd">六步主链</h2>
    <div class="chain">
      <div class="stage">
        <span class="n">① 素材入口</span>
        <h3>粘贴或上传原通稿</h3>
        <p>标明素材类型与报道方向。原通稿全程留在同屏，是后面所有事实比对的底稿。</p>
      </div>
      <div class="stage">
        <span class="n">② 入口准入</span>
        <h3>先判定这次调用该不该发生</h3>
        <p>判的不是词，是这次调用。三档处置，硬拦那一档模型完全不碰。</p>
      </div>
      <div class="stage">
        <span class="n">③ 稿件生成</span>
        <h3>一份通稿，两份产物</h3>
        <p>同时产出播报稿与短视频文案，并逐句记下这一句是谁写的。</p>
      </div>
      <div class="stage">
        <span class="n">④ 输出预检</span>
        <h3>禁用词、领导表述、事实比对</h3>
        <p>与原通稿逐项核人名、职务、地名、数字、日期，AI 生成内容标识按《标识办法》自动补上。产出是标注，不是闸门——人少，阻断就是卡死。</p>
      </div>
      <div class="stage">
        <span class="n">⑤ 三审三校</span>
        <h3>初审一校 · 复审二校 · 终审三校</h3>
        <p>每一级卡片上写着这一级该看什么。退回必须写理由，真的改过一句才能重新预检。</p>
      </div>
      <div class="stage">
        <span class="n">⑥ AI 参与度追溯</span>
        <h3>签发之后说得清</h3>
        <p>签发卡、参与度折线、句级来源图谱、责任链、规则命中，五块一屏看完。</p>
      </div>
    </div>
  </section>

  <section>
    <h2 class="hd">入口准入 · 三档处置</h2>
    <div class="tiers">
      <div class="tier block">
        <span class="tag">硬拦</span>
        <h3>不给调用</h3>
        <p>不予受理，模型完全不碰。输出侧拦截的时候 token 已经烧了、内容已经生成了只是没给你看；输入侧拦掉，什么都没发生。</p>
        <div class="zero">模型调用 0 次 / 0 tokens / 无内容产生</div>
      </div>
      <div class="tier warn">
        <span class="tag">要理由</span>
        <h3>不拦，但要一个选题依据</h3>
        <p>编辑的日常工作就是处理敏感题材——事故通报、涉诉纠纷。一刀切拦掉，系统当场就没法用了。填一句依据即放行，责任落到人头上。</p>
      </div>
      <div class="tier pass">
        <span class="tag">仅留痕</span>
        <h3>常规选题直接放行</h3>
        <p>不打断编辑，但这次调用进审计——谁、什么时候、用哪个模型、花了多少 token，都记着。</p>
      </div>
    </div>
    <p class="aside-tier">
      另有<b>非业务用途识别</b>：不违法所以不拦，只标一笔，进使用情况报表。公器私用是事业单位极其敏感的一条，值得单列。
    </p>
  </section>

  <section class="signature">
    <div class="prose">
      <h2 class="hd">核心：句级来源标记</h2>
      <h3>每一句都记着是 AI 写的，还是人写的</h3>
      <p>
        每句话标记四种来源之一：<strong>AI 原样、人改过、人新写、原文引用</strong>。
        每次流转重算一次比例，得到这一稿的 <strong>AI 参与度</strong>。
      </p>
      <p>
        这个数字不是自己填的。系统逐句比对上一版，自动判定哪几句被人改过——
        <strong>被考核的人不能是这个数字的来源</strong>，否则它什么也测不到。
      </p>
      <p>
        签发时若仍接近 100%，说明这一路三审三校<strong>没人真看过</strong>。
        别的审校产品给不出这个数字，因为它们只看得见成品，看不见生产过程。
      </p>
    </div>
    <div class="demo-panel">
      <div class="cap">句级来源图谱 · 一格是一句话</div>
      <div class="strip">
        <i class="ai"></i><i class="ai"></i><i class="ai"></i><i class="ai"></i><i class="ai"></i>
        <i class="ai"></i><i class="ai"></i><i class="ai"></i><i class="ai"></i>
      </div>
      <div class="strip-label"><span>生成后 · 9 句全部由 AI 写</span><b>AI 参与度 100%</b></div>
      <div class="strip">
        <i class="ai"></i><i class="edited"></i><i class="ai"></i><i class="ai"></i><i class="edited"></i>
        <i class="ai"></i><i class="human"></i><i class="ai"></i><i class="source"></i>
      </div>
      <div class="strip-label"><span>编辑改过两句、新写一句、引用原文一句之后</span><b class="drop">AI 参与度 66.7%</b></div>
      <div class="legend">
        <span><i class="ai"></i>AI 原样</span>
        <span><i class="edited"></i>人改过</span>
        <span><i class="human"></i>人新写</span>
        <span><i class="source"></i>原文引用</span>
      </div>
      <p class="note">算法：（AI 原样 + 人改过 × 0.5）÷ 总句数。上图 9 句里 5 句 AI 原样、2 句人改过，即 6 ÷ 9。</p>
    </div>
  </section>

  <section class="scope">
    <h2 class="hd">这一版明确不做</h2>
    <ul>
      <li>不做内容采集，只<b>粘贴 / 上传</b></li>
      <li>不做多平台真实发布，按钮只演示状态变化</li>
      <li>不做电子签章</li>
      <li>不做权限配置界面，角色与权限是<b>代码内固定组合</b></li>
      <li>不做图片 / 视频审核</li>
      <li>模型判断层<b>只标不拦</b>，一律输出「待人工复核」，不给自动终审结论</li>
    </ul>
    <p class="note">主动说明，比被问出来强。</p>
  </section>

  <section>
    <div class="tail">
      <div>
        <h3>十分钟走一遍整条链路</h3>
        <p>不需要看代码，也不需要装任何东西。用 <span class="mono">zhangmin</span> / <span class="mono">gatekeeper-demo</span> 登录，左栏已有 7 篇准备好的稿件。</p>
      </div>
      <a class="btn" href="/workbench">进入试用</a>
    </div>
  </section>

</main>

<footer>
  <div>演示环境里的稿件、人名、地名、数字<strong>全部是模拟 / 脱敏素材</strong>，不对应任何真实机构或个人。</div>
  <div>页面零外部资源（无 CDN、无网络字体、无远程图片），会场断网也能打开。</div>
  <div class="mono">guiks-gd-content-moderation</div>
</footer>

</body>
</html>`;
}
