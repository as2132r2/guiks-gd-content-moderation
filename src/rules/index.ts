/**
 * 入口准入 与 输出预检 的规则实现。
 *
 * ⚠️ 这是一个**确定性桩**，为的是让工作台先跑通。词表刻意很小 —— 方正智能审校
 * 有 21 类 136 个词库，堆词表我们堆不过，卖点也不在这里 (market-landscape.md)。
 * 真实实现会替换本文件的函数体；`src/domain/gatekeeping.ts` 的契约不变，界面
 * 一行都不用改。
 *
 * 词条来源: 新华社《新闻信息报道中的禁用词和慎用词》2016 年 7 月修订版（节选）。
 */
import {
  summarize,
  type AdmissionResult,
  type Annotation,
  type AnnotationCategory,
  type PreflightAction,
  type PreflightResult,
  type RuleHit,
} from '../domain/gatekeeping.js';

interface TermRule {
  ruleId: string;
  term: string;
  category: AnnotationCategory;
  action: PreflightAction;
  title: string;
  detail: string;
  suggestion?: string;
}

/** 明确违法，且与新闻业务无关 → 硬拦，模型完全不碰。 */
const BLOCK_TERMS: ReadonlyArray<{ ruleId: string; term: string }> = [
  { ruleId: 'AD-B-01', term: '制毒' },
  { ruleId: 'AD-B-02', term: '贩毒' },
  { ruleId: 'AD-B-03', term: '枪支改装' },
  { ruleId: 'AD-B-04', term: '赌博网站' },
  { ruleId: 'AD-B-05', term: '诈骗话术' },
  { ruleId: 'AD-B-06', term: '洗钱' },
];

/** 涉敏感题材，但可能是正当报道 → 要理由。中间这一档是最值钱的部分。 */
const REASON_TERMS: ReadonlyArray<{ ruleId: string; term: string }> = [
  { ruleId: 'AD-R-01', term: '事故' },
  { ruleId: 'AD-R-02', term: '伤亡' },
  { ruleId: 'AD-R-03', term: 'death' },
  { ruleId: 'AD-R-04', term: '塌方' },
  { ruleId: 'AD-R-05', term: '纠纷' },
  { ruleId: 'AD-R-06', term: '上访' },
  { ruleId: 'AD-R-07', term: '征地' },
  { ruleId: 'AD-R-08', term: '拆迁' },
  { ruleId: 'AD-R-09', term: '涉诉' },
  { ruleId: 'AD-R-10', term: '群体性事件' },
];

/** 不违法，但不是业务用途。只标不拦，进审计报表给台里管理者看。 */
const OFF_DUTY_TERMS: ReadonlyArray<{ ruleId: string; term: string }> = [
  { ruleId: 'AD-O-01', term: '小说' },
  { ruleId: 'AD-O-02', term: '年终总结' },
  { ruleId: 'AD-O-03', term: '述职报告' },
  { ruleId: 'AD-O-04', term: '情书' },
  { ruleId: 'AD-O-05', term: '剧本杀' },
  { ruleId: 'AD-O-06', term: '朋友圈文案' },
];

const collect = (
  text: string,
  rules: ReadonlyArray<{ ruleId: string; term: string }>,
): RuleHit[] =>
  rules
    .filter((rule) => text.includes(rule.term))
    .map((rule) => ({ ruleId: rule.ruleId, evidence: rule.term }));

/**
 * 入口准入: 判定的不是词，是**这次调用该不该发生**。
 *
 * 硬拦那一档是整条链路上唯一免费的一档 —— 输入侧拦掉，token 没烧、内容没产生、
 * 模型一次都没被碰到。
 */
export function runAdmission(input: { title: string; sourceText: string }): AdmissionResult {
  const text = `${input.title}\n${input.sourceText}`;

  const offDutyHits = collect(text, OFF_DUTY_TERMS);
  const offDutyUse = offDutyHits.length > 0;

  const blocked = collect(text, BLOCK_TERMS);
  if (blocked.length > 0) {
    return {
      decision: 'blocked',
      reasonCode: 'illegal-unrelated',
      message: '本次调用不予受理：内容明确违法且与新闻业务无关。模型未被调用，未产生任何内容。',
      hits: blocked,
      ...(offDutyUse ? { offDutyUse } : {}),
    };
  }

  // 公器私用单独成档: 不违法，所以不硬拦；不是业务，所以不能默默放过。
  if (offDutyUse) {
    return {
      decision: 'admitted-logged',
      reasonCode: 'off-duty-use',
      message: '已放行并留痕。这次调用看起来不是新闻业务用途，已计入本台使用情况报表。',
      hits: offDutyHits,
      offDutyUse: true,
    };
  }

  const sensitive = collect(text, REASON_TERMS);
  if (sensitive.length > 0) {
    return {
      decision: 'reason-required',
      reasonCode: 'sensitive-topic',
      message: '涉敏感题材。敏感题材是新闻业务的日常，我们不拦——请填写选题依据或上级授权，填完放行并留痕。',
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

const TERM_RULES: readonly TermRule[] = [
  {
    ruleId: 'PF-T-01',
    term: '隆重召开',
    category: 'banned-term',
    action: 'block',
    title: '禁用词：隆重召开',
    detail: '新华社规范：一般性会议不冠以「隆重」。',
    suggestion: '召开',
  },
  {
    ruleId: 'PF-T-02',
    term: '亲自',
    category: 'caution-term',
    action: 'flag',
    title: '慎用词：亲自',
    detail: '报道领导同志活动时慎用「亲自」，履行本职不必特别标注。',
    suggestion: '（删去）',
  },
  {
    ruleId: 'PF-T-03',
    term: '老板',
    category: 'banned-term',
    action: 'block',
    title: '禁用词：老板',
    detail: '对国内领导干部和国有企业负责人不使用「老板」这一称呼。',
    suggestion: '负责人',
  },
  {
    ruleId: 'PF-T-04',
    term: '省省委书记',
    category: 'leader-title',
    action: 'redact',
    title: '领导表述规范：职务写法有误',
    detail: '应为「中共XX省委书记」，不写「中共XX省省委书记」。',
    suggestion: '省委书记',
  },
  {
    ruleId: 'PF-T-05',
    term: '胜利闭幕',
    category: 'caution-term',
    action: 'flag',
    title: '慎用词：胜利闭幕',
    detail: '一般性会议闭幕不冠以「胜利」。',
    suggestion: '闭幕',
  },
];

/**
 * 带单位的数字与日期 —— 幻觉最致命的地方，也是最容易机器比对的地方。
 *
 * `\s*` 不是可有可无: 真实文案里「1200 人」「3.2 亿元」都常见，漏掉空格这一档
 * 就等于漏掉一半的幻觉数字。normalizeDigits 在比对前把两边的空格都去掉。
 */
const NUMBER_PATTERN =
  /\d+(?:\.\d+)?\s*(?:亿元|万元|亿|万|元|人次|人|户|个|家|公里|千米|米|吨|平方米|％|%)|\d{4}\s*年|\d{1,2}\s*月\d{1,2}\s*日/g;

const AI_LABEL_MARKERS = ['人工智能生成', 'AI 生成', 'AI生成', '本文由AI', '本文由 AI'];

const normalizeDigits = (text: string) => text.replace(/\s+/g, '');

/**
 * 输出预检: 禁用词 / 慎用词 / 领导表述 / 与原通稿一致性 / AI 标识。
 *
 * 产出是**标注**，不是**闸门** (business-process.md §一之二)。人少，阻断就是
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

  input.sentences.forEach((sentence, segmentOrdinal) => {
    for (const rule of TERM_RULES) {
      let from = sentence.indexOf(rule.term);
      while (from !== -1) {
        annotations.push({
          id: nextId(),
          artifactId: input.artifactId,
          segmentOrdinal,
          start: from,
          end: from + rule.term.length,
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

    // 与原通稿的一致性比对: 生成稿里有而原文没有的数字一律标红。
    for (const match of sentence.matchAll(NUMBER_PATTERN)) {
      const literal = match[0];
      if (source.includes(normalizeDigits(literal))) continue;
      annotations.push({
        id: nextId(),
        artifactId: input.artifactId,
        segmentOrdinal,
        start: match.index,
        end: match.index + literal.length,
        action: 'redact',
        category: 'inconsistency',
        title: `与原通稿不一致：${literal}`,
        detail: '这个数字在原通稿里找不到。生成稿里有而原文没有的数字一律标红待复核。',
        tier: 'L1',
      });
    }
  });

  // AI 生成内容标识: 《标识办法》2025-09-01 施行，四部门联合发布，广电总局是签发方之一。
  const whole = input.sentences.join('');
  if (!AI_LABEL_MARKERS.some((marker) => whole.includes(marker))) {
    const lastOrdinal = Math.max(0, input.sentences.length - 1);
    annotations.push({
      id: nextId(),
      artifactId: input.artifactId,
      segmentOrdinal: lastOrdinal,
      start: 0,
      end: 0,
      action: 'flag',
      category: 'ai-label',
      title: '缺少 AI 生成内容标识',
      detail:
        '《人工智能生成合成内容标识办法》要求显式标识。预检可自动补一句，补完仍需人工确认位置。',
      suggestion: '本内容由人工智能生成，已经人工审核。',
      tier: 'L1',
    });
  }

  annotations.sort(
    (a, b) => a.segmentOrdinal - b.segmentOrdinal || a.start - b.start,
  );
  return { artifactId: input.artifactId, annotations, summary: summarize(annotations) };
}
