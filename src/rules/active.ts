/**
 * 当前生效的那一份词表。
 *
 * [index.ts](index.ts) 的引擎默认吃内置基线；**工作台吃这里的**。分开是为了让
 * 引擎保持纯函数——同一份稿子加同一份词表永远得到同一个结果，这条性质是彩排
 * 和责任链共同的地基，不能被一个悄悄读库的副作用毁掉。
 */
import { getWorkflowRepository } from '../db/repository.js';
import { toRuleset, type Ruleset } from './ruleset.js';

let cached: Ruleset | undefined;

/**
 * 库里那一份词表。
 *
 * 缓存按版本号失效：每次只多一条 `SELECT version FROM ruleset_meta WHERE id=1`
 * 的主键查询，比每次重建整份词表便宜得多，又不会在别的进程改了词表之后还拿着
 * 旧的判。**判定依据不该有缓存不一致这种事**——按旧词表判出来的结论，留痕里却
 * 记着新版本号，那条留痕就是错的。
 */
export function activeRuleset(): Ruleset {
  const repository = getWorkflowRepository();
  const version = repository.ruleset.version();
  if (cached && cached.version === version) return cached;
  const snapshot = repository.ruleset.snapshot();
  cached = toRuleset(snapshot.version, snapshot.rules);
  return cached;
}

/** 测试与换库时用。生产路径不需要——版本号自己会让缓存失效。 */
export function resetActiveRulesetCache(): void {
  cached = undefined;
}
