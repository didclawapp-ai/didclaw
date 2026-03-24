# Changelog

本文件记录 DidClaw / LCLAW 仓库面向协作者与用户的可见变更。**每次提交请同步追加条目**（见 `.cursor/rules/didclaw-project.mdc`）。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/）。**版本号规则**（SemVer、`package.json` / `tauri.conf.json` / `Cargo.toml` 同步、标签 `v*`）见 `.cursor/rules/didclaw-project.mdc` 中的「版本号与发版」。

## [未发布]

## [0.3.0] - 2026-03-24

### 新增

- **桌面端 DidClaw 本地存储**：在应用数据目录使用 SQLite（`didclaw.db`）存放网关本机合并配置及白名单 KV（设备身份、首次引导、Skills 安装根、OpenClaw 更新提示等）；纯浏览器仍使用 `localStorage`。未发版阶段**不**做自旧 `gateway-local.json` 或 `localStorage` 的自动迁移。OpenClaw 的 `~/.openclaw` 文件逻辑未改。

### 变更

- DidClaw 本地 SQLite：**移除**自 `gateway-local.json` 与自 WebView `localStorage` 的自动迁移逻辑（未发版阶段不维护老数据恢复路径）。
- Tauri：`permissions/didclaw.toml` 的 `invoke-all` 白名单补充 `didclaw_kv_get` / `didclaw_kv_set` / `didclaw_kv_remove`（及遗漏的 `dialog_save_base64_file`），避免 ACL 拒绝 IPC。

### 文档

- 新增 `docs/didclaw-sqlite-storage-migration.md`：DidClaw 自有数据统一 SQLite 的方案与实施说明（OpenClaw `~/.openclaw` 不在此范围）。
