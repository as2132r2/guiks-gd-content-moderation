# guiks-gd-content-moderation

贵客松赛道二·广电方向的独立 Web Demo。目标是一条可现场跑通的县级融媒闭环：

> 素材入口 → 入口准入 → 稿件生成 → 输出预检 → 三审流转 → AI 参与度追溯

项目从薄荷 `AuditGate` PR 的可运行代码起步，但独立建库、独立配置、独立部署，不依赖薄荷线上服务。

## 黑客松技术栈

- Node.js 22 + TypeScript
- Hono + 服务端 HTML/Hono JSX + 少量浏览器 JavaScript
- SQLite + Drizzle ORM
- Claude Agent SDK
- 统一模型 Gateway（GLM/DeepSeek，Anthropic 兼容协议）
- REST + SSE
- Vitest + Docker Compose

第一版保持单仓库、单服务、单容器。模型 Gateway 是代码级硬边界：业务模块不得直接访问模型供应商。

## 当前基线

当前代码保留了原 AuditGate 已验证的：

- 请求/响应双向扫描
- `block / redact / flag` 三档动作
- 策略配置
- SSE 事件流
- 逐用户用量
- 红队与报告
- 43 个自动化测试

这些能力将从“通用 AI 保密审计”改造为“县级融媒适播预检与生产追溯”。原说明保存在 [docs/legacy-auditgate-readme.md](docs/legacy-auditgate-readme.md)，组长方案保存在 [docs/design/broadcast-pivot.html](docs/design/broadcast-pivot.html)。

## 本地运行

```bash
npm install
npm run dev
```

打开 <http://localhost:3300>。

```bash
npm run check
docker compose up --build
```

## 开发入口

- [最终架构与边界](docs/ARCHITECTURE.md)
- [团队分工与截止时间](docs/EXECUTION-PLAN.md)
- [协作规则](CONTRIBUTING.md)

`main` 必须始终能演示。功能开发走短分支、小 PR；影响共享契约、模型 Gateway 或演示链路的修改需要黄博文或 William 复核。
