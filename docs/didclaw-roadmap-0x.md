# DidClaw 0.x 功能实施路线图

> 目标：在 Product Hunt 发布前（1.0 之前）完成以下功能，让非技术用户开箱即用。

---

## P0 — 发布前必须完成

### P0-1 国际化（i18n） ✅ 已完成（v0.3.2，commit bbe27c6）

**目标**：UI 支持中文 / 英文切换，Product Hunt 主展示语言为英文。

**技术方案**
- 引入 `vue-i18n v9`（与 Vue 3 + Pinia 无缝集成）
- 语言文件放在 `lclaw-ui/src/i18n/` 下，按语言分文件：`zh.ts` / `en.ts`
- 在 `localSettings` store 中增加 `locale` 字段，持久化到 localStorage
- 设置界面加语言切换选项

**工作范围**
- [x] 安装 vue-i18n，搭建目录结构
- [x] 提取所有 Vue 组件中的中文硬编码字符串（模板 + script）
- [x] 提取 Pinia store 中的错误消息字符串
- [x] 英文翻译（en.ts）
- [x] 设置 Tab 增加语言切换 UI（GatewayLocalDialog 标题栏「中 / EN」按钮）
- [ ] Rust 侧错误字符串（用户可见部分）英文化（低优先，可后续补充）

**注意**：PowerShell 安装脚本已为英文 ✅，无需改动。

---

### P0-2 记忆管理 UI ~~（已取消）~~

> **决定不做**：1.0 之前不在 UI 内提供 workspace Markdown 编辑器，用户通过文件管理器或 `openclaw configure` 直接编辑即可。

---

### P0-3 Token 用量显示 ✅ 已完成（v0.3.2）

**目标**：让用户了解本次会话消耗了多少 Token。

> **范围调整**：费用估算不做；历史用量汇总 Tab 不做。只展示当前会话 Token 用量即可。

**工作范围**
- [x] 前端：消息面板标题栏右侧展示本次会话累计输入/输出 Token（来自 Gateway `sessions.list`）

---

### P0-4 网关健康状态面板 ~~（已取消）~~

> **决定不做**：现有连接状态 LED + Doctor 诊断面板已足够满足健康检查需求，不再单独开发健康状态浮层。

---

### P0-5 配置备份 / 恢复 ✅ 已完成（v0.3.2）

**目标**：用户可一键备份全部配置和记忆文件，支持换电脑恢复。

**OpenClaw 对应**：[Backup CLI](https://docs.openclaw.ai/cli/backup) — `openclaw backup`

**技术方案**
- 备份内容：整个 `~/.openclaw/` 目录（排除 `logs/`、`completions/`、`agents/*/sessions/` 等大体积目录）
- 打包为 `.zip`，通过 Tauri 文件选择器保存到用户指定位置
- 恢复时从 zip 解压还原，合并写回 `~/.openclaw/`

**工作范围**
- [x] Tauri：`backup_openclaw_config()` / `restore_openclaw_config()` / `estimate_openclaw_backup_size()` 命令
- [x] 前端：`BackupRestoreDialog.vue`（估算体积 + 导出按钮 + 导入按钮 + 操作反馈）
- [x] 顶栏「···」菜单新增「备份与恢复」入口（仅桌面端）

---

### P0-6 Doctor 图形化（OpenClaw 健康诊断）✅ 已完成（v0.3.2）

**目标**：将 `openclaw doctor` 的诊断结果图形化展示，让普通用户无需看命令行也能知道哪里有问题。

**OpenClaw 对应**：[Doctor](https://docs.openclaw.ai/gateway/doctor)

**可行性分析**
- `openclaw doctor --non-interactive` 输出结构化的纯文本诊断结果，可以通过现有的脚本运行机制捕获
- 不需要解析所有输出，只需解析关键状态行（`✓` / `⚠` / `✗` 前缀）

**技术方案**
- 复用现有 `run_ensure_openclaw_windows_install` 的流式输出机制
- 新增 Tauri 命令 `run_openclaw_doctor()` → 执行 `openclaw doctor --non-interactive`，流式返回输出
- 前端解析输出中的状态行，转为结构化的检查项列表：

```
✓  Config normalization: OK
⚠  Gateway service: running but on old port
✗  Model auth: Anthropic token expired
```

**UI 设计**
- 触发入口：设置 → 网关 Tab 底部 "运行诊断" 按钮
- 运行时显示进度（流式滚动输出）
- 完成后显示分类结果卡片：
  - 绿色：通过项
  - 黄色：警告项（附说明文字）
  - 红色：错误项（附修复建议 + 一键修复按钮，如"重启网关"）
- 支持 `--repair` 模式（点击"自动修复"按钮）

**工作范围**
- [x] Tauri：`run_openclaw_doctor(repair: bool)` 命令
- [x] 前端：`DoctorPanel.vue` 组件（输出解析 + 状态卡片）
- [x] 设置页集成入口（「连助手」Tab 底部可折叠「网关诊断」面板）

---

## P1 — 0.x 阶段内完成

### P1-1 常驻指令（Standing Orders）

**目标**：用户在界面内定义 AI 的持久任务授权，无需每次重新描述。

**OpenClaw 对应**：[Standing Orders](https://docs.openclaw.ai/automation/standing-orders)

**技术方案**
- 本质是编辑 `AGENTS.md` 中的特定 section
- 在记忆管理 UI（P0-2）基础上，AGENTS.md 编辑器增加"常驻指令模板"按钮
- 提供 3 个预置模板：日报助手 / 文件整理 / 自定义

**工作范围**
- [ ] 在 MemoryManagerDialog 中增加常驻指令编辑器
- [ ] 内置模板库（3 个初始模板）
- [ ] 与定时任务联动提示（"记得配合定时任务使用"）

---

### P1-2 Exec 审批 UI ✅ 已完成

**目标**：AI 要执行终端命令或写文件时，用户可以在界面内审批 / 拒绝。

**OpenClaw 对应**：[Exec Approvals](https://docs.openclaw.ai/tools/exec-approvals)

**技术方案**
- 网关发出 `exec.approval.requested` WS 事件时，前端弹出审批对话框
- 显示：命令内容、工作目录、所属 Agent
- 用户点击"仅此次允许" / "总是允许" / "拒绝"，通过 `exec.approval.resolve` RPC 回应
- 多请求排队展示

**工作范围**
- [x] 研究 OpenClaw approvals WS 事件格式（`exec.approval.requested`，payload 含 `id`/`systemRunPlan`/`agentId`）
- [x] `stores/approval.ts`：Pinia 审批队列 store
- [x] `ExecApprovalDialog.vue`：展示命令、允许/拒绝
- [x] `stores/gateway.ts`：监听 `exec.approval.requested` 事件
- [x] 通过真实 gateway 响应确认 `exec.approval.resolve` 参数字段为 `id`（非 `approvalId`）

---

### P1-3 Channel 接入引导 ✅ 已完成

**目标**：用户通过图形向导接入主流消息渠道，手机消息 ↔ DidClaw AI。

**支持渠道（本期）**
| 渠道 | 接入方式 | 插件 |
|------|----------|------|
| WhatsApp | 流式命令向导（已有 session 自动复用，提示重启 Gateway） | `@openclaw/whatsapp`（本机） |
| 微信（个人） | 官方 ClawBot 插件；按需检测/安装 → `openclaw channels login --channel openclaw-weixin` 扫码 → 自动重启 Gateway | `@tencent-weixin/openclaw-weixin`（腾讯官方） |
| 飞书 (Feishu) | 官方插件流式安装 `npx -y @larksuite/openclaw-lark install`；备用手动凭据 | `@larksuite/openclaw-lark` |
| Discord | Bot Token 表单 | 内置 |
| 企业微信 (WeCom) | Bot ID + Secret 表单 + 一键安装插件 | `@wecom/wecom-openclaw-plugin` |

**个人微信（ClawBot）已知能力边界**
- ✅ 与已有联系人 1:1 私聊（DM）
- ❌ 不支持群聊（接收/发送均不可）
- ❌ 不支持通过 DidClaw 添加好友
- ⚠️ 每条微信消息在 OpenClaw 里创建一个独立子会话（`openclaw-weixin:direct:<id>`），与 `main` 会话并列，切回 `main` 后子会话进入「后台子代理运行中」状态；下条消息到来或手动点击会话条目可切回
- ⚠️ 仅支持 iPhone 微信 8.0.70+，需在微信→设置→功能→插件中手动开启 ClawBot；Android 官方尚未支持



**入口位置**：Header 独立按钮「渠道」（与「定时任务」「技能」并列）

**工作范围**
- [x] Tauri：`write_channel_config(channel, payload)` 命令
- [x] Tauri：`start_channel_qr_flow(channel, gateway_url)` 流式命令（支持 whatsapp / feishu）
- [x] Tauri：`resolve_npx_executable()` Windows npx 路径解析
- [x] `ChannelSetupDialog.vue`：4 渠道向导 UI（WhatsApp 流式终端、飞书官方插件向导、Discord/WeCom 表单）
- [x] AppHeader：新增「渠道」Header 按钮入口

**已知修复**
- WhatsApp `channels login` 为交互式 CLI：自动向 stdin 发 3 次回车（间隔 1.5s）接受默认选项
- 已有本地 session 时命令以 0 退出（不显示 QR），前端提示「已有绑定会话」并提供「重启 Gateway」按钮
- `@wecom/wecom-openclaw-plugin` 等含 `@` 的 i18n 字符串会被 vue-i18n 误解析为链接消息语法，已移出 i18n 改为组件内常量
- Gateway 重启后 WhatsApp 插件进入 `stopped (reconnectAttempts=0)` 状态不自动重连：已在「已有绑定会话」状态下新增「重新连接」按钮，点击重新调用 `web.login.start` 唤醒插件，无需重新扫码
- 握手时序错误（"invalid handshake: first request must be connect"）：原先用 `client.connected`（仅检查 WebSocket OPEN）判断 Gateway 就绪，Gateway 重启插件安装后立即发 RPC 会报此错；改为检查 `gwStore.status === "connected"`（仅在 `onHello` 回调后设置），并在握手完成后额外等待 800ms
- 同号码自测（Gateway 号码与发消息号码相同）会触发 AI 回复消息被 Baileys 循环接收的无限回环；需在 `openclaw.json` 设置 `channels.whatsapp.selfChatMode: true`。使用专用号码（推荐）则无此问题

---

### P1-4 Slash 命令提示面板 ✅ 已完成

**目标**：用户输入 `/` 时弹出可用命令列表，降低使用门槛。

**OpenClaw 对应**：[Slash Commands](https://docs.openclaw.ai/tools/slash-commands)

**常用命令清单**（预置）
```
/new       新建会话
/status    查看用量状态
/usage     详细用量
/remember  让 AI 记住某事
/forget    清除记忆
/model     切换模型
```

**技术方案**
- MessageComposer 监听 `/` 触发，弹出命令选择浮层
- 选中后自动填充到输入框

**工作范围**
- [ ] `SlashCommandPicker.vue` 浮层组件
- [ ] MessageComposer 集成触发逻辑
- [ ] 命令定义文件（可扩展）

---

### P1-5 模型故障切换配置 ✅ 已完成

**目标**：主力模型不可用时自动切换备用，用户在 UI 里配置优先级。

**OpenClaw 对应**：[Model Failover](https://docs.openclaw.ai/concepts/model-failover)

**技术方案**
- 在 AI 配置（AiProviderSetup）中增加"备用模型"设置
- 写入 `agents.defaults.model.fallbacks` 配置项

**工作范围**
- [x] AiProviderSetup 增加备用模型选择器（从已配置服务商模型列表选择或手动输入）
- [x] `writeOpenClawModelConfig` 原生支持 fallbacks 字段（Rust 侧无需改动）

---

## 优先级执行顺序建议

```
✅ P0-1 i18n  →  ✅ P0-6 Doctor  →  ✅ P0-3 Token 用量  →  ✅ P0-5 备份恢复
     ↓
✅ P1-4 Slash 命令  →  ✅ P1-2 Exec 审批  →  ✅ P1-5 故障切换  →  ✅ P1-3 渠道接入
     ↓
P1-1 常驻指令
```

---

## 完成情况汇总（截至 v0.5.0）

| 功能 | 状态 | 说明 |
|------|------|------|
| P0-1 国际化（i18n） | ✅ 完成 | 中/英切换，顶栏语言按钮 |
| P0-2 记忆管理 UI | 🚫 取消 | 用文件管理器 / CLI 直接编辑即可 |
| P0-3 Token 用量显示 | ✅ 完成 | 消息面板标题栏显示本次会话输入/输出 Token |
| P0-4 网关健康面板 | 🚫 取消 | 连接 LED + Doctor 面板已够用 |
| P0-5 配置备份/恢复 | ✅ 完成 | 一键 zip 备份 `~/.openclaw/`，顶栏菜单可访问 |
| P0-6 Doctor 图形化 | ✅ 完成 | 网关诊断面板，支持自动修复 |
| P1-2 Exec 审批 UI | ✅ 完成 | `exec.approval.requested` 弹窗，支持允许/总是允许/拒绝 |
| P1-3 消息渠道接入 | ✅ 完成 | WhatsApp / 飞书 / Discord / 企业微信向导，顶栏「渠道」按钮 |
| P1-4 Slash 命令提示 | ✅ 完成 | `/` 触发浮层，红/黄/绿风险色标注 |
| P1-5 模型故障切换 | ✅ 完成 | AI 配置页备用模型管理，写入 `fallbacks` 配置 |
| P1-1 常驻指令 | 🔲 待做 | Standing Orders 图形化编辑 |

---

## 版本号规划参考

| 里程碑 | 版本 | 主要内容 |
|--------|------|---------|
| 上一版 | 0.3.x | AI 配置、i18n、Doctor、备份恢复、Token 用量 — P0 全部完成 |
| 上一版 | 0.4.0 | Slash 命令、Exec 审批、模型故障切换 — P1 部分完成 |
| 当前 | 0.5.0 | 消息渠道接入（WhatsApp/飞书/Discord/企业微信）— **P1 主体完成** |
| P1 完整 | 0.6.0 | 常驻指令（P1-1） |
| 发布候选 | 0.9.0 | 功能冻结、Bug 修复、文档完善 |
| Product Hunt 发布 | 1.0.0 | 正式发布 |
