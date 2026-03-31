---
name: didclaw-workspace
description: >-
  Anchors agents to the LCLAW monorepo for the DidClaw client (Tauri + web).
  Summarizes repo layout, authoritative Cursor rules, docs entry points, and
  client check commands. Use when working in this repository, onboarding, or
  when the user mentions DidClaw, LCLAW, didclaw-ui, Gateway, or Tauri here.
---

# DidClaw / LCLAW 工作区

## 定位

- 仓库根：**LCLAW**；对外产品名：**DidClaw**（勿用「LCLAW UI」作品名）。
- 客户端代码根目录：**`didclaw-ui/`**（Vite 前端 + `src-tauri`）。
- 方案与接口类说明：**`docs/`**。
- 大型上游拷贝 **`openclaw-src/`** 通常不入库；勿误提交。

## 权威规则（先于本 Skill）

本仓库已在 **`.cursor/rules/`** 定义总则与安全/客户端约束；生成代码与提交说明须与其一致，尤其：

- `didclaw-project.mdc`：目录、品牌、`DIDCLAW_*`、版本三处同步、`CHANGELOG.md`、最小改动。
- `didclaw-client.mdc`：客户端侧约定。
- `didclaw-security.mdc`：安全与敏感信息。

若任务涉及发版、契约或 Git 纪律，**先对照上述文件**，勿凭记忆简化。

## 何时读哪些文档

| 主题 | 建议入口 |
|------|----------|
| DidClaw 自有 SQLite 存储、KV、与 OpenClaw 目录边界 | `docs/didclaw-sqlite-storage-migration.md` |
| 网关 / HTTP 字段与错误码 | `docs/` 中对应文档 + 调用方代码（契约优先） |

未明确要求时，**不要**新建或扩展说明用 Markdown（见 `didclaw-project.mdc`）。

## 客户端自检（在 `didclaw-ui/`）

```bash
pnpm run lint
pnpm run typecheck
pnpm test
```

涉及 Tauri 改动时，确认 **`didclaw-ui/src-tauri`** 可编译。

## 协作语言

面向团队的说明、规则解释、PR 描述等：**简体中文**（与 `didclaw-project.mdc` 一致）。
