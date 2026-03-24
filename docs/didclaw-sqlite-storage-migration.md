# DidClaw 自有数据存储统一为 SQLite — 迁移方案

## 1. 目标与边界

### 1.1 目标

- **DidClaw 客户端自身**产生的配置与状态，收敛到 **单一 SQLite 数据库**（由桌面壳读写），便于备份、审计、版本迁移与后续扩展。
- 对外行为与现有 **IPC / 前端调用契约**保持一致（`read_gateway_local_config` 等外形不变）。

### 1.2 明确不做（边界）

- **OpenClaw 生态数据**保持现有形态，**不迁入 SQLite、不改变路径与格式**，包括但不限于：
  - 用户主目录下 `~/.openclaw/`（如 `openclaw.json`、`agents/.../models.json`、`auth-profiles.json` 等）；
  - Tauri 侧已存在的 **读/写/合并/备份** 逻辑与契约。
- **聊天记录与会话权威**：仍以 **网关（WebSocket 协议）** 为准；客户端不引入本地消息库作为业务主存（除非未来单独立项）。

### 1.3 运行环境策略

| 环境 | 策略 |
|------|------|
| **Tauri 桌面** | SQLite 为 DidClaw 自有数据的**主存**；实现于 Rust，库文件放在应用数据目录。 |
| **纯浏览器（`pnpm dev` 无壳）** | 无 Rust/SQLite；**继续**使用 `localStorage`（及环境变量）作为降级，与今日行为一致。 |

---

## 2. 现状盘点（迁移前 / 已迁移对照）

### 2.1 应用数据目录（已实现）

- **当前主存**：`app_data_dir()/didclaw.db`，表 `didclaw_kv`；网关合并配置使用内部键 `__didclaw_gateway_local_merged__`（见 `didclaw_db.rs`）。
- **无老数据导入**：产品未正式发布阶段不实现自 `gateway-local.json` 或自 `localStorage` 的自动迁移；新数据只写入 `didclaw.db`（桌面）或 `localStorage`（纯浏览器）。
- **消费方**：`read_gateway_local_config` / `write_gateway_local_config` 契约不变；`openclaw_gateway`、`openclaw_version_check`、`setup_status` 等仍通过 `gateway_local::read_merged_map`。

### 2.2 WebView `localStorage`（DidClaw 键）

| 领域 | 键/说明 | 建议迁入 SQLite（桌面） |
|------|---------|-------------------------|
| 设备身份 | `didclaw-device-identity-v1`（含私钥，JSON） | 是（桌面主存；浏览器仍 localStorage） |
| 首次运行 / 模型向导 | `didclaw_first_run_model_complete`、`didclaw_model_config_deferred`、`didclaw_model_wizard_snooze_until`、`didclaw_setup_wizard_snooze_until` | 是 |
| Skills 安装根 | `didclaw.skillsInstallRoot` | 是 |
| OpenClaw 更新提示 | `didclaw.openclawUpdate.dismissedLatest` | 是（仍为 DidClaw UI 状态，与 OpenClaw 配置文件无关） |

### 2.3 不属于本次「DidClaw 库」的数据

- **`VITE_*` / 构建期环境变量**：网关默认 URL 等，仍为开发与便携场景入口，不写入 SQLite（除非产品明确要求「运行时覆盖写入库」）。
- **任意 `~/.openclaw/**`**：按 1.2 节，**不迁移**。

---

## 3. 目标架构（SQLite）

### 3.1 库文件位置

- **建议路径**：`app_data_dir()/didclaw.db`（与其它应用数据文件同目录，便于备份）。
- **打开方式**：Tauri 启动或首次 IPC 时打开；使用 **单文件数据库** + 合理 `PRAGMA`（如 `journal_mode=WAL`、`foreign_keys=ON`），具体在实现阶段定稿。

### 3.2 表结构 — 方案 A（推荐）：KV + 网关专用视图逻辑

为减少与现有「合并写 JSON」逻辑的摩擦，可采用：

1. **`didclaw_kv`**
   - `key TEXT PRIMARY KEY`
   - `value TEXT NOT NULL`（UTF-8 字符串；复杂结构用 JSON 文本）
   - 用于：设备身份、向导 snooze、Skills 根路径、更新提示 dismiss 等。

2. **`gateway_local`（单表多列或单行 JSON）** — 二选一：
   - **2a. 单列 JSON**：一行 `payload TEXT`，与当前 `merged` 对象一致，**复用**现有 merge/序列化思路；
   - **2b. 规范化列**：`url`、`token`、`password`、各布尔与路径字段；读写时组装为今日 `merged_to_frontend_value` 形状。

**推荐 2a（JSON 单列）**：迁移成本最低，与 `gateway_local.rs` 现有 `Map<String, Value>` 语义最接近；若未来要强审计再考虑 2b。

### 3.3 版本与迁移（schema）

- 使用 **`PRAGMA user_version`** 或自建 `didclaw_meta` 表记录 **schema 版本**。
- 每个版本配套 **up 迁移**（Rust 内嵌 SQL 或迁移脚本）；**不提供**对用户手改库的承诺（与 OpenClaw 手写 JSON 策略区分）。

---

## 4. 数据与版本策略（当前）

### 4.1 不做自动迁移

- 不发版阶段：**不**从旧 `gateway-local.json`、**不**从 WebView `localStorage` 自动灌入 SQLite，避免维护多套导入路径。
- 正式发布前若需兼容外测用户，可再单独立项做「一次性导入」或导出/导入工具。

### 4.2 Rust 内部调用方

- 所有当前 `gateway_local::read_merged_map` / `write_merged_from_payload` 的调用点改为走 **统一存储模块**（内部仍暴露相同 Rust API 更佳，减少扩散）。
- 对外文档中旧表述「gateway-local.json」应逐步改为「DidClaw 本地数据库（`didclaw.db`）/ 网关本地配置」。

---

## 5. IPC 与前端契约

### 5.1 保持稳定的命令（推荐）

- **`read_gateway_local_config` / `write_gateway_local_config`**：参数与返回 JSON **不变**；仅后端存储从文件改为 SQLite。

### 5.2 新增命令（若 KV 不全部通过网关一条 JSON 表达）

- 例如：`didclaw_kv_get` / `didclaw_kv_set` / `didclaw_kv_delete`（需 **键白名单或前缀** + 长度上限，符合 `didclaw-security.mdc` 对 IPC 的校验要求）。
- 前端封装：`device-identity`、`modelConfigDeferred`、`skills-invoke`、`OpenClawUpdatePrompt` 在 `isDidClawDesktop()` 时走 invoke，否则 localStorage。

### 5.3 类型与命名

- `DidClawElectronApi` / `isDidClawElectron` 等为历史「桌面壳」抽象；**与本迁移无强绑定**；可选在后续单独做「重命名为 Desktop」的 refactor。

---

## 6. 安全与隐私

- SQLite **磁盘上为本地明文**（token/password、设备私钥等）；不因此自动变为加密库。
- 若后续要加密：**单独立项**（密钥链、OS 凭据仓、备份与恢复策略）。
- IPC：**禁止**无界字符串；对 `key`、`value` 设最大长度；网关 JSON 合并逻辑保持服务端式校验习惯。

---

## 7. 测试与验收

- **桌面新数据路径**：网关本机设置保存后写入 `didclaw.db`，重启后仍在；KV 键同理。
- **纯浏览器**：不调用 `didclaw_kv_*`，仍用 `localStorage` + 环境变量，无回归。
- **回归范围**：网关拉起选项、`openclaw_version_check`、安装引导、Skills 路径、首次运行向导、更新提示 dismiss。

---

## 8. 文档与变更管理

- 实现落地时：更新 `CHANGELOG.md`（[未发布]）；同步修改用户可见说明（如 `docs/didclaw-已实现功能说明.md`、`.env.production.example` 中「gateway-local.json」表述）。
- **本文件**：在实现完成后可增加一节「实施记录」链接到 PR/提交，或标为已归档方案。

---

## 9. 风险与待决问题

| 项 | 说明 |
|----|------|
| 读源一致性 | 桌面以 DB 为准、浏览器以 localStorage 为准；勿混用两套壳测同一 profile。 |
| 并发 | 多窗口/多进程是否共享同一 `app_data_dir`；SQLite 锁与 WAL 是否足够（通常足够）。 |
| 备份 | 用户备份应用数据时仅复制 `didclaw.db` 即可；需在支持文档中说明。 |
| Electron | 若仍存在独立 Electron 包，需决定是否与同路径 JSON 对齐或仅 Tauri 落库（当前仓库以 Tauri 为主）。 |

---

## 10. 里程碑（回顾）

1. **M1**：SQLite + `didclaw.db` schema v1。
2. **M2**：网关合并配置写入 DB + `read_merged_map` 调用方验证。
3. **M3**：KV IPC + 前端桌面路径走 DB；**未做**老 JSON / localStorage 自动导入。
4. **M4**：文档与 CHANGELOG 持续同步；若发版需兼容历史数据再补导入方案。

---

*文档版本：与仓库实现同步；细节以代码与 CHANGELOG 为准。*

---

## 11. 实施记录（仓库现状）

- **Rust**：`rusqlite`（`bundled`）模块 `didclaw_db.rs`；`gateway_local.rs` 改为读写字段合并结果至 SQLite。
- **IPC**：`didclaw_kv_get` / `didclaw_kv_set` / `didclaw_kv_remove`（键白名单 + 长度上限，见 `didclaw_db.rs`）。
- **前端**：`didclaw-kv.ts` 在 `main.ts` 挂载前 `hydrateDidClawKvCache()`（仅从 DB 填充缓存）；设备身份、首次引导、Skills 安装根、OpenClaw 更新 dismiss 等在桌面端走 KV；纯浏览器仍 `localStorage`。
- **未实现**：自 `gateway-local.json` / `localStorage` 的自动数据恢复（未发版阶段不需要）。
- **未采用**：`tauri-plugin-sql`（由 Rust + 受限 IPC 收口，见前文技术取舍）。
