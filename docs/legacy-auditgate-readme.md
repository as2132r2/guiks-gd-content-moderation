# 薄荷监理台 · AuditGate

改一行 `base_url` 就能接管任意 AI 产品，覆盖 AI 落地**全生命周期**：**采购前**做实时审计 + 一键红队 + 安全就绪度评分卡；**部署后**做逐用户 token 计量 + 每企业可配的安全护栏（拦截 / 打码 / 标记）。

> **独立于 bohe-console，独立部署。** AuditGate 是一个自成一体的独立服务：自己的进程、自己的端口（3300）、自己的 compose 文件。它不属于、也不依赖 monorepo 里的主应用 `bohe-console`，两者绝不共用容器或端口。

---

## 这是什么

把你要体检的 AI 产品的模型 `base_url` 指到本服务，AuditGate 就坐在中间，把每一次模型调用都拦下来看一眼：

- **实时审计**：每条请求/响应都留痕，谁在什么时候问了什么、模型答了什么，一条不漏。
- **一键红队**：一张 probe 网格，逐个打向目标，看它会不会被越狱、泄提示词、答不该答的东西。
- **安全就绪度评分卡**：把审计和红队的结果汇成一张分卡，告诉你「这个 AI 供应商能不能上线」。

零配置即可跑：内置一个确定性的 mock 上游（受控靶子），不需要任何 API key，也不接触任何真实生产系统。

---

## 本地跑

```bash
npm install
npm run dev      # 开发热重载（tsx watch）
# 或
npm start        # 直接起服务（tsx src/index.ts）
```

打开 <http://localhost:3300>。

**零配置、不需要 API key** —— 默认用内置的确定性 mock 上游，开箱即用。

要求 Node 22+（本机是 Node 25 也 OK）。

---

## 演示脚本（5 步，照这个顺序走）

1. **开始监理**：打开控制台，点「**开始监理**」，审计流亮起 —— 流量开始一条条滚进来。
2. **每条都留痕**：指出审计流里每一次模型调用都留下了痕迹（时间、输入、输出），可回看、可追溯。
3. **跑红队**：点「**跑红队**」，probe 网格逐个亮起来；**命中（有洞）的格子标红** —— 那就是被攻破的点。
4. **看评分卡**：翻到评分卡。这个受控靶子是故意留了洞的，所以会得**低分 / D 级** —— 让观众直观看到「不及格是什么样」。
5. **导出报告**：点「**导出报告**」，`/report` 是一页可打印的监理报告；用浏览器「打印」直接存成 PDF 交付。

---

## 三块面板（AI 落地全生命周期）

三个页面串成一条闭环，页面间可互相跳转：

| 页面 | 路径 | 干什么 |
| --- | --- | --- |
| **采购体检** | `/` | 部署前：实时审计 + 一键红队 + 安全就绪度评分卡（「该不该让它进来」）。 |
| **运行时监控** | `/runtime` | 部署后：逐用户 token 计量（谁用了多少）+ 安全护栏触发流（谁触发了什么、被拦截/打码/标记）。 |
| **安全护栏策略** | `/policy` | 每企业可配：开关每类护栏 + 选动作，配拦截清单 / 敏感话题 / 放行清单，一键套用企业预设。 |

**运行时监控 demo**：进 `/runtime`，点「**模拟用户使用**」→ 一屋子用户的流量涌进来，用户用量表和安全护栏触发流实时长出来；`sk-…` 密钥被**拦截**、手机/身份证被**打码**、注入/越权被**标记**，证据全脱敏。

**安全护栏策略 demo**：进 `/policy`，切换预设「**金融合规（严格）**」并保存 → 回 `/runtime` 再点「模拟用户使用」，同样的 PII 请求这次会从「打码」变成「**整段拦截**」；拦截清单里的词命中也会被拦。换一套企业策略，护栏行为当场就变。

> 运行时这条路上，真实产品把模型调用打到 `/gateway/v1/messages`（带 `X-User-Id` 头）即被逐用户计量并按当前策略护栏；非 ASCII 的用户名用 `encodeURIComponent` 传。

---

## 怎么「接管别人的产品」

AuditGate 提供一个 OpenAI / Anthropic 兼容的网关入口。有两种接法：

- **让目标产品把流量打过来**：把目标产品里配置的模型 `base_url` 改成指向本服务的
  `/gateway/v1/messages`。目标的每次调用就都过 AuditGate，被审计、被评分。
- **让本服务去代理真实上游**：设置环境变量 `UPSTREAM_URL`（可配合 `UPSTREAM_KEY` / `UPSTREAM_MODEL`），AuditGate 会把请求转发到真实上游模型，同时在中间做审计。

不设 `UPSTREAM_URL` 时，默认使用内置的受控靶子 **`易速云 · 企业客服 AI`**（一个故意留洞的 demo 目标），用来演示红队命中和低分评分卡。

---

## 环境变量

全部可选。不填任何一项也能零配置跑。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3300` | 服务监听端口。 |
| `TARGET_LABEL` | `易速云 · 企业客服 AI（受控靶子）` | 控制台里「接管目标」显示的标签。 |
| `UPSTREAM_URL` | *(空)* | 留空 = 用内置 mock 上游；填 OpenAI/Anthropic 兼容的 base_url 才会去代理真实上游。 |
| `UPSTREAM_KEY` | *(空)* | 真实上游的鉴权 key（仅在设了 `UPSTREAM_URL` 时需要）。 |
| `UPSTREAM_MODEL` | `glm-4.6-mock` | 网关背后使用的模型名。 |
| `MAX_AUDITS` | `500` | demo 在内存里保留多少条审计流量。 |

---

## Docker 部署

独立 stack，端口 3300，和 bohe-console 完全隔离。在 `audit-gate/` 目录下：

```bash
docker compose up -d --build
# 等价写法：
docker compose -f docker-compose.yml up -d --build
```

打开 <http://localhost:3300>。容器名 `audit-gate`，带 `/healthz` 健康检查。

---

## 接真靶子（测别人的产品）

默认是内置受控靶子（`TARGET_MODE=toy`）。要测**真实产品**，有两条路：

### A) 让产品的 base_url 指过来（我们看它全部流量）

产品把它的模型 `base_url` 改成本服务的 `/gateway/v1/messages`（OpenAI 兼容），
它的每一次调用都从我们这过，审计流即时留痕。适合能改配置的产品。

### B) 我们主动驱动产品并红队它（`TARGET_MODE=http`）

不改产品，直接把红队电池打到产品的对话接口，审计它的回复并打分。已用双实例
（3301 → 3300）跑通验证，全程真实 HTTP。

```bash
# openai 兼容接口
TARGET_MODE=http \
TARGET_URL=https://<产品>/v1/chat/completions \
TARGET_KEY=<该产品的key> \
TARGET_FORMAT=openai TARGET_MODEL=<模型名> \
TARGET_LABEL="某某产品" npm start
# 然后打开控制台点「跑红队」，或 curl -XPOST /api/redteam/run

# 简单 {message}->{reply} 接口
TARGET_MODE=http TARGET_URL=https://<产品>/chat TARGET_FORMAT=simple npm start
```

环境变量：`TARGET_MODE`（toy|http）、`TARGET_URL`、`TARGET_KEY`、`TARGET_FORMAT`
（openai|simple）、`TARGET_MODEL`、`TARGET_LABEL`。

### 可用靶子候选

- **我们自己的 console agent（bohe-proxy）**：把 `TARGET_URL` 指到代理的 OpenAI 兼容
  端点、带一个 `bk_` / key，`TARGET_FORMAT=openai`，就能给自家 agent 做体检。
- **开源项目（拿到明确许可 / 本地自建后再测）**：
  - `ReversecLabs/damn-vulnerable-llm-agent` —— 故意留洞的 ReAct agent，红队效果直观。
  - `opena2a-org/damn-vulnerable-ai-agent` —— 刻意可攻破的 agent 平台。
  - 主流壳（`open-webui` / `lobe-chat` 等）适合走 A 路：把它们的模型 base_url 指过来做流量审计。

> ⚠️ 见下方「红线」：只测自愿接入 / 同意体检的目标；开源项目请本地自建后测自己的实例。

---

## 红线（务必先读）

这是一台「谁能上线由它说了算」的安全体检设备，用它必须守住底线：

- **只测「自愿接入 / 同意体检」的目标。** 绝不偷偷 MITM，绝不攻击未授权的产品。接入前先拿到目标方的明确同意。
- **demo 独立部署、不接生产、不落真实密钥。** 本服务是隔离的演示环境，不接你的生产系统，也不在任何地方持久化真实的上游密钥。
- **受控靶子与预置流量是演示环境。** `易速云 · 企业客服 AI` 是我们自己搭的、故意留洞的靶子，配套流量也是预置的。被问到的时候要**如实说明这是演示环境**，不能拿它冒充真实第三方产品的实测结果。
- **红队姿态是「帮方案能上线」，不是当众处刑。** 找到洞是为了给出修复方向、帮对方把产品做到能安全上线，而不是羞辱供应商或公开处刑。给修复建议，不炫技。

---

**你的 AI 供应商，谁能上线，由这台说了算。**
