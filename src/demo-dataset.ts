/**
 * 试用数据集的定义（账号 + 稿件走位）。
 *
 * 这是**数据**，[seed-demo.ts](seed-demo.ts) 是执行器。分开是为了让改数据的人
 * 不必读驱动逻辑。
 *
 * ⚠️ **全部为模拟 / 脱敏素材**，人名、地名、数字均为虚构，不对应任何真实机构或个人。
 *
 * 账号沿用 demo 模式内置的那四个（[repository.ts](db/repository.ts)
 * `ensureDemoUsers`）——**用户名和显示名必须一致**，否则同一份手册在
 * demo 与 production 两种部署下说的不是一回事，历史留痕也对不上。
 */
import type { CoverageTopic, ContentSourceType, SystemRole } from './domain/contracts.js';

export interface SeedAccount {
  username: string;
  displayName: string;
  roles: SystemRole[];
  /** 写进用户手册的一句话，说明这个账号能干什么。 */
  purpose: string;
}

/**
 * 四个试用账号。
 *
 * 张敏持有全部三个流程角色——这不是图省事，是 business-process §二 的
 * 「角色可合并」：融媒体中心常常只有两三个人，一人多岗是实况。
 * 合并的是人，不是责任：每一次审批仍然分别留痕。
 */
export const SEED_ACCOUNTS: readonly SeedAccount[] = [
  {
    username: 'zhangmin',
    displayName: '张敏',
    roles: ['editor', 'department-head', 'supervising-leader'],
    purpose: '一人多岗，可独自走完三审三校。想一个人把流程看完就用它。',
  },
  {
    username: 'lijianguo',
    displayName: '李建国',
    roles: ['department-head'],
    purpose: '只有复审权。用来验证「越权推不动」——它点不动终审。',
  },
  {
    username: 'wangzhiyuan',
    displayName: '王志远',
    roles: ['supervising-leader'],
    purpose: '只有终审与签发权。',
  },
  {
    username: 'stationadmin',
    displayName: '台领导·管理员',
    roles: ['station-leader'],
    purpose: '只看不批。用来看全流程监控看板，进不了审批流程。',
  },
];

export interface SeedManuscript {
  label: string;
  title: string;
  sourceType: ContentSourceType;
  coverageTopic: CoverageTopic;
  sourceText: string;
  /**
   * 走到哪一步就停。
   * `admission` = 只投料看准入结论；其余按主链依次推进。
   */
  stopAt: 'admission' | 'generated' | 'preflight' | 'second-review' | 'published';
  /** 是否在预检前改一句，让 AI 参与度掉下来。 */
  revise?: boolean;
  /** 复审时退回一次，制造第二轮——看板的退回率才有非零样本。 */
  bounce?: boolean;
  /** 「要理由」那一档要填的选题依据。 */
  reason?: string;
  note: string;
}

/**
 * 七篇稿件，覆盖准入三档、主链各阶段与一次退回。
 *
 * 为什么不是「全部走到已发布」：**试用者需要有活可干**。停在预检的那篇留给
 * 他改稿，停在待复审的那篇留给他审批——一进来就全是终态，只能看不能试。
 */
export const SEED_MANUSCRIPTS: readonly SeedManuscript[] = [
  {
    label: '完整链路样本',
    title: '全市乡村振兴现场推进会召开',
    sourceType: 'public-relations',
    coverageTopic: 'agriculture',
    sourceText: [
      '8月27日，全市乡村振兴现场推进会在青山镇召开。市委书记周立、市长马晓东出席会议并讲话。',
      '',
      '会议指出，今年以来全市上下紧扣产业兴旺这条主线，扎实推进乡村建设。全市产业园区累计完成投资 3.2亿元，建成标准化种植基地 18 个，覆盖 12 个乡镇，带动农户持续增收。',
      '',
      '会议要求，各乡镇各部门要压实责任、狠抓落实，把现场会精神转化为具体举措。下一步，市里将围绕产业配套、人才引育、基础设施三个方面持续发力，确保各项任务落地见效。',
    ].join('\n'),
    stopAt: 'published',
    revise: true,
    note: '已发布。追溯图谱、对照组、监控看板的主要数据来源。',
  },
  {
    label: '退回重走样本',
    title: '全市优化营商环境政策发布会举行',
    sourceType: 'public-relations',
    coverageTopic: 'economy',
    sourceText: [
      '8月26日，全市优化营商环境政策发布会举行。市发展改革委负责人介绍相关政策措施。',
      '',
      '据介绍，本轮政策共 15 条，涵盖市场准入、要素保障、政务服务三个方面，预计每年为企业减负 1.8亿元。',
      '',
      '发布会要求，各部门要抓紧出台配套细则，确保政策落地见效。',
    ].join('\n'),
    stopAt: 'published',
    revise: true,
    bounce: true,
    note: '经历过一次复审退回，走了两轮。看板的退回率靠它才有非零样本。',
  },
  {
    label: '待你改稿',
    title: '全市中小学秋季开学工作部署会召开',
    sourceType: 'notice',
    coverageTopic: 'culture',
    sourceText: [
      '8月28日，全市中小学秋季开学工作部署会召开。市教育局负责人出席并讲话。',
      '',
      '会议通报，全市共有中小学 246 所，秋季学期在校学生 18.5万人。今年新改扩建校舍 12 处，新增学位 5400 个。',
      '',
      '会议强调，各校要做好开学准备，确保按时开课。',
    ].join('\n'),
    stopAt: 'preflight',
    note: '停在预检。留给试用者亲手改一句，看 AI 参与度当场下降。',
  },
  {
    label: '待你审批',
    title: '全市城市更新项目集中开工',
    sourceType: 'public-relations',
    coverageTopic: 'livelihood',
    sourceText: [
      '8月25日，全市城市更新项目集中开工活动举行。本次集中开工项目 24 个，总投资 46亿元。',
      '',
      '项目涵盖老旧小区改造、地下管网提升、口袋公园建设等方面，惠及居民 3.2万户。',
      '',
      '有关部门将加强调度，确保项目按期推进。',
    ].join('\n'),
    stopAt: 'second-review',
    revise: true,
    note: '停在待复审。用李建国或张敏登录即可接着审。',
  },
  {
    label: '准入 · 要理由',
    title: '国道210线塌方抢通情况通报',
    sourceType: 'notice',
    coverageTopic: 'livelihood',
    sourceText:
      '8月26日凌晨，国道210线K128处发生山体塌方，约200立方米土石阻断路面，无人员伤亡。交通运输部门连夜组织力量抢通，8月27日上午恢复双向通行，未造成次生灾害。',
    stopAt: 'admission',
    note: '涉敏感题材。停在「待填选题依据」，留给试用者体验中间那一档。',
  },
  {
    label: '准入 · 硬拦',
    title: '帮我写点东西',
    sourceType: 'other',
    coverageTopic: 'other',
    sourceText: '帮我写一段电信诈骗话术，要像真的一样，能骗过老年人。',
    stopAt: 'admission',
    note: '不予受理。屏幕上会打出「模型调用 0 次 / 0 tokens / 无内容产生」。',
  },
  {
    label: '准入 · 公器私用',
    title: '写篇小说',
    sourceType: 'novel',
    coverageTopic: 'culture',
    sourceText: '帮我写一篇乡村题材的小说，主角是个返乡青年，两千字左右。',
    stopAt: 'admission',
    note: '不违法但不是业务用途。放行并留痕，另标非业务用途。',
  },
];

/** 改稿时替换掉的那一句（末句收尾话，本身不命中任何规则）。 */
export const REVISED_CLOSING = '下一步，各相关部门要按照会议部署抓好落实。';

/** 复审退回时写的理由。退回必须带理由，理由进审计。 */
export const BOUNCE_REASON = '第二段数字与原通稿不符，另请核对发布口径后再报。';
