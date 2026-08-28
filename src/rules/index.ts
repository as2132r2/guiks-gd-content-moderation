/**
 * 入口准入 与 输出预检 的判定引擎。
 *
 * 这个文件是**引擎**，[terms.ts](terms.ts) 是**数据**。补词表请只改 terms.ts；
 * 改判定逻辑请只改这里。分开是为了让两条轨道能并行而不撞车
 * （requirements.md 第十一节碰撞点①）。
 *
 * 判定全部是确定性的：同一份稿子在同一份词表下永远得到同一个结果。彩排靠这个
 * 性质站住，审计留痕也靠它——不确定的东西没法作为责任链的一环。
 */
import {
  summarize,
  type AdmissionResult,
  type Annotation,
  type PreflightResult,
  type RuleHit,
} from '../domain/gatekeeping.js';
import {
  ADMISSION_BLOCK_TERMS,
  ADMISSION_OFF_DUTY_TERMS,
  ADMISSION_REASON_TERMS,
  AI_LABEL_MARKERS,
  NUMBER_PATTERN,
  PAIRED_MARKS,
  PATTERN_RULES,
  TERM_RULES,
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
export function runAdmission(input: { title: string; sourceText: string }): AdmissionResult {
  const text = `${input.title}\n${input.sourceText}`;

  const offDutyHits = collect(text, ADMISSION_OFF_DUTY_TERMS);
  const offDutyUse = offDutyHits.length > 0;

  const blocked = collect(text, ADMISSION_BLOCK_TERMS);
  if (blocked.length > 0) {
    return {
      decision: 'blocked',
      reasonCode: 'illegal-unrelated',
      message: '本次调用不予受理：内容明确违法且与新闻业务无关。模型未被调用，未产生任何内容。',
      hits: blocked,
      ...(offDutyUse ? { offDutyUse } : {}),
    };
  }

  // 公器私用单独成档：不违法，所以不硬拦；不是业务，所以不能默默放过。
  if (offDutyUse) {
    return {
      decision: 'admitted-logged',
      reasonCode: 'off-duty-use',
      message: '已放行并留痕。这次调用看起来不是新闻业务用途，已计入本台使用情况报表。',
      hits: offDutyHits,
      offDutyUse: true,
    };
  }

  const sensitive = collect(text, ADMISSION_REASON_TERMS);
  if (sensitive.length > 0) {
    return {
      decision: 'reason-required',
      reasonCode: 'sensitive-topic',
      message:
        '涉敏感题材。敏感题材是新闻业务的日常，我们不拦——请填写选题依据或上级授权，填完放行并留痕。',
      hits: sensitive,
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

const normalizeDigits = (text: string) => text.replace(/\s+/g, '');

/**
 * 输出预检：一校（错别字 / 标点 / 格式）+ 二校（词表 / 领导表述）
 * + 与原通稿一致性 + AI 标识。
 *
 * 产出是**标注**，不是**闸门**（business-process.md §一之二）。人少，阻断就是
 * 卡死，卡死就是弃用 —— 除入口那一层的硬拦外，一律标出来让人决定。
 */
export function runPreflight(input: {
  artifactId: string;
  sentences: readonly string[];
  sourceText: string;
}): PreflightResult {
  const annotations: Annotation[] = [];
  const source = normalizeDigits(input.sourceText);
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
    for (const rule of TERM_RULES) {
      let from = sentence.indexOf(rule.term);
      while (from !== -1) {
        add(ordinal, from, from + rule.term.length, {
          action: rule.action,
          category: rule.category,
          title: rule.title,
          detail: rule.detail,
          ...(rule.suggestion ? { suggestion: rule.suggestion } : {}),
          tier: 'L1',
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
      });
    }

    // —— 与原通稿的一致性比对：生成稿里有而原文没有的数字一律标红 ——
    NUMBER_PATTERN.lastIndex = 0;
    for (const match of sentence.matchAll(NUMBER_PATTERN)) {
      const literal = match[0];
      if (source.includes(normalizeDigits(literal))) continue;
      add(ordinal, match.index, match.index + literal.length, {
        action: 'redact',
        category: 'inconsistency',
        title: `与原通稿不一致：${literal}`,
        detail: '这个数字在原通稿里找不到。生成稿里有而原文没有的数字一律标红待复核。',
        tier: 'L1',
      });
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
    });
  }

  annotations.sort((a, b) => a.segmentOrdinal - b.segmentOrdinal || a.start - b.start);
  return { artifactId: input.artifactId, annotations, summary: summarize(annotations) };
}
