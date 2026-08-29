# guiks-gd-content-moderation

贵客松赛道二·广电方向的独立 Web Demo。目标是一条可现场跑通的融媒闭环：

> 素材入口 → 入口准入 → 稿件生成 → 输出预检 → 三审流转 → AI 参与度追溯

项目从薄荷 `AuditGate` PR 的可运行代码起步，但独立建库、独立配置、独立部署，不依赖薄荷线上服务。

## 黑客松技术栈

- Node.js 22 + TypeScript
- Hono + 服务端拼装 HTML（模板字符串，无前端框架、无构建步骤）+ 页面内联的少量浏览器 JavaScript
- SQLite（better-sqlite3）+ Drizzle ORM；迁移是手写的幂等 SQL 数组，运行时不读 drizzle 生成物
- 统一模型 Gateway（当前为 OpenAI-compatible Chat Completions，已接 GLM 与 DeepSeek；Anthropic Messages/SSE 适配待接入）
- REST + SSE
- Vitest + GitHub Actions
- Docker Compose 用于本地与容器化演示；线上实例走 systemd + Nginx，见 [docs/deploy/](docs/deploy/)

第一版保持单仓库、单服务、单进程。模型 Gateway 是代码级硬边界：业务模块不得直接访问模型供应商。

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
- 判定依据（词表）落库、可管理，带单调递增的 `rulesetVersion` 并写进每一次准入与预检留痕
- 按账号的每日调用次数与 token 上限，挂在网关上；超限是资源判定，与内容判定不共用字段
- 全流程监控看板的跨稿件聚合
- 产品介绍首页与可切换主题
- `healthz` 存活检查和 `readyz` 数据库/模型就绪检查
- Vitest 全量自动化回归与 GitHub Actions

这些能力将从“通用 AI 保密审计”改造为“融媒适播预检与生产追溯”。原说明保存在 [docs/legacy-auditgate-readme.md](docs/legacy-auditgate-readme.md)，组长方案保存在 [docs/design/broadcast-pivot.html](docs/design/broadcast-pivot.html)。

## 本地运行

```bash
npm install
cp .env.example .env
npm run dev
```

打开 <http://localhost:3300> 是产品介绍页（公开，无需登录），点「进入试用」进 `/workbench`，
未登录会跳转到 `/login`。demo/test 模式会幂等创建五个演示账号，
默认密码为 `gatekeeper-demo`，也可以在登录页一键进入：

| 账号 | 显示名 | 角色 | 用来验证什么 |
| --- | --- | --- | --- |
| `zhangmin` | 张敏 | 编辑 + 部门主任 + 分管领导 | 一人多岗，可独自走完三审三校；在同一工作台切换本次行使身份 |
| `lijianguo` | 李建国 | 部门主任 | 只有复审权，点不动终审——用来验证越权推不动 |
| `wangzhiyuan` | 王志远 | 分管领导 | 只有终审与签发权 |
| `chenxue` | 陈雪 | 编辑 | 一线记者的日常身份，写得了稿、推不动审批 |
| `stationadmin` | 台领导·管理员 | 台领导 | 只看不批，用来看全流程监控看板 |

production 不创建这些已知密码账号，也禁止一键登录。

```bash
npm run check
npm run build
docker compose up --build
```

默认使用内置确定性 Mock，不需要 API Key。当前真实模型适配器使用 OpenAI-compatible
Chat Completions。单模型部署可继续设置 `UPSTREAM_URL`、`UPSTREAM_KEY`、`UPSTREAM_MODEL`；
多模型部署使用 `UPSTREAM_PROFILES_JSON`，为每个模型独立配置 `model / label / provider /
url / key / thinking / timeoutMs`，并让 `UPSTREAM_MODEL` 指向默认配置档。工作台会显示安全的
模型列表，编辑可在每次生成前切换模型；URL 与 Key 始终只留在服务端。DeepSeek V4 的低延迟演示
建议 `thinking=disabled`；GLM-5.3 / GLM-5.3-Flash 必须保留 `provider-default`，不能关闭思考。
业务代码不得自行读取这些变量。Anthropic Messages/SSE 需要另行实现适配器。

> 轨道 C 的登录鉴权与固定角色权限已经合入；production 仍必须配置强 `SESSION_SECRET`、
> 独立 `GATEWAY_TOKEN` 和至少一个生产账号。`GATEWAY_TOKEN` 只保护原始
> `/gateway/v1/messages` 接口，不能替代 Web 产品的用户鉴权。

Docker 会以非 root 用户运行，并把 SQLite 数据保存在命名卷
`moderation-data`。`docker compose down` 不会删除数据；只有明确执行
`docker compose down -v` 才会删除该卷。

## Production 启动边界

> 下面讲的是启动必须满足的条件。**具体怎么部署到服务器看 [docs/deploy/](docs/deploy/)**——
> 线上实例跑的是 systemd + Nginx，不跑 Docker；环境变量、播种、清理、备份与排错在
> [operations.md](docs/deploy/operations.md)。


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
启用且角色合法的非 demo 账号。原演示控制面（policy / runtime / redteam / report /
controlled target，以及 AuditGate 时代的 `/api/monitor/start`）只在 demo 挂载，production
返回 404——**注意这里的 monitor 指的是那个遗留播种端点，不是 `/monitor` 全流程监控看板，
后者在 production 照常挂载**。HTTP `/gateway/v1/messages` 使用独立的
`GATEWAY_TOKEN`（`Authorization: Bearer ...` 或 `x-api-key`）；进程内稿件生成仍直接调用
`throughGateway()`，不需要伪造 HTTP 凭据。

## 页面

| 路径 | 内容 | 鉴权 |
| --- | --- | --- |
| `/` | 产品介绍页 | 公开 |
| `/login` | 登录 | 公开 |
| `/workbench` | 稿件工作台，六步主链都在这里 | 登录 |
| `/monitor` | 全流程监控看板（跨稿件态势） | 登录 + `audit:read` |
| `/rules` | 判定依据管理（词表与变更台账） | 登录 + `rules:read` |
| `/console`、`/policy`、`/runtime`、`/report` | 遗留 AuditGate 控制面 | **仅 demo 挂载，production 返回 404** |

## 底座 API

**健康与元信息**

- `GET /healthz`：进程存活
- `GET /readyz`：SQLite、模型与 production 身份/机器凭据就绪状态
- `GET /api/meta`：无密钥的运行信息

**登录与会话**

- `POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me`：登录与签名会话

**工作台**（界面直接调用的主链接口）

- `GET/POST /api/workbench`：稿件列表与创建（创建即走入口准入）
- `GET /api/workbench/:id`：稿件、产物、审核与追溯聚合
- `GET /api/workbench/:id/contrast`：与原通稿的一致性比对
- `POST /api/workbench/:id/transition`：推进三审流转
- `POST /api/workbench/:id/artifacts/:artifactId/revise`：人工改稿并重新预检
- `GET /api/workbench-models`：可选模型（仅名称、供应商与运行模式，不返回 URL / Key）

**稿件底座 REST**

- `GET/POST /api/manuscripts`：稿件列表与创建
- `GET /api/manuscripts/:id`：稿件、产物、审核和追溯聚合
- `POST /api/manuscripts/:id/artifacts`：保存播报稿或短视频文案
- `PUT /api/manuscripts/:id/artifacts/:artifactId/segments`：整段替换句级来源并重算 AI 参与度
- `POST /api/manuscripts/:id/reviews`：保存准入/预检/三审决定
- `PATCH /api/manuscripts/:id/status`：推进工作流状态
- `POST /api/manuscripts/:id/trace`：仅应用内部 repository 能力，浏览器 HTTP 账号不可伪造

**监控、判定依据与使用限制**

- `GET /api/monitor/overview`：全流程监控看板的跨稿件聚合
- `GET /api/rules`、`POST /api/rules`、`PATCH /api/rules/:ruleId`、`DELETE /api/rules/:ruleId`：词表读写
- `GET /api/rules/changes`：不可变的词表变更台账
- `GET/PUT /api/usage-limits`：按账号的每日调用与 token 上限
- `GET /api/fixtures`：内置示例素材

**事件与网关**

- `GET /events`：SSE 实时事件流
- `POST /gateway/v1/messages`：原始网关入口，使用独立的 `GATEWAY_TOKEN`

**遗留接口**（`/api/state`、`/api/usage`、`/api/policy*`、`/api/redteam/run`、`/api/runtime/*`、`/api/monitor/start`、`/api/demo/*`、`/target/*`）只在 demo 挂载。注意 `/api/monitor/start` 是 AuditGate 时代的内存态播种，**与 `/api/monitor/overview` 无关**。

请求与响应示例见 [底座 API 契约](docs/API.md)（覆盖稿件底座、判定依据与使用限制；工作台与监控聚合接口尚未收录）。

## 开发入口

- [最终架构与边界](docs/ARCHITECTURE.md)
- [底座 API 契约](docs/API.md)
- [方案与口径](docs/gatekeeper/)——先读 [plan.md](docs/gatekeeper/plan.md)，功能清单与进度在 [requirements.md](docs/gatekeeper/requirements.md)
- [部署与试用](docs/deploy/)——运维看 [operations.md](docs/deploy/operations.md)，试用者看 [user-manual.md](docs/deploy/user-manual.md)
- [演示脚本与检查单](docs/demo/)
- [团队分工与截止时间](docs/EXECUTION-PLAN.md)
- [协作规则](CONTRIBUTING.md)

`main` 必须始终能演示。功能开发走短分支、小 PR；影响共享契约、模型 Gateway 或演示链路的修改需要黄博文或 William 复核。
