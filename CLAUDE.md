# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **同步维护要求：** 本文件与 [AGENT.md](AGENT.md) 是等价的协作指引。每次修改其中任一文件时，必须同步更新另一份文件，确保两者内容和约束一致。

## 项目

`guiks-gd-content-moderation`——融媒体中心的稿件生产与监理 Demo（贵客松赛道二·广电方向）。一条六步主链：

```
素材入口 → 入口准入 → 稿件生成 → 输出预检 → 三审流转 → AI 参与度追溯
```

**权威方案在 [docs/gatekeeper/](docs/gatekeeper/)**，改动主链语义前先读 [plan.md](docs/gatekeeper/plan.md)（口径与系统六层）、[business-process.md](docs/gatekeeper/business-process.md)（状态机与留痕规则）、[market-landscape.md](docs/gatekeeper/market-landscape.md)（竞品与 detector 规格）。技术边界在 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，分工与时间表在 [docs/EXECUTION-PLAN.md](docs/EXECUTION-PLAN.md)。

代码从薄荷 `AuditGate` 起步，但独立建库、独立部署，不依赖薄荷线上服务。

**开工前先看 [requirements.md](docs/gatekeeper/requirements.md) 第十一节（三轨道分工）与第十二节（轨道 C 冲突）**：
当前有三条并行轨道——A 状态机与审核内核、B 界面与规则数据、C 账号角色权限。
两处共享文件是串行的，**`src/domain/contracts.ts` 同时被 A 的校次契约与 C 的角色分层改动，不要并行动它**。

## 命令

```bash
npm run dev                      # tsx watch，http://localhost:3300
npm run check                    # typecheck + 全部测试；提交前必跑
npm test                         # vitest run
npx vitest run test/policy.test.ts           # 跑单个测试文件
npx vitest run -t "blocks planted secret"    # 按用例名跑
npm run build && npm run start:prod          # tsc → dist，node 运行
docker compose up --build
npm run seed:demo                # 播种试用账号与稿件走位（src/demo-dataset.ts）
npm run reset:demo               # 清掉试用数据
npm run provision:user           # 建账号（production 部署用）
```

无需 API Key 即可启动：`UPSTREAM_URL` 为空时走 `src/lib/scenarios.ts` 里的确定性 mock。当前真实模型适配器支持 OpenAI-compatible Chat Completions；单模型兼容配置使用 `UPSTREAM_URL` / `UPSTREAM_KEY` / `UPSTREAM_MODEL`，多模型部署使用 `UPSTREAM_PROFILES_JSON`，为每个模型独立绑定 URL / Key / thinking / timeout，并用 `UPSTREAM_MODEL` 指定默认模型。DeepSeek V4 低延迟演示建议 `thinking=disabled`；GLM-5.3 / GLM-5.3-Flash 必须使用 `provider-default`。**业务代码不得自行读取这些变量，浏览器 API 不得返回 URL / Key**。Anthropic Messages/SSE 需要另行实现适配器。测试里 `NODE_ENV=test` 自动使用 `:memory:` 数据库。

## 架构

同一进程里并存**两套状态**，不要把它们搞混：

| | 遗留 AuditGate 通用审计 | 广电稿件主链 |
| --- | --- | --- |
| 状态 | `src/lib/store.ts` 内存环形缓冲（audits / findings / guardrail / usage），进程重启即失 | SQLite（`src/db/`），事务写入，启动时幂等迁移 |
| 契约 | `src/types.ts` | `src/domain/contracts.ts` |
| 入口 | `/gateway/v1/messages`、`/api/state`、`/api/usage`、`/redteam`、`/report` | `/api/manuscripts*`、`/api/workbench*`、`/api/monitor/overview` |
| 页面 | `/console`、`/policy`、`/runtime`、`/report`（后四个只在 `APP_MODE=demo` 下挂载） | **`/`**（产品介绍页，公开）、`/workbench`（工作台）、`/monitor`（全流程监控看板）、`/rules`（判定依据管理） |

两套都通过 `src/lib/bus.ts` 往同一条 SSE `/events` 发事件，浏览器按 event name 区分。

### 硬约束

1. **模型只能经网关出去。** `throughGateway()`（[src/routes/gateway.ts](src/routes/gateway.ts)）是唯一出口，业务模块不许直连供应商 URL 或读 Key。这既保证审计零遗漏，也是入口准入闸的强制力来源——绕不过网关就绕不过准入。
2. **`src/domain/contracts.ts` 是跨人协作的共享契约。** 页面、Gateway、规则模块只能通过这些类型交换主链数据；改它需要另一位成员复核。
3. **迁移只追加，不改历史。** [src/db/migrations.ts](src/db/migrations.ts) 是手写的 id + SQL 数组，`drizzle.config.ts` 只用于 `db:studio`/`generate`，运行时不读 drizzle 生成物。schema 变更要同时改 `src/db/schema.ts` 和新增一条 migration。
4. **生产 fail closed。** `APP_MODE=production` 且未配模型时，除非显式 `ALLOW_MOCK_UPSTREAM`，`/readyz` 返回 503。上游失败不得伪造成功内容。
5. **`main` 必须随时能演示。** 短分支小 PR，`npm run check` 通过再提。
6. **真实模型不裸奔。** `GATEWAY_TOKEN` 只保护原始网关接口；工作台、靶场、红队和 runtime 要等轨道 C 登录鉴权或部署层统一保护后，才能带真实上游公开部署。Mock 演示不受此限制。
7. **判定依据自己也要被追溯。** 词表可改，所以每一次准入/预检留痕都带 `rulesetVersion`，每一次词表改动都写不可变的 `rule_change_log`（谁、何时、哪条、从什么改成什么、为什么）。**出处与理由都是服务端必填**，内置基线删不掉、词面与出处改不了——「基线是什么」必须永远查得回去。
8. **超限不是内容判定。** 使用限制判「这个账号今天还能不能调」（资源），入口准入判「这次调用该不该发生」（内容）。两套结论**一个字段都不共用**：超限走 429 `usage_quota_exceeded`、留痕 kind 是 `quota-blocked`（actor「使用限制」）、**稿件状态一步不动**，文案里明写「这不是内容判定」。混在一起，留痕里就会长出「因为超限所以被判违规」的假因果。

### 双向治理的两个钩子

- `scanRequest()` —— 入向。方案里的**入口准入**：硬拦（不给调用，模型完全不碰）/ 要理由（填选题依据后放行留痕）/ 仅留痕，外加"非业务用途识别"（公器私用，只标不拦）。
- `scanResponse()` —— 出向。方案里的**输出预检**：禁用词与慎用词、领导表述规范、与原通稿的一致性比对（人名/职务/地名/数字/日期）、AI 生成内容标识。

两者的判定结果经 `evaluateGuardrails()`（[src/lib/guardrails.ts](src/lib/guardrails.ts)）落到三档动作 `block / redact / flag`，语义按方案重新定义为审片动作：拦下不让播 / 标红待复核 / 放行留痕。**挂载位置与三档动作原样复用，换的是函数体和词表。**

## 当前进度（重要）

底座已就位：网关、双向 scan 钩子、护栏、策略、SSE、逐用户计量、红队与评分、稿件工作流的契约/持久化/REST、healthz+readyz、Docker、CI。

**已落地**：

- 入口准入与输出预检的**结果契约**在 [src/domain/gatekeeping.ts](src/domain/gatekeeping.ts)，规则实现在 [src/rules/](src/rules/)，工作台在 [src/routes/workbench.ts](src/routes/workbench.ts) + [src/views/workbench-view.ts](src/views/workbench-view.ts)，稿件生成在 [src/model/](src/model/)。换 detector 只换 `src/rules/` 的函数体，界面不动。
- 模型调用按 `callId` 成对写入 `model-requested` / `model-completed`，完成事件持久化请求/实际模型、tokens、耗时与计量来源，并进入工作台留痕和 `trace` SSE。无稿件上下文的通用代理流量尚未写入 SQLite。
- 句级切分与改稿后的来源判定在 [src/domain/segmentation.ts](src/domain/segmentation.ts)：**来源由服务端判定，不接受客户端上报**——被考核的人能自己标「我改过」，这个数就什么都不是了。
- 句级来源标记**已落地**：`sentenceOrigins` + `SentenceSegment` 在契约里，`sentence_segments` 表在 migration `0002`，AI 参与度算在 [src/domain/ai-share.ts](src/domain/ai-share.ts)（`(ai + ai-edited×0.5)/总句数`，权重可调）。产物带 `segments` 创建时自动算，人改稿后调 `PUT /api/manuscripts/:id/artifacts/:artifactId/segments` 整段替换并重算，写 `segments-recorded` 追溯。
**AI 参与度和产物级 `origin` 都只由句级来源推导，不接受手工填**——带了 `segments` 就忽略请求里的 `aiShare` 与 `origin`（全 `ai` → `ai`，一句 AI 都没有 → `human`，其余 `mixed`；`source` 算非 AI）。

- **AI 参与度追溯图谱已落地**：`tracePanel` 在 [src/views/workbench-view.ts](src/views/workbench-view.ts)，
  五块内容——签发卡、AI 参与度折线、句级来源图谱、责任链、规则命中。折线画的是稿件级比例，从留痕重建。
- **首页是产品介绍页**：`/` 是公开、不含任何稿件数据的产品说明页（[src/routes/landing.ts](src/routes/landing.ts) + [src/views/landing-view.ts](src/views/landing-view.ts)），「进入试用」指向 `/workbench`；**工作台已从 `/` 收敛到 `/workbench`**，未登录由它自己转 `/login`。遗留 AuditGate 控制台在 `/console`。
- **全流程监控看板已落地**：`/monitor` 页面在 [src/views/oversight-view.ts](src/views/oversight-view.ts)，聚合端点 `GET /api/monitor/overview` 在 [src/routes/oversight.ts](src/routes/oversight.ts)，跨稿件 SQL 在 [src/db/oversight.ts](src/db/oversight.ts)。与工作台第 ⑥ 屏的分工：**追溯图谱答「这一篇稿子怎么走的」，监控看板答「这个台最近在怎么写稿」**。页面与端点都要 `audit:read`，与 `/api/state` 取齐。⚠️ 别和遗留的 `/api/monitor/start`（[src/routes/monitor.ts](src/routes/monitor.ts)，AuditGate 时代的内存态播种）搞混。
- **试用数据集与用户手册已落地**：数据定义在 [src/demo-dataset.ts](src/demo-dataset.ts)（**全部模拟/脱敏素材**，人名地名数字均为虚构），执行器是 [src/seed-demo.ts](src/seed-demo.ts)，手册在 [docs/deploy/user-manual.md](docs/deploy/user-manual.md)（另有同名 `.html` 一份，含监控一节与可粘贴素材）。试用账号的用户名与显示名必须与 `ensureDemoUsers`（[src/db/repository.ts](src/db/repository.ts)）一致，否则 demo 与 production 两种部署下手册说的不是一回事、历史留痕也对不上。
- **轨道 A 审核内核已落地**：校次契约、`revision` 复核修改、可选 `countersign` 会签、审核轮次、会签表单与意见留痕、改稿后重新预检、实体一致性、L2「待人工复核」、AI 显式/隐式标识和准入结论持久化均已实现。轨道 A migration 使用 `0004`，轨道 C 用户表使用 `0003`。
- **轨道 C 登录鉴权已落地**：SQLite 用户与角色、scrypt 密码、签名会话、固定权限矩阵、真人留痕、production 强凭据与建号边界均已接入；模型列表和稿件业务接口同样受会话保护。
- **判定依据落库并可管理**：词条在 `rule_terms`（migration `0006`），页面 `/rules`（[src/views/rules-view.ts](src/views/rules-view.ts)）+ REST `/api/rules*`（[src/routes/rules.ts](src/routes/rules.ts)），持久层在 [src/db/ruleset.ts](src/db/ruleset.ts)。
  **[src/rules/terms.ts](src/rules/terms.ts) 不再是运行时数据，而是「内置基线」的权威定义**，由启动时幂等的 `ensureBuiltinRuleTerms()` 灌库（只补缺失的 ruleId，不覆盖已有行，所以停用状态不会被重启冲掉）。
  引擎 `runAdmission()` / `runPreflight()` 多一个 `ruleset` 参数，**默认仍是内置基线**——测试与准入案例拿到的是确定性的基线结果；工作台传 [src/rules/active.ts](src/rules/active.ts) 的 `activeRuleset()`。
  **只有词条落库**：正则（标点/格式/叠字）、共现规则（当事人姓名保护）、一致性比对与 L2 判断留在代码里，界面只读展示——让人从浏览器塞任意正则等于开一个远程拒绝服务的口子。
  权限：`rules:read` 给全部系统角色，`rules:write` 只给 `station-leader`。
- **使用限制已落地**：单账号每日调用次数与 token 上限，表在 `usage_limits` / `usage_counters` / `usage_limit_events`（migration `0007`），持久层 [src/db/usage.ts](src/db/usage.ts)，界面是 `/rules` 的「使用限制」页签，端点 `GET|PUT /api/usage-limits`。
  **执行点在 `throughGateway()`**，和准入同一个论证：绕不过网关就绕不过配额。挡在模型之前，token 一个没烧。
  **计数落库**——`/api/usage`（`src/lib/store.ts`）是内存环形缓冲，进程重启即清零，配额建在它上面等于重启就能续杯。按（本地日期，账号）计数，按账号不按显示名。
  上游 429/502 不吃额度；**出厂两项都不限**，所以装上这一版开箱行为不变。权限 `usage-limit:read` 给全部角色，`usage-limit:write` 只给 `station-leader`。
- **真实模型协议与切换已落地**：OpenAI 兼容 `/chat/completions` 可接 GLM / DeepSeek；模型配置档把供应商 URL、Key、思考模式与超时绑定到模型，工作台可按次切换并写入模型留痕。DeepSeek V4 已用真实 Key 完成双产物、服务商计量与失败恢复验收；GLM-5.3 / GLM-5.3-Flash 的真实请求均已到达服务端并识别模型，但当前账户因余额或资源包不足返回 429，待充值后补成功响应验收。仓库不保存真实 URL/Key。
- **红队与评分已转为广电口径**：12 发探针覆盖导向、事实、标识、可追溯、版权，评分使用同名五维。

**还差**：

- [src/lib/detectors.ts](src/lib/detectors.ts) 的 `scanRequest()` / `scanResponse()` 仍是 AuditGate 旧规格（提示注入词表 / PII + 密钥），**网关那条路还没接上广电规则**——新规则目前只在 `src/rules/` 里被工作台调用，两边最终要合，否则「绕不过网关就绕不过准入」这句在代码里还不成立。
- DeepSeek V4 已完成本地 Docker 真实联调；GLM 两个模型待账户补充余额或资源包后完成成功响应验收。其他部署环境仍需自行安全注入模型配置档与网关令牌。
- `/console`、`/policy`、`/runtime`、`/report` 四个遗留页面未改（2238 行，讲广电时一个都不用）；后三个连同 `/redteam`、靶场与 demo 重置端点现在只在 `APP_MODE=demo` 下挂载。⚠️ **`/policy` 与 `/rules` 不是一回事**：前者作用在 `src/lib/detectors.ts` 的遗留规格上、内存态、进程重启即失，且不作用于主链；主链在用的判定依据在 `/rules`。
- `test/fixtures/` 仍不存在；`docs/demo/` 已建（演示脚本、runbook、准入案例、展台易拉宝）。

## 措辞纪律（用户可见文案与文档都适用）

- **不说「安全」**——会被听成内容安全红海，且是防御性的；要说敢发、发得快、出了事说得清。
- **不说「敏感词过滤」**——那层叫**「入口准入」**，判定的不是词，是这次调用该不该发生。
- **产品名使用 `guiks-gd-content-moderation`**——`AuditGate` 仅用于说明代码来源，不再使用旧产品名。
- **不说「县级」**——产品面向**融媒体中心**，不限行政层级；运行条件类论据说「中小型融媒体中心」或「人手紧的编辑部」。例外只有三处：国标《县级融媒体中心建设规范》、参考文献标题、赛事手册原话，引用时保持原文。演示素材统一用市级。
- **不假装审校是空白**——方正 21 类 136 词库、黑马 30 年是既成事实。词表是配角，卖点是句级来源标记。
- 《广播电视安全播出管理规定》管**技术**播出安全（停播、信号、设备），**不管内容差错**，别混着讲。
- 演示素材若非来自真实机构，界面和作品说明必须写明「模拟/脱敏素材」。
- L2 模型判断一律输出「待人工复核」，不给自动终审结论。

## 分支

`feat/audit-gateway`（黄博文·网关与审核内核）、`feat/editor-workflow`（William·生产链路与界面）、`feat/foundation`（Leo·底座与发布）、`feat/rules-fixtures`（刘浩·规则数据与素材），紧急修复用 `fix/<short-name>`。不要在一个分支里同时重构共享底座和开发页面。
