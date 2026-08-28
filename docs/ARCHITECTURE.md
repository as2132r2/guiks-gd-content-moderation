# 最终架构与 MVP 边界

## 拍板结论

黑客松版本采用单体 Web 应用：`Hono + TypeScript + SQLite + Claude Agent SDK + REST/SSE`。

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
src/routes/       页面、REST、SSE、Gateway HTTP 入口
src/views/        工作台、预检、流转、追溯、管理页面
src/domain/       稿件、审次、决定、追溯等纯领域模型
src/lib/          detector、guardrail、policy、event 等通用能力
src/model/        ModelGateway、AgentRuntime、供应商适配
src/db/           SQLite、Drizzle schema、repository
test/             确定性规则、接口、演示主链回归
```

目录会随第一批 PR 创建；共享契约先定，页面和检测并行开发。

## 黑客松内明确不做

- 不做爬虫和外部采集系统对接，只粘贴/上传。
- 不做真实多平台发布，按钮只演示状态变化。
- 三个审核角色写死，不做完整账号与权限系统。
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
