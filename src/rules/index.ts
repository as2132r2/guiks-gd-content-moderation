/**
 * 入口准入 与 输出预检 的判定引擎。
 *
 * 这个文件是**引擎**，[terms.ts](terms.ts) 是**数据**。补词表请只改 terms.ts；
 * 改判定逻辑请只改这里。分开是为了让两条轨道能并行而不撞车
 * （requirements.md 第十一节碰撞点①）。
 *
 * 判定全部是确定性的：同一份稿子在同一份词表下永远得到同一个结果。彩排靠这个
 * 性质站住，审计留痕也靠它——不确定的东西没法作为责任链的一环。
 *
 * 词表落库后两个入口都多一个 `ruleset` 参数，**默认是内置基线**：不关心库状态的
 * 调用点（测试、准入案例）拿到的仍是确定性的基线结果，一行都不用改；工作台传
 * `activeRuleset()`（[active.ts](active.ts)），并把 `ruleset.version` 写进留痕。
 */
import {
  summarize,
  type AdmissionResult,
  type Annotation,
  type AnnotationCategory,
  type PreflightResult,
  type RuleHit,
} from '../domain/gatekeeping.js';
import type { ProofreadPass } from '../domain/contracts.js';
import { builtinRuleset, type Ruleset } from './ruleset.js';
import {
  AI_LABEL_MARKERS,
  NUMBER_PATTERN,
  PAIRED_MARKS,
  PATTERN_RULES,
  PROTECTED_IDENTITIES,
  SURNAMES,
  type AdmissionTerm,
} from './terms.js';

const collect = (text: string, rules: readonly AdmissionTerm[]): RuleHit[] =>
  rules
    .filter((rule) => text.includes(rule.term))
    .map((rule) => ({ ruleId: rule.ruleId, evidence: rule.term }));

/**
 * 入口准入：判定的不是词，是**这次调用该不该发生**。
 *
 * 硬拦那一档是整条链路上唯一免费的一档 —— 输入侧拦掉，token 没烧、内容没产生、
 * 模型一次都没被碰到。
 */
export function runAdmission(
  input: { title: string; sourceText: string },
  ruleset: Ruleset = builtinRuleset(),
): AdmissionResult {
  const text = `${input.title}\n${input.sourceText}`;

  // 公器私用是**标记不是闸门**（gatekeeping.ts 的 `offDutyUse` 注释）：它与三档
  // 判定正交，所以只置字段、绝不提前 return。早前它排在敏感题材前面并直接返回，
  // 结果是「帮我把这次事故写成一篇小说」被当成公器私用放行——**多写两个字反而
  // 绕过了「要理由」**。闸门只能因为更严的理由收紧，不能因为多一条线索放松。
  const offDutyHits = collect(text, ruleset.admissionOffDuty);
  const offDutyUse = offDutyHits.length > 0;
  const offDutyFlag = offDutyUse ? { offDutyUse: true as const } : {};

  const blocked = collect(text, ruleset.admissionBlock);
  if (blocked.length > 0) {
    return {
      decision: 'blocked',
      reasonCode: 'illegal-unrelated',
      message: '本次调用不予受理：内容明确违法且与新闻业务无关。模型未被调用，未产生任何内容。',
      hits: [...blocked, ...offDutyHits],
      ...offDutyFlag,
    };
  }

  const sensitive = collect(text, ruleset.admissionReason);
  if (sensitive.length > 0) {
    return {
      decision: 'reason-required',
      reasonCode: 'sensitive-topic',
      message:
        '涉敏感题材。敏感题材是新闻业务的日常，我们不拦——请填写选题依据或上级授权，填完放行并留痕。',
      hits: [...sensitive, ...offDutyHits],
      ...offDutyFlag,
    };
  }

  // 到这里才轮到公器私用单独成档：不违法所以不硬拦，不是业务所以不默默放过。
  if (offDutyUse) {
    return {
      decision: 'admitted-logged',
      reasonCode: 'off-duty-use',
      message: '已放行并留痕。这次调用看起来不是新闻业务用途，已计入本台使用情况报表。',
      hits: offDutyHits,
      offDutyUse: true,
    };
  }

  return {
    decision: 'admitted-logged',
    reasonCode: 'routine',
    message: '常规业务选题，直接放行，本次调用已进审计。',
    hits: [],
  };
}

// ————————————————————————— 输出预检 —————————————————————————

/**
 * 比对前的归一。
 *
 * 去空格之外还去掉量级后面的「元」：原通稿写「3.2 亿元」、生成稿写「3.2 亿」是
 * **同一个数**，把它标成「这个数字在原通稿里找不到」是误报。误报比漏报更伤——
 * 编辑被假警报教育两次之后就不再看这一档了，而这一档正是幻觉唯一的出口。
 *
 * 「100 元」不动：那里的「元」是量词本身，不是量级的尾巴。
 * 量词不同仍然算不同（「3.2 亿元」≠「3.2 亿人」），靠 NUMBER_PATTERN 把量级后面
 * 的量词一起抽出来保证。
 */
const normalizeDigits = (text: string) =>
  text.replace(/\s+/g, '').replace(/([亿万])元$/, '$1');

/**
 * 原通稿里出现过的数字/日期，去空格后的**精确**集合。
 *
 * 早前这里是 `source.includes(literal)` 的子串判断，于是原文「15 人」能让生成稿
 * 里的「5 人」蒙混过关——而数字被改大改小恰恰是幻觉最常见的形态。改成先把原文
 * 按同一个 pattern 抽成集合再比对，"5人" 与 "15人" 就是两个不同的元素。
 */
function sourceNumbers(sourceText: string): Set<string> {
  const found = new Set<string>();
  NUMBER_PATTERN.lastIndex = 0;
  for (const match of sourceText.matchAll(NUMBER_PATTERN)) found.add(normalizeDigits(match[0]));
  return found;
}

const proofreadPassFor = (category: AnnotationCategory): ProofreadPass => {
  if (category === 'judgment' || category === 'ai-label') return 'third';
  if (category === 'typo' || category === 'punctuation' || category === 'format') return 'first';
  // privacy-name 与 inconsistency 一样落二校：plan §七 二校查「数据、人名、地名、术语」。
  return 'second';
};

/**
 * 受保护语境里的完整姓名 —— 姓氏后跟 1~2 个汉字，且下一个字不是「某」。
 *
 * `(?!某)` 是这条规则的合规出口：《禁用词》法律类第 1 条要求的正是「张某」这种
 * 写法，已经这么写的不该再被标出来。
 */
const FULL_NAME_PATTERN = new RegExp(`(?:${SURNAMES.join('|')})(?!某)[\\u4e00-\\u9fff]{1,2}`, 'g');

/** 句中命中的受保护身份，返回原文九类里的类名。 */
function protectedIdentitiesIn(sentence: string): string[] {
  return PROTECTED_IDENTITIES.filter((identity) =>
    identity.terms.some((term) => sentence.includes(term)),
  ).map((identity) => identity.label);
}

interface EntityCandidate {
  literal: string;
  start: number;
  kind: '人名与职务' | '地名';
}

/**
 * 领导职务，**长的排前面**。
 *
 * 顺序即匹配优先级：`市长` 排在 `副市长` 前面的话，「副市长马晓东」会被切成
 * 「市长马晓东」——少一个「副」，比不出来反而更糟。
 */
const LEADER_TITLES = [
  '省委书记', '市委书记', '县委书记', '党组书记', '党委书记',
  '副省长', '副市长', '副县长',
  '省长', '市长', '县长', '局长', '主任',
] as const;

/** 写法一：「姓名（同志）（任）职务」——张伟任县长、李强同志担任局长。 */
const NAME_THEN_TITLE_PATTERN = new RegExp(
  `[\\u4e00-\\u9fff]{2,4}(?:同志)?(?:担任|任|是)?(?:${LEADER_TITLES.join('|')})`,
  'g',
);

/**
 * 写法二的前半段：「职务 + 姓」——市委书记周、县长马。
 *
 * **时政通稿绝大多数是这一种写法**，而写法一那条正则要求姓名在前，
 * 对「市委书记周立」一个都匹配不上。名字部分不在这条正则里取，
 * 见 titleThenNameCandidates。
 */
const TITLE_THEN_SURNAME_PATTERN = new RegExp(
  `(?:${LEADER_TITLES.join('|')})(?:${SURNAMES.join('|')})`,
  'g',
);

/**
 * 名字后面允许出现什么。
 *
 * 「职务 + 姓 + 一两个字」单看断不干净——「主任周五召开例会」里周是百家姓，
 * 周五不是人。所以要求名字后面接标点、句末或一个谓语，靠上下文把日期、
 * 序数这类假人名挡掉。
 */
const NAME_TAIL_BOUNDARY =
  /^(?:$|[^一-鿿]|出席|列席|讲话|指出|强调|表示|要求|主持|宣布|介绍|率|带队|一行|等|说|在|到|赴|就|亲自|同志)/;

const LOCATION_PATTERN = /(?:在|赴|到|位于)([一-鿿]{2,10}(?:县|市|区|镇|乡|村|社区))/g;

/** 「职务+姓名」的候选。名字取两字优先、一字次之，都不成立就不是人名。 */
function titleThenNameCandidates(sentence: string): EntityCandidate[] {
  const candidates: EntityCandidate[] = [];
  for (const match of sentence.matchAll(TITLE_THEN_SURNAME_PATTERN)) {
    const surnameEnd = match.index + match[0].length;
    for (const givenLength of [2, 1]) {
      const end = surnameEnd + givenLength;
      const given = sentence.slice(surnameEnd, end);
      if (given.length !== givenLength) continue;
      if (!/^[一-鿿]+$/.test(given)) continue;
      if (!NAME_TAIL_BOUNDARY.test(sentence.slice(end))) continue;
      candidates.push({
        literal: sentence.slice(match.index, end),
        start: match.index,
        kind: '人名与职务',
      });
      break;
    }
  }
  return candidates;
}

/** 同一段文字被两种写法各命中一次时只留长的，否则同一个人会被标两遍。 */
function dropContained(candidates: EntityCandidate[]): EntityCandidate[] {
  return candidates.filter(
    (candidate, index) =>
      !candidates.some((other, otherIndex) => {
        if (otherIndex === index || other.kind !== candidate.kind) return false;
        const contains =
          other.start <= candidate.start &&
          other.start + other.literal.length >= candidate.start + candidate.literal.length;
        if (!contains) return false;
        // 完全同 span 时保留先出现的那条，否则两条会互相淘汰、一条不剩。
        return other.literal.length > candidate.literal.length || otherIndex < index;
      }),
  );
}

function entityCandidates(sentence: string): EntityCandidate[] {
  const candidates: EntityCandidate[] = [];
  for (const match of sentence.matchAll(NAME_THEN_TITLE_PATTERN)) {
    candidates.push({ literal: match[0], start: match.index, kind: '人名与职务' });
  }
  candidates.push(...titleThenNameCandidates(sentence));
  for (const match of sentence.matchAll(LOCATION_PATTERN)) {
    const literal = match[1];
    if (!literal) continue;
    candidates.push({
      literal,
      start: match.index + match[0].indexOf(literal),
      kind: '地名',
    });
  }
  return dropContained(candidates);
}

const JUDGMENT_RULES: ReadonlyArray<{
  pattern: RegExp;
  title: string;
  detail: string;
}> = [
  {
    pattern: /网传|据网友反映|有消息称|未经证实/g,
    title: '事实来源待人工复核',
    detail: '该表述没有给出可核验来源，需人工核对事实依据后决定是否采用。',
  },
  {
    pattern: /绝对不会|百分之百|零风险|必将全面领先/g,
    title: '绝对化判断待人工复核',
    detail: '该表述包含强判断或绝对化结论，模型不作终审结论，需人工复核。',
  },
];

/**
 * 输出预检：一校（错别字 / 标点 / 格式）+ 二校（词表 / 领导表述）
 * + 与原通稿一致性 + AI 标识。
 *
 * 产出是**标注**，不是**闸门**（business-process.md §一之二）。人少，阻断就是
 * 卡死，卡死就是弃用 —— 除入口那一层的硬拦外，一律标出来让人决定。
 */
export function runPreflight(
  input: {
    artifactId: string;
    sentences: readonly string[];
    sourceText: string;
  },
  ruleset: Ruleset = builtinRuleset(),
): PreflightResult {
  const annotations: Annotation[] = [];
  const source = sourceNumbers(input.sourceText);
  let seq = 0;
  const nextId = () => {
    seq += 1;
    return `${input.artifactId.slice(0, 8)}-a${seq}`;
  };

  const add = (
    segmentOrdinal: number,
    start: number,
    end: number,
    rest: Omit<Annotation, 'id' | 'artifactId' | 'segmentOrdinal' | 'start' | 'end'>,
  ) => {
    annotations.push({
      id: nextId(),
      artifactId: input.artifactId,
      segmentOrdinal,
      start,
      end,
      ...rest,
    });
  };

  input.sentences.forEach((sentence, ordinal) => {
    // —— 词表：按字面找，同一条词可以在一句里命中多次 ——
    for (const rule of ruleset.termRules) {
      let from = sentence.indexOf(rule.term);
      while (from !== -1) {
        add(ordinal, from, from + rule.term.length, {
          action: rule.action,
          category: rule.category,
          title: rule.title,
          detail: rule.detail,
          ...(rule.suggestion ? { suggestion: rule.suggestion } : {}),
          tier: 'L1',
          proofreadPass: proofreadPassFor(rule.category),
        });
        from = sentence.indexOf(rule.term, from + rule.term.length);
      }
    }

    // —— 一校：模式规则 ——
    for (const rule of PATTERN_RULES) {
      // 正则带 g 且被复用，每次扫描前必须归零 lastIndex，否则会漏命中。
      rule.pattern.lastIndex = 0;
      let match = rule.pattern.exec(sentence);
      while (match !== null) {
        if (!rule.refine || rule.refine(match, sentence)) {
          add(ordinal, match.index, match.index + match[0].length, {
            action: rule.action,
            category: rule.category,
            title: rule.title,
            detail: rule.detail,
            ...(rule.suggestion ? { suggestion: rule.suggestion } : {}),
            tier: 'L1',
            proofreadPass: proofreadPassFor(rule.category),
          });
        }
        // 零宽匹配会死循环，手动推进一格。
        if (match.index === rule.pattern.lastIndex) rule.pattern.lastIndex += 1;
        match = rule.pattern.exec(sentence);
      }
    }

    // —— 一校：成对符号数量不等 ——
    for (const mark of PAIRED_MARKS) {
      const opens = sentence.split(mark.open).length - 1;
      const closes = sentence.split(mark.close).length - 1;
      if (opens === closes) continue;
      const orphan = opens > closes ? mark.open : mark.close;
      const at = sentence.lastIndexOf(orphan);
      add(ordinal, Math.max(at, 0), Math.max(at, 0) + orphan.length, {
        action: 'flag',
        category: 'punctuation',
        title: `标点：${mark.name}不成对`,
        detail: `这一句里「${mark.open}」出现 ${opens} 次、「${mark.close}」出现 ${closes} 次。`,
        tier: 'L1',
        proofreadPass: 'first',
      });
    }

    // —— 与原通稿的一致性比对：生成稿里有而原文没有的数字一律标红 ——
    NUMBER_PATTERN.lastIndex = 0;
    for (const match of sentence.matchAll(NUMBER_PATTERN)) {
      const literal = match[0];
      if (source.has(normalizeDigits(literal))) continue;
      add(ordinal, match.index, match.index + literal.length, {
        action: 'redact',
        category: 'inconsistency',
        title: `与原通稿不一致：${literal}`,
        detail: '这个数字在原通稿里找不到。生成稿里有而原文没有的数字一律标红待复核。',
        tier: 'L1',
        proofreadPass: 'second',
      });
    }

    // 二校：生成稿新增的人名/职务组合或地名必须回看原通稿。
    for (const entity of entityCandidates(sentence)) {
      if (input.sourceText.includes(entity.literal)) continue;
      add(ordinal, entity.start, entity.start + entity.literal.length, {
        action: 'redact',
        category: 'inconsistency',
        title: `与原通稿不一致：${entity.literal}`,
        detail: `这个${entity.kind}在原通稿里找不到，需由二校核对后决定是否采用。`,
        tier: 'L1',
        proofreadPass: 'second',
      });
    }

    // 二校：受保护当事人不得公开真名（《禁用词》法律类第 1 条）。
    // 判的是**共现**——身份词与完整姓名同句才成立，所以不是词表能做的事。
    const protectedLabels = protectedIdentitiesIn(sentence);
    if (protectedLabels.length > 0) {
      const seen = new Set<string>();
      FULL_NAME_PATTERN.lastIndex = 0;
      for (const match of sentence.matchAll(FULL_NAME_PATTERN)) {
        const name = match[0];
        if (seen.has(name)) continue;
        seen.add(name);
        add(ordinal, match.index, match.index + name.length, {
          action: 'redact',
          category: 'privacy-name',
          title: `当事人姓名需匿名化：${name}`,
          detail:
            `这一句涉及「${protectedLabels.join('、')}」。` +
            '《新闻信息报道中的禁用词和慎用词》法律类第 1 条：涉及此类对象不宜公开报道其真实姓名，' +
            '应使用真实姓氏加「某」字指代，且不宜使用化名。',
          suggestion: `${name.slice(0, 1)}某`,
          tier: 'L1',
          proofreadPass: 'second',
        });
      }
    }

    // 三校：L2 只指出判断风险，永远不给自动终审结论。
    for (const rule of JUDGMENT_RULES) {
      rule.pattern.lastIndex = 0;
      for (const match of sentence.matchAll(rule.pattern)) {
        add(ordinal, match.index, match.index + match[0].length, {
          action: 'flag',
          category: 'judgment',
          title: rule.title,
          detail: `${rule.detail} 结论：待人工复核。`,
          tier: 'L2',
          proofreadPass: 'third',
        });
      }
    }
  });

  // AI 生成内容标识：《标识办法》2025-09-01 施行，四部门联合发布，广电总局是签发方之一。
  const whole = input.sentences.join('');
  if (!AI_LABEL_MARKERS.some((marker) => whole.includes(marker))) {
    add(Math.max(0, input.sentences.length - 1), 0, 0, {
      action: 'flag',
      category: 'ai-label',
      title: '缺少 AI 生成内容标识',
      detail:
        '《人工智能生成合成内容标识办法》要求显式标识。预检可自动补一句，补完仍需人工确认位置。',
      suggestion: '本内容由人工智能生成，已经人工审核。',
      tier: 'L1',
      proofreadPass: 'third',
    });
  }

  annotations.sort((a, b) => a.segmentOrdinal - b.segmentOrdinal || a.start - b.start);
  return { artifactId: input.artifactId, annotations, summary: summarize(annotations) };
}
