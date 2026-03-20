# lclaw-ui 开发步骤

> 依据 [`OpenClaw-顶层界面-开发方案.md`](./OpenClaw-顶层界面-开发方案.md) 整理的**执行顺序**；勾选 `[ ]` 跟踪进度。  
> 协议细节随时记入 [`gateway-client-protocol-notes.md`](./gateway-client-protocol-notes.md)。

---

## 0. 前期准备

- [ ] **Node**：安装 **Node 22 LTS**（或与团队统一的 22+），与方案 §5.4 一致。
- [ ] **pnpm**：`corepack enable` 后使用 `pnpm`（与 `openclaw-src` 一致）。
- [ ] **OpenClaw Gateway**：能在本机或指定主机启动（示例端口 `18789`），并确认 `gateway.auth`、token 或密码可用。
- [ ] **阅读**：方案 §3（契约）、§4.1（会话切换与 abort）、§3.4（跨端口联调）。

---

## 1. 工程脚手架与目录

在 `LCLAW/lclaw-ui/` 下初始化（若目录已有内容则跳过重复步骤）。

- [x] 使用 Vite 创建 **Vue + TypeScript** 工程（参见 `lclaw-ui/README.md` 中的 `create vite` 命令）。
- [x] 安装 **Pinia**、**Vue Router**（路由可先只配默认页）。
- [x] 建立方案 §1.4 建议的目录：`src/app/`、`src/features/chat`、`preview`、`gateway`、`src/components`、`src/lib`。
- [x] 配置 **路径别名**（如 `@/`），统一 import 风格。
- [x] 添加 **ESLint**（含 `eslint-plugin-vue`）+ **Prettier**，或 **Biome**（二选一）。
- [x] 配置 `.env.development` / `.env.example`：`VITE_GATEWAY_URL`、`VITE_GATEWAY_TOKEN`（**勿将真实 token 提交 Git**）。
- [x] 在 `gateway-client-protocol-notes.md` 填写当前锁定的 **OpenClaw / Gateway 版本**（持续随升级更新）。

---

## 2. 应用壳与全局布局

- [x] 在 `src/app` 实现**左右分栏**布局：左侧预留聊天区、右侧预留预览区；右栏宽度可后续加分栏拖拽（方案 §4.2）。
- [x] 挂载 **Pinia**，规划 store 划分（建议至少：`useGatewayStore`、`useSessionStore` 或等价模块）。
- [ ] （可选）设置页路由：连接参数、主题、语言占位，对应阶段 E 的 i18n 扩展点。

---

## 3. 阶段 A — Gateway 与最小聊天闭环

对应方案 **§7 阶段 A**。

### 3.1 WebSocket 与 RPC 封装（`features/gateway`）

- [x] 实现 WS **连接**：URL 取自 `VITE_GATEWAY_URL`，握手携带 **token/password**（方案 §3.2）。
- [x] 实现 **重连**（指数退避或固定间隔）、**关闭码**分类；对 **配对失败** 展示明确文案并引导 `openclaw devices approve`。
- [x] 封装 **请求/响应**：与 Gateway 的 JSON-RPC 风格对齐；为每个方法预留 **超时与错误** 分支。
- [x] （建议）尽早引入 **Zod**（或 TypeBox），对**首条下行消息**或核心响应做校验骨架，便于阶段 E 扩全（方案 §3.5）。

### 3.2 会话与历史（只读）

- [x] 调用 **`sessions.list`**，左栏展示会话列表；选中项写入全局状态 `activeSessionId`。
- [x] 调用 **`chat.history`**，展示**只读**消息列表（注意官方截断/省略，产品可提示「摘要」）。
- [x] 切换会话时遵守方案 **§4.1**：切换前对在途生成 **`chat.abort`**，右栏清空或切换上下文（首版右栏可为空占位）。

### 3.3 发送与基础展示

- [x] 输入框 + **`chat.send`**；展示返回/流式中的助手内容（先做**非流式或最小流式**即可）。
- [x] 连接状态展示：已连接 / 重连中 / 错误（方案 §4.1）。

**阶段 A 完成标准**：跨端口（如 5173 → 18789）可连上 Gateway，能选会话、看历史、发一条消息并看到回复。

---

## 4. 阶段 B — 左栏完整闭环

对应方案 **§7 阶段 B**。

- [x] **`chat.abort`**：发送中/生成中可中断；中断后 UI 状态与官方行为一致（如保留部分输出，参见 [WebChat](https://docs.openclaw.ai/web/webchat)）。
- [x] **发送中禁用/排队**：避免同会话状态机混乱（方案 §4.1）。
- [x] **历史刷新策略**：发送成功后刷新或增量合并；大会话考虑分页或「加载更多」（与 `chat.history` 能力对齐）。
- [x] **下行事件**：非 `chat` 事件在 **DEV** 下 `console.debug`；工具/Agent 气泡 UI 仍待绑定。
- [x] **长列表**：已接入 **`@tanstack/vue-virtual`**（`ChatMessageList.vue`）。
- [x] 更新 **`gateway-client-protocol-notes.md`**：已记 `chat` / `connect.challenge` 等（余事件待补）。

**阶段 B 完成标准**：左栏交互完整，会话切换无串台，abort 与连发策略符合 §4.1。

---

## 5. 阶段 C — 右栏 MVP

对应方案 **§7 阶段 C**。

- [x] 在 `features/preview` 实现 **Markdown 渲染**（**markdown-it** + **DOMPurify**，`lib/markdown-render.ts`）。
- [x] **表格、代码块**：表格已随 Markdown；**代码高亮**（**highlight.js** + `github` 主题，`markdown-render.ts` / `PreviewPane.vue`）。
- [x] **与左栏联动**：点击消息 + **「跟随最新」**（`stores/preview.ts`）。
- [x] 右栏**独立滚动**（`PreviewPane` + 布局 `overflow`）；左栏列表自有滚动容器。

**阶段 C 完成标准**：右栏稳定渲染 Markdown/表格/代码，无裸 XSS 测试用例失败。

---

## 6. 阶段 D — 右栏增强

对应方案 **§7 阶段 D**。

- [ ] **ECharts**：约定 fenced 块或工具 JSON schema；**parse 前 Zod 校验**，失败时右栏友好错误占位（方案 §4.2、§10）。
- [ ] **ECharts 按需引入**（`echarts/core`），避免整包过大。
- [ ] **工具调用时间线**：用阶段 B 已订阅的事件驱动 UI；敏感字段脱敏。
- [ ] **下载链接**：`src/lib` 实现 **URL 白名单**；统一「在新标签打开 / 下载」入口；**首期不做 Office 内嵌预览**（方案 §4.2）。
- [ ] 高频工具输出：**节流/合并** 更新，避免卡顿（方案 §6.1）。

**阶段 D 完成标准**：图表、工具线、安全下载流程可用；右栏性能在长对话下可接受。

---

## 7. 阶段 E — 硬化与发布

对应方案 **§7 阶段 E**。

- [ ] **Zod/TypeBox** 覆盖核心 RPC 响应与关键下行事件；异常路径有用户可见说明（方案 §3.5）。
- [ ] **同步 `gateway-client-protocol-notes.md`**：方法表、事件表、版本、与官方差异。
- [ ] **可观测性**：脱敏错误上报、连接诊断（复制诊断信息）、常见错误码中文对照（方案 §6.1）。
- [ ] **回归**：锁定一组 OpenClaw 版本，升级小版本后跑冒烟（方案 §8）。
- [ ] **构建**：`pnpm build`，在 **Nginx/Caddy/IIS** 验证 SPA **History fallback**（方案 §5.2）。
- [ ] **文档**：内网部署步骤、环境变量说明、Gateway 前置条件。
- [ ] （按需）**BFF / SSO / 审计**（方案 §2、§6）。
- [ ] （按需）**无障碍**、**i18n** 文案外置（方案 §7 阶段 E）。

**阶段 E 完成标准**：可交付内网 SPA（及可选安装包）；协议与版本可追溯。

---

## 8. （可选）桌面安装包

方案 §5.2、§1.4：在 Web 稳定后再做。

- [ ] 选定 **Electron + Vite** 或 **Tauri 2 + Vite**。
- [ ] 加载同一套 `dist` 或 dev URL；处理 **Token 安全存储**（方案 §6、§10）。
- [ ] Windows **代码签名**与更新策略按法务/运维要求排期。

---

## 附录：每日联调自检

| 检查项 | 说明 |
|--------|------|
| Gateway 进程 | 端口与 `VITE_GATEWAY_URL` 一致 |
| 浏览器控制台 | 无混合内容（https 页连 ws） |
| 新浏览器配置 | 是否需 `devices approve` |
| 会话切换 | 切换后右栏与消息是否属于同一会话 |

---

## 相关文档

| 文档 | 用途 |
|------|------|
| [OpenClaw-顶层界面-开发方案.md](./OpenClaw-顶层界面-开发方案.md) | 架构、契约、安全、复审约定 |
| [gateway-client-protocol-notes.md](./gateway-client-protocol-notes.md) | 版本化协议笔记 |
| [../lclaw-ui/README.md](../lclaw-ui/README.md) | 技术栈摘要与初始化命令 |

---

*文档结束。*
