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

1. **建 5 个账号**（`zhangmin` / `lijianguo` / `wangzhiyuan` / `stationadmin` / `chenxue`），口令取 `SEED_PASSWORD`；已存在就跳过
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

**稿件通过真实 API 产生，不直接写库。** 稿件要经过准入、生成、预检、三审才会有留痕、句级来源和 AI 参与度。绕开路由直接插表，播出来的数据就和用户实际操作产生的不一样——**演示夹具一旦和真实流程不一致，就失去了它的全部意义**。

脚本用 `app.request()` 在进程内打自己的 API，所以**不需要另起服务，也不需要网络**。

## 四、清理数据

```bash
npm run reset:demo -- --yes              # 只清稿件，保留账号
npm run reset:demo -- --yes --accounts   # 连试用账号一起清
```

**必须显式带 `--yes`。** 这个脚本删的是整库的稿件，包括留痕与审核记录——责任链一旦删掉就找不回来。不给确认参数就拒绝执行。

保留账号是默认行为：清数据通常是为了重播，而重建账号会把管理员改过的口令冲掉。

> 删账号不会带走历史。留痕里的 `actor_user_id` 是 `ON DELETE SET NULL`，
> 那条记录会显示「（无署名）」而不是消失——**责任链不能因为账号注销就断掉**。

## 五、常规运维

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

## 六、排错

| 症状 | 原因 | 处置 |
| --- | --- | --- |
| 登录返 503 `authentication_unavailable` | `SESSION_SECRET` 不合规 | 按第一节重新生成，必须带 `base64:` 前缀 |
| `/readyz` 返 503 | 未配模型且未允许 mock | 配 `UPSTREAM_URL`，或设 `ALLOW_MOCK_UPSTREAM=true` |
| 播种报 `requires a persistent DATABASE_PATH` | 落到了 `:memory:` | 显式设 `DATABASE_PATH` |
| 播种报 `login failed` | 账号口令与 `SEED_PASSWORD` 不一致 | 用 `--accounts` 清掉账号后重播，或改用正确口令 |
| 端口打不开 | 容器与本地 dev server 抢 3300 | 二选一，`docker compose down` |
| 页面能开但没数据 | 库是空的 | 跑一次 `npm run seed:demo` |

## 七、相关文档

| 文档 | 内容 |
| --- | --- |
| [user-manual.md](user-manual.md) | 试用手册，给使用者 |
| [../demo/script.md](../demo/script.md) | 三分钟演示口播稿与操作清单 |
| [../demo/runbook.md](../demo/runbook.md) | 演示前检查单与应急预案 |
| [../ARCHITECTURE.md](../ARCHITECTURE.md) | 技术边界 |
| [../gatekeeper/requirements.md](../gatekeeper/requirements.md) | 功能清单与进度 |
