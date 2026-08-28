# guiks-gd-content-moderation

贵客松赛道二·广电方向的独立 Web Demo。目标是一条可现场跑通的县级融媒闭环：

> 素材入口 → 入口准入 → 稿件生成 → 输出预检 → 三审流转 → AI 参与度追溯

项目从薄荷 `AuditGate` PR 的可运行代码起步，但独立建库、独立配置、独立部署，不依赖薄荷线上服务。

## 黑客松技术栈

- Node.js 22 + TypeScript
- Hono + 服务端 HTML/Hono JSX + 少量浏览器 JavaScript
- SQLite + Drizzle ORM
- Claude Agent SDK
- 统一模型 Gateway（当前为 OpenAI-compatible Chat Completions；Anthropic Messages/SSE 适配待接入）
- REST + SSE
- Vitest + Docker Compose

第一版保持单仓库、单服务、单容器。模型 Gateway 是代码级硬边界：业务模块不得直接访问模型供应商。

## 当前底座

当前代码保留了原 AuditGate 已验证的：

- 请求/响应双向扫描
- `block / redact / flag` 三档动作
- 策略配置
- SSE 事件流
- 逐用户用量
- 红队与报告
- 广电主链共享契约（稿件、产物、审次、决定、追溯）
- SQLite/Drizzle 持久化与自动迁移
- 稿件工作流 REST API 与 SSE 事件
- `healthz` 存活检查和 `readyz` 数据库/模型就绪检查
- Vitest 全量自动化回归与 GitHub Actions

这些能力将从“通用 AI 保密审计”改造为“县级融媒适播预检与生产追溯”。原说明保存在 [docs/legacy-auditgate-readme.md](docs/legacy-auditgate-readme.md)，组长方案保存在 [docs/design/broadcast-pivot.html](docs/design/broadcast-pivot.html)。

## 本地运行

```bash
npm install
cp .env.example .env
npm run dev
```

打开 <http://localhost:3300>。

```bash
npm run check
npm run build
docker compose up --build
```

默认使用内置确定性 Mock，不需要 API Key。当前真实模型适配器使用 OpenAI-compatible
Chat Completions；在 `.env` 设置统一的 `UPSTREAM_URL`、`UPSTREAM_KEY` 和
`UPSTREAM_MODEL` 即可接入同协议代理，业务代码不得自行读取这些变量。Anthropic
Messages/SSE 适配由轨道 A 接入后再启用。

> 公网接入真实模型前，必须先合入轨道 C 的登录鉴权或在部署层统一保护所有业务路由。
> `GATEWAY_TOKEN` 只保护原始 `/gateway/v1/messages` 接口，不能替代 Web 产品的用户鉴权。

Docker 会以非 root 用户运行，并把 SQLite 数据保存在命名卷
`moderation-data`。`docker compose down` 不会删除数据；只有明确执行
`docker compose down -v` 才会删除该卷。

## 底座 API

- `GET /healthz`：进程存活
- `GET /readyz`：SQLite 与模型配置就绪状态
- `GET /api/meta`：无密钥的运行信息
- `GET/POST /api/manuscripts`：稿件列表与创建
- `GET /api/manuscripts/:id`：稿件、产物、审核和追溯聚合
- `POST /api/manuscripts/:id/artifacts`：保存播报稿或短视频文案
- `POST /api/manuscripts/:id/reviews`：保存准入/预检/三审决定
- `PATCH /api/manuscripts/:id/status`：推进工作流状态
- `POST /api/manuscripts/:id/trace`：追加模型、规则或系统追溯事件
- `GET /events`：SSE 实时事件流

请求与响应示例见 [底座 API 契约](docs/API.md)。

## 开发入口

- [最终架构与边界](docs/ARCHITECTURE.md)
- [团队分工与截止时间](docs/EXECUTION-PLAN.md)
- [协作规则](CONTRIBUTING.md)

`main` 必须始终能演示。功能开发走短分支、小 PR；影响共享契约、模型 Gateway 或演示链路的修改需要黄博文或 William 复核。
