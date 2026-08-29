/**
 * 「这个模块是被直接跑起来的吗」——CLI 脚本用来决定要不要执行 main()。
 *
 * 为什么不能只写 `import.meta.url === pathToFileURL(process.argv[1]).href`：
 *
 * 1. **Windows**：`file://${process.argv[1]}` 这种拼法在 Windows 路径上永远不等，
 *    `npm run dev` 会静默什么都不做。用 `pathToFileURL` 解决。
 * 2. **符号链接**：生产发布是 `current -> releases/<sha>`（见
 *    [docs/DEPLOYMENT-TENCENT-CLOUD.html](../../docs/DEPLOYMENT-TENCENT-CLOUD.html)）。
 *    通过 `current/dist/seed-demo.js` 调用时，node 解析出的 `import.meta.url` 是
 *    **真实路径**，而 `argv[1]` 是**符号链接路径**，两者永远不等——
 *    **脚本一声不吭地退出，还返回 0**。部署的人看到退出码 0，以为播种成功了，
 *    实际上一条数据都没写。这种失败比报错难查得多，所以两边都取 realpath 再比。
 *
 * （`src/index.ts` 侥幸没踩到 2，是因为 systemd 用了 `--preserve-symlinks-main`，
 * 那会让 `import.meta.url` 保持符号链接路径。但这是运行方式带来的巧合，不是保证。）
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 把一个路径解析到真身；解析不了（文件不存在等）就原样返回。 */
export type PathResolver = (path: string) => string;

const resolveOrKeep = (resolver: PathResolver, path: string): string => {
  try {
    return resolver(path);
  } catch {
    return path;
  }
};

/**
 * `importMetaUrl` 指向的模块，是不是本次进程的入口。
 *
 * `argv1` 与 `resolver` 只为测试注入——正常调用只传第一个参数。
 */
export function isDirectRun(
  importMetaUrl: string,
  argv1: string | undefined = process.argv[1],
  resolver: PathResolver = realpathSync,
): boolean {
  if (!argv1) return false;
  let modulePath: string;
  try {
    modulePath = fileURLToPath(importMetaUrl);
  } catch {
    return false;
  }
  return resolveOrKeep(resolver, modulePath) === resolveOrKeep(resolver, argv1);
}

/** 供测试与诊断使用：把入口路径规范成 URL，便于打印对比。 */
export const entryPointUrl = (path: string): string => pathToFileURL(path).href;
