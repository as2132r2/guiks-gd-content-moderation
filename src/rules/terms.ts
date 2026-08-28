/**
 * 规则数据 —— 词表与模式，不含任何判定逻辑。
 *
 * 这个文件是**数据**，[index.ts](index.ts) 是**引擎**。分开是为了让两条轨道
 * 能并行：换词表只动这里，改判定只动那里，不会撞在同一个文件上
 * （requirements.md 第十一节碰撞点①）。
 *
 * 词条来源：新华社《新闻信息报道中的禁用词和慎用词》2016 年 7 月修订版。
 * **当前是节选，不是全部 102 条。** 补全归轨道 B，补的时候只加数组元素，
 * 不要动 index.ts。每条都要能说出出处，说不出的宁可不加——在广电评委面前，
 * 一条错的禁用词比少十条更伤。
 */
import type { AnnotationCategory, PreflightAction } from '../domain/gatekeeping.js';

/** 一条按字面匹配的词表规则。 */
export interface TermRule {
  ruleId: string;
  term: string;
  category: AnnotationCategory;
  action: PreflightAction;
  title: string;
  detail: string;
  suggestion?: string;
}

/** 一条按模式匹配的规则。`pattern` 必须带 `g`，引擎按全局扫。 */
export interface PatternRule {
  ruleId: string;
  pattern: RegExp;
  category: AnnotationCategory;
  action: PreflightAction;
  title: string;
  detail: string;
  suggestion?: string;
  /** 命中后再过一道，用来压掉正则压不掉的误报。 */
  refine?: (match: RegExpExecArray, sentence: string) => boolean;
}

export interface AdmissionTerm {
  ruleId: string;
  term: string;
}

// ————————————————————————— 入口准入 —————————————————————————

/** 明确违法，且与新闻业务无关 → 硬拦，模型完全不碰。 */
export const ADMISSION_BLOCK_TERMS: readonly AdmissionTerm[] = [
  { ruleId: 'AD-B-01', term: '制毒' },
  { ruleId: 'AD-B-02', term: '贩毒' },
  { ruleId: 'AD-B-03', term: '枪支改装' },
  { ruleId: 'AD-B-04', term: '赌博网站' },
  { ruleId: 'AD-B-05', term: '诈骗话术' },
  { ruleId: 'AD-B-06', term: '洗钱' },
  { ruleId: 'AD-B-07', term: '开票' },
  { ruleId: 'AD-B-08', term: '暴恐' },
  { ruleId: 'AD-B-09', term: '爆炸物制作' },
  { ruleId: 'AD-B-10', term: '偷拍' },
];

/**
 * 涉敏感题材，但可能是正当报道 → 要理由。
 *
 * **中间这一档是最值钱的部分。** 广电编辑的正常工作就是处理敏感题材——写事故
 * 通报、涉诉纠纷、涉政会议。一刀切拦掉，系统当场不可用。
 */
export const ADMISSION_REASON_TERMS: readonly AdmissionTerm[] = [
  { ruleId: 'AD-R-01', term: '事故' },
  { ruleId: 'AD-R-02', term: '伤亡' },
  { ruleId: 'AD-R-03', term: '死亡' },
  { ruleId: 'AD-R-04', term: '塌方' },
  { ruleId: 'AD-R-05', term: '纠纷' },
  { ruleId: 'AD-R-06', term: '上访' },
  { ruleId: 'AD-R-07', term: '征地' },
  { ruleId: 'AD-R-08', term: '拆迁' },
  { ruleId: 'AD-R-09', term: '涉诉' },
  { ruleId: 'AD-R-10', term: '群体性事件' },
  { ruleId: 'AD-R-11', term: '疫情' },
  { ruleId: 'AD-R-13', term: '食品安全' },
  { ruleId: 'AD-R-14', term: '举报' },
  { ruleId: 'AD-R-15', term: '停产' },
  { ruleId: 'AD-R-16', term: '欠薪' },
];

/** 不违法，但不是业务用途（公器私用）。只标不拦，进审计报表。 */
export const ADMISSION_OFF_DUTY_TERMS: readonly AdmissionTerm[] = [
  { ruleId: 'AD-O-01', term: '小说' },
  { ruleId: 'AD-O-02', term: '年终总结' },
  { ruleId: 'AD-O-03', term: '述职报告' },
  { ruleId: 'AD-O-04', term: '情书' },
  { ruleId: 'AD-O-05', term: '剧本杀' },
  { ruleId: 'AD-O-06', term: '朋友圈文案' },
  { ruleId: 'AD-O-07', term: '入党申请' },
  { ruleId: 'AD-O-08', term: '论文' },
  { ruleId: 'AD-O-09', term: '简历' },
  { ruleId: 'AD-O-10', term: '婚礼致辞' },
];

// ————————————————————————— 二校 / 复审：词表 —————————————————————————

const banned = (
  ruleId: string,
  term: string,
  detail: string,
  suggestion?: string,
): TermRule => ({
  ruleId,
  term,
  category: 'banned-term',
  action: 'block',
  title: `禁用词：${term}`,
  detail,
  ...(suggestion ? { suggestion } : {}),
});

const caution = (
  ruleId: string,
  term: string,
  detail: string,
  suggestion?: string,
): TermRule => ({
  ruleId,
  term,
  category: 'caution-term',
  action: 'flag',
  title: `慎用词：${term}`,
  detail,
  ...(suggestion ? { suggestion } : {}),
});

export const TERM_RULES: readonly TermRule[] = [
  // —— 会议与领导活动表述 ——
  banned('PF-T-01', '隆重召开', '新华社规范：一般性会议不冠以「隆重」。', '召开'),
  banned('PF-T-02', '隆重举行', '新华社规范：一般性活动不冠以「隆重」。', '举行'),
  caution('PF-T-03', '亲自', '报道领导同志活动时慎用「亲自」，履行本职不必特别标注。', '（删去）'),
  caution('PF-T-04', '胜利闭幕', '一般性会议闭幕不冠以「胜利」。', '闭幕'),
  caution('PF-T-05', '亲切接见', '「接见」用于上级对下级；平级或对外宾应用「会见」。', '会见'),
  caution('PF-T-06', '发表重要讲话', '「重要」是评价性表述，一般性会议报道慎用。', '讲话'),

  // —— 称谓 ——
  banned(
    'PF-T-10',
    '老板',
    '新华社规范：对国内领导干部和国有企业负责人不使用「老板」这一称呼。',
    '负责人',
  ),
  banned('PF-T-11', '打工仔', '新华社规范：不使用带歧视色彩的称呼指代进城务工人员。', '务工人员'),
  banned('PF-T-12', '打工妹', '新华社规范：不使用带歧视色彩的称呼指代进城务工人员。', '务工人员'),
  banned('PF-T-13', '残废人', '新华社规范：应使用「残疾人」。', '残疾人'),
  banned('PF-T-14', '瞎子', '新华社规范：应使用「盲人」。', '盲人'),
  banned('PF-T-15', '聋哑人士', '新华社规范：视情况使用「聋人」或「听力障碍者」。', '听力障碍者'),
  banned('PF-T-16', '弱智', '新华社规范：应使用「智力障碍者」。', '智力障碍者'),

  // —— 文娱与绝对化表述 ——
  caution('PF-T-20', '影帝', '新华社规范：不使用「影帝」「影后」「巨星」「天王」等词形容文艺界人士。'),
  caution('PF-T-21', '影后', '新华社规范：不使用「影帝」「影后」「巨星」「天王」等词形容文艺界人士。'),
  caution('PF-T-22', '天王', '新华社规范：不使用「影帝」「影后」「巨星」「天王」等词形容文艺界人士。'),
  caution('PF-T-23', '史上最', '绝对化表述，新闻报道慎用。'),
  caution('PF-T-24', '完美无缺', '绝对化表述，新闻报道慎用。'),

  // —— 领导表述规范（职务写法） ——
  {
    ruleId: 'PF-L-01',
    term: '省省委书记',
    category: 'leader-title',
    action: 'redact',
    title: '领导表述规范：职务写法有误',
    detail: '应为「中共XX省委书记」，不写「中共XX省省委书记」。',
    suggestion: '省委书记',
  },
  {
    ruleId: 'PF-L-02',
    term: '市市委书记',
    category: 'leader-title',
    action: 'redact',
    title: '领导表述规范：职务写法有误',
    detail: '应为「中共XX市委书记」，不写「中共XX市市委书记」。',
    suggestion: '市委书记',
  },
  {
    ruleId: 'PF-L-03',
    term: '县县委书记',
    category: 'leader-title',
    action: 'redact',
    title: '领导表述规范：职务写法有误',
    detail: '应为「中共XX县委书记」，不写「中共XX县县委书记」。',
    suggestion: '县委书记',
  },
];

// ————————————————————————— 一校：错别字 / 标点 / 格式 —————————————————————————

/**
 * 一校那一档（plan §七：「L1 全自动」）。
 *
 * 这里只放**确定性、几乎不会误报**的规则。一校的产出编辑会逐条看，误报一多
 * 就没人看了——宁可少抓，不可乱抓。
 */
export const PATTERN_RULES: readonly PatternRule[] = [
  // —— 标点 ——
  {
    ruleId: 'PF-P-01',
    pattern: /[一-鿿][,;?!]/g,
    category: 'punctuation',
    action: 'flag',
    title: '标点：中文里用了半角标点',
    detail: '中文语境应使用全角标点（，；？！）。',
  },
  {
    ruleId: 'PF-P-02',
    pattern: /([，。！？；：])\1+/g,
    category: 'punctuation',
    action: 'flag',
    title: '标点：重复标点',
    detail: '同一标点连续出现，通常是误输入。',
  },
  {
    ruleId: 'PF-P-03',
    pattern: /[一-鿿]\.(?!\d)/g,
    category: 'punctuation',
    action: 'flag',
    title: '标点：中文里用了半角句点',
    detail: '中文语境句末应使用句号「。」。',
    suggestion: '。',
  },
  {
    ruleId: 'PF-P-04',
    pattern: /\([^)]*[一-鿿][^)]*\)/g,
    category: 'punctuation',
    action: 'flag',
    title: '标点：中文内容用了半角括号',
    detail: '中文语境应使用全角括号（）。',
  },

  // —— 错别字与用词 ——
  {
    ruleId: 'PF-W-01',
    pattern: /按装/g,
    category: 'typo',
    action: 'flag',
    title: '用词：按装',
    detail: '应为「安装」。',
    suggestion: '安装',
  },
  {
    ruleId: 'PF-W-02',
    pattern: /重覆/g,
    category: 'typo',
    action: 'flag',
    title: '用词：重覆',
    detail: '应为「重复」。',
    suggestion: '重复',
  },
  {
    ruleId: 'PF-W-03',
    pattern: /渡过难关|渡过危机/g,
    category: 'typo',
    action: 'flag',
    title: '用词：渡过 / 度过',
    detail: '与时间、阶段搭配用「度过」；「渡」用于渡水、渡船。',
    suggestion: '度过',
  },
  {
    ruleId: 'PF-W-04',
    pattern: /([一-鿿])\1{2,}/g,
    category: 'typo',
    action: 'flag',
    title: '用词：同一字连续重复',
    detail: '同一汉字连续出现三次以上，通常是误输入。',
  },

  // —— 格式 ——
  {
    ruleId: 'PF-F-01',
    pattern: /　+/g,
    category: 'format',
    action: 'flag',
    title: '格式：全角空格',
    detail: '正文中不使用全角空格缩进，段落格式由排版控制。',
  },
  {
    ruleId: 'PF-F-02',
    pattern: /[０-９]+/g,
    category: 'format',
    action: 'flag',
    title: '格式：全角数字',
    detail: '数字应使用半角。',
  },
  {
    ruleId: 'PF-F-03',
    pattern: /[ \t]{2,}/g,
    category: 'format',
    action: 'flag',
    title: '格式：连续空格',
    detail: '正文中不应出现连续空格。',
  },
];

/**
 * 成对符号。不做正则，交给引擎数个数——正则数不了嵌套，也给不出准确位置。
 *
 * **故意不查引号。** 引文经常横跨句号（「他说：今天开会。明天开工。」），
 * 而预检是按句扫的，按句查引号必然误报。宁可少抓。
 */
export const PAIRED_MARKS: ReadonlyArray<{ ruleId: string; open: string; close: string; name: string }> = [
  { ruleId: 'PF-P-10', open: '（', close: '）', name: '括号（）' },
  { ruleId: 'PF-P-11', open: '《', close: '》', name: '书名号《》' },
];

/** 出现其中任意一条即认为已带 AI 生成内容标识。 */
export const AI_LABEL_MARKERS: readonly string[] = [
  '人工智能生成',
  'AI 生成',
  'AI生成',
  '本文由AI',
  '本文由 AI',
  '智能生成',
];

/**
 * 带单位的数字与日期 —— 幻觉最致命的地方，也是最容易机器比对的地方。
 *
 * `\s*` 不是可有可无：真实文案里「1200 人」「3.2 亿元」都常见，漏掉空格这一档
 * 就等于漏掉一半的幻觉数字。比对前两边都会去掉空格。
 */
export const NUMBER_PATTERN =
  /\d+(?:\.\d+)?\s*(?:亿元|万元|亿|万|元|人次|人|户|个|家|公里|千米|米|吨|平方米|％|%)|\d{4}\s*年|\d{1,2}\s*月\d{1,2}\s*日/g;
