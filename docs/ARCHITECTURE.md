# 最终架构与 MVP 边界

## 拍板结论

黑客松版本采用单体 Web 应用：`Hono + TypeScript + SQLite + REST/SSE`，服务端拼装 HTML，无前端框架。

不做前后端分离，不拆 Console/Worker/Proxy 三个部署进程。原因是提交截止在 8 月 29 日 24:00，当前最重要的是尽早跑通完整演示链路。

## 运行结构

```text
浏览器
  │
  ▼
Hono Web/API
  ├── 素材与稿件页面
  ├── 入口准入
  ├── 生产与预检
  ├── 三审流转
  ├── 追溯图谱
  ├── 管理与策略页面
  └── ModelGateway（唯一模型出口）
            │
            ├── GLM
            └── DeepSeek
```

所有业务代码只能依赖 `ModelGateway` 接口，禁止直接读取供应商 Key 或调用供应商 URL。这样即使 Gateway 暂时和主应用同进程，入口准入、调用计量和留痕仍然天然全覆盖。赛后可以在不改业务接口的情况下拆成独立代理进程。

## 六步演示主链

1. 粘贴或上传一份通稿。
2. 入口准入给出“硬拦 / 要理由 / 仅留痕”。
3. 生成播报稿和短视频文案。
4. 预检查禁用词、人物/职务/地名/数字/日期一致性和 AI 标识。
5. 编辑、部门主任、分管领导完成三段流转。
6. 展示句级 AI 参与度、修改、规则命中、放行和签发记录。

## 技术分层

```text
src/routes/       页面、REST、SSE、Gateway HTTP 入口（`throughGateway()` 在 gateway.ts）
src/views/        工作台、监控看板、判定依据、追溯等页面，服务端拼装 HTML
src/domain/       稿件、审次、决定、追溯、句级来源等纯领域模型
src/rules/        入口准入与输出预检的判定实现
src/lib/          detector、guardrail、policy、event 等通用能力
src/middleware/   会话鉴权
src/model/        稿件生成（播报稿 / 短视频文案）与确定性 mock
src/db/           SQLite、Drizzle schema、repository、手写幂等迁移
test/             确定性规则、接口、演示主链回归
```

共享契约已落在 `src/domain/contracts.ts`，页面、Gateway、规则模块只能通过这些类型和底座 API 交换主链数据。

## 数据与运行保证

- SQLite 默认路径为 `./data/app.db`，Docker 内为 `/app/data/app.db`。
- 应用启动时自动执行幂等迁移，开启外键、5 秒 busy timeout 和 WAL。
- 稿件、产物、审核决定、状态变化和追溯使用事务写入。
- `/healthz` 只判断进程存活；`/readyz` 在 production 同时判断数据库、模型配置、强格式会话
  密钥、独立 HTTP Gateway 机器密钥，以及至少一个启用且角色合法的非 demo 账号。
- Docker 使用 Node 22、多阶段构建、非 root 用户和独立持久卷。
- `APP_MODE=production` 且未配置模型时，除非显式允许 Mock，否则 `/readyz` 返回 503。
- production 不 seed 演示账号；一次性 CLI 通过隐藏 TTY/stdin 建立 `is_demo=0` 的固定角色账号。
  数据卷从 demo 切换到 production 时，持久化的 demo 账号即使密码正确也不能登录。
  每次会话重载同样检查该标记，旧 demo cookie 不能跨模式继续访问。
- 遗留 policy/runtime/redteam/monitor/report/controlled-target 路由只在 demo 挂载；production
  HTTP `/gateway/v1/messages` 使用独立强 API key。进程内 `throughGateway()` 仍是主链唯一模型
  出口，不经过浏览器会话或 HTTP 机器认证。
- 判定依据（词表）落库并可管理，词表整体带单调递增的 `rulesetVersion`，写进每一次准入与
  预检留痕；改动写不可变的 `rule_change_log`。**判定依据可变之后，留痕必须带依据的版本，
  否则留痕本身失去意义。**
- 每日调用次数与 token 上限挂在 `throughGateway()` 上（与「绕不过网关就绕不过准入」同一个
  论证），计数按（本地日期，账号）落库。**超限是资源判定，与入口准入的内容判定不共用任何
  字段**：独立的 429、独立的 `quota-blocked` 留痕、稿件状态不动。出厂不限。

## 黑客松内明确不做

- 不做爬虫和外部采集系统对接，只粘贴/上传。
- 不做真实多平台发布，按钮只演示状态变化。
- 做账号与固定角色组合，但不做权限配置后台、密码找回、SSO 或用户管理 UI。
- 不做电子签章。
- 不做 RAG 平台，历史稿件仅作为预置风格样例。
- L2 模型判断最多一个场景，只标记“待人工复核”，不能替人终审。
- 不做图片、视频审核。
- 不引入 LangGraph、Redis、Kafka或微服务编排。

## 从 AuditGate 保留什么

- Gateway 强制入口
- 请求/响应双向扫描钩子
- `block / redact / flag` 三档动作
- 策略、事件流、逐用户计量
- 红队、评分和报告框架
- 原有自动化测试

生产环境必须 fail closed。Mock 只用于演示和测试，上游失败不得返回伪造成功内容。
