import { describe, expect, it } from 'vitest';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDirectRun } from '../src/lib/entrypoint.js';

/**
 * 这组用例挡的是一种特别难查的失败：**CLI 脚本静默什么都不做，还返回 0**。
 * 部署的人看到退出码 0 就以为播种成功了，实际上一条数据都没写。
 */
describe('入口判定', () => {
  // 经 URL 往返一次，拿到当前平台的原生路径写法——Windows 上是反斜杠。
  // 直接写字面量的话，这组用例只在 POSIX 上成立。
  const native = (posix: string) => fileURLToPath(pathToFileURL(posix).href);
  const real = native('/opt/app/releases/abc123/dist/seed-demo.js');
  const link = native('/opt/app/current/dist/seed-demo.js');
  // 生产发布是 current -> releases/<sha>，两条路径指向同一个文件。
  const resolver = (path: string) => (path === link ? real : path);

  it('runs when invoked by its own path', () => {
    expect(isDirectRun(pathToFileURL(real).href, real, resolver)).toBe(true);
  });

  it('still runs when invoked through the release symlink', () => {
    // 朴素写法在这里为 false —— node 解析出的 import.meta.url 是真实路径，
    // argv[1] 是符号链接路径。脚本于是一声不吭地退出。
    expect(isDirectRun(pathToFileURL(real).href, link, resolver)).toBe(true);
  });

  it('still runs when the runtime keeps the symlinked path instead', () => {
    // systemd 用 --preserve-symlinks-main 时反过来：import.meta.url 是符号链接。
    expect(isDirectRun(pathToFileURL(link).href, real, resolver)).toBe(true);
  });

  it('stays quiet when imported by something else', () => {
    expect(isDirectRun(pathToFileURL(real).href, native('/opt/app/current/dist/index.js'), resolver)).toBe(
      false,
    );
  });

  it('stays quiet with no entry point at all', () => {
    expect(isDirectRun(pathToFileURL(real).href, undefined, resolver)).toBe(false);
  });

  it('falls back to plain comparison when the path cannot be resolved', () => {
    // 文件不存在时 realpathSync 会抛。抛了不该当成「不是入口」——
    // 那又会退回静默什么都不做。
    const throwing = () => {
      throw new Error('ENOENT');
    };
    expect(isDirectRun(pathToFileURL(real).href, real, throwing)).toBe(true);
    expect(isDirectRun(pathToFileURL(real).href, link, throwing)).toBe(false);
  });
});
