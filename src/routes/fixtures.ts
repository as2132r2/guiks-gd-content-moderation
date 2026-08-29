/**
 * 只读的示例素材。**两种模式都挂载**（见 [index.ts](../index.ts)）。
 *
 * 为什么不放在 [demo.ts](demo.ts) 里：那个文件只在 `APP_MODE=demo` 下挂载，
 * 而「填入示例通稿」是试用手册第 2 步就要点的按钮——production 下 404 的话，
 * 试用者第二步就撞墙。
 *
 * 反过来，前缀 `/api/demo/*` 从此只对应会清空整库的那两个端点。一个只读的
 * 取素材接口顶着 demo 前缀却在生产可用，下一个读代码的人就再也不能凭前缀
 * 判断某个端点在生产下存不存在——这次要修的 bug 正是这么来的。
 *
 * 素材本身仍以 [demo-fixtures.ts](demo-fixtures.ts) 为唯一事实来源。
 */
import { Hono } from 'hono';
import { requireAuth, type AuthEnv } from '../middleware/auth.js';
import { DEMO_FIXTURES, MAIN_NOTICE } from './demo-fixtures.js';

export const fixtureRoutes = new Hono<AuthEnv>();

fixtureRoutes.use('/api/fixtures', requireAuth);

/** 表单「填入示例通稿」按钮取主通稿正文，免去现场粘贴 200 字。 */
fixtureRoutes.get('/api/fixtures', (c) =>
  c.json({ mainNotice: MAIN_NOTICE, cases: DEMO_FIXTURES }),
);
