# Changelog

本文件记录 DidClaw / LCLAW 仓库面向协作者与用户的可见变更。**每次提交请同步追加条目**（见 `.cursor/rules/didclaw-project.mdc`）。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/）。**版本号规则**（SemVer、`package.json` / `tauri.conf.json` / `Cargo.toml` 同步、标签 `v*`）见 `.cursor/rules/didclaw-project.mdc` 中的「版本号与发版」。

## [未发布]

### 修复

- **一次性定时任务**等结束后，网关从 `sessions.list` 移除对应会话时，不再把当前选中强行改回 `sessions[0]`（主会话），避免聊天区**刚切到定时会话又立刻消失**；对已从列表消失的当前键在本地挂一条 **「…（已结束）」** 占位行，切走其它会话后下次刷新即与网关列表对齐。
- **`sessions.changed`**：先 **`await` 会话 `refresh()`** 再按需 **`loadHistory(silent)`**（与 `onHello` 一致），避免静默历史抢先拉主会话与刷新竞态。
- **Windows 初始化 / 拉起 OpenClaw**：从桌面启动时若系统 **PATH 缺少 `System32`**，仅写 `powershell.exe` 会报 **「无法启动 PowerShell：program not found」**。现对 `powershell` 使用 **`%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`**（存在时），并对子进程 **`PATH` 前置 System32、PowerShell、Wbem**（与 `windows_enhanced_path` 一致）。

### 变更

- 首次向导「安装并初始化」：用 **分步状态列表**（环境检测 → Node.js → OpenClaw CLI → onboard → 完成）替代仅无限进度条；阶段来自 `ensure-openclaw-windows.ps1` 的 `ui=…` 标记与 Tauri 的 `didclaw-ensure-install-phase`（spawn 前 `precheck_ok`）。下方日志区仍可展开查看细节。
- 定时任务列表「运行态」列改为 **运行中 / 已运行 / 未运行**（依据网关 `state.runningAtMs`、`lastRunAtMs` 与 `lastStatus`/`lastRunStatus`）；原「最近 / 下次 / 上次」细项保留为单元格悬停提示。

## [0.3.1] - 2026-03-24

### 修复

- 网关下行 **`cron`** / 与当前选中会话同 **`sessionKey` 的 `agent`**：在**本机未发送且无本地 `runId`** 时 **750ms 防抖** 拉 **`chat.history`（silent）**。实测部分版本定时任务期间仅有 `cron`/`agent`、**无 `chat`**，仅靠原逻辑主时间线不刷新，与重连后拉历史不对齐。
- 网关下行 **`sessions.changed`**（与官方 Control UI `app-gateway.ts` 一致）：收到后刷新会话列表并对当前会话静默 **`chat.history`**，避免定时任务等写入主时间线后界面不更新、仅重连才对齐。
- **`chat` 事件**若因载荷与 Zod 校验不完全匹配而被丢弃，对**当前选中会话**增加节流的 **`loadHistory` 兜底**，降低主会话 systemEvent / 网关新状态枚举导致「无实时刷新」的概率。
- 定时任务「已有任务」：`cron.list` 响应解析增加 `rows` / `records` / `values`、`payload` 与 `cron` 嵌套等兼容，并在结构化字段不匹配时用**浅层启发式**识别任务数组，降低网关返回形态升级后出现空列表的概率。
- 网关 `connect` 的 `caps` 改为默认空数组（不再仅声明 `tool-events`），以接收 **`chat` 下行事件**；避免定时任务等在 `cron:` 等会话运行时界面不刷新、需重连才出现历史（参见 [OpenClaw Session 文档](https://docs.openclaw.ai/concepts/session) 中 cron 会话键说明）。

### 新增

- **网关推送诊断日志**：`src/lib/gateway-debug-log.ts`。开发环境默认在控制台输出 `[didclaw][gateway-push]`（`chat` / `sessions.changed` / `loadHistory` 等关键路径）；生产或 Tauri 可 `localStorage.setItem("didclaw_debug_gateway","1")` 后刷新开启，设为 `"0"` 可在开发构建下关闭。
- 定时任务弹窗：对接 **`cron.status`**（顶部调度摘要）、**`cron.runs`**（运行记录列表、范围/排序、分页加载、带 `sessionKey` 时「打开会话」）；**`cron.list`** 请求参数与官方 Control UI 对齐（`includeDisabled`、`offset`、`sortBy`、`sortDir` 等，失败时回退简化参数）。**`cron.update` / `cron.remove` / `cron.run`** 改用与官方一致的 **`id`** 字段。辅助解析见 `src/lib/cron-gateway.ts`。
- `public/logo-didclaw-variants.html`：DidClaw Logo 字体与样式对比静态页，便于选型与评审。

### 变更

- 网关 **`agent`** 下行：仅在 **`stream` 非 `tool`**（lifecycle / compaction 等）或 **`tool` 且 `phase === "result"`** 时参与防抖静默拉 **`chat.history`**，跳过高频 **`tool` start/update**，减轻请求与 `incomingCount` 抖动；**`cron`** 仍按原逻辑触发。
- 定时任务创建表单：「会话」选项与说明对齐 [OpenClaw Cron](https://docs.openclaw.ai/automation/cron-jobs) / [Session](https://docs.openclaw.ai/concepts/session) 主会话与隔离行为，便于理解主聊天窗与 `cron:` 会话的差异。
- 顶栏品牌区：DidClaw 标题分色（D / idCl / aw）、Righteous 字体与菱形标配色调整；`index.html` 补充加载 Righteous 字重。
- 聊天：网关 `chat` 事件若针对**非当前选中会话**（如定时任务在隔离会话跑），在输入区空闲时**自动切换到该会话**并展示流式/结果；若本地仍在发送或生成中则仅节流刷新会话列表，避免打断当前轮次。

## [0.3.0] - 2026-03-24

### 新增

- **桌面端 DidClaw 本地存储**：在应用数据目录使用 SQLite（`didclaw.db`）存放网关本机合并配置及白名单 KV（设备身份、首次引导、Skills 安装根、OpenClaw 更新提示等）；纯浏览器仍使用 `localStorage`。未发版阶段**不**做自旧 `gateway-local.json` 或 `localStorage` 的自动迁移。OpenClaw 的 `~/.openclaw` 文件逻辑未改。

### 变更

- DidClaw 本地 SQLite：**移除**自 `gateway-local.json` 与自 WebView `localStorage` 的自动迁移逻辑（未发版阶段不维护老数据恢复路径）。
- Tauri：`permissions/didclaw.toml` 的 `invoke-all` 白名单补充 `didclaw_kv_get` / `didclaw_kv_set` / `didclaw_kv_remove`（及遗漏的 `dialog_save_base64_file`），避免 ACL 拒绝 IPC。

### 文档

- 新增 `docs/didclaw-sqlite-storage-migration.md`：DidClaw 自有数据统一 SQLite 的方案与实施说明（OpenClaw `~/.openclaw` 不在此范围）。
