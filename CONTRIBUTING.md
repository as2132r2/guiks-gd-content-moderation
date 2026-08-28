# 协作规则

## 分支

- 黄博文：`feat/audit-gateway`
- William：`feat/editor-workflow`
- Leo：`feat/foundation`
- 刘浩：`feat/rules-fixtures`

紧急修复使用 `fix/<short-name>`。不要在一个分支同时重构共享底座和开发页面。

## 提交与 PR

1. 提交前运行 `npm run check`。
2. PR 写清楚：改了什么、如何验证、是否影响三分钟演示。
3. 改共享类型、Gateway、数据库 schema 时，必须找另一位成员复核。
4. 合并后立即拉取 `main` 并跑一次主链。

## Definition of Done

- 成功路径可现场操作，不依赖开发者手工改数据库。
- 失败时页面有明确提示，不能静默回退 Mock。
- 核心行为有至少一个自动化测试。
- 不把 API Key、真实个人信息或未脱敏素材提交到 Git。
