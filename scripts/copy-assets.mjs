/**
 * 把随构建一起发布的静态资源拷进 dist/。
 *
 * 为什么需要这一步：**部署只带 `dist/` 和生产 `node_modules/`**
 * （见 docs/DEPLOYMENT-TENCENT-CLOUD.html 第 2 节；Dockerfile 的运行镜像
 * 也只 COPY 这两样）。试用手册留在 `docs/` 里的话，服务端运行时根本读不到它——
 * 本地开发一切正常，一上服务器按钮就是死的。
 *
 * `tsc` 不搬非 TS 文件，所以在这里搬。
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 源文件 → dist 内的目标位置。 */
const ASSETS = [['docs/deploy/user-manual.html', 'dist/assets/user-manual.html']];

for (const [from, to] of ASSETS) {
  const target = resolve(root, to);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(resolve(root, from), target);
  process.stdout.write(`copied ${from} → ${to}\n`);
}
