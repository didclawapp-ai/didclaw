# DidClaw 会话上下文记忆文件

> 供新对话窗口读取，快速恢复项目状态。读取本文件后即可继续开发，无需重新熟悉项目。

---

## 项目基本信息

- **产品名**：DidClaw（对外品牌名，不叫 LCLAW UI）
- **仓库根**：`f:\LCLAW`
- **客户端代码**：`f:\LCLAW\didclaw-ui\`（Tauri 2 + Vue 3 + TypeScript + Pinia）
- **OpenClaw 底层**：`f:\LCLAW\openclaw-src\`（只读，不修改）
- **当前版本**：`0.3.2`
- **技术栈**：Tauri 2（Rust）、Vue 3、Pinia、TypeScript、Vite、pnpm

---

## 项目定位

面向**非技术普通用户**的本地 AI 工作助手桌面客户端。核心价值：
- 本地运行、数据不上云
- 不依赖特定 AI 品牌（模型无关）
- 傻瓜式操作，对标已有市场同类但更易用
- 计划在 **Product Hunt** 发布，需支持中英双语

OpenClaw 是底层 AI 网关（self-hosted），DidClaw 是其图形客户端。

---

## 已完成的主要功能（截止本次会话）

- ✅ 聊天对话、会话管理、流式输出
- ✅ 定时任务（Cron Jobs）— 傻瓜式 UI，卡片式任务列表
- ✅ 技能管理（ClawHub + 本地安装）
- ✅ AI 配置 — 卡片式，输入 API Key 一键应用，11 家服务商预置
- ✅ 文件预览（PDF / 图片 / Markdown / 代码）
- ✅ 夜间模式（CSS 变量 + Tauri setTheme）
- ✅ 安装向导（含 Node.js fallback 安装）
- ✅ OpenClaw 升级 + 网关重启流程
- ✅ 聊天消息标签显示 IDENTITY.md/USER.md 中设定的 AI 和用户名称
- ✅ 预览面板关闭按钮
- ✅ 计时器 Bug 修复（sessions.changed 不再中断活跃 run）
- ✅ 工具/事件调试面板隐藏

---

## 关键文件位置

| 文件 | 说明 |
|------|------|
| `didclaw-ui/src/app/AppShell.vue` | 主布局（左侧会话列表、中间聊天、右侧预览）|
| `didclaw-ui/src/app/AppHeader.vue` | 顶部菜单栏 |
| `didclaw-ui/src/stores/chat.ts` | 聊天 Pinia store（消息、历史、定时同步）|
| `didclaw-ui/src/stores/gateway.ts` | WebSocket 连接和事件处理 |
| `didclaw-ui/src/stores/localSettings.ts` | 本地设置 store，控制各弹窗 |
| `didclaw-ui/src/lib/desktop-api.ts` | Tauri IPC 调用封装 |
| `didclaw-ui/src/vite-env.d.ts` | IPC 命令类型声明 |
| `didclaw-ui/src/lib/provider-catalog.ts` | AI 服务商预置数据（11 家）|
| `didclaw-ui/src/features/settings/GatewayLocalDialog.vue` | 设置对话框主体 |
| `didclaw-ui/src/features/settings/AiProviderSetup.vue` | AI 配置卡片 UI |
| `didclaw-ui/src/features/cron/CronJobsDialog.vue` | 定时任务 UI |
| `didclaw-ui/src/features/preview/PreviewPane.vue` | 文件预览组件 |
| `didclaw-ui/src-tauri/src/commands.rs` | Tauri 命令注册 |
| `didclaw-ui/src-tauri/src/lib.rs` | 模块注册 + 命令 handler 注册 |
| `didclaw-ui/src-tauri/src/openclaw_common.rs` | 公共路径工具（`openclaw_dir()` 等）|
| `didclaw-ui/src-tauri/src/workspace_identity.rs` | 读取 IDENTITY.md/USER.md |
| `scripts/ensure-openclaw-windows.ps1` | Windows 安装脚本（已全英文）|
| `docs/didclaw-roadmap-0x.md` | **下一步功能路线图**（必读）|
| `CHANGELOG.md` | 每次提交必须更新 |

---

## 重要开发规范

1. **每次 git commit 必须同步更新 `CHANGELOG.md`**（根目录），记录在 `## [未发布]` 下
2. **最小改动原则**：只改当前任务需要的文件
3. **先 typecheck 再提交**：`cd didclaw-ui && pnpm run typecheck`
4. **命名规范**：npm 包名 `didclaw`，环境变量前缀 `DIDCLAW_*`
5. **版本号三处同步**：`package.json` + `tauri.conf.json` + `Cargo.toml`
6. **Shell 环境**：Windows PowerShell，不用 `tail`/`head`，用 `Select-Object -Last N`

---

## 当前待做（按优先级）

详见 `docs/didclaw-roadmap-0x.md`，摘要如下：

### P0（Product Hunt 发布前必须）
1. **i18n 国际化**（中/英）— 建议先做，框架搭好后其他功能受益
2. **记忆管理 UI** — 编辑 IDENTITY/USER/SOUL/AGENTS.md
3. **API 用量/费用显示** — Token 统计
4. **网关健康状态面板** — 连接指示 + 详情浮层
5. **配置备份/恢复**
6. **Doctor 图形化** — `openclaw doctor --non-interactive` 输出图形化

### P1（0.x 阶段内）
7. 常驻指令（Standing Orders）UI
8. Exec 审批弹窗
9. Telegram Channel 接入向导
10. Slash 命令提示面板（`/` 触发）
11. 模型故障切换配置

---

## 下一个任务建议：从 i18n 开始

**原因**：框架搭好后，后续所有功能的新文字直接写语言文件，避免后期批量补提取。

**技术方案**：
- 安装 `vue-i18n v9`（`pnpm add vue-i18n`）
- 语言文件：`didclaw-ui/src/i18n/zh.ts` + `didclaw-ui/src/i18n/en.ts`
- `localSettings` store 增加 `locale: 'zh' | 'en'` 字段
- 设置界面加语言切换

OR 先做 **Doctor 图形化**（工作量小，只需 2-3 个新文件，效果直观）：
- 新增 Tauri 命令 `run_openclaw_doctor(repair: bool)`
- 新增 `DoctorPanel.vue`，流式解析 `openclaw doctor --non-interactive` 输出
- 解析 `✓` / `⚠` / `✗` 前缀，渲染状态卡片

---

## OpenClaw 路径约定

```
~/.openclaw/
  openclaw.json          # 主配置
  workspace/
    IDENTITY.md          # AI 身份（名字、角色）← DidClaw 已读取显示名称
    USER.md              # 用户信息（姓名等）← DidClaw 已读取显示名称
    SOUL.md              # AI 个性
    AGENTS.md            # Agent 指令 / 常驻指令
    HEARTBEAT.md         # 心跳指令
    MEMORY.md            # 长期记忆
    memory/YYYY-MM-DD.md # 日记忆
  agents/main/sessions/  # 聊天历史 JSONL
  cron/jobs.json         # 定时任务
```

---

## 近期修复的主要 Bug（供参考，避免重复）

1. `sessions.changed` WS 事件在活跃 run 期间不再调用 `loadHistory`（chat.ts）
2. AI 配置保存时所有模型正确写入模型列表（不再只写默认一个）
3. AI 接口地址改为可编辑输入框
4. 定时任务消息不再消失（移除 cron 事件触发 loadHistory）
5. 新建会话显示"新对话"而不是 UUID
6. OpenClaw 升级按钮实际执行升级 + 升级后自动重启网关
7. Rust 参数 `upgrade: bool` → `upgrade: Option<bool>` 修复编译错误

---

*本文件由上一个对话窗口生成，最后更新于 2026-03-25*
