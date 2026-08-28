# 功能需求与开发进度

> 把关人的功能清单与真实进度。更新于 2026-08-28 18:00。
> 需求来源：[plan.md](plan.md)（六层主链）、[business-process.md](business-process.md)（状态机与留痕）、[market-landscape.md](market-landscape.md)（detector 规格）。
> 技术边界见 [ARCHITECTURE.md](../ARCHITECTURE.md)，分工与时间表见 [EXECUTION-PLAN.md](../EXECUTION-PLAN.md)。

**这份文档的用法**：每一行都写了「证据」——落地的指到具体文件，没落地的写「无」。
状态不靠感觉，靠代码。改完一个功能点顺手把这一行改掉，别攒到最后。

## 状态图例

| 记号 | 含义 |
| --- | --- |
| ✅ | 已落地，且有测试或实测证据 |
| 🟡 | 能跑通，但是桩 / 只做了一部分，演示前需要补 |
| ⬜ | 未开始 |
| ⛔ | 本版明确不做（见第八节） |

---

## 一、素材入口

| # | 功能点 | 状态 | 负责人 | 证据 |
| --- | --- | --- | --- | --- |
| 1.1 | 粘贴通稿正文 | ✅ | William | [workbench-view.ts](../../src/views/workbench-view.ts) 表单 + `POST /api/workbench` |
| 1.2 | 素材类型选择（脚本/小说/通知/通稿/其他） | ✅ | Leo | `contentSourceTypes` [contracts.ts](../../src/domain/contracts.ts) |
| 1.3 | 「模拟 / 脱敏素材」界面标注 | ✅ | William | 顶栏 `.demo-badge` |
| 1.4 | 上传文件（docx / txt） | ⬜ | William | 无 multipart 处理 |
| 1.5 | 预置真实县级政务通稿（脱敏） | ⬜ | 刘浩 | `docs/demo/` 目录不存在 |

> 1.4 是方案里写了「粘贴/上传」的，现在只有粘贴。演示走粘贴就够，**不做也不影响主链**。
> 1.5 属于素材工作，不是代码工作，但**没有它演示就只能用编的**——上台必须如实说明。

## 二、入口准入

判定的不是词，是**这次调用该不该发生**。三档缺一不可。

| # | 功能点 | 状态 | 负责人 | 证据 |
| --- | --- | --- | --- | --- |
| 2.1 | 硬拦：不给调用，模型完全不碰 | ✅ | 黄博文 | `runAdmission` [rules/index.ts](../../src/rules/index.ts)；状态落 `admission-blocked` 终态 |
| 2.2 | 「模型 0 次调用 / 0 tokens / 无内容」证据展示 | ✅ | William | `admissionPanel` 的 `.evidence` 条 |
| 2.3 | 要理由：填选题依据后放行留痕 | ✅ | 黄博文 + William | 无理由返 400，见 `checkTransition` [workflow.ts](../../src/domain/workflow.ts) |
| 2.4 | 仅留痕：直接放行进审计 | ✅ | 黄博文 | 同 2.1 |
| 2.5 | 非业务用途识别（公器私用），只标不拦 | ✅ | 黄博文 | `offDutyUse` 字段，与三档正交 |
| 2.6 | 真实词表（现为 6+10+6 条桩） | 🟡 | 刘浩 | 桩在 `BLOCK_TERMS` / `REASON_TERMS` / `OFF_DUTY_TERMS` |
| 2.7 | 准入判定结果持久化 | 🟡 | 黄博文 | 命中项进了 `rule-hit` 留痕，但结论每次由 `runAdmission` 重算 |

> **2.7 是一笔技术债，要知道它在**：判定是确定性的，所以重算结果一致；但词表一改，历史稿件页面上显示的准入结论会跟着变，而当时的留痕不变。赛后要把结论固化进表。

## 三、生产层（稿件生成）

| # | 功能点 | 状态 | 负责人 | 证据 |
| --- | --- | --- | --- | --- |
| 3.1 | 通稿 → 播报稿 | ✅ | William | `generateBroadcastArtifacts` [broadcast.ts](../../src/model/broadcast.ts) |
| 3.2 | 通稿 → 短视频文案 | ✅ | William | 同上 |
| 3.3 | 生成必须走网关（业务代码不碰 Key） | ✅ | 黄博文 | 只调 `throughGateway()`，无直连 |
| 3.4 | 确定性 mock，零 Key 可演示 | ✅ | William | [broadcast-mock.ts](../../src/model/broadcast-mock.ts)，刻意埋禁用词 / 错数字 / 缺标识 |
| 3.5 | 生成产物按句切分并标 `ai` | ✅ | William | `splitSentences` + `addArtifact(segments)` |
| 3.6 | 接通真实模型（GLM） | ⬜ | 黄博文 | `UPSTREAM_URL` 为空；**且协议口径冲突，见下** |
| 3.7 | 本台风格：风格 skill + 预置历史稿件 | ⬜ | William | 只有一句 system prompt，无历史稿件样例 |

> **3.6 有一个必须先拍板的冲突**：`.env.example` 与 CLAUDE.md 写「Anthropic 兼容」，
> 但 [upstream.ts](../../src/lib/upstream.ts) 实际打的是 OpenAI 的 `/chat/completions`，
> 且 `config.upstreamModel` 默认 `glm-4.6-mock` 而 `.env.example` 写 `GLM-5.2`。
> **接真实模型之前必须统一，否则这一项会卡住。**

## 四、预检层（输出预检）

产出是**标注**，不是闸门。除入口硬拦外一律标出来让人决定。

| # | 功能点 | 状态 | 负责人 | 证据 |
| --- | --- | --- | --- | --- |
| 4.1 | 三档动作 block / redact / flag | ✅ | 黄博文 | `PreflightAction` [gatekeeping.ts](../../src/domain/gatekeeping.ts) |
| 4.2 | 标注锚定到句子（与句级来源共坐标系） | ✅ | 黄博文 | `Annotation.segmentOrdinal` |
| 4.3 | 与原通稿一致性：数字 | ✅ | 黄博文 | `NUMBER_PATTERN`，容忍数字与单位间空格 |
| 4.4 | 与原通稿一致性：日期 | ✅ | 黄博文 | 同上（`YYYY年` / `M月D日`） |
| 4.5 | 与原通稿一致性：人名 / 职务 / 地名 | ⬜ | 黄博文 | 无实体抽取 |
| 4.6 | 禁用词 | 🟡 | 刘浩 | 2 条桩（新华社 102 条） |
| 4.7 | 慎用词 | 🟡 | 刘浩 | 2 条桩 |
| 4.8 | 领导表述规范 | 🟡 | 刘浩 | 1 条桩 |
| 4.9 | AI 生成内容标识：检测缺失 | ✅ | 黄博文 | `AI_LABEL_MARKERS` |
| 4.10 | AI 生成内容标识：自动补写 | ⬜ | 黄博文 | 只给 `suggestion`，不落笔 |
| 4.11 | 隐式标识（文件元数据） | ⬜ | 黄博文 | 无 |
| 4.12 | L2 判断层（导向 / 事实，只标不拦） | ⬜ | 黄博文 | `judgment` 枚举已留位，无规则产出 |
| 4.13 | 双栏对照 + 标注高亮界面 | ✅ | William | `productionPanel` |

> **4.5 与 4.12 是评委最可能追问的两项。** 4.12 至少要做一个 case，
> 输出一律「待人工复核」，不给自动终审结论——主动讲出不确定性是加分的。

## 五、三审流转

| # | 功能点 | 状态 | 负责人 | 证据 |
| --- | --- | --- | --- | --- |
| 5.1 | 状态机（14 条迁移，表驱动） | ✅ | William | [workflow.ts](../../src/domain/workflow.ts) |
| 5.2 | 非法迁移拒绝（409） | ✅ | William | `checkTransition`，[workflow.test.ts](../../test/workflow.test.ts) |
| 5.3 | 三个角色写死 + 一屏切换器 | ✅ | William | `workflowRoles` + 顶栏 `.role-btn` |
| 5.4 | 角色可合并，但每次审批分别留痕 | ✅ | William | 每次迁移写一条 `ReviewRecord` |
| 5.5 | 退回必须带理由，理由进审计 | ✅ | William | 无理由返 400 |
| 5.6 | 「这一步由 X 处理」的等待提示 | ✅ | William | `waitingOn` |
| 5.7 | 签发 → 已发布（按钮只演示状态变化） | ✅ | William | `signed → published` |
| 5.8 | 三审界面（现在只有按钮 + 记录列表） | 🟡 | William | `reviewPanel` 过于素，看不出「三审三校」的分量 |

## 六、审计层（AI 参与度追溯）

**这是方案唯一的结构性卖点。**

| # | 功能点 | 状态 | 负责人 | 证据 |
| --- | --- | --- | --- | --- |
| 6.1 | 句级来源标记（ai / ai-edited / human / source） | ✅ | Leo | `SentenceSegment` + `sentence_segments` 表 |
| 6.2 | AI 参与度公式与重算 | ✅ | Leo | `computeAiShare` [ai-share.ts](../../src/domain/ai-share.ts) |
| 6.3 | **origin 由后端逐句 diff 判定**，前端不许传 | ✅ | William | `deriveSegmentOrigins` [segmentation.ts](../../src/domain/segmentation.ts) |
| 6.4 | 改稿后 AI 参与度当场下降 + 显示落差 | ✅ | William | 实测 100% → 85.7%，`↓ 14.3%（人改过了）` |
| 6.5 | 规则命中进留痕 | ✅ | William | `rule-hit` trace（准入 + 预检各一路） |
| 6.6 | 完整责任链留痕（谁、何时、改了什么） | ✅ | Leo | `trace_events`，一条稿件实测 18 条 |
| 6.7 | **追溯图谱界面** | ⬜ | William | `tracePanel` 是占位文字。**最大缺口** |
| 6.8 | 对照组：关掉把关人再跑同一份通稿 | ⬜ | William | 无 |

> **6.7 是演示脚本 2:20「全场最该停留的一屏」。** 后端数据全齐（6.1–6.6 都是 ✅），
> 缺的纯粹是把它画出来。**这是剩余时间里性价比最高的一件事。**

## 七、横切能力

| # | 能力 | 状态 | 负责人 | 证据 |
| --- | --- | --- | --- | --- |
| 7.1 | 网关唯一模型出口 | ✅ | 黄博文 | `throughGateway()`，全仓库无直连 |
| 7.2 | SQLite + 幂等迁移 + 事务写入 | ✅ | Leo | [migrations.ts](../../src/db/migrations.ts) 两条迁移 |
| 7.3 | SSE 事件流 | ✅ | Leo | `/events`，背压 200 条 + 15s keepalive |
| 7.4 | healthz / readyz + 生产 fail closed | ✅ | Leo | 未配模型且非 demo → 503 |
| 7.5 | Docker + compose | ✅ | Leo | 本地实测 healthy，`/workbench` 可开 |
| 7.6 | CI（typecheck + 测试 + 构建 + 容器冒烟） | ✅ | Leo | [ci.yml](../../.github/workflows) |
| 7.7 | 自动化测试 | ✅ | 全体 | 16 文件 / 94 用例 |
| 7.8 | 首页 `/` 仍是遗留 AuditGate 控制台 | ⬜ | William | 打开根路径显示的不是把关人。**给评委看会尴尬** |
| 7.9 | 红队 probe 改写为广电（诱导导向 / 编造事实 / 未标识） | ⬜ | 黄博文 | 仍是越狱套密钥那十二发 |
| 7.10 | 评分五维改名重算（导向/事实/标识/可追溯/版权） | ⬜ | 黄博文 | 仍是注入抵抗 / 配置卫生 |
| 7.11 | 遗留四页（console/policy/runtime/report）处置 | ⬜ | 全体 | 2238 行死重，讲广电时一个都不用 |

## 八、本版明确不做

写进作品说明，主动划边界比被问出来强。

| 不做 | 出处 |
| --- | --- |
| ⛔ 内容采集对接 / 爬虫 | plan §十三 |
| ⛔ 多平台真实发布（留按钮） | plan §十三 |
| ⛔ 用户与权限体系（三个角色写死） | plan §十三 |
| ⛔ 电子签章 | plan §十三 |
| ⛔ RAG 工程（历史稿件仅作风格样例） | plan §十三 |
| ⛔ 图片 / 视频审核 | ARCHITECTURE |
| ⛔ 申诉流程（`已拒绝` 是终态） | business-process §六 |
| ⛔ 多人并行编辑 / 版本合并 | business-process §六 |
| ⛔ 稿件检索与归档 | business-process §六 |
| ⛔ LangGraph / Redis / Kafka / 微服务 | ARCHITECTURE |

## 九、进度汇总

| 层 | ✅ | 🟡 | ⬜ | 完成度 |
| --- | --- | --- | --- | --- |
| 01 素材入口 | 3 | 0 | 2 | 主链可用 |
| 02 入口准入 | 5 | 2 | 0 | **功能齐，词表待换** |
| 03 生产层 | 5 | 0 | 2 | 主链可用，真实模型未接 |
| 04 预检层 | 6 | 3 | 4 | **一致性与 L2 是缺口** |
| 05 三审流转 | 7 | 1 | 0 | **功能齐，界面素** |
| 06 审计层 | 6 | 0 | 2 | **数据齐，图谱没画** |
| 07 横切 | 7 | 0 | 4 | 底座扎实，遗留页面未清 |
| 合计 | **39** | **6** | **14** | — |

**一句话**：六步主链已经能从素材一路走到签发，底座（网关 / 持久化 / 状态机 / 句级来源 / 部署 / CI）是可交付质量；
缺的集中在两处——**追溯图谱那一屏没画**，**词表和一致性比对还是桩**。

## 十、剩余时间的优先级

按「掉了就演不成」排序，不按「做起来舒服」排序。

| 优先级 | 事项 | 对应 | 预估 |
| --- | --- | --- | --- |
| **P0** | 追溯图谱界面 | 6.7 | 3–4h |
| **P0** | 首页 `/` 指向工作台 | 7.8 | 10min |
| **P1** | 真实词表替换桩 | 2.6 / 4.6–4.8 | 2h（刘浩） |
| **P1** | 接通真实模型 + 统一协议口径 | 3.6 | 2h（黄博文） |
| **P1** | 三审界面做出分量 | 5.8 | 2h |
| **P2** | 一致性比对补人名 / 职务 / 地名 | 4.5 | 2–3h |
| **P2** | L2 判断层一个 case | 4.12 | 2h |
| **P2** | 对照组演示 | 6.8 | 1h |
| **P3** | 脱敏通稿素材 | 1.5 | 刘浩，非代码 |
| **P3** | 红队 probe 与评分改名 | 7.9 / 7.10 | 赛后也行 |

**8/29 20:00 代码冻结前，P0 和 P1 必须全绿。** P2 做不完就不做，别为了 P2 动主链。
