export const themeStorageKey = 'gatekeeper.theme.v1';

export const themeIds = ['mono', 'warm', 'glass'] as const;
export type ThemeId = (typeof themeIds)[number];

export const themes: Readonly<Record<ThemeId, { label: string; description: string }>> = {
  mono: { label: '经典黑白', description: '纯白、冷灰、深黑' },
  warm: { label: '纸质暖白', description: '暖白书页、柔和护眼' },
  glass: { label: '液态玻璃', description: '深黑玻璃、浅色高光' },
};

export function normalizeTheme(value: unknown): ThemeId {
  return typeof value === 'string' && (themeIds as readonly string[]).includes(value)
    ? value as ThemeId
    : 'mono';
}

export const themeStyles = `
html { color-scheme: light; }
html { --theme-sans:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; --sans:var(--theme-sans); --serif:var(--theme-sans); }
html[data-theme="mono"] {
  --bg:#f5f5f7; --bg-effect:#f5f5f7; --panel:#fff; --panel-solid:#fff; --panel-2:#f5f5f7; --panel-3:#e8e8ed;
  --ink:#1d1d1f; --muted:#626267; --faint:#6e6e73; --line:rgba(0,0,0,.10); --line-strong:rgba(0,0,0,.20);
  --accent:#1d1d1f; --accent-deep:#1d1d1f; --accent-soft:rgba(29,29,31,.09); --on-accent:#fff; --brand-bg:#000; --brand-ink:#fff;
  --block:#a13f38; --block-soft:rgba(161,63,56,.11); --warn:#80601c; --warn-soft:rgba(128,96,28,.11);
  --info:#426988; --info-soft:rgba(66,105,136,.11); --ai:#426988; --ai-edited:#566d5b; --human:#8a5e26; --source:#6a6a66;
  --shadow:0 18px 55px rgba(0,0,0,.075); --shadow-soft:0 7px 24px rgba(0,0,0,.05); --theme-blur:none;
}
html[data-theme="warm"] {
  --bg:#f7f3ec; --bg-effect:#f7f3ec; --panel:#fffdf8; --panel-solid:#fffdf8; --panel-2:#f8f3ea; --panel-3:#eee6da;
  --ink:#282622; --muted:#5f5a52; --faint:#736c62; --line:rgba(72,59,44,.11); --line-strong:rgba(72,59,44,.20);
  --accent:#676057; --accent-deep:#544e46; --accent-soft:rgba(103,96,87,.10); --on-accent:#fffdf8; --brand-bg:#595148; --brand-ink:#fffdf8;
  --block:#99463a; --block-soft:rgba(153,70,58,.11); --warn:#7a5516; --warn-soft:rgba(122,85,22,.12);
  --info:#476a82; --info-soft:rgba(71,106,130,.12); --ai:#476a82; --ai-edited:#536d54; --human:#855b28; --source:#766b5d;
  --shadow:0 16px 42px rgba(70,56,38,.07); --shadow-soft:0 6px 18px rgba(70,56,38,.045); --theme-blur:none;
}
html[data-theme="warm"] .doc .body, html[data-theme="warm"] .card p { line-height:1.8; }
html[data-theme="glass"] {
  color-scheme: dark;
  --bg:#08090d; --bg-effect:radial-gradient(circle at 14% -12%,rgba(136,157,238,.22),transparent 34%),radial-gradient(circle at 92% 8%,rgba(113,196,204,.14),transparent 27%),radial-gradient(circle at 48% 110%,rgba(160,116,222,.12),transparent 34%),#08090d; --panel:rgba(25,27,35,.74); --panel-solid:#191b23; --panel-2:rgba(255,255,255,.065); --panel-3:rgba(255,255,255,.105);
  --ink:#f1f3f7; --muted:#b2b7c1; --faint:#858b97; --line:rgba(255,255,255,.105); --line-strong:rgba(255,255,255,.18);
  --accent:#b8c5f3; --accent-deep:#e8ebf3; --accent-soft:rgba(184,197,243,.14); --on-accent:#101116; --brand-bg:linear-gradient(145deg,rgba(184,197,243,.16),rgba(25,27,35,.90)); --brand-ink:#f1f3f7;
  --block:#e38f89; --block-soft:rgba(227,143,137,.12); --warn:#d9b276; --warn-soft:rgba(217,178,118,.13);
  --info:#9dbbe2; --info-soft:rgba(157,187,226,.12); --ai:#9dbbe2; --ai-edited:#a3c6aa; --human:#d9b276; --source:#8d93a0;
  --shadow:0 28px 90px rgba(0,0,0,.46); --shadow-soft:0 14px 40px rgba(0,0,0,.22); --theme-blur:blur(22px) saturate(140%);
}
body { background:var(--bg-effect); }
header.topbar { position:relative; z-index:10; }
body,header.topbar,aside,.card,.doc,.signoff,.theme-trigger,.theme-popover,input,textarea,select,button.btn,.role-btn,.persona { transition:background-color .24s ease,border-color .24s ease,color .24s ease,box-shadow .24s ease; }
html[data-theme="glass"] header.topbar, html[data-theme="glass"] .card, html[data-theme="glass"] aside, html[data-theme="glass"] .theme-popover { backdrop-filter:var(--theme-blur); -webkit-backdrop-filter:var(--theme-blur); }
.theme-wrap { position:relative; }
.theme-trigger { display:inline-flex; align-items:center; gap:7px; font:inherit; font-size:13px; color:var(--muted); padding:7px 12px; background:var(--panel-2); border:1px solid var(--line); border-radius:9px; cursor:pointer; }
.theme-trigger:hover, .theme-trigger:focus-visible { color:var(--ink); border-color:var(--accent); }
.theme-swatch { width:13px; height:13px; border-radius:50%; border:1px solid var(--line-strong); background:linear-gradient(135deg,var(--bg) 0 48%,var(--ink) 50% 100%); }
.theme-popover { position:absolute; z-index:50; top:calc(100% + 10px); right:0; width:min(350px,88vw); padding:12px; color:var(--ink); background:var(--panel-solid); border:1px solid var(--line-strong); border-radius:15px; box-shadow:var(--shadow); transform-origin:90% 0; opacity:0; visibility:hidden; transform:translateY(-7px) scale(.975); transition:opacity 180ms ease,transform 180ms cubic-bezier(.16,1,.3,1),visibility 0s linear 180ms; }
.theme-popover.open { opacity:1; visibility:visible; transform:translateY(0) scale(1); transition-delay:0s; }
.theme-popover h2 { margin:0 0 10px; font-size:13px; font-weight:600; }
.theme-options { display:grid; gap:8px; }
.theme-option { display:grid; grid-template-columns:64px 1fr 20px; align-items:center; gap:11px; width:100%; min-height:58px; padding:8px; color:inherit; text-align:left; background:transparent; border:1px solid var(--line); border-radius:11px; cursor:pointer; opacity:0; transform:translateY(-4px); transition:background-color 160ms ease,border-color 160ms ease,transform 180ms ease,opacity 180ms ease; }
.theme-popover.open .theme-option { opacity:1; transform:translateY(0); }
.theme-popover.open .theme-option:nth-child(2) { transition-delay:24ms; }.theme-popover.open .theme-option:nth-child(3) { transition-delay:48ms; }
.theme-option:hover, .theme-option:focus-visible { background:var(--panel-2); border-color:var(--line-strong); }.theme-option[aria-pressed="true"] { border-color:var(--accent); background:var(--accent-soft); }
.theme-preview { height:40px; border:1px solid rgba(127,127,127,.3); border-radius:8px; padding:6px; display:grid; grid-template-columns:14px 1fr; gap:5px; overflow:hidden; }.theme-preview i { display:block; border-radius:3px; }.theme-preview span { display:grid; gap:3px; }.theme-preview span i:first-child { height:7px; }.theme-preview span i:last-child { height:15px; }
.theme-preview.mono { background:#f5f5f7; }.theme-preview.mono > i { background:#000; }.theme-preview.mono span i { background:#d2d2d7; }.theme-preview.warm { background:#f7f3ec; }.theme-preview.warm > i { background:#676057; }.theme-preview.warm span i { background:#e4dbce; }.theme-preview.glass { background:linear-gradient(135deg,#1a1d2c,#08090d 65%); }.theme-preview.glass > i { background:#cbd4f1; }.theme-preview.glass span i { background:rgba(255,255,255,.14); }
.theme-copy strong,.theme-copy span { display:block; }.theme-copy span { margin-top:2px; color:var(--muted); font-size:11px; }.theme-check { color:var(--accent); font-size:16px; opacity:0; }.theme-option[aria-pressed="true"] .theme-check { opacity:1; }
@media (prefers-reduced-motion:reduce) {
  body,header.topbar,aside,.card,.doc,.signoff,.theme-trigger,.theme-popover,input,textarea,select,button.btn,.role-btn,.persona,.theme-option {
    transition-duration:.001ms !important; animation-duration:.001ms !important; animation-delay:0ms !important;
  }
}
@supports not ((backdrop-filter:blur(2px)) or (-webkit-backdrop-filter:blur(2px))) { html[data-theme="glass"] { --panel:#191b23; --panel-2:#252832; } }
`;

export function renderThemeControl(): string {
  return `<div class="theme-wrap"><button class="theme-trigger" id="theme-trigger" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="theme-popover"><span class="theme-swatch" aria-hidden="true"></span><span>主题</span></button><div class="theme-popover" id="theme-popover" role="dialog" aria-label="选择界面主题" aria-hidden="true"><h2>选择界面主题</h2><div class="theme-options">${themeIds.map((id) => `<button class="theme-option" type="button" data-set-theme="${id}" aria-pressed="${id === 'mono'}"><span class="theme-preview ${id}"><i></i><span><i></i><i></i></span></span><span class="theme-copy"><strong>${themes[id].label}</strong><span>${themes[id].description}</span></span><span class="theme-check">✓</span></button>`).join('')}</div></div></div>`;
}

export const themeRuntimeScript = `(function(){'use strict';var root=document.documentElement,trigger=document.getElementById('theme-trigger'),popover=document.getElementById('theme-popover'),valid=['mono','warm','glass'];if(!trigger||!popover)return;function allowed(theme){return valid.indexOf(theme)!==-1;}function options(){return Array.prototype.slice.call(popover.querySelectorAll('[data-set-theme]'));}function selected(){return options().filter(function(button){return button.getAttribute('aria-pressed')==='true';})[0];}function close(restoreFocus){popover.classList.remove('open');popover.setAttribute('aria-hidden','true');trigger.setAttribute('aria-expanded','false');if(restoreFocus)trigger.focus();}function open(){popover.classList.add('open');popover.setAttribute('aria-hidden','false');trigger.setAttribute('aria-expanded','true');window.setTimeout(function(){var button=selected();if(button)button.focus();},0);}function apply(theme){if(!allowed(theme))theme='mono';root.dataset.theme=theme;options().forEach(function(button){button.setAttribute('aria-pressed',String(button.getAttribute('data-set-theme')===theme));});try{localStorage.setItem('${themeStorageKey}',theme);}catch(error){}}trigger.addEventListener('click',function(){if(popover.classList.contains('open'))close(true);else open();});popover.addEventListener('click',function(event){var button=event.target.closest('[data-set-theme]');if(!button)return;apply(button.getAttribute('data-set-theme'));close(true);});document.addEventListener('pointerdown',function(event){if(popover.classList.contains('open')&&!popover.contains(event.target)&&!trigger.contains(event.target))close(false);});document.addEventListener('keydown',function(event){if(!popover.classList.contains('open'))return;if(event.key==='Escape'){event.preventDefault();close(true);return;}if(event.key!=='ArrowDown'&&event.key!=='ArrowUp'&&event.key!=='Home'&&event.key!=='End')return;var list=options(),index=list.indexOf(document.activeElement);event.preventDefault();if(event.key==='Home')index=0;else if(event.key==='End')index=list.length-1;else index=event.key==='ArrowDown'?(index+1+list.length)%list.length:(index-1+list.length)%list.length;list[index].focus();});var current=root.dataset.theme;if(!allowed(current))apply('mono');else apply(current);}());`;

/** Must remain before every document's first style element to avoid a theme flash. */
export const themeBootstrap = `<script data-theme-bootstrap>(function(){'use strict';var key='${themeStorageKey}',valid=['mono','warm','glass'],theme='mono';try{var stored=localStorage.getItem(key);if(valid.indexOf(stored)!==-1)theme=stored;}catch(error){}document.documentElement.dataset.theme=theme;document.addEventListener('DOMContentLoaded',function(){${themeRuntimeScript}});}());</script>`;
