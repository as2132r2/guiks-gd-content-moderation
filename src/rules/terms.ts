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

/**
 * 硬拦：明确违法，**且与新闻业务无关**。模型完全不碰。
 *
 * 这一档最重，所以收得极窄——只认**操作指令式措辞**（话术 / 教程 / 制毒方法）。
 *
 * 为什么不能按题材拦：**任何题材都可能是新闻。**「制毒」「传销」「洗钱」
 * 「邪教」「偷拍设备」「虚开发票」全都是县级台正经在写的稿子（破获制毒窝点、
 * 打击传销、查获偷拍设备）。按题材硬拦会把正常选题拦死，评委问一句
 * 「那我要报道这个事件怎么办」方案当场就崩。它们一律归「要理由」。
 *
 * ⚠️ **词表判不了意图。** 「诈骗话术」出现在一篇揭露诈骗手法的报道里同样会被
 * 拦。真正的意图识别要靠 L2，这一档在本版是确定性桩——宁可窄，不可宽：
 * 漏拦一条最多是留痕里多一条记录，误拦一条是编辑当场没法工作。
 */
export const ADMISSION_BLOCK_TERMS: readonly AdmissionTerm[] = [
  { ruleId: 'AD-B-01', term: '诈骗话术' },
  { ruleId: 'AD-B-02', term: '制毒方法' },
  { ruleId: 'AD-B-03', term: '制毒教程' },
  { ruleId: 'AD-B-04', term: '开锁教程' },
  { ruleId: 'AD-B-05', term: '洗钱教程' },
  { ruleId: 'AD-B-06', term: '爆炸物制作教程' },
  { ruleId: 'AD-B-07', term: '赌博网站搭建' },
  { ruleId: 'AD-B-08', term: '外挂制作' },
];/**
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
  { ruleId: 'AD-R-17', term: '强拆' },
  { ruleId: 'AD-R-18', term: '医疗事故' },
  { ruleId: 'AD-R-19', term: '校园欺凌' },
  { ruleId: 'AD-R-20', term: '环境污染' },
  { ruleId: 'AD-R-21', term: '违建' },
  { ruleId: 'AD-R-22', term: '舆情' },
  { ruleId: 'AD-R-23', term: '失联' },
  { ruleId: 'AD-R-24', term: '传销' },
  { ruleId: 'AD-R-25', term: '洗钱' },
  { ruleId: 'AD-R-26', term: '邪教' },
  { ruleId: 'AD-R-27', term: '制毒' },
  { ruleId: 'AD-R-28', term: '偷拍' },
  { ruleId: 'AD-R-29', term: '暴恐' },
  { ruleId: 'AD-R-30', term: '假证' },
  { ruleId: 'AD-R-31', term: '虚开发票' },
  { ruleId: 'AD-R-32', term: '色情' },
  { ruleId: 'AD-R-33', term: '枪支' },
  { ruleId: 'AD-R-34', term: '爆炸' },
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
  { ruleId: 'AD-O-11', term: '读后感' },
  { ruleId: 'AD-O-12', term: '祝酒词' },
  { ruleId: 'AD-O-13', term: '追星' },
  { ruleId: 'AD-O-14', term: '网文' },
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

  // —— 二、法律法规类 ——
  // 判决之后用「罪犯」是对的，所以只能慎用不能硬拦 —— 是否宣判要人来判断。
  caution(
    'PF-T-30',
    '罪犯',
    '新华社规范：法院宣判之前不得使用「罪犯」，应称「犯罪嫌疑人」。请确认是否已宣判。',
    '犯罪嫌疑人',
  ),
  caution('PF-T-31', '杀人犯', '未经法院判决不得以「凶手」「杀人犯」称呼犯罪嫌疑人。', '犯罪嫌疑人'),
  caution(
    'PF-T-32',
    '法制社会',
    '「依法治国」语境用「法治」，「法制」指法律制度本身。',
    '法治社会',
  ),

  // —— 三、民族宗教类 ——
  banned('PF-T-40', '回教', '新华社规范：不使用「回教」，应称「伊斯兰教」。', '伊斯兰教'),
  banned('PF-T-41', '蒙古大夫', '新华社规范：不使用带民族歧视色彩的「蒙古大夫」。'),
  banned(
    'PF-T-42',
    '伊斯兰民族',
    '新华社规范：不得将信仰伊斯兰教的民族称为「伊斯兰民族」。',
  ),

  // —— 四、港澳台和领土主权类 ——
  banned('PF-T-50', '中华民国', '新华社规范：不得使用「中华民国」及其旗、徽、歌。'),
  banned('PF-T-51', '台湾政府', '新华社规范：不使用「台湾政府」，涉台机构名称须加引号。'),
  banned('PF-T-52', '中港台', '新华社规范：不得将台港澳与中国并列，应为「内地与港澳台」。', '内地与港澳台'),
  banned('PF-T-53', '中国大陆和台湾', '新华社规范：涉台报道「大陆」与「台湾」对应，不用「中国大陆」。', '大陆和台湾'),
  banned('PF-T-54', '香港政府', '新华社规范：应称「香港特别行政区政府」，简称「香港特区政府」。', '香港特区政府'),

  // —— 五、国际关系类 ——
  banned('PF-T-60', '北朝鲜', '新华社规范：不使用「北朝鲜」，应称「朝鲜」。', '朝鲜'),
  banned('PF-T-61', '南朝鲜', '新华社规范：不使用「南朝鲜」，应称「韩国」。', '韩国'),

  // —— 一、社会生活类：绝对化与粗俗语 ——
  banned('PF-T-70', '疗效最佳', '新华社规范：医药报道不得使用绝对化疗效术语。'),
  banned('PF-T-71', '无毒副作用', '新华社规范：医药报道不得使用绝对化疗效术语。'),
  banned('PF-T-72', '盲流', '新华社规范：不使用带歧视色彩的「盲流」指代务工人员。', '务工人员'),
  caution('PF-T-73', '大师', '新华社规范：慎用「大师」「宗师」等称谓形容文艺界人士。'),

  // —— 语义赘余（一校「语病」里少数可确定的部分） ——
  caution('PF-T-80', '凯旋归来', '「凯旋」已含「归来」，语义重复。', '凯旋'),
  caution('PF-T-81', '凯旋而归', '「凯旋」已含「归来」，语义重复。', '凯旋'),
  caution('PF-T-82', '亲眼目睹', '「目睹」已含「亲眼」，语义重复。', '目睹'),
  caution('PF-T-83', '免费赠送', '「赠送」已含「免费」，语义重复。', '赠送'),

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
 * 公文里高频的错别字。
 *
 * **收录标准只有一条：错误形式本身不是一个词。** 这样才不会误伤——
 * 「布署」不成词，写出来必错；而「必须 / 必需」「其他 / 其它」都是真词，
 * 要靠上下文判断，属于 L2，不放这里。
 */
const MISSPELLINGS: readonly PatternRule[] = (
  [
    ['布署', '部署'],
    ['峻工', '竣工'],
    ['凑和', '凑合'],
    ['座落', '坐落'],
    ['渡假', '度假'],
    ['帐蓬', '帐篷'],
    ['再接再励', '再接再厉'],
    ['迫不急待', '迫不及待'],
    ['穿流不息', '川流不息'],
    ['相形见拙', '相形见绌'],
    ['一如继往', '一如既往'],
    ['名负其实', '名副其实'],
    ['谈笑风声', '谈笑风生'],
    ['走头无路', '走投无路'],
    ['蓄势代发', '蓄势待发'],
    ['再所不惜', '在所不惜'],
  ] as const
).map(([wrong, right], index) => ({
  ruleId: `PF-W-${String(index + 10).padStart(2, '0')}`,
  pattern: new RegExp(wrong, 'g'),
  category: 'typo' as const,
  action: 'flag' as const,
  title: `错别字：${wrong}`,
  detail: `应为「${right}」。`,
  suggestion: right,
}));

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
  ...MISSPELLINGS,

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

/**
 * 涉案当事人姓名保护 —— 《禁用词》法律类第 1 条。
 *
 * 原文：涉及下列对象时**不宜公开报道其真实姓名**，可使用真实姓氏加「某」字指代，
 * 如「张某」「李某」，不宜使用化名。
 *
 * 这一条词表匹配不了：它判的不是某个词，是「身份词」与「完整姓名」**在同一句里
 * 同时出现**。方正、黑马那套按词库匹配的做法给不出这个结论——这正是把判定放在
 * 生产现场才拿得到的东西。
 *
 * 每个条目对应原文九类之一，`label` 直接写进标注，评委问出处时指得回去。
 */
export interface ProtectedIdentity {
  ruleId: string;
  /** 触发词，出现在句中即认为涉及该类对象。 */
  terms: readonly string[];
  /** 原文九类里的第几类，写进标注 detail。 */
  label: string;
}

export const PROTECTED_IDENTITIES: readonly ProtectedIdentity[] = [
  { ruleId: 'PF-N-01', label: '犯罪嫌疑人家属', terms: ['嫌疑人家属', '嫌犯家属', '犯罪嫌疑人的家属'] },
  { ruleId: 'PF-N-02', label: '涉及案件的未成年人', terms: ['未成年人', '未成年', '未满十八周岁', '在校学生'] },
  { ruleId: 'PF-N-03', label: '涉及案件的妇女和儿童', terms: ['被害人', '受害人', '受害者', '被拐', '被拐卖'] },
  { ruleId: 'PF-N-04', label: '采用辅助生育手段的孕、产妇', terms: ['人工授精', '人工受精', '试管婴儿', '辅助生育', '代孕'] },
  { ruleId: 'PF-N-05', label: '严重传染病患者', terms: ['传染病患者', '肺结核患者', '结核病患者', '霍乱患者'] },
  { ruleId: 'PF-N-06', label: '精神病患者', terms: ['精神病患者', '精神障碍患者', '精神分裂'] },
  { ruleId: 'PF-N-07', label: '被暴力胁迫卖淫的妇女', terms: ['被迫卖淫', '强迫卖淫', '胁迫卖淫'] },
  { ruleId: 'PF-N-08', label: '艾滋病患者', terms: ['艾滋病', 'HIV 感染者', 'HIV感染者'] },
  { ruleId: 'PF-N-09', label: '有吸毒史或被强制戒毒的人员', terms: ['吸毒', '强制戒毒', '戒毒人员', '涉毒人员'] },
];

/**
 * 常见汉族姓氏，用于在受保护语境里认出**完整姓名**。
 *
 * 只用来配合 PROTECTED_IDENTITIES 做共现判断，不单独使用——单看姓氏误报会非常多。
 * 「张某」这种已经合规的写法由引擎的 `(?!某)` 排除。
 */
export const SURNAMES: readonly string[] = [
  '王', '李', '张', '刘', '陈', '杨', '黄', '赵', '吴', '周',
  '徐', '孙', '马', '朱', '胡', '郭', '何', '高', '林', '罗',
  '郑', '梁', '谢', '宋', '唐', '许', '邓', '冯', '韩', '曹',
  '曾', '彭', '萧', '蔡', '潘', '田', '董', '袁', '于', '余',
  '叶', '蒋', '杜', '苏', '魏', '程', '吕', '丁', '沈', '任',
  '姚', '卢', '傅', '钟', '姜', '崔', '谭', '廖', '范', '汪',
  '陆', '金', '石', '戴', '贾', '韦', '夏', '邱', '方', '侯',
  '邹', '熊', '孟', '秦', '白', '江', '阎', '薛', '尹', '段',
];
