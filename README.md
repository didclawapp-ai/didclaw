# DidClaw

**面向普通用户的 OpenClaw AI 桌面助手**

[功能特性](#功能特性) · [为什么选择 DidClaw](#为什么选择-didclaw) · [快速开始](#快速开始) · [架构](#架构) · [开发](#开发) · [许可证](#许可证)

[![平台](https://img.shields.io/badge/平台-Windows-blue)](https://github.com/LCLAW/didclaw)
[![许可证](https://img.shields.io/badge/许可证-AGPL--3.0-green)](LICENSE)
[![技术栈](https://img.shields.io/badge/Tauri-2.x-orange)](https://tauri.app)

---

## 概述

**DidClaw** 让每一位普通用户都能轻松驾驭 AI 智能体。基于 [OpenClaw](https://openclaw.ai) Gateway 构建，将命令行式的 AI 编排能力转化为直观的桌面体验——无需打开终端，无需编辑配置文件。

无论是通过微信指挥 AI 完成任务、自动预览多种格式文件、还是设置定时 AI 调度任务，DidClaw 都为你提供所需的界面与工具。所有数据与配置保存在本机，不经过任何云服务。

---

## 为什么选择 DidClaw

强大的 AI 能力不应该只属于技术用户。DidClaw 的设计理念很简单：**先进的技术应该配得上尊重用户时间的界面。**

| 痛点 | DidClaw 解决方案 |
|------|-----------------|
| 复杂的 CLI 配置 | 引导式安装向导，一键完成环境搭建 |
| 难以理解的配置文件 | 可视化设置面板，实时校验 |
| 网关进程管理麻烦 | 自动管理 OpenClaw 子进程生命周期 |
| 多 AI 服务商切换 | 统一的服务商配置与一键切换 |
| 技能/插件安装困难 | 内置 ClawHub 技能市场 |
| 文件格式各异难以查阅 | 内置多格式文件预览（PDF / 图片 / Markdown / 代码 / Office） |

---

## 功能特性

### 零门槛上手

通过直观的图形界面完成从安装到首次 AI 对话的全部流程，无需任何终端命令或 YAML 文件。首次启动自动弹出安装向导，逐步引导完成环境配置。

### 多渠道指挥 AI

支持通过微信、企业微信、WhatsApp、Telegram、飞书、Discord、Slack、Microsoft Teams、LINE、Google Chat 等渠道向 AI 发送指令。每个渠道独立运行，可针对不同任务配置专属 AI 智能体。

### 多文件格式预览

内置文件预览面板，直接在应用内查看 AI 产出的各类文件：

- **图片**：PNG / JPEG / GIF / WebP / SVG
- **文档**：PDF（内嵌渲染）
- **富文本**：Markdown（实时渲染）
- **代码**：语法高亮，支持 60+ 编程语言
- **Office**：DOCX / XLSX / PPTX（LibreOffice 本地预览 / Office Online 在线预览）
- **纯文本**：TXT / LOG / CSV

### 执行审批（人工确认）

AI 执行 Shell 命令前弹出确认对话框，用户可逐条审核并选择批准或拒绝，在安全与效率间灵活平衡。

### 定时任务调度

可视化创建基于 Cron 的定时 AI 任务，设定触发时间与执行内容，让 AI 全天候在后台工作，结果自动投递到指定对话。

### 技能生态（ClawHub）

通过内置技能市场浏览、安装和管理 AI 技能扩展包，无需包管理工具。也支持从本地路径导入自定义技能。

### 多会话并发

同时管理多个独立 AI 会话，每个会话维护独立的上下文与历史记录，支持流式输出、附件发送与富文本渲染。

### 自适应主题

深色、浅色或跟随系统自动切换，保护用户视力，提升使用舒适度。

---

## 快速开始

### 系统要求

- **操作系统**：Windows 10/11（当前主要发布目标；macOS / Linux 可从源码编译）
- **内存**：4 GB RAM 起（8 GB 推荐）
- **存储**：1 GB 可用磁盘空间

### 安装预构建版本（推荐）

从 [Releases](../../releases) 页面下载对应平台的最新安装包。

### 从源码构建

```bash
# 前置条件：Node.js 18+、pnpm 8+、Rust（rustup）

git clone https://github.com/your-org/LCLAW.git
cd LCLAW/didclaw-ui
pnpm install

# 桌面端开发模式（Tauri）
pnpm dev:tauri

# 打包 Windows 安装包
pnpm dist:win
# 产物位于 src-tauri/target/release/bundle/
```

### 运行时依赖

应用首次启动时会自动检测并安装 [OpenClaw](https://openclaw.ai)（需 Node.js 环境）。  
也可手动安装：`npm install -g openclaw@latest`

---

## 架构

DidClaw 采用 **Tauri 双进程架构**，前端通过 WebSocket 与 OpenClaw Gateway 通信：

```
┌─────────────────────────────────────────────────────┐
│                  DidClaw 桌面应用                    │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │           Tauri / Rust 后端进程              │   │
│  │  • 窗口与应用生命周期管理                    │   │
│  │  • OpenClaw 子进程监管                       │   │
│  │  • 配置读写、技能安装、版本检测               │   │
│  │  • 系统集成（托盘、文件预览、本地服务）       │   │
│  └─────────────────────────────────────────────┘   │
│                        │                           │
│                        │ IPC（Tauri Commands）      │
│                        ▼                           │
│  ┌─────────────────────────────────────────────┐   │
│  │           Vue 3 前端渲染进程                 │   │
│  │  • 基于组件的现代 UI（Vue 3 + TypeScript）   │   │
│  │  • Pinia 状态管理                            │   │
│  │  • Markdown / 代码 / 图表 / 文件预览渲染     │   │
│  └─────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────┘
                           │
                           │ WebSocket（RPC 协议）
                           ▼
┌─────────────────────────────────────────────────────┐
│                  OpenClaw Gateway                   │
│  • AI 智能体运行时与任务编排                         │
│  • 多渠道消息管理                                    │
│  • 技能 / 插件执行环境                               │
│  • AI 服务商抽象层                                   │
└─────────────────────────────────────────────────────┘
```

---

## 开发

### 技术栈

| 层 | 技术 |
|----|------|
| 桌面壳 | [Tauri 2](https://tauri.app)（Rust + WebView2） |
| 前端框架 | Vue 3 · TypeScript · Vite |
| 状态管理 | Pinia |
| 渲染增强 | markdown-it · highlight.js · DOMPurify · ECharts |
| 类型安全 | Zod（Gateway 响应校验） |
| 单元测试 | Vitest |

### 目录结构

```
didclaw-ui/
├── src/
│   ├── app/          # 顶层布局（AppShell、AppHeader）
│   ├── features/     # 功能模块（chat / cron / skills / settings / ...）
│   ├── stores/       # Pinia（gateway / chat / session / theme / ...）
│   └── lib/          # 工具库（gateway 客户端、格式化、类型定义）
├── src-tauri/        # Rust 桌面后端
│   └── src/          # 命令、配置读写、网关进程、版本检测等
├── test/             # Vitest 单元测试
└── scripts/          # Windows PowerShell 安装脚本
```

### 常用命令

```bash
cd didclaw-ui

# 开发
pnpm dev:tauri        # 桌面端（Tauri，推荐）
pnpm dev:web          # 纯浏览器联调

# 质量检查
pnpm lint             # ESLint
pnpm typecheck        # TypeScript 类型检查
pnpm test             # 单元测试（Vitest）
pnpm test:coverage    # 测试覆盖率报告

# 构建打包
pnpm dist:win         # 打包 Windows 安装包
```

---

## 关于本项目

**项目代码与文档完全由 [Claude Sonnet](https://www.anthropic.com/claude) 编写，产品方向由人类维护者决策。**

我们鼓励贡献者同样借助 AI 工具参与——写代码、提 Issue、改文档都欢迎。  
重要的是你的判断，而不是你打字的速度。

贡献前请阅读 `.cursor/rules/` 中的项目规范。

---

## 许可证

DidClaw 基于 [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE) 发布。

> 如需商务合作，请联系 [didclawapp@gmail.com](mailto:didclawapp@gmail.com)
