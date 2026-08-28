# AGENT.md

This file provides guidance to coding agents when working with code in this repository.

> **同步维护要求：** 本文件与 [CLAUDE.md](CLAUDE.md) 是等价的协作指引。每次修改其中任一文件时，必须同步更新另一份文件，确保两者内容和约束一致。

## 项目

「把关人」——县级融媒体中心的稿件生产与监理 Demo（贵客松赛道二·广电方向）。一条六步主链：

```
素材入口 → 入口准入 → 稿件生成 → 输出预检 → 三审流转 → AI 参与度追溯
```

**权威方案在 [docs/gatekeeper/](docs/gatekeeper/)**，改动主链语义前先读 [plan.md](docs/gatekeeper/plan.md)（口径与系统六层）、[business-process.md](docs/gatekeeper/business-process.md)（状态机与留痕规则）、[market-landscape.md](docs/gatekeeper/market-landscape.md)（竞品与 detector 规格）。技术边界在 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，分工与时间表在 [docs/EXECUTION-PLAN.md](docs/EXECUTION-PLAN.md)。

代码从薄荷 `AuditGate` 起步，但独立建库、独立部署，不依赖薄荷线上服务。

## 命令

```bash
npm run dev                      # tsx watch，http://localhost:3300
npm run check                    # typecheck + 全部测试；提交前必跑
npm test                         # vitest run
npx vitest run test/policy.test.ts           # 跑单个测试文件
npx vitest run -t "blocks planted secret"    # 按用例名跑
npm run build && npm run start:prod          # tsc → dist，node 运行
docker compose up --build
```

无需 API Key 即可启动：`UPSTREAM_URL` 为空时走 `src/lib/scenarios.ts` 里的确定性 mock。接真实模型只设 `UPSTREAM_URL` / `UPSTREAM_KEY` / `UPSTREAM_MODEL`（Anthropic 兼容），**业务代码不得自行读取这三个变量**。测试里 `NODE_ENV=test` 自动使用 `:memory:` 数据库。

## 架构

同一进程里并存**两套状态**，不要把它们搞混：

| | 遗留 AuditGate 通用审计 | 广电稿件主链 |
| --- | --- | --- |
| 状态 | `src/lib/store.ts` 内存环形缓冲（audits / findings / guardrail / usage），进程重启即失 | SQLite（`src/db/`），事务写入，启动时幂等迁移 |
| 契约 | `src/types.ts` | `src/domain/contracts.ts` |
| 入口 | `/gateway/v1/messages`、`/api/state`、`/api/usage`、`/redteam`、`/report` | `/api/manuscripts*` |

| 页面 | `/`(console)、`/policy`、`/runtime`、`/report` | `/workbench`（工作台，`/api/workbench*`） |

两套都通过 `src/lib/bus.ts` 往同一条 SSE `/events` 发事件，浏览器按 event name 区分。

### 硬约束

1. **模型只能经网关出去。** `throughGateway()`（[src/routes/gateway.ts](src/routes/gateway.ts)）是唯一出口，业务模块不许直连供应商 URL 或读 Key。这既保证审计零遗漏，也是入口准入闸的强制力来源——绕不过网关就绕不过准入。
2. **`src/domain/contracts.ts` 是跨人协作的共享契约。** 页面、Gateway、规则模块只能通过这些类型交换主链数据；改它需要另一位成员复核。
3. **迁移只追加，不改历史。** [src/db/migrations.ts](src/db/migrations.ts) 是手写的 id + SQL 数组，`drizzle.config.ts` 只用于 `db:studio`/`generate`，运行时不读 drizzle 生成物。schema 变更要同时改 `src/db/schema.ts` 和新增一条 migration。
4. **生产 fail closed。** `APP_MODE=production` 且未配模型时，除非显式 `ALLOW_MOCK_UPSTREAM`，`/readyz` 返回 503。上游失败不得伪造成功内容。
5. **`main` 必须随时能演示。** 短分支小 PR，`npm run check` 通过再提。

### 双向治理的两个钩子

- `scanRequest()` —— 入向。方案里的**入口准入**：硬拦（不给调用，模型完全不碰）/ 要理由（填选题依据后放行留痕）/ 仅留痕，外加"非业务用途识别"（公器私用，只标不拦）。
- `scanResponse()` —— 出向。方案里的**输出预检**：禁用词与慎用词、领导表述规范、与原通稿的一致性比对（人名/职务/地名/数字/日期）、AI 生成内容标识。

两者的判定结果经 `evaluateGuardrails()`（[src/lib/guardrails.ts](src/lib/guardrails.ts)）落到三档动作 `block / redact / flag`，语义按方案重新定义为审片动作：拦下不让播 / 标红待复核 / 放行留痕。**挂载位置与三档动作原样复用，换的是函数体和词表。**

## 当前进度（重要）

底座已就位：网关、双向 scan 钩子、护栏、策略、SSE、逐用户计量、红队与评分、稿件工作流的契约/持久化/REST、healthz+readyz、Docker、CI。

**已落地**：

- 入口准入与输出预检的**结果契约**在 [src/domain/gatekeeping.ts](src/domain/gatekeeping.ts)，规则实现在 [src/rules/](src/rules/)，工作台在 [src/routes/workbench.ts](src/routes/workbench.ts) + [src/views/workbench-view.ts](src/views/workbench-view.ts)，稿件生成在 [src/model/](src/model/)。换 detector 只换 `src/rules/` 的函数体，界面不动。
- 句级切分与改稿后的来源判定在 [src/domain/segmentation.ts](src/domain/segmentation.ts)：**来源由服务端判定，不接受客户端上报**——被考核的人能自己标「我改过」，这个数就什么都不是了。
- 句级来源标记**已落地**：`sentenceOrigins` + `SentenceSegment` 在契约里，`sentence_segments` 表在 migration `0002`，AI 参与度算在 [src/domain/ai-share.ts](src/domain/ai-share.ts)（`(ai + ai-edited×0.5)/总句数`，权重可调）。产物带 `segments` 创建时自动算，人改稿后调 `PUT /api/manuscripts/:id/artifacts/:artifactId/segments` 整段替换并重算，写 `segments-recorded` 追溯。
**AI 参与度和产物级 `origin` 都只由句级来源推导，不接受手工填**——带了 `segments` 就忽略请求里的 `aiShare` 与 `origin`（全 `ai` → `ai`，一句 AI 都没有 → `human`，其余 `mixed`；`source` 算非 AI）。

**还差**：

- [src/lib/detectors.ts](src/lib/detectors.ts) 的 `scanRequest()` / `scanResponse()` 仍是 AuditGate 旧规格（提示注入词表 / PII + 密钥），**网关那条路还没接上广电规则**——新规则目前只在 `src/rules/` 里被工作台调用，两边最终要合，否则「绕不过网关就绕不过准入」这句在代码里还不成立。
- `/`、`/policy`、`/runtime`、`/report` 四个遗留页面未改。
- `test/fixtures/`、`docs/demo/` 仍不存在。

## 措辞纪律（用户可见文案与文档都适用）

- **不说「安全」**——会被听成内容安全红海，且是防御性的；要说敢发、发得快、出了事说得清。
- **不说「敏感词过滤」**——那层叫**「入口准入」**，判定的不是词，是这次调用该不该发生。
- **不说 AuditGate**——代码目录名保持不动，对外一律说「把关人」。
- **不假装审校是空白**——方正 21 类 136 词库、黑马 30 年是既成事实。词表是配角，卖点是句级来源标记。
- 《广播电视安全播出管理规定》管**技术**播出安全（停播、信号、设备），**不管内容差错**，别混着讲。
- 演示素材若非来自真实机构，界面和作品说明必须写明「模拟/脱敏素材」。
- L2 模型判断一律输出「待人工复核」，不给自动终审结论。

## 分支

`feat/audit-gateway`（黄博文·网关与审核内核）、`feat/editor-workflow`（William·生产链路与界面）、`feat/foundation`（Leo·底座与发布）、`feat/rules-fixtures`（刘浩·规则数据与素材），紧急修复用 `fix/<short-name>`。不要在一个分支里同时重构共享底座和开发页面。
