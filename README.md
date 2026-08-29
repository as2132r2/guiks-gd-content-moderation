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
- SQLite 账号、固定角色组合、签名会话与稳定真人留痕
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

打开 <http://localhost:3300>，未登录会跳转到 `/login`。demo/test 模式会幂等创建四个演示账号；
默认密码为 `gatekeeper-demo`，也可以在登录页一键进入。`zhangmin`（张敏）持有全部三个流程角色，
可在同一工作台切换本次行使身份；`lijianguo`、`wangzhiyuan` 分别只有主任和分管领导角色，
`stationadmin` 是只读台领导账号。production 不创建这些已知密码账号，也禁止一键登录。

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

## Production 启动边界

production 的 `SESSION_SECRET` 和 `GATEWAY_TOKEN` 必须各自使用 `base64:` 加至少 32 个
随机字节，且不能复用。分别运行下面的生成命令两次，把两个不同结果交给部署环境的 secret
管理器；仓库和 `.env.example` 不保存可用于 production 的已知值：

```bash
node -e "console.log('base64:'+require('node:crypto').randomBytes(32).toString('base64'))"
```

production 不自动创建账号。启动进程或容器后，使用同一 `DATABASE_PATH` 执行一次性建号命令；
交互式终端会隐藏输入并要求确认密码，密码不会出现在参数、输出或应用日志中：

```bash
APP_MODE=production DATABASE_PATH=./data/app.db npm run provision:user -- \
  --username news-editor --display-name "生产编辑" --roles editor
```

production 镜像内可执行：

```bash
docker compose exec app node dist/provision-user.js \
  --username news-editor --display-name "生产编辑" --roles editor
```

自动化只能通过 stdin 提供密码；必须使用 CI secret 注入并关闭命令回显，避免 shell 历史、
进程列表和构建日志泄露。CLI 明确拒绝 `--password`。可用角色为 `editor`、
`department-head`、`supervising-leader`、`station-leader`，至少一个角色且不得重复。

`/readyz` 在 production 同时要求数据库、模型、强会话密钥、强机器网关密钥，以及至少一个
启用且角色合法的非 demo 账号。原演示控制面（policy/runtime/redteam/monitor/report/controlled
target）只在 demo 挂载，production 返回 404。HTTP `/gateway/v1/messages` 使用独立的
`GATEWAY_TOKEN`（`Authorization: Bearer ...` 或 `x-api-key`）；进程内稿件生成仍直接调用
`throughGateway()`，不需要伪造 HTTP 凭据。

## 底座 API

- `GET /healthz`：进程存活
- `GET /readyz`：SQLite、模型与 production 身份/机器凭据就绪状态
- `GET /api/meta`：无密钥的运行信息
- `POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me`：登录与签名会话
- `GET/POST /api/manuscripts`：稿件列表与创建
- `GET /api/manuscripts/:id`：稿件、产物、审核和追溯聚合
- `POST /api/manuscripts/:id/artifacts`：保存播报稿或短视频文案
- `POST /api/manuscripts/:id/reviews`：保存准入/预检/三审决定
- `PATCH /api/manuscripts/:id/status`：推进工作流状态
- `POST /api/manuscripts/:id/trace`：仅应用内部 repository 能力，浏览器 HTTP 账号不可伪造
- `GET /events`：SSE 实时事件流

请求与响应示例见 [底座 API 契约](docs/API.md)。

## 开发入口

- [最终架构与边界](docs/ARCHITECTURE.md)
- [团队分工与截止时间](docs/EXECUTION-PLAN.md)
- [协作规则](CONTRIBUTING.md)

`main` 必须始终能演示。功能开发走短分支、小 PR；影响共享契约、模型 Gateway 或演示链路的修改需要黄博文或 William 复核。
