/**
 * 产品介绍首页。
 *
 * 公开访问，不挂 `requireAuth`——访客点进来应当先看懂这是什么，再决定要不要登录。
 * 页面上没有任何稿件数据，只有写死的产品说明，所以没有可泄露的东西。
 * 需要鉴权的是 `/workbench`（「进入试用」指向它，未登录会被它自己转去 `/login`）。
 */
import { Hono } from 'hono';

import { renderLanding } from '../views/landing-view.js';

export const landingRoutes = new Hono();

landingRoutes.get('/', (c) => c.html(renderLanding()));
