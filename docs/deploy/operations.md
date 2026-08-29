# 部署与运维

面向部署这套系统的人。试用者视角的说明在 [user-manual.md](user-manual.md)。

## 一、环境变量

`APP_MODE=production` 下有三项**必须配**，缺一个服务就起不来或登录不了：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `APP_MODE` | ✅ | `production` |
| `SESSION_SECRET` | ✅ | **必须是 `base64:` 前缀的 32 字节随机值**，见下方生成命令。弱口令或占位值会让 `/api/auth/login` 直接返 503 |
| `GATEWAY_TOKEN` | ✅ | 同样格式，且**不能和 `SESSION_SECRET` 相同** |
| `DATABASE_PATH` | | 默认 `./data/app.db`；容器内 `/app/data/app.db` |
| `UPSTREAM_URL` | | 留空 = 走内置确定性 mock（零 Key 可跑）。填真实 base_url 才代理真模型 |
| `UPSTREAM_KEY` | | 真实模型凭据 |
| `UPSTREAM_MODEL` | | 默认 `GLM-5.2` |
| `SEED_PASSWORD` | | 播种账号的口令，默认 `gatekeeper-demo`。**对外试用建议保持默认**，手册里写的就是它 |

生成合规密钥：

```bash
node -e "console.log('base64:' + require('crypto').randomBytes(32).toString('base64'))"
```

跑两次，分别给 `SESSION_SECRET` 和 `GATEWAY_TOKEN`。

> **为什么这么严**：`production` 下弱密钥会被 `config.ts` 判定为未就绪并拒绝登录。
> 这是有意的——会话密钥弱等于没有鉴权。

## 二、部署

```bash
docker compose up -d --build
curl -f http://localhost:3300/readyz     # 期望 {"status":"ready"}
```

`/healthz` 只判进程存活；`/readyz` 同时判数据库与模型配置。

> `APP_MODE=production` 且未配模型时，除非显式 `ALLOW_MOCK_UPSTREAM=true`，`/readyz` 返回 503。
> 这是 fail closed：上游没配好就不要假装能用。

## 三、播种试用数据

```bash
npm run seed:demo          # 开发 / 源码运行
npm run seed:demo:prod     # 生产构建（先 npm run build）
```

它做两件事，**都是只增不删**：

1. **建 5 个账号**（`zhangmin` / `lijianguo` / `wangzhiyuan` / `stationadmin` / `chenxue`），口令取 `SEED_PASSWORD`；已存在就跳过。**生产模式下遇到 demo 账号会就地转正**（保留 `users.id`，见第五节）
2. **补齐 15 篇稿件**——前 7 篇是教学样本，覆盖准入三档、主链各阶段与一次退回；后 8 篇是本底数据。按标题判重，已播过的跳过

预期输出：

```
账号：新建 5，已存在 0
稿件：待播 15，已存在 0（只增不删，不动库里已有的数据）
  ✓ 完整链路样本　全市乡村振兴现场推进会召开
  ✓ 退回重走样本　全市优化营商环境政策发布会举行
  ✓ 待你改稿　全市中小学秋季开学工作部署会召开
  ✓ 待你审批　全市城市更新项目集中开工
  ✓ 准入 · 要理由　国道210线塌方抢通情况通报
  ✓ 准入 · 硬拦　帮我写点东西
  ✓ 准入 · 公器私用　写篇小说
  ✓ 本底 · 时政　全市党建工作推进会召开
  ✓ 本底 · 民生　城区供水管网改造工程完工
  ✓ 本底 · 经济　前七月全市规上工业增加值发布
  ✓ 本底 · 三农　全市秋粮收购工作启动
  ✓ 本底 · 文化教育　市图书馆新馆正式开馆
  ✓ 本底 · 要理由后走完　全市环境污染问题整改情况通报
  ✓ 本底 · 民生　城乡公交一体化新线路开通
  ✓ 本底 · 经济　全市重点招商引资项目集中签约
完成：全库稿件 15 篇，已签发 10，留痕 315 条，全台 AI 参与度 95.0%
```

### 本底数据是干什么的

后 8 篇不参与教学，`dayOffset` 把它们铺在过去六天里。**存在的全部理由是让监控看板
不是一条竖线**——按日趋势要有多个点、生产量要有多个人、报道方向要有分布，
只有 7 篇同一天同一个人的稿子，那三栏都是空的。

挪日期用的是 `shiftManuscriptHistory`，**整条时间线一起平移，篇内间隔分毫不动**。
所以「环节平均停留」算出来的还是原样：**能编的只有哪一天，不能编的是走了多久。**

本底稿件全部已发布且时间靠前，工作台左栏按 `updated_at` 倒序，它们沉在底下，
不会把教学样本挤下去。

**这组数字是空库首播的结果。** 词表或 mock 变过，数字就会变；库里本来有数据，
「全库稿件」那一行自然更大——**它报的是全库现状，不是这次播了多少**。

### 只增不删

**播种永远不删数据。** 再跑一次是空操作：

```
账号：新建 0，已存在 5
稿件：待播 0，已存在 15（只增不删，不动库里已有的数据）
  （无需播种。要推倒重来请先跑 npm run reset:demo -- --yes）
完成：全库稿件 15 篇，已签发 10，留痕 315 条，全台 AI 参与度 95.0%
```

为什么要这样：**试用者建的稿子和播种数据在同一个库里**，播种一旦顺手清库，
别人试到一半的东西就没了。删数据是另一条命令，而且必须显式确认——
**播种和删除是两件事，不能一个动作顺手把另一件也做了。**

判重按标题。所以：改夹具正文不会重播（标题没变），**改标题会当成新稿件补进去**。
要让改动完全生效，先 `reset:demo` 再播。

### 两个设计决定

**账号已存在就跳过，不覆盖口令。** 重复播种不该把管理员改过的密码冲掉。
唯一的例外是生产模式下的 demo 账号——它登不进去，留着没有意义，所以**就地转正**：
换口令、翻 `is_demo`、`session_version` 加一，但 `users.id` 不动。
**不动 id 是关键**，指向它的留痕才不会被 `ON DELETE SET NULL` 置空。

**稿件通过真实 API 产生，不直接写库。** 稿件要经过准入、生成、预检、三审才会有留痕、句级来源和 AI 参与度。绕开路由直接插表，播出来的数据就和用户实际操作产生的不一样——**演示夹具一旦和真实流程不一致，就失去了它的全部意义**。

脚本用 `app.request()` 在进程内打自己的 API，所以**不需要另起服务，也不需要网络**。

## 四、清理数据

```bash
npm run reset:demo -- --yes              # 只清稿件，保留账号
npm run reset:demo -- --yes --accounts   # 连试用账号一起清
```

**必须显式带 `--yes`。** 这个脚本删的是整库的稿件，包括留痕与审核记录——责任链一旦删掉就找不回来。不给确认参数就拒绝执行。

保留账号是默认行为：清数据通常是为了重播，而重建账号会把管理员改过的口令冲掉。

> 删账号不会带走历史，但会带走**归并**。留痕里的 `actor_user_id` 是
> `ON DELETE SET NULL`：单篇稿件的责任链读的是留痕里的人名文本，**账号注销后
> 照样显示是谁放行的**；塌掉的是监控看板「内容生产者」那一栏，它按
> `actor_user_id` 分组，置空后全归进「（无署名）」一行。
>
> 也就是说：注销账号之后，说得清「这篇稿子谁签的」，说不清「这个人一共干了多少」。
> **切部署模式不必付这个代价**——那条路走的是就地转正，见第五节。

## 五、从 demo 切到 production

### 为什么要切

`APP_MODE=demo` 会额外挂上六组遗留路由（[index.ts](../../src/index.ts) 里的
`if (config.appMode === 'demo')`），**它们一个 `requireAuth` 都没有**。公网跑 demo，
等于把这一排接口连同真实模型额度一起开在外面：

| 端点 | demo | production |
| --- | --- | --- |
| `/policy`、`/api/policy`、`/api/policy/presets` | 无凭据 200 | 404 |
| `PUT /api/policy`、`POST /api/policy/preset` | 无凭据可写 | 404 |
| `/runtime`、`/api/usage`、`/report`、`/target/info` | 无凭据 200 | 404 |
| `POST /api/runtime/chat`、`POST /target/chat`、`POST /api/redteam/run` | **无凭据即可烧真实模型额度** | 404 |
| `POST /api/demo/reset`、`POST /api/demo/seed` | 无凭据即可清空整库 | 404 |
| `POST /api/monitor/start` | 无凭据 200 | 404 |

对照：`/api/monitor/overview` 与 `/workbench` 两种模式下都要登录，它们本来就是对的。

这也是 [CLAUDE.md](../../CLAUDE.md) 硬约束 6「真实模型不裸奔」的落地方式——
靶场、红队和 runtime 要么等鉴权，要么在生产构建里根本不存在。这里选的是后者。

### 切换步骤

**库里的数据全部保留**——稿件、留痕、责任链、监控看板的按人归并，一样不少。
下面按 compose 部署写；源码部署把 `docker compose exec app node dist/xxx.js`
换成 `npm run xxx:prod` 即可。

```bash
# 0. 停服并备份（compose 用的是命名卷，拷贝方式见第六节「备份」）
docker compose down

# 1. 改 .env：APP_MODE=production，并按第一节生成两个【不同】的强密钥
#    APP_MODE=production
#    SESSION_SECRET=base64:...
#    GATEWAY_TOKEN=base64:...

# 2. 起服。此时 /readyz 返 503（account: missing），是对的，见下一小节
docker compose up -d --build

# 3. 播种。它会把试用账号就地转正，并补齐缺的稿件；临时走 mock，
#    手册里的数字才对得上
docker compose exec -e ALLOW_MOCK_UPSTREAM=true app node dist/seed-demo.js

# 4. 验收
curl -s http://127.0.0.1:3300/readyz          # 期望 {"status":"ready"}
```

第 3 步的预期输出：

```
账号：新建 0，已存在 1，转正 4（原为 demo 账号，保留 user id 与历史归并）
稿件：待播 0，已存在 15（只增不删，不动库里已有的数据）
```

**没有「清库」这一步。** `APP_MODE=production` 拒绝 demo 账号登录
（[auth.ts](../../src/routes/auth.ts)），所以那 4 个内置账号必须处理掉——但处理方式是
**就地转正**（[repository.ts](../../src/db/repository.ts) 的 `promoteDemoUserToProduction`），
不是删掉重建。`users.id` 保住，指向它的 `actor_user_id` 就不会被
`ON DELETE SET NULL` 置空，历史一条不掉。

> **早期版本这里是「删掉重建」，所以旧文档要求先 `reset:demo` 清库。**
> 现在不需要了。真想推倒重来是另一件事，见第四节。

**为什么播种要走 mock。** 第三节那组数字（15 篇 / 已签发 10 / 留痕 315 条 /
AI 参与度 95.0%）是确定性 mock 的结果。走真实模型播出来对不上，还要花钱。
`ALLOW_MOCK_UPSTREAM=true` 只加在那一条命令上，`.env` 不动。

**转正会让所有人重新登录一次。** `session_version` 加一，demo 模式下签发的
会话立即失效——这是有意的，demo 会话不该跨进生产继续用。

### 播种之前 `/readyz` 会返 503

切过去之后、播种之前，库里只有 demo 账号，`hasEnabledProductionUser()` 是 false：

```json
{"status":"not-ready","checks":{"database":true,"model":"mock","gatewayAuth":"configured","authentication":"configured","account":"missing"}}
```

**这是设计如此，不是切炸了。** compose 的 healthcheck 会把容器标成 unhealthy，
但 `restart: unless-stopped` 不会因此重启（没有 autoheal），播完种自动恢复 `ready`。
如果部署链路上还有别的东西盯着 healthcheck 调流量，把第 2–4 步连着做完，别留窗口。

### 切完会变的东西

| | demo | production |
| --- | --- | --- |
| 登录页快捷身份卡 | 4 张，点一下就进 | **0 张**，全部手输用户名口令 |
| 工作台「演示模式」「演示准备」按钮 | 有 | **无**——两者第一步都是清空整库 |
| `?present=1` 进引导演示外壳 | 生效 | 不生效 |
| 六组遗留路由 | 挂着 | 404 |
| 进程监听地址 | `0.0.0.0` | `127.0.0.1`（[index.ts](../../src/index.ts)），**必须有反向代理** |
| `SEED_DEMO_USERS` | 生效 | **被忽略**（[config.ts](../../src/config.ts)） |
| demo 账号（`is_demo=1`） | 可登 | **一律拒登**，口令对也不行 |
| `/readyz` | 不查账号 | 库里没有启用的非 demo 账号就 503 |
| 换 `SESSION_SECRET`、账号转正 | — | 全部在线会话立即失效，所有人要重登一次 |

**不变的**：**库里的数据一条不少**——稿件、留痕、责任链、句级来源、AI 参与度，
以及监控看板按人归并的那一栏，切换前后逐字相同。试用者自己建的稿子也在。

[user-manual.md](user-manual.md) 同样一个字都不用改。五个试用账号的用户名、
显示名、口令（`SEED_PASSWORD`，默认 `gatekeeper-demo`）、15 篇稿件走位、
「填入示例通稿」按钮、`/`、`/login`、`/workbench`、`/monitor`、`/console` 全部照旧。
手册不用出第二版——账号名当初就是为此钉死的（见 [demo-dataset.ts](../../src/demo-dataset.ts) 顶部注释）。

演示夹具那两个按钮的消失也不影响手册：它从头到尾没让试用者点过引导演示。
要做展台路演，另起一个 demo 实例（`docker compose up` 缺省就是 demo），
**不要在生产实例上跑**——「重建三组样例」清的是生产库。

### 验收清单

遗留路由与清库端点，**期望全部 404**：

```bash
B=http://127.0.0.1:3300
for p in /policy /api/policy /api/policy/presets /runtime /api/usage /report /target/info /api/monitor/start /api/redteam/run /api/demo/reset /api/demo/seed; do
  printf '%-24s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "$B$p")"
done
```

挂着但要登录的三个，**期望 401 / 401 / 302**：

```bash
curl -s -o /dev/null -w 'fixtures  %{http_code}\n' http://127.0.0.1:3300/api/fixtures
```

```bash
curl -s -o /dev/null -w 'overview  %{http_code}\n' http://127.0.0.1:3300/api/monitor/overview
```

```bash
curl -s -o /dev/null -w 'workbench %{http_code}\n' http://127.0.0.1:3300/workbench
```

然后用 `zhangmin` / `gatekeeper-demo` 登一次，看三件事：

1. **左栏稿件数和切换前一样**——切换不删数据，少一篇就是出事了
2. **`/monitor` 的「内容生产者」还是原来那几个人**，没有多出「（无署名）」一行；
   有的话说明账号被删掉重建了，不是转正
3. 按手册第 2 步点**「填入示例通稿」**，填进来 213 字的通稿

第 3 条是整个切换里最容易漏的：它的端点曾经和清库端点挂在同一组路由上，切到
生产就 404，手册第二步直接撞墙。现在它在 [fixtures.ts](../../src/routes/fixtures.ts)，
两种模式都挂，`test/production-routes.test.ts` 钉着这条不让它再退回去。

## 六、常规运维

### 重置试用环境

试用者把数据改乱了。**播种不再清库**，所以要两步：

```bash
npm run reset:demo -- --yes     # 先清稿件（账号保留）
npm run seed:demo               # 再播一遍
```

只想补上缺的、不动现有数据，就只跑第二条。

### 建一个非试用账号

```bash
npm run provision:user -- --username someone --display-name 某某 --roles editor
# 口令从 stdin 读，不落命令行历史
```

角色可选：`editor` / `department-head` / `supervising-leader` / `station-leader`。

### 备份

数据全在 `DATABASE_PATH` 指向的那一个 SQLite 文件里（WAL 模式，连带 `-wal` / `-shm`）。停服拷贝，或用 `sqlite3 .backup` 热备。

### 切回 mock

真实模型超时或凭据出问题时，**清空 `UPSTREAM_URL` 重启即可**，业务完全不变——内置 mock 是确定性的，同一份通稿永远得到同一个结果。

## 七、排错

| 症状 | 原因 | 处置 |
| --- | --- | --- |
| 登录返 503 `authentication_unavailable` | `SESSION_SECRET` 不合规 | 按第一节重新生成，必须带 `base64:` 前缀 |
| `/readyz` 返 503，`checks.model` 是 `missing` | 未配模型且未允许 mock | 配 `UPSTREAM_URL`，或设 `ALLOW_MOCK_UPSTREAM=true` |
| `/readyz` 返 503，`checks.account` 是 `missing` | 生产库里还没有启用的非 demo 账号 | 跑一次 `seed:demo`，或 `provision:user` 建一个。切模式后这是正常中间态，见第五节 |
| 播种报 `requires a persistent DATABASE_PATH` | 落到了 `:memory:` | 显式设 `DATABASE_PATH` |
| 播种报 `login failed` | 账号口令与 `SEED_PASSWORD` 不一致 | 用 `--accounts` 清掉账号后重播，或改用正确口令 |
| 播种报 `502 model_upstream_failed` | 未配模型且没开 mock | 这一次加 `ALLOW_MOCK_UPSTREAM=true`（只作用于该进程，`app.env` 不动） |
| **播种毫无输出、退出码 0、库里没变** | 早期版本经 `current` 符号链接调用时入口判定失效 | 已修（`lib/entrypoint.ts` 比 realpath）。旧版本上改用 `readlink -f` 解析出的真实路径调用 |
| 端口打不开 | 容器与本地 dev server 抢 3300 | 二选一，`docker compose down` |
| 页面能开但没数据 | 库是空的 | 跑一次 `npm run seed:demo` |

## 八、相关文档

| 文档 | 内容 |
| --- | --- |
| [user-manual.md](user-manual.md) | 试用手册，给使用者 |
| [../demo/script.md](../demo/script.md) | 三分钟演示口播稿与操作清单 |
| [../demo/runbook.md](../demo/runbook.md) | 演示前检查单与应急预案 |
| [../ARCHITECTURE.md](../ARCHITECTURE.md) | 技术边界 |
| [../gatekeeper/requirements.md](../gatekeeper/requirements.md) | 功能清单与进度 |
