/**
 * 词表的两种形态之间的转换。
 *
 * - `Ruleset` —— **引擎吃的形状**。[index.ts](index.ts) 只认它。
 * - `ManagedRule` —— **库里和界面上的形状**（[domain/ruleset.ts](../domain/ruleset.ts)）。
 *
 * 内置基线在 [terms.ts](terms.ts)：`builtinRuleset()` 给引擎，`builtinManagedRules()`
 * 给灌库。两者出自同一份数组，所以基线永远只有一个定义处。
 */
import type { BlockBucketWarning, ManagedRule } from '../domain/ruleset.js';
import {
  ADMISSION_BLOCK_TERMS,
  ADMISSION_OFF_DUTY_TERMS,
  ADMISSION_REASON_TERMS,
  TERM_RULES,
  baselineSourceFor,
  type AdmissionTerm,
  type TermRule,
} from './terms.js';

/**
 * 引擎判定时用的那一份词表。
 *
 * `version` 会写进准入与预检的留痕——**判定依据可变之后，留痕必须带依据的版本，
 * 否则留痕本身失去意义**。内置基线固定为 0，表示「未经任何人工改动」。
 */
export interface Ruleset {
  version: number;
  admissionBlock: readonly AdmissionTerm[];
  admissionReason: readonly AdmissionTerm[];
  admissionOffDuty: readonly AdmissionTerm[];
  termRules: readonly TermRule[];
}

export const BUILTIN_RULESET_VERSION = 0;

/**
 * 未经改动的内置基线。
 *
 * `runAdmission()` / `runPreflight()` 的默认参数就是它，所以测试与任何不关心
 * 库状态的调用点都拿到确定性的基线结果，一行都不用改。
 */
export function builtinRuleset(): Ruleset {
  return {
    version: BUILTIN_RULESET_VERSION,
    admissionBlock: ADMISSION_BLOCK_TERMS,
    admissionReason: ADMISSION_REASON_TERMS,
    admissionOffDuty: ADMISSION_OFF_DUTY_TERMS,
    termRules: TERM_RULES,
  };
}

const admissionRow = (
  rule: AdmissionTerm,
  bucket: ManagedRule['admissionBucket'],
  at: number,
): ManagedRule => ({
  ruleId: rule.ruleId,
  scope: 'admission',
  term: rule.term,
  source: baselineSourceFor(rule.ruleId, rule.source),
  origin: 'builtin',
  enabled: true,
  ...(bucket ? { admissionBucket: bucket } : {}),
  createdAt: at,
  updatedAt: at,
});

const preflightRow = (rule: TermRule, at: number): ManagedRule => ({
  ruleId: rule.ruleId,
  scope: 'preflight',
  term: rule.term,
  source: baselineSourceFor(rule.ruleId, rule.source),
  origin: 'builtin',
  enabled: true,
  category: rule.category,
  action: rule.action,
  title: rule.title,
  detail: rule.detail,
  ...(rule.suggestion ? { suggestion: rule.suggestion } : {}),
  createdAt: at,
  updatedAt: at,
});

/** 内置基线摊平成库里的行。灌库只会 INSERT 缺失的 ruleId，不覆盖已有行。 */
export function builtinManagedRules(at: number): ManagedRule[] {
  return [
    ...ADMISSION_BLOCK_TERMS.map((rule) => admissionRow(rule, 'block', at)),
    ...ADMISSION_REASON_TERMS.map((rule) => admissionRow(rule, 'reason', at)),
    ...ADMISSION_OFF_DUTY_TERMS.map((rule) => admissionRow(rule, 'off-duty', at)),
    ...TERM_RULES.map((rule) => preflightRow(rule, at)),
  ];
}

/** 库里的行组装回引擎吃的形状。停用的条目在这里就被丢掉，引擎不必知道有这回事。 */
export function toRuleset(version: number, rules: readonly ManagedRule[]): Ruleset {
  const live = rules.filter((rule) => rule.enabled);
  const admission = (bucket: ManagedRule['admissionBucket']): AdmissionTerm[] =>
    live
      .filter((rule) => rule.scope === 'admission' && rule.admissionBucket === bucket)
      .map((rule) => ({ ruleId: rule.ruleId, term: rule.term, source: rule.source }));

  return {
    version,
    admissionBlock: admission('block'),
    admissionReason: admission('reason'),
    admissionOffDuty: admission('off-duty'),
    termRules: live
      .filter((rule) => rule.scope === 'preflight')
      .map((rule) => ({
        ruleId: rule.ruleId,
        term: rule.term,
        category: rule.category ?? 'caution-term',
        action: rule.action ?? 'flag',
        title: rule.title ?? `词表命中：${rule.term}`,
        detail: rule.detail ?? '',
        ...(rule.suggestion ? { suggestion: rule.suggestion } : {}),
        source: rule.source,
      })),
  };
}

/**
 * 操作指令式后缀。
 *
 * 硬拦那一档**只认操作指令**，不认题材——理由见 terms.ts 里
 * `ADMISSION_BLOCK_TERMS` 的注释：任何题材都可能是新闻。「制毒」「传销」
 * 「洗钱」「邪教」全是台里正经在写的稿子。
 */
const INSTRUCTIONAL_SUFFIXES = [
  '话术',
  '教程',
  '方法',
  '技巧',
  '配方',
  '步骤',
  '攻略',
  '搭建',
  '制作',
  '制售',
  '教学',
  '指南',
] as const;

/**
 * 往硬拦档加词前的自检。
 *
 * 返回非空即要求调用方显式确认——**不禁止，但留下知情的证据**。误拦一条是编辑
 * 当场没法工作，漏拦一条最多是留痕里多一条记录；这个不对称决定了这一档只能窄。
 *
 * `message` 会原样显示给台领导、并原样写进改动记录，所以是纯文本：没有 Markdown
 * 记号，也不含 HTML。
 */
export function assessBlockBucket(
  term: string,
  reasonLaneTerms: readonly string[],
): BlockBucketWarning | undefined {
  const collision = reasonLaneTerms.find(
    (existing) => existing === term || term.includes(existing) || existing.includes(term),
  );
  if (collision) {
    return {
      code: 'already-reason-lane',
      message:
        `「${collision}」现在在「要理由」档。把它提到硬拦，` +
        '破获案件、专项整治这类正经选题会被拦死，编辑当场没法工作。',
    };
  }
  if (!INSTRUCTIONAL_SUFFIXES.some((suffix) => term.includes(suffix))) {
    return {
      code: 'topic-word',
      message:
        `「${term}」看起来是题材，不是操作指令。硬拦档只认「话术 / 教程 / 方法」` +
        '这类操作指令式措辞——任何题材都可能是新闻，按题材硬拦会把正常选题拦死。' +
        '涉敏感题材请放「要理由」档。',
    };
  }
  return undefined;
}

/**
 * 界面上只读展示的一条内置判定逻辑。
 *
 * 三个字段都会原样显示给管理员，所以是纯文本：没有 Markdown 记号，也不含 HTML。
 */
export interface EngineRuleSummary {
  ruleId: string;
  label: string;
  detail: string;
  /** 为什么它不能在界面上改。 */
  reason: string;
}

/**
 * 不落库、只能改代码的那一部分判定逻辑。
 *
 * **界面必须把它们列全**，否则管理员会以为词表就是判定的全部——那反而是新的
 * 误导。看得见改不了，好过看不见。
 */
export function builtinEngineRules(): EngineRuleSummary[] {
  const REGEX_REASON =
    '正则不落库：让人从浏览器往服务端塞任意正则，等于开一个远程拒绝服务的口子（灾难性回溯）。';
  const LOGIC_REASON = '这是判定逻辑不是词条数据，改它等于改引擎，只能改代码并跑测试。';
  return [
    {
      ruleId: 'PF-P-01..04',
      label: '标点差错',
      detail: '中文里的半角标点、重复标点、半角句点、半角括号。',
      reason: REGEX_REASON,
    },
    {
      ruleId: 'PF-P-10..11',
      label: '成对符号不成对',
      detail: '括号（）与书名号《》按句数个数。故意不查引号——引文常跨句，按句查必误报。',
      reason: LOGIC_REASON,
    },
    {
      ruleId: 'PF-W-04',
      label: '同一字连续重复三次以上',
      detail: '叠字数不出字面量，只能用正则。',
      reason: REGEX_REASON,
    },
    {
      ruleId: 'PF-F-01..03',
      label: '格式规范',
      detail: '全角空格、全角数字、连续空格。',
      reason: REGEX_REASON,
    },
    {
      ruleId: 'PF-N-01..09',
      label: '当事人姓名保护',
      detail:
        '《禁用词》法律类第 1 条九类对象。判的是「共现」——身份词与完整姓名同句才成立，' +
        '所以词表匹配不了，这也正是把判定放在生产现场才拿得到的东西。',
      reason: LOGIC_REASON,
    },
    {
      ruleId: '（一致性比对）',
      label: '与原通稿不一致',
      detail: '生成稿里有而原通稿没有的数字、日期、人名职务、地名一律标红待复核。',
      reason: LOGIC_REASON,
    },
    {
      ruleId: '（L2 判断）',
      label: '导向与事实判断',
      detail: '无可核验来源的表述、绝对化结论。结论一律「待人工复核」，不给自动终审结论。',
      reason: LOGIC_REASON,
    },
    {
      ruleId: '（AI 标识）',
      label: 'AI 生成内容标识',
      detail: '《人工智能生成合成内容标识办法》要求显式标识，缺失即标出并给出可插入的一句。',
      reason: LOGIC_REASON,
    },
  ];
}
