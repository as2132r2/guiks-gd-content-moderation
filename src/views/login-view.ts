import { renderThemeControl, themeBootstrap, themeStyles } from './theme.js';

interface LoginAccount {
  username: string;
  label: string;
  hint: string;
}

const demoAccounts: readonly LoginAccount[] = [
  { username: 'zhangmin', label: '编辑·张敏', hint: '演示账号 · 可行使三个流程角色' },
  { username: 'lijianguo', label: '部门主任·李建国', hint: '复审与会签' },
  { username: 'wangzhiyuan', label: '分管领导·王志远', hint: '终审与签发' },
  { username: 'stationadmin', label: '台领导·管理员', hint: '只读追溯与分析' },
];

export function renderLogin(options: { demoLoginEnabled: boolean; next?: string }): string {
  const requestedNext = options.next ?? '';
  const next =
    requestedNext.startsWith('/') &&
    !requestedNext.startsWith('//') &&
    !requestedNext.startsWith('/\\')
      ? requestedNext
      : '/';
  const inlineNext = JSON.stringify(next).replaceAll('<', '\\u003c');
  const cards = options.demoLoginEnabled
    ? `<section class="quick"><h2>演示身份</h2><p>模拟账号，仅用于本地演示。</p>${demoAccounts
        .map(
          (account) => `<button class="persona" data-demo="${account.username}">
            <strong>${account.label}</strong><span>${account.hint}</span>
          </button>`,
        )
        .join('')}</section>`
    : '';

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>登录 · 把关人</title>${themeBootstrap}<style>${themeStyles}
  *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg-effect);color:var(--ink);font-family:var(--sans,system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif)}
  main{width:min(900px,92vw);display:grid;grid-template-columns:1fr 1fr;background:var(--panel);border:1px solid var(--line);border-radius:18px;overflow:visible;box-shadow:var(--shadow)}
  section{padding:38px}.brand{background:var(--brand-bg);color:var(--brand-ink);display:flex;flex-direction:column;justify-content:center;border-radius:17px 0 0 17px}.brand small{opacity:.68;letter-spacing:.08em}.brand h1{font-size:34px;margin:12px 0}.brand p{line-height:1.8;opacity:.82}
  .login-tools{display:flex;justify-content:flex-end;margin-bottom:16px}h2{margin:0 0 8px;font-size:20px}.quick>p{color:var(--muted);font-size:13px}.persona{display:block;width:100%;text-align:left;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:10px;padding:12px 14px;margin:9px 0;cursor:pointer}.persona:hover{border-color:var(--accent);background:var(--panel-2)}.persona strong,.persona span{display:block}.persona span{font-size:12px;color:var(--muted);margin-top:4px}
  form{margin-top:24px;padding-top:22px;border-top:1px solid var(--line)}label{display:block;font-size:12px;color:var(--muted);margin:10px 0 5px}input{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--panel-2);color:var(--ink);font:inherit}.submit{width:100%;margin-top:14px;padding:11px;border:0;border-radius:8px;background:var(--accent);color:var(--on-accent);font-weight:700;cursor:pointer}.error{min-height:20px;color:var(--block);font-size:13px;margin-top:12px}
  @media(max-width:720px){main{grid-template-columns:1fr}.brand{padding:26px 30px;border-radius:17px 17px 0 0}.quick{padding:28px 30px}}
  </style></head><body><main>
  <section class="brand"><small>融媒体中心 · 稿件生产与监理</small><h1>把关人</h1><p>账号确认“谁在操作”，角色确认“以什么职责操作”。合并的是人，不是责任。</p></section>
  <section><div class="login-tools">${renderThemeControl()}</div>${cards}<form id="login-form"><h2>账号登录</h2><label for="username">用户名</label><input id="username" autocomplete="username" required><label for="password">密码</label><input id="password" type="password" autocomplete="current-password" required><button class="submit">登录</button><div class="error" id="error"></div></form></section>
  </main><script>(function(){'use strict';var next=${inlineNext};var error=document.getElementById('error');
  function login(body){error.textContent='';return fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json().catch(function(){return {}}).then(function(data){if(!r.ok)throw new Error(data.message||data.error||('HTTP '+r.status));location.href=next;});}).catch(function(e){error.textContent=e.message;});}
  document.getElementById('login-form').addEventListener('submit',function(e){e.preventDefault();login({username:document.getElementById('username').value.trim(),password:document.getElementById('password').value});});
  Array.prototype.forEach.call(document.querySelectorAll('[data-demo]'),function(button){button.addEventListener('click',function(){login({username:button.getAttribute('data-demo'),demo:true});});});
  }());</script></body></html>`;
}
