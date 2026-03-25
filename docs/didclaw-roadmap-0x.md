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

### P0-2 记忆管理 UI

**目标**：让用户在界面内直接编辑 AI 身份（IDENTITY.md）、个人信息（USER.md）、AI 个性（SOUL.md）、常驻指令（AGENTS.md），无需手动改文件。

**OpenClaw 对应**：[Memory](https://docs.openclaw.ai/concepts/memory) / [Agent Workspace](https://docs.openclaw.ai/concepts/agent-workspace)

**技术方案**
- Tauri 侧新增命令：读取 / 写入 workspace 下的 Markdown 文件
- 文件路径：`~/.openclaw/workspace/{IDENTITY,USER,SOUL,AGENTS,MEMORY}.md`
- 前端新建 `MemoryManagerDialog.vue`，Tab 式编辑各文件
- 编辑器用 `<textarea>`（Markdown 纯文本，不做富文本），有字符计数提示
- 保存时写入磁盘，并提示"下次对话生效"

**UI 设计要点**
- IDENTITY.md → "AI 设定"（名字、角色、性格）
- USER.md → "关于我"（姓名、时区、偏好）
- SOUL.md → "AI 风格"（高级用户，默认折叠）
- AGENTS.md → "常驻指令 / 技能说明"（高级用户，默认折叠）
- MEMORY.md → "长期记忆"（只读展示 + 清空按钮）

**工作范围**
- [ ] Rust：`read_workspace_file(name)` / `write_workspace_file(name, content)` 命令
- [ ] 前端：`MemoryManagerDialog.vue` 组件
- [ ] 菜单栏入口（AppHeader 加"记忆"按钮）

---

### P0-3 API 用量 / 费用显示

**目标**：让用户了解本次会话消耗了多少 Token 和大概费用。

**OpenClaw 对应**：[Usage Tracking](https://docs.openclaw.ai/concepts/usage-tracking) — `/status` 和 `/usage` 命令返回的数据

**技术方案**
- 通过网关 `chat.send` 发送 `/status` 或解析 OpenClaw session log
- 更可靠的方案：读取 `~/.openclaw/agents/main/sessions/` 下的 JSONL transcript，
  统计 `usage.inputTokens` / `usage.outputTokens` 字段
- 前端在 ChatRunStatusBar 或设置面板展示累计用量

**UI 设计**
- 状态栏右侧常驻小字：`本次 ↑1.2k ↓3.4k tokens`
- 设置 → 用量 Tab：按日/周聚合，展示 token 数 + 估算费用（基于各 provider 定价）

**工作范围**
- [ ] Tauri：`read_session_usage(agentId, date_range)` 命令（解析 JSONL）
- [ ] 前端：`ChatRunStatusBar` 增加 token 小计
- [ ] 前端：设置内用量汇总 Tab

---

### P0-4 网关健康状态面板

**目标**：用户能一眼看出网关运行是否正常，出问题时有明确提示和修复引导。

**OpenClaw 对应**：[Health Checks](https://docs.openclaw.ai/gateway/health) / `openclaw health` CLI

**技术方案**
- 调用现有 `getOpenClawSetupStatus` / 网关 HTTP `/health` 接口
- 补充解析：端口占用、Node 版本、服务进程状态
- 连接失败时在 AppHeader 显示警告图标 + 快速操作面板

**UI 设计**
- AppHeader 连接图标：绿色（健康）/ 黄色（警告）/ 红色（断开）
- 点击图标展开面板，显示：
  - 网关版本 / Node 版本
  - 上次启动时间
  - 当前端口是否正常监听
  - 已配置的 Channel 状态（如有）
  - 一键"重启网关" / "查看日志"按钮

**工作范围**
- [ ] Tauri：`get_gateway_health_detail()` 命令（整合多个状态源）
- [ ] 前端：`GatewayStatusPanel.vue` 浮层组件
- [ ] AppHeader 状态图标更新逻辑

---

### P0-5 配置备份 / 恢复

**目标**：用户可一键备份全部配置和记忆文件，支持换电脑恢复。

**OpenClaw 对应**：[Backup CLI](https://docs.openclaw.ai/cli/backup) — `openclaw backup`

**技术方案**
- 备份内容：`~/.openclaw/openclaw.json` + `workspace/*.md` + `cron/jobs.json`
- 打包为 `.zip`，通过 Tauri 文件选择器保存到用户指定位置
- 恢复时解包并写回（写前自动备份当前版本）

**工作范围**
- [ ] Tauri：`backup_openclaw_config()` / `restore_openclaw_config(path)` 命令
- [ ] 前端：设置 → 备份 Tab（导出按钮 + 导入按钮 + 最近备份列表）

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

### P1-2 Exec 审批 UI

**目标**：AI 要执行终端命令或写文件时，用户可以在界面内审批 / 拒绝。

**OpenClaw 对应**：[Exec Approvals](https://docs.openclaw.ai/tools/exec-approvals)

**技术方案**
- 网关发出 `approvals` 相关 WS 事件时，前端弹出审批对话框
- 显示：命令内容、工作目录、风险提示
- 用户点击"允许" / "拒绝"，通过 `chat.send` 或专用 API 回应

**工作范围**
- [ ] 研究 OpenClaw approvals WS 事件格式（`gateway-types.ts` 扩展）
- [ ] `ExecApprovalDialog.vue`：展示命令、允许/拒绝
- [ ] gateway.ts：监听 approvals 事件并触发对话框

---

### P1-3 Channel 接入引导（Telegram 优先）

**目标**：用户通过向导完成 Telegram Bot 绑定，实现手机消息 ↔ DidClaw AI。

**OpenClaw 对应**：[Telegram](https://docs.openclaw.ai/channels/telegram) — 配置最简单，只需 Bot Token

**技术方案**
- 新增 `ChannelSetupDialog.vue`，Step 1 先只做 Telegram
- 步骤：创建 Bot（链接到 BotFather）→ 粘贴 Token → 写入 `openclaw.json` →
  重启网关 → 验证（发一条测试消息）
- 其他 Channel（WhatsApp / Discord）留作后续 Step

**工作范围**
- [ ] Tauri：`write_channel_config(channel, config)` 命令
- [ ] `ChannelSetupDialog.vue`：Telegram 向导
- [ ] 菜单栏 "Channel 连接" 入口

---

### P1-4 Slash 命令提示面板

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

### P1-5 模型故障切换配置

**目标**：主力模型不可用时自动切换备用，用户在 UI 里配置优先级。

**OpenClaw 对应**：[Model Failover](https://docs.openclaw.ai/concepts/model-failover)

**技术方案**
- 在 AI 配置（AiProviderSetup）中增加"备用模型"设置
- 写入 `agents.defaults.model.fallbacks` 配置项

**工作范围**
- [ ] AiProviderSetup 增加备用模型选择器
- [ ] `writeOpenClawModelConfig` 扩展支持 fallbacks 字段

---

## 优先级执行顺序建议

```
P0-1 i18n 框架  →  P0-6 Doctor  →  P0-2 记忆管理  →  P0-4 健康面板
     ↓
P0-3 用量显示  →  P0-5 备份恢复
     ↓
P1-4 Slash 命令  →  P1-1 常驻指令  →  P1-3 Telegram  →  P1-2 Exec 审批  →  P1-5 故障切换
```

i18n 建议最先做，搭好框架后其他功能的新字符串直接写进语言文件，避免后期补提取。

---

## 版本号规划参考

| 里程碑 | 版本 | 主要内容 |
|--------|------|---------|
| 当前 | 0.3.x | AI 配置卡片化、记忆名称显示、计时修复等 |
| P0 完成 | 0.4.0 | i18n、记忆管理、Doctor、健康面板 |
| P0 全部 + P1 前半 | 0.5.0 | 用量显示、备份、常驻指令、Slash 命令 |
| P1 全部 | 0.6.0 | Telegram 接入、Exec 审批、故障切换 |
| 发布候选 | 0.9.0 | 功能冻结、Bug 修复、文档完善 |
| Product Hunt 发布 | 1.0.0 | 正式发布 |
