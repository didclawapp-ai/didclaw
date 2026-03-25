# DidClaw

> 面向普通用户的本地 AI 桌面助手，基于 [OpenClaw](https://openclaw.ai) Gateway 驱动。
> 数据存本地、模型自选、无需云账号。

---

## 产品定位

DidClaw 是 OpenClaw Gateway 的桌面客户端，目标用户是**非技术背景的普通用户**：

- 一键安装，自动完成 OpenClaw 环境配置
- 支持国内外主流 AI 模型（通过 OpenClaw 统一接入）
- 对话、定时任务、技能管理，操作直观
- 所有数据与配置保存在本机，不经过任何云服务

## 技术架构

| 层 | 技术 |
|----|------|
| 桌面壳 | [Tauri 2](https://tauri.app)（Rust + WebView2） |
| 前端 | Vue 3 · Pinia · Vue Router · TypeScript · Vite |
| 通信 | WebSocket（OpenClaw Gateway RPC 协议） |
| 渲染 | markdown-it · highlight.js · DOMPurify · ECharts |
| 类型安全 | Zod（Gateway 响应校验） |
| 后端逻辑 | Rust（配置读写、网关子进程管理、技能安装、版本检测） |

```
lclaw-ui/
├── src/                  # Vue 前端
│   ├── app/              # 顶层布局（AppShell、AppHeader）
│   ├── features/         # 功能模块（chat / cron / skills / settings / ...）
│   ├── stores/           # Pinia（gateway / chat / session / theme / ...）
│   └── lib/              # 工具库（gateway 客户端、格式化、类型定义）
├── src-tauri/            # Rust 桌面后端
│   └── src/              # 命令、配置读写、网关进程、版本检测等
└── scripts/              # Windows PowerShell 安装脚本
```

## 快速开始

### 前置条件

- [Node.js](https://nodejs.org) 18+
- [pnpm](https://pnpm.io) 8+
- [Rust](https://rustup.rs)（编译 Tauri）
- Windows 10/11（当前发布目标；macOS/Linux 可编译运行）

### 开发

```bash
cd lclaw-ui
pnpm install

# 桌面端（Tauri，推荐）
pnpm dev:tauri

# 纯浏览器联调（需自行启动 OpenClaw Gateway）
pnpm dev:web
```

### 打包

```bash
cd lclaw-ui
pnpm dist:win
# 产物在 src-tauri/target/release/bundle/
```

### 运行时依赖

应用启动时会自动检测并安装 [OpenClaw](https://openclaw.ai)（需 Node.js 环境）。  
也可手动安装：`npm install -g openclaw@latest`

---

## 主要功能

- **对话**：多会话管理、流式输出、附件、消息预览
- **定时任务**：可视化创建定时 AI 任务，结果自动投递到对话
- **技能管理**：从 ClawHub 搜索安装技能，或本地导入
- **模型切换**：支持 OpenAI / Ollama / MiniMax / Moonshot 等接入 OpenClaw 的所有模型
- **夜间模式**：深色主题，跟随系统或手动切换
- **自动更新检测**：发现新版 OpenClaw 时一键升级并重启网关

---

## 关于本项目

**项目代码与文档完全由 [Claude Sonnet](https://www.anthropic.com/claude) 编写，产品方向由人类维护者决策。**

我们鼓励贡献者同样借助 AI 工具参与——写代码、提 Issue、改文档都欢迎。  
重要的是你的判断，而不是你打字的速度。

贡献前请阅读 `.cursor/rules/` 中的项目规范。

## 许可证

待定。
