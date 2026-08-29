# 轨道 C 认证与审计完整性主审

> 审查日期：2026-08-29
> 审查对象：`codex/track-c-auth`，最新远端基线 `e8ecd48`
> 方法：Bowen 工程不变量 + Captain 反向验证
> 当前裁决：**Captain 与最终独立 Reviewer 均已通过；P0–P3 无 finding，`ALLOW MERGE`。**

## 实施状态（2026-08-29）

四轮八个修复工作包已经按文件所有权完成：

- `/events` 复用现有签名会话，匿名请求返回 `401 authentication_required`；认证客户端仍可读取 SSE 首帧。
- 内容写入采用显式状态白名单；签发和发布后，工作台改稿、底层新增产物、底层替换句子统一返回 `409 manuscript_not_editable`。
- 签发时把 AI 参与度与句数写入 `signed` 事件，签发卡只读该快照。
- 人工审核以 `(manuscriptId, stage, round)` 为键；相同决定重试复用，矛盾决定返回 `409 review_decision_conflict`，规范迁移复用预存决定。
- `/api/state` 要求有效会话和 `audit:read`，`/console` 匿名访问回到带 `next` 的登录页。
- SSE 在每个业务帧和 keepalive 前重新读取签名 cookie 与数据库 `session_version`；logout 后旧连接在下一帧前关闭并取消订阅。
- 浏览器只提供正文意图；句级来源由服务端根据旧句和原通稿推导，浏览器新增产物固定记录稳定真人账号，不能伪造 model、AI 或 system actor。
- 规范迁移按 manuscript ID 在当前单 Node 进程内串行；锁内重读状态，异常释放，不同稿件仍可并发。
- production 只接受 `base64:` 编码的强随机会话密钥和独立 Gateway 机器密钥；弱值、复用值、缺账号均使 readiness fail closed。
- `users.is_demo` 是持久真源；production 拒绝 demo 密码和旧 demo cookie，并提供一次性非 UI 建号 CLI。
- 遗留 monitor/redteam/runtime/policy/report/controlled-target 仅在 demo 挂载；production HTTP Gateway 使用独立机器凭据。
- canonical transition 的生成、预检、审核、状态和签发快照在一次同步 SQLite 事务内提交；外部模型等待在事务外。

Captain 在编译后的 `dist` 上重新执行两轮旧漏洞攻击，结果为：

```text
匿名 /events                          -> 401
匿名 /api/state                       -> 401；登录后 -> 200
logout 后旧 SSE                       -> done=true，无新 audit 泄露
首次 / 重试 / 冲突审核                -> 201 / 200 / 409
editor review / trace 数量            -> 1 / 1
published 后改稿 / 新增 / 替换         -> 409 / 409 / 409
攻击前后 artifacts/segments/trace     -> 完全一致
发布后签发快照                         -> 完全一致
同文本伪造 human 来源                  -> AI share 1 -> 1，句子仍为 ai
浏览器伪造 model/system               -> human actor + 稳定 user ID，伪造值未落库
同稿并发 admitted -> generated         -> 200 / 409，2 个产物，1 条合法状态迁移
production 弱/缺 secret               -> readyz 503
production 无账号 / provision 后       -> readyz 503 / 200
production demo 密码 / 旧 cookie       -> 401 / 401
production legacy write               -> 404
production Gateway 无/错/正确 key       -> 401 / 401 / 200
第二产物写入故障                        -> status=admitted，产物/句段/追溯均 0
预检/审核/状态中途故障                   -> 聚合与迁移前完全一致
浏览器完整主链                         -> 建稿、生成、改稿、预检、三审、签发、发布通过
浏览器最终责任链                       -> 同一 user，编辑/主任/分管领导三段角色快照齐全
npm run check                         -> 33 files / 233 tests，exit 0
npm run build                         -> exit 0
git diff --check origin/main --       -> exit 0
```

当前权威部署边界是单 Node 进程、单 SQLite handle。多进程部署前，审核唯一性与同稿串行仍需数据库唯一约束、reservation/CAS 或可恢复作业。SQLite 事务不覆盖 gateway 内存 audit 与 SSE；模型成功但 DB commit 失败时，重试会留下多次可审计的模型调用尝试，但不会留下半稿。静态 Gateway key 轮换、TLS、登录限速、SSO/密码恢复、外部 secret manager 和真实上游联调仍属于部署阶段能力。

最终只读 Reviewer 检查了全部 tracked/untracked 变更，并独立重放 production provision、legacy 404、Gateway 机器认证、四类事务故障、同稿并发和旧 Track C 越权用例；结论为 P0–P3 均无 finding，允许进入合并阶段。

## 第一轮独立复审新增 findings

独立 Reviewer 没有复用 Worker 的完成结论，在延迟上游和遗留读取面继续反向攻击，又坐实以下问题；修复前维持“不允许合并”：

### P1：`/api/state` 是匿名审计数据旁路

虽然 `/events` 已要求登录，但同一全局审计 store 仍可由匿名 `/api/state` 读取。编译产物实测可以取得工作台生成时的完整原稿和模型 prompt。最小关闭范围是保护 `/api/state` 并校验 `audit:read`；`/console` 同步挂登录，保持一致体验。其他遗留页面和机器网关的认证边界继续作为明确债务，不在未拍板前机械套用浏览器 cookie。

### P1：浏览器仍能自报句级来源和模型身份

编辑可以保持正文不变，把 `segments[].origin` 全部报成 `human`，使 artifact AI 参与度从 1 变成 0；也可以在 foundation artifact POST 中伪造 `model`，得到 AI actor 留痕。这违反“来源由服务端判定、被考核者不能自报”的仓库不变量。

修复必须把浏览器字段降级为文本意图：人工改稿由服务端根据旧句子和原通稿推导来源；浏览器新增产物只能形成稳定真人 actor，不能创建 system/AI 身份。真正模型产物仍只由进程内规范流程写入。

### P2：异步生成期间存在同稿并发竞态

延迟真实上游下，同时执行两次 `admitted -> generated` 实测得到两个 200、四个产物和一条非法 `generated -> generated` 留痕。当前单 Node 进程边界下，修复采用按 manuscript ID 的进程内串行执行：锁内重新读取状态，异常必须释放，不同稿件仍可并行。多进程部署前仍需数据库级 reservation/CAS。

### P2：logout 不会撤销已打开的 SSE

SSE 只在握手时校验会话。logout 递增 `session_version` 后，旧连接仍能接收后续 audit body。发送首帧以后的每个事件和 keepalive 前必须重新读取会话；失效立即停止流并取消订阅。

## 第二轮独立复审新增 findings

第一轮修复后，新的只读 Reviewer 再次给出 `BLOCK MERGE`，并坐实四个生产边界问题：

1. production 会把任意 32 字符低熵值当成可用 `SESSION_SECRET`。
2. 新 production 库没有建号路径却能 readiness 200；旧 demo 数据卷又能用默认密码进入 production。
3. 遗留 monitor/redteam/runtime/policy 控制面在 production 仍可匿名写，机器 Gateway 没有独立身份边界。
4. canonical transition 跨多次事务；第二份产物或最终状态写失败会留下第一份半稿。

关闭方式不是放宽判据，而是把真源补齐：production 密钥改为明确随机编码契约；账号持久标记 `is_demo` 并提供一次性 provisioning；遗留演示面不在 production 挂载，HTTP Gateway 使用独立机器 key；所有规范迁移的 SQLite 副作用改为单事务组合提交。故障注入测试证明旧实现会残留 `1 artifact / 1 segment / 1 artifact trace`，新实现同一失败下全部为 0。

## 一、用户结果与真源

目标结果不是“接口加了登录”，而是：模拟人员登录后，只能以账号实际持有的角色操作稿件；签发和发布后的内容与审批事实不能被事后改写；每次审批能够追溯到稳定用户 ID、当时行使的角色和显示名。

关键真源：

- 用户与角色：SQLite `users`。
- 流程合法性：服务端状态机和固定权限矩阵。
- 审批与签发事实：SQLite `review_records`、`trace_events`，不是客户端字段或 SSE。
- 完成证据：真实 HTTP 请求、数据库聚合、命令退出码和负向测试。

## 二、已复现 findings

### P1：匿名 SSE 泄露完整稿件和模型请求

`GET /events` 未要求登录，却转发遗留审计和工作台共用总线上的全部事件。匿名连接实测返回 `200`，并收到模型请求目标、完整任务提示和原通稿正文。

失败机制：REST 认证边界只保护 `/api/workbench*`、`/api/manuscripts*`，受保护稿件在模型调用时又通过未认证 SSE 旁路流出。

修复要求：

1. `/events` 至少要求有效会话，匿名请求返回 `401 authentication_required`。
2. 工作台事件流不得向无关客户端广播模型完整 prompt/body；优先拆分或过滤为工作流状态事件。
3. 增加真实流式负向测试，不能只检查路由存在。

### P1：已签发/已发布稿件仍可修改

完整流转至 `published` 后实测：

```text
POST 工作台改稿       -> 200
POST 底层新增产物     -> 201
产物数量              -> 2 增至 3
签发 AI 参与度         -> 1 降至 0.6667
```

失败机制：改稿、新增产物和替换句子只验证编辑角色，没有验证稿件是否仍处于可编辑状态；签发卡又从当前句子重新计算 AI 参与度，导致历史签发指标被追溯性改写。

权威流程规定：`已发布` 是终态；`复核修改` 才是退回后的改稿入口。

修复要求：

1. 服务端集中定义稿件可编辑状态，至少冻结 `signed`、`published`；按现有流程只在 `generated`、`revision` 接受人工改稿。
2. 所有写入口复用同一判定，UI 隐藏按钮不能代替服务端拒绝。
3. 签发时保存 AI 参与度快照，签发卡从签发事件读取快照。
4. 增加发布后改稿、替换句子、新增产物全部失败，且正文、产物数、签发快照不变的回归测试。

### P2：同一审级可写入矛盾或重复决定

同一轮编辑初审实测可依次写入：

```text
changes-requested
approved
approved
```

前两个直接审核请求均返回 `201`，随后状态迁移再次自动写入 `approved`。

失败机制：直接审核接口每次追加记录；规范迁移执行器不知道当前轮次是否已有决定，因此客户端按“先保存审核、再推进状态”调用时必然产生重复审计，冲突决定也不会阻止后续推进。

修复要求：

1. 以 `(manuscript, stage, round)` 定义一次审级决定。
2. 相同决定重试必须幂等；矛盾决定返回明确冲突。
3. 状态迁移复用已有的同决定记录，不重复插入；矛盾记录不得被静默覆盖。
4. 不改变现有工作台的一键迁移路径和既有角色授权语义。

### P2：迁移副作用没有跨步骤原子性

规范迁移执行器会依次生成产物、写预检、写审核、更新状态；各 repository 方法使用独立事务。若进程在中间失败，可能留下“副作用已写、状态未迁移”的半完成状态。

本项来自代码路径推断，尚未注入崩溃复现。黑客松演示可以作为明确债务，但生产前必须通过事务化、幂等键或可恢复执行器关闭风险。

## 三、修复顺序与写入所有权

1. 事件流认证：独立修改 `src/routes/events.ts` 和专用测试。
2. 稿件冻结与签发快照：由一个 Worker 独占 `workbench.ts`、`manuscripts.ts`、`workbench-view.ts`、repository 和相关测试。
3. 审核幂等：等待第 2 步完成后串行修改同一组中心文件。
4. Captain 集成后运行全量检查和旧实现会失败的反向实验。
5. 独立 Reviewer 不继承 Worker 解释，只看 diff、命令和可复现行为。

## 四、验收门禁

必须同时满足：

- 匿名 `/events` 返回 401，且收不到稿件、prompt 或模型请求正文。
- 登录后的工作台事件更新仍能正常工作。
- `signed`、`published` 的所有人工改稿和产物写入口均失败。
- 签发快照在后续读取中保持不变。
- 同轮相同审核决定重试不产生新记录；矛盾决定明确失败。
- 张敏仍能一屏完成编辑、主任、分管领导完整主链。
- 李建国、王志远和台领导的角色边界不回退。
- `npm run check`、`npm run build`、`git diff --check origin/main --` 全部退出 0，且测试发现数非零。
- 浏览器完整路径通过，独立 Reviewer 无未解决中高风险 finding。

## 五、停止条件与回滚

出现以下情况立即停止并重新规划：需要改变既定状态机边、需要 destructive migration、需要开放新的系统写接口、认证事件流破坏遗留页面的必要演示路径，或审核幂等要求改变现有外部 API 的核心语义。

本轮只做向后兼容代码和测试修复，不删除历史审批或追溯数据。回滚代码不会删除新增账号、审核或留痕。
