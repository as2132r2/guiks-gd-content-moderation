# 底座 API 契约

所有接口返回 JSON；时间为 Unix 毫秒。错误使用稳定的 `error` 代码，页面不要依赖错误文案。

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

## 保存生成产物

`POST /api/manuscripts/:id/artifacts`

```json
{
  "kind": "broadcast-script",
  "content": "生成后的播报稿",
  "origin": "mixed",
  "aiShare": 0.72,
  "model": "GLM-5.2"
}
```


`kind` 可选：`source`、`broadcast-script`、`short-video-copy`；`origin` 可选：
`human`、`ai`、`mixed`。`aiShare` 范围为 0 到 1。

可以在同一请求里带上句级来源，产物与句子一次事务写入：

```json
{
  "kind": "broadcast-script",
  "content": "生成后的播报稿",
  "origin": "ai",
  "model": "GLM-5.2",
  "segments": [
    { "text": "第一句由模型生成。", "origin": "ai" },
    { "text": "第二句引自原通稿。", "origin": "source", "sourceRef": "原文第 2 段" }
  ]
}
```


`segments` 按数组顺序落 `ordinal`，句级 `origin` 可选 `ai`、`ai-edited`、`human`、`source`。

**带了 `segments` 就忽略请求里的 `aiShare` 和产物级 `origin`**，两者都由句级来源派生：

- `aiShare` = `(ai + ai-edited × 0.5) / 总句数`，权重在 `src/domain/ai-share.ts`
- 产物 `origin`：全部句子都是 `ai` → `ai`；一句 `ai` / `ai-edited` 都没有 → `human`；其余 → `mixed`。
  `source`（引自原通稿）算作非 AI——那不是模型写的。

## 重写句级来源

`PUT /api/manuscripts/:id/artifacts/:artifactId/segments`

```json
{
  "actor": "部门主任",
  "segments": [
    { "text": "第一句主任改过。", "origin": "ai-edited" },
    { "text": "第二句引自原通稿。", "origin": "source", "sourceRef": "原文第 2 段" }
  ]
}
```


整段替换该产物的句子，重算 AI 参与度与产物 `origin`，同时写一条 `segments-recorded` 追溯
（含 `previousAiShare`、`previousOrigin` 与各来源句数）。**每次流转有人改稿就调一次**，
参与度和产物来源都不允许手工填。产物不属于该稿件时返回 404 `artifact_not_found`。


## 读取稿件聚合

`GET /api/manuscripts/:id`

返回 `manuscript`、`artifacts`、`segments`、`reviews`、`trace`。`segments` 先按产物顺序、
再按 `ordinal` 排列，覆盖该稿件的全部产物；追溯图谱和 AI 参与度都从这里取数。

## 保存审核决定

`POST /api/manuscripts/:id/reviews`

```json
{
  "stage": "editor",
  "decision": "approved",
  "actor": "编辑甲",
  "reason": "事实项与格式已核对"
}
```

`stage` 可选：`admission`、`preflight`、`editor`、`department-head`、
`supervising-leader`。

`decision` 可选：`blocked`、`reason-required`、`pending-human-review`、
`approved`、`changes-requested`、`rejected`。L2 模型判断必须保存为
`pending-human-review`，不能代替人工终审。

## 推进状态

`PATCH /api/manuscripts/:id/status`

```json
{
  "status": "first-review",
  "actor": "编辑甲"
}
```

状态可选值直接从 `src/domain/contracts.ts` 的 `manuscriptStatuses` 读取。具体状态机由业务层控制，底座只负责校验枚举、持久化和追溯。

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

创建稿件、保存产物、保存审核决定和推进状态都会自动写追溯；此接口仅供模型调用、规则命中等额外事件使用。

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
