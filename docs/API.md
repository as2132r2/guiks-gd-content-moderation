# 底座 API 契约

所有接口返回 JSON；时间为 Unix 毫秒。错误使用稳定的 `error` 代码，页面不要依赖错误文案。

`/healthz`、`/readyz`、`/api/meta`、产品介绍页 `/` 和登录页/登录接口公开。**其余一律要求签名
会话 cookie**——工作台、稿件、`/api/state`、`/console`、`/events`、`/monitor`，以及只在
`APP_MODE=demo` 挂载的遗留演示控制面。HTTP 模型网关使用独立机器凭据，不接受浏览器
cookie 代替。
固定错误语义为：未登录 `401 authentication_required`，账号未持有请求角色或该角色没有动作权限
`403 role_not_allowed`，角色持有无误但当前状态不允许迁移时保留 `409 wrong_role` / `invalid_transition`。

## 登录与会话

`POST /api/auth/login`

标准登录：

```json
{ "username": "zhangmin", "password": "gatekeeper-demo" }
```

仅 `APP_MODE=demo` 可使用一键登录：

```json
{ "username": "zhangmin", "demo": true }
```

成功返回 `{ "user": { "id", "username", "displayName", "roles" } }` 并设置 8 小时有效的
`HttpOnly`、`SameSite=Lax`、`Path=/` 签名 cookie；production 额外设置 `Secure`。
不存在、密码错误和禁用账号统一返回 `401 invalid_credentials`。production 禁止 demo 一键登录，
持久化为 `is_demo=1` 的账号在 production 连普通密码登录也统一返回 `401 invalid_credentials`。
会话每次都重新读取该标记；即使 demo 与 production 因错误配置复用了同一会话密钥，切换模式前
签发的 demo cookie 在 production 也返回 `401 authentication_required`。

- `GET /api/auth/me`：从数据库重新读取当前账号与严格解析后的角色；无效会话返回 401。
- `POST /api/auth/logout`：清除 cookie 并递增账号的 `session_version`，已复制的旧 cookie 同时失效；重复调用幂等。

cookie 只保存用户 ID、会话版本和服务端校验的到期时间，不保存密码或权限。客户端提交的
`role` 仅表示“本次以哪个已持有角色操作”，服务端会用 `users.roles_json` 和固定权限矩阵复核。

## Production 准备与机器网关

production 的 `SESSION_SECRET` 与 `GATEWAY_TOKEN` 都只接受 `base64:` 加至少 32 个随机字节；
两个值必须独立生成。缺失、格式错误、已知 demo 值或明显重复/低熵值会令 `/readyz` 返回 503。
此外，数据库必须至少包含一个启用、角色可严格解析且 `is_demo=0` 的账号。production 不自动
seed，使用 README 中的一次性 `provision:user` CLI 建号，密码只从隐藏 TTY 或 stdin 读取。

`POST /gateway/v1/messages` 在 production 要求以下任一独立机器凭据：

```http
Authorization: Bearer base64:<random-secret>
```

```http
x-api-key: base64:<random-secret>
```

机器密钥未正确配置返回 `503 gateway_auth_not_configured`；缺失或不匹配返回
`401 gateway_unauthorized`。这一限制仅适用于 HTTP 表面，进程内规范主链调用
`throughGateway()` 不受影响。

`/api/monitor/start`、`/api/redteam/run`、`/api/runtime/*`、`/api/policy*`、`/api/usage`、
`/policy`、`/runtime`、`/report` 和 `/target/*` 是遗留 demo surface，production 不挂载并稳定
返回 404。

在 demo 下它们同样认人：接口要求签名会话并校验 `audit:read`（与 `/api/state` 取齐），匿名
返回 `401 authentication_required`；`/policy`、`/runtime`、`/report` 三个页面匿名 `302` 到
`/login?next=<path>`。其中 `/api/monitor/start`、`/api/redteam/run`、`/api/runtime/chat`、
`/api/runtime/simulate` 和 `/target/chat` 每次调用都会真的打模型，匿名可触发就等于把上游
额度敞开——这是 CLAUDE.md 硬约束 6「真实模型不裸奔」的一部分。

## 创建稿件

`POST /api/manuscripts`

```json
{
  "title": "融媒演示稿",
  "sourceType": "notice",
  "sourceText": "模拟/脱敏素材正文"
}
```

`sourceType` 可选：`script`、`novel`、`notice`、`public-relations`、`other`。
仅编辑角色可创建稿件。

## 浏览器保存编辑产物

`POST /api/manuscripts/:id/artifacts`

```json
{
  "kind": "broadcast-script",
  "content": "编辑录入或导入的播报稿"
}
```

`kind` 可选：`source`、`broadcast-script`、`short-video-copy`。这是浏览器中的真人编辑入口：
服务端从 `content` 切句，与原通稿逐句比对，能确定为原文引用的标为 `source`，其余标为
`human`；`artifact-created` 追溯固定记录当前登录编辑的稳定用户 ID、角色与显示名。

旧客户端仍可发送以下字段，服务端会完成解析以保持请求兼容，但**全部忽略其来源或模型声明**：

```json
{
  "kind": "broadcast-script",
  "content": "编辑录入或导入的播报稿",
  "origin": "ai",
  "aiShare": 1,
  "model": "browser-claimed-model",
  "segments": [
    { "text": "第一句由模型生成。", "origin": "ai" },
    { "text": "第二句引自原通稿。", "origin": "source", "sourceRef": "原文第 2 段" }
  ]
}
```

浏览器自报的 `origin`、`aiShare`、`model`、`segments[].origin` 和 `sourceRef` 均不是来源真源，
不会落入产物或 AI/system 留痕。真正的模型生成只由 `admitted → generated` 的进程内规范工作流
调用 repository，继续保存真实模型名、AI 句级来源和 `actorType=ai`；HTTP 不开放 system/AI 写能力。

AI 参与度与产物级来源始终由服务端持有的句级来源派生：

- `aiShare` = `(ai + ai-edited × 0.5) / 总句数`，权重在 `src/domain/ai-share.ts`
- 产物 `origin`：全部句子都是 `ai` → `ai`；一句 `ai` / `ai-edited` 都没有 → `human`；其余 → `mixed`。
  `source`（引自原通稿）算作非 AI——那不是模型写的。

## 重写句级来源

`PUT /api/manuscripts/:id/artifacts/:artifactId/segments`

```json
{
  "segments": [
    { "text": "第一句编辑改过。" },
    { "text": "第二句引自原通稿。" }
  ]
}
```


整段替换该产物的句子。服务端将文本与旧句子、原通稿对比后判定 `ai`、`ai-edited`、`human`
或 `source`，重算 AI 参与度与产物 `origin`，同时写一条 `segments-recorded` 追溯
（含 `previousAiShare`、`previousOrigin` 与各来源句数）。**每次流转有人改稿就调一次**，
参与度和产物来源都不允许手工填。产物不属于该稿件时返回 404 `artifact_not_found`。
该接口只允许编辑角色。旧客户端若仍发送 `actor`、`segments[].origin` 或 `sourceRef`，服务端会
解析后忽略；真人身份从会话派生，句级来源从服务端已有事实派生。


## 读取稿件聚合

`GET /api/manuscripts/:id`

返回 `manuscript`、`artifacts`、`segments`、`reviews`、`trace`。`segments` 先按产物顺序、
再按 `ordinal` 排列，覆盖该稿件的全部产物；追溯图谱和 AI 参与度都从这里取数。
所有已登录系统角色均可读取；`station-leader` 仅有此类读取能力，不进入状态机。

## 保存审核决定

`POST /api/manuscripts/:id/reviews`

```json
{
  "stage": "editor",
  "decision": "approved",
  "reason": "事实项与格式已核对"
}
```

`stage` 可选：`admission`、`preflight`、`editor`、`department-head`、
`supervising-leader`。

人工接口的 `decision` 只接受 `approved`、`changes-requested`；退回必须携带
`reason`。L2 模型判断的 `pending-human-review` 由进程内规则模块留痕，不能通过
浏览器账号写入或代替人工终审。

人工 stage 固定映射到相应流程角色：`editor`、`department-head`、`supervising-leader`。
浏览器账号不能提交系统 stage；人工审核只能在稿件正处于对应审级时写入，否则返回
`409 review_stage_not_active`。`countersign` 必须通过规范状态流转同时提交会签方和意见，
不能用本接口单独保存。旧 `actor` 字段已废弃并忽略。

同一稿件、审级和审核轮次只有一份人工决定。首次写入返回 `201`；同一账号携带完全
相同决定和实质字段重试时返回 `200`，并在响应中标记 `reused: true`、
`idempotent: true`，不会新增审核或追溯记录。决定、账号、退回理由等字段不一致时返回
`409 review_decision_conflict`，既有决定不会被覆盖。

## 推进状态

`PATCH /api/manuscripts/:id/status`

```json
{
  "status": "first-review",
  "role": "editor"
}
```

状态可选值直接从 `src/domain/contracts.ts` 的 `manuscriptStatuses` 读取。`role` 只接受三个
`WorkflowRole`，不接受 `system` 或 `station-leader`。服务端验证账号确实持有该角色后才将其传入
状态机；旧 `actor` 字段已废弃并忽略。
该端点与工作台共用同一个迁移执行管线：生成、预检、审核记录与追溯副作用不会因调用底层 API
而被跳过。

## 追加追溯

`POST /api/manuscripts/:id/trace`

```json
{
  "kind": "rule-hit",
  "actorType": "system",
  "actor": "preflight",
  "data": {
    "ruleId": "wording-001",
    "result": "pending-human-review"
  }
}
```

创建稿件、保存产物、保存审核决定和推进状态都会自动写追溯。HTTP
`POST /api/manuscripts/:id/trace` 对所有浏览器账号返回 `403 system_only`，防止伪造
`actorType=system`；模型、规则和应用内部事件继续直接调用 repository。

审核与追溯响应同时包含可空的 `actorUserId` 和 `actor`。前者是稳定用户真源；后者是事件发生时的
`角色·显示名` 快照，显示名以后发生变化也不会改写历史记录。

## SSE

`GET /events`

新增业务事件名：`manuscript`、`workflow`、`trace`。每条业务事件包含：

```json
{
  "id": "event uuid",
  "type": "workflow",
  "manuscriptId": "manuscript uuid",
  "occurredAt": 1787900000000,
  "data": {}
}
```

连接建立时先收到 `status`，空闲期间每 15 秒收到 `ping`。
