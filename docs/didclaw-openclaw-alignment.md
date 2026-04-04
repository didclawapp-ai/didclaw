# OpenClaw 功能 vs DidClaw 对齐与路线图

> **用途**：以 **OpenClaw 能力全貌** 为行、**DidClaw（`didclaw-ui` + Tauri）** 为列，做状态标注与排期参考；比零散「补全清单」更接近产品路线图。  
> **上游能力定义**：见同目录 [`openclaw-features.md`](./openclaw-features.md)（仓库对齐版）。  
> **协议与 RPC 细节**：见 [`gateway-client-protocol-notes.md`](./gateway-client-protocol-notes.md)。  
> **多 Agent（公司制）专题方案**：见 [`didclaw-multi-agent-company-spec.md`](./didclaw-multi-agent-company-spec.md)。  
> **整理日期**：2026-04-04（修订：纳入代码核对与表述修正）

---

## 维护说明

| 项 | 建议 |
|----|------|
| **何时更新** | OpenClaw 大版本升级、`didclaw-ui` 合并大块功能、或每季度例行对表 |
| **如何验证** | 以本仓库代码为准；表格中的路径相对于仓库根目录 `LCLAW/` |
| **统计占比** | 文末计数为**按表格行人工汇总**，仅反映趋势，非严格 KPI |

---

## 状态标记

| 标记 | 含义 |
|------|------|
| ✅ 已对齐 | DidClaw 已实现该能力（含 UI 或等价路径） |
| 🟡 部分对齐 | 有基础实现、缺专用 UI，或仅覆盖子场景 |
| ❌ 未对齐 | 尚未实现 |
| ➖ 不适用 | 属 Gateway/CLI/其他形态，桌面客户端不直接替代 |

---

## 一、核心架构

| OpenClaw 能力 | 状态 | DidClaw 实现说明 |
|---------------|------|------------------|
| Gateway 控制平面 (WebSocket) | ✅ | `didclaw-ui/src/features/gateway/gateway-client.ts`、`tauri-gateway-socket.ts`、`src-tauri/.../gateway_tunnel.rs` |
| CLI | ➖ | 桌面端不替代全部 CLI，部分能力用 UI + Tauri 封装 |
| Pi Agent Runtime (RPC) | ➖ | 网关侧运行时，客户端经 `chat.send` 等使用 |
| Control UI / WebChat | ✅ | 主界面承担聊天与控制；**侧重**安装、预览、备份、技能等增强（非「API 一一等同」官方 Web） |
| 会话模型（主会话 / 群组等） | ✅ | `didclaw-ui/src/stores/session.ts` + `chat.ts` 与 `sessions.list` 同步 |
| Multi-agent：每 agent 独立 auth-profiles | ✅ | 官方 [Multi-Agent Routing](https://docs.openclaw.ai/concepts/multi-agent)：`~/.openclaw/agents/<agentId>/agent/auth-profiles.json`，主凭据不自动共享，需共用时 **复制** 至目标 agentDir；DidClaw 保存 `agents.list` 后对空凭据子 agent **从 main 复制**（`sync_openclaw_subagent_auth_profiles_from_main` / `openclaw_agents_config.rs`） |
| Gateway 本机子进程 | ✅ | `openclaw_gateway.rs`：`ensure` / `restart` / `stop` 等（以实际命令名为准） |

---

## 二、消息通道

### 2.1 带专用配置面板的通道

| 通道 | 状态 | 说明 |
|------|------|------|
| WhatsApp | ✅ | `features/settings/channels/whatsapp/` |
| WeChat（微信插件） | ✅ | `wechat/` |
| Feishu | ✅ | `feishu/` |
| WeCom | ✅ | `wecom/` |
| Discord | ✅ | `discord/` |
| Slack | ✅ | `slack/` |
| Microsoft Teams | ✅ | `msteams/` |
| LINE | ✅ | `line/` |
| Google Chat | ✅ | `googlechat/` |

### 2.2 无专用 Panel、依赖通用插件/安装流

下列在仓库中**未见**与上表同级的 `*Panel.vue`，通常走 **`GenericPluginPanel.vue`**、**`InstallChannelPanel.vue`** 或插件元数据（与官方「扩展通道」一致）：

| 通道 | 状态 | 说明 |
|------|------|------|
| Telegram, Signal, BlueBubbles, iMessage, IRC, Matrix, Mattermost, Nextcloud Talk, Nostr, Synology Chat, Tlon, Twitch, Zalo, Zalo Personal | 🟡 | 统一记为：**通用插件/安装流**；具体是否已装取决于本机 `openclaw plugins` |
| QQ Bot | ❌ | 未见专用 Panel；上游见 `extensions/qqbot`，可后续接通用流 |

### 2.3 通道相关能力

| 能力 | 状态 | 说明 |
|------|------|------|
| 通用插件通道面板 | ✅ | `GenericPluginPanel.vue` |
| 通道安装 / QR 等流程 | ✅ | `InstallChannelPanel.vue`、`start_channel_qr_flow` 等 |
| 通道健康检查 | ✅ | `composables/useChannelHealth.ts` |
| OAuth（如 Minimax、OpenAI Codex 等） | ✅ | `useOAuthFlow.ts` 等 |
| 流式安装日志 | ✅ | `useStreamingInstall.ts` |
| 群聊提及 / 激活策略配置 UI | ❌ | 以网关配置为准，客户端未做专项表单 |
| DM 配对策略配置 UI | 🟡 | 设备/Scope 配对有；**频道级 dmPolicy 等**未做完整表单 |
| 广播群组 | ❌ | 未做 |

---

## 三、AI 模型与提供商

| 能力 | 状态 | 说明 |
|------|------|------|
| 模型与 Provider 配置 UI | ✅ | `AiProviderSetup.vue`，Tauri：`read/write_open_claw_model_config`、`read/write_open_claw_providers*` |
| 提供商目录 / 预设 | ✅ | `lib/provider-catalog.ts` |
| 使用统计展示 | ✅ | `UsageStatsDialog.vue`、`format-token-count.ts` |
| AI 配置快照（只读诊断） | ✅ | `read_open_claw_ai_snapshot` |
| OpenAI/Codex OAuth | ✅ | `run_openai_codex_oauth` |
| 模型故障转移（failover）配置 UI | ❌ | 依赖 `openclaw.json` 手工或官方工具 |
| **会话级模型覆盖** | 🟡 | **`session.ts` 已提供 `patchSessionModel` → `sessions.patch`，当前无组件调用**；用户可向网关发 `/model` 等文本命令（若网关支持） |
| 思考级别 UI（等价 `/think`） | ❌ | 未做专用控件；可依赖聊天内发送网关斜杠命令（若允许） |

---

## 四、工具系统

| 能力 | 状态 | 说明 |
|------|------|------|
| 工具时间线 | ✅ | `InlineToolTimeline.vue`、`stores/toolTimeline.ts` |
| Exec 审批 | ✅ | `ExecApprovalDialog.vue`、`stores/approval.ts` |
| 工具 Profile 读写 | ✅ | `read/write_open_claw_tools_profile` |
| 技能启用/禁用 | ✅ | `write_open_claw_skill_enabled` |
| 浏览器控制 UI | ❌ | 未集成 |
| Web 搜索 UI | ❌ | 未集成 |
| read/write/edit（沙箱内） | ➖ | 工具在网关侧执行，客户端不重复做编辑器 |
| 代码执行沙盒 UI | ❌ | 未集成 |
| 图片生成 / PDF 工具向 UI | ❌ | 预览有，**分析类工具面板**无 |
| 工具 allow/deny 可视化配置 | ❌ | 未做 |

---

## 五、自动化与调度

| 能力 | 状态 | 说明 |
|------|------|------|
| Cron 管理 | ✅ | `CronJobsDialog.vue`、网关 `cron.*` |
| Webhook | ❌ | 未做 |
| Gmail Pub/Sub | ❌ | 未做 |
| Heartbeat / Hooks / ClawFlow 等 | ❌ | 未做；是否属当前上游主线见 [`openclaw-features.md`](./openclaw-features.md) |

---

## 六、语音与通话

| 能力 | 状态 | 说明 |
|------|------|------|
| Voice Wake / Talk Mode / TTS / PTT / Voice Call | ❌ | 属官方 macOS/iOS/Android 节点应用能力；DidClaw（Windows 桌面为主）未覆盖 |

---

## 七、设备与节点

| 能力 | 状态 | 说明 |
|------|------|------|
| 网关 WebSocket 配对 / Tunnel | ✅ | `gateway_tunnel_*`、配对修复流程（如顶栏 backend repair） |
| 节点列表 / `node.invoke` 控制台 | ❌ | 未做 |
| 摄像头 / 录屏 / 位置 / 通知（节点侧） | ❌ | 未做 |

---

## 八、Canvas / A2UI

| 能力 | 状态 | 说明 |
|------|------|------|
| Canvas / A2UI / Eval / Snapshot | ❌ | 未做（与官方节点 + Canvas 主机不同；另有产品内 **信息素图** 等自有可视化，不计入 OpenClaw Canvas） |

---

## 九、安全与认证

| 能力 | 状态 | 说明 |
|------|------|------|
| 网关 Token / 密码 | ✅ | **桌面**：`gateway-local.json` + 本机设置；**浏览器联调**：`VITE_GATEWAY_TOKEN` / `VITE_GATEWAY_PASSWORD` |
| 设备配对 / Scope | ✅ | 与 Tunnel、`device.pair.approve` 等配合 |
| 频道 DM 配对码、allowlist 表单 | ❌ | 以网关配置为准 |
| 沙盒 / Tailscale / secrets 管理 UI | ❌ | 未做 |
| Doctor | ✅ | `DoctorDialog.vue` / `DoctorPanel.vue`、`run_openclaw_doctor` |

---

## 十、安装与部署（DidClaw 侧）

| 能力 | 状态 | 说明 |
|------|------|------|
| Windows 上引导安装 OpenClaw | ✅ | `run_ensure_openclaw_windows_install` 等 |
| 安装状态检测 | ✅ | `get_open_claw_setup_status` |
| OpenClaw 版本检查 | ✅ | `check_openclaw_update` |
| Onboard | ✅ | `FirstRunWizard.vue`、`run_openclaw_onboard` |
| Gateway 启停 / 自动启动 | ✅ | 本机设置 + Tauri 命令 |
| 开机自启 / 防止休眠 | ✅ | `get/set_autostart_*`、`prevent_sleep_*` |
| DidClaw 自更新 | ✅ | `check_didclaw_update` / `install_didclaw_update` |
| 配置备份与恢复 | ✅ | `BackupRestoreDialog.vue` 等 |
| 配置回滚 | ✅ | `restore_open_claw_config_to_latest_backup` |

---

## 十一、Web 界面形态

| 能力 | 状态 | 说明 |
|------|------|------|
| 聊天主界面 | ✅ | 类 WebChat |
| 独立 Dashboard 仪表盘 | ❌ | 未做 |
| TUI | ➖ | GUI 替代 |

---

## 十二、技能与插件

| 能力 | 状态 | 说明 |
|------|------|------|
| 技能管理器 / ClawHub | ✅ | `SkillsManagerDialog.vue`、`clawhub_*`、`openclaw_skills_*` |
| 插件 list/inspect/enable/update/uninstall | ✅ | `openclaw_plugins_*` |
| 插件 zip 安装 | ✅ | `plugins_pick_package_file` |
| 技能创建向导 | ❌ | 未做 |

---

## 十三、会话与斜杠命令

| 能力 | 状态 | 说明 |
|------|------|------|
| 会话列表 / 切换 / 历史 | ✅ | `session.ts`、`SessionHistoryDialog.vue` |
| 发送后识别 `/new`、`/reset` 并刷新会话 | ✅ | `stores/chat.ts` 内逻辑 |
| **SlashCommandPicker 预置命令** | ✅ | `slash-commands.ts`：**`/new`、`/remember`、`/forget`、`/status`、`/usage`、`/model`**（带参数） |
| 其他网关斜杠（如 `/compact`、`/think`、`/restart`） | 🟡 | **可手打在输入框发送**，由网关处理；**未全部纳入 Picker 列表** |

---

## 十四、CLI 与 UI 映射

| CLI（示例） | DidClaw 对应 | 状态 |
|-------------|--------------|------|
| `openclaw onboard` | 首次运行向导 | ✅ |
| `openclaw gateway` | 启停 / 自动启动 | ✅ |
| `openclaw agent` / 聊天 | 主界面 | ✅ |
| `openclaw channels` | `ChannelSetupDialog` 等 | ✅ |
| `openclaw doctor` | Doctor 对话框 | ✅ |
| `openclaw status` | 连接状态 / Hello | 🟡 |
| `openclaw update`（DidClaw 包） | 更新提示组件 | ✅ |
| `openclaw plugins` / `skills` | 技能与插件 UI | ✅ |
| `openclaw nodes` | — | ❌ |
| `openclaw devices` / `pairing` | 配对相关 | 🟡 |
| `openclaw cron` | Cron 对话框 | ✅ |
| `openclaw sessions` | 会话列表 + 历史 | 🟡 |
| `openclaw models` | AiProviderSetup | ✅ |
| `openclaw memory` / `browser` / `logs` / `secrets` / `sandbox` | — | ❌ |

---

## 十五、媒体与预览

| 能力 | 状态 | 说明 |
|------|------|------|
| 聊天附件 | ✅ | Composer 附件管线 |
| 图片 / PDF / MD / 代码 / ECharts | ✅ | `PreviewPane`、LibreOffice 链路等 |
| 另存、系统打开、分享 | ✅ | Tauri / 菜单命令 |
| 图片生成 / 视频理解工具 UI | ❌ | 未做 |

---

## 十六、远程访问

| 能力 | 状态 | 说明 |
|------|------|------|
| 本机 WS（含 Tauri Tunnel） | ✅ | 环回 + Origin 策略 |
| Tailscale / SSH 隧道 / Bonjour 配置 UI | ❌ | 未做 |

---

## 十七、其他（DidClaw 增强与缺口）

| 能力 | 状态 | 说明 |
|------|------|------|
| i18n（中/英） | ✅ | `i18n/en.ts`、`zh.ts` |
| 主题 | ✅ | `stores/theme.ts` |
| Markdown / 代码高亮 / 外链白名单 | ✅ | 见预览与渲染模块 |
| 全局快捷键 / 托盘 | ✅ | `useAppShellGlobalShortcuts.ts`、`tray_icon.rs` |
| 信息素记忆（实验） | ✅ | `pheromone-engine.ts`、`PheromoneMapDialog.vue` |
| Live Edit | ✅ | `LiveCodePanel.vue`、`live_edit_apply_unified_diff` |
| KV | ✅ | `didclaw_kv_*` |
| Presence / Typing / Usage footer / 循环检测 UI | ❌ | 未做 |

---

## 总结统计（趋势）

| 状态 | 行数（约） |
|------|------------|
| ✅ | 48 |
| 🟡 | 14 |
| ❌ | 24 |
| ➖ | 2 |

**说明**：按本章各表「状态」列逐行人工计数，合并了「通用插件」多通道行；复算时允许个位数偏差。

### DidClaw 差异化强项（相对官方 Control UI 主路径）

- Tauri 桌面安装包与 **一站式 OpenClaw 安装/向导**
- **多格式预览**（PDF、Office 链、ECharts 等）
- **配置备份 / 回滚**
- **ClawHub + 插件/技能**可视化
- **双语**与 **Live Edit**、**信息素**等实验能力

### 建议优先补齐（路线图）

1. **会话级模型**：为已有 `patchSessionModel` 增加 UI（会话头或设置条）
2. **日志 / 健康**：Gateway 日志或 `health` RPC 的只读面板
3. **Webhook / 自动化**：与 Cron 并列的入口或链官方配置说明
4. **安全表单**：allowlist、沙盒、Tailscale 等至少「只读 + 打开配置文件」
5. **节点**：只读 `node.list` + 文档链，再迭代控制
6. **Dashboard**：系统与连接概览（可选）
7. **斜杠命令**：将常用网关命令同步进 `slash-commands.ts` 提示（不改变网关语义）

---

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-04-04 | 首版入 `docs/`：合并 workspace 对齐表 + 代码核对（会话模型 API、斜杠命令、Token 来源、统计说明） |
