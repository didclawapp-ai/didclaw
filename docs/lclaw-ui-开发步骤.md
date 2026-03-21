# lclaw-ui 开发步骤

> 依据 [`OpenClaw-顶层界面-开发方案.md`](./OpenClaw-顶层界面-开发方案.md)（**方案 v1.7**）整理的**执行顺序**；勾选 `[ ]` 跟踪进度。增量排期另见 [`lclaw-ui-功能补全清单.md`](./lclaw-ui-功能补全清单.md)。  
> **当前包版本**：`lclaw-ui/package.json` → **0.2.0**（发版时与 Git tag / 方案 § 头同步更新）。  
> 协议细节随时记入 [`gateway-client-protocol-notes.md`](./gateway-client-protocol-notes.md)。  
> **桌面壳（Electron）与本机文件预览**：见 [`lclaw-ui-electron-local-preview.md`](./lclaw-ui-electron-local-preview.md)。

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
- [x] 安装 **Pinia**、**Vue Router**（`/` → `HomeView`/`AppShell`，`/about` 关于页）。
- [x] 建立方案 §1.4 建议的目录：`src/app/`、`src/features/chat`、`preview`、`gateway`、`src/components`、`src/lib`。
- [x] 配置 **路径别名**（如 `@/`），统一 import 风格。
- [x] 添加 **ESLint**（含 `eslint-plugin-vue`）+ **Prettier**，或 **Biome**（二选一）。
- [x] 配置 `.env.development` / `.env.example`：`VITE_GATEWAY_URL`、`VITE_GATEWAY_TOKEN`（**勿将真实 token 提交 Git**）。
- [x] 在 `gateway-client-protocol-notes.md` 填写当前锁定的 **OpenClaw / Gateway 版本**（持续随升级更新）。

---

## 2. 应用壳与全局布局

- [x] 在 `src/app` 实现**左右分栏**布局：左侧聊天、右侧预览；**无文件预览时右栏默认隐藏**，有预览（含加载/错误）时自动展开；右栏**分栏拖拽**仍为可选增强。
- [x] **壳层拆分**：顶栏 `AppHeader.vue`、输入区 `MessageComposer.vue`，`AppShell` 负责分栏与消息列表编排；主按钮样式为全局 `.lc-btn` / `.lc-btn-ghost`（`style.css`）。
- [x] 挂载 **Pinia**，规划 store 划分（建议至少：`useGatewayStore`、`useSessionStore` 或等价模块）。
- [x] （可选）**设置页路由**：`/settings` Web 连接参数（localStorage + 安全提示）；主题 / i18n 仍见阶段 E。

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

- [x] **附件**：输入区拖拽 / 选择文件，`chat.send.attachments` 传 **base64 图片**（与网关 `chat-attachments` 一致）；非图片写入消息说明并支持 **blob 预览**。
- [x] 输入框 + **`chat.send`**；**流式**：`extractChatDeltaText` / `mergeAssistantStreamDelta`；助手占位行；**乐观**用户消息 + `loadHistory` 与快照**条数合并**避免未落库时冲掉用户行；消息数组类型为 **`UiChatMessage`**（`src/lib/chat-messages.ts`）。
- [x] 连接状态展示：已连接 / 重连中 / 错误（方案 §4.1）。

**阶段 A 完成标准**：跨端口（如 5173 → 18789）可连上 Gateway，能选会话、看历史、发消息并**流式**看到助手回复。

---

## 4. 阶段 B — 左栏完整闭环

对应方案 **§7 阶段 B**。

- [x] **`chat.abort`**：发送中/生成中可中断；中断后 UI 状态与官方行为一致（如保留部分输出，参见 [WebChat](https://docs.openclaw.ai/web/webchat)）。
- [x] **发送中禁用/排队**：避免同会话状态机混乱（方案 §4.1）。
- [x] **历史刷新策略**：发送成功后刷新或增量合并；大会话考虑分页或「加载更多」（与 `chat.history` 能力对齐）。
- [x] **下行事件**：非 `chat` 事件在 **DEV** 下 `console.debug`；**工具时间线**已在阶段 D 接入 `PreviewPane`。
- [x] **长列表**：已接入 **`@tanstack/vue-virtual`**（`ChatMessageList.vue`）。
- [x] **列表过滤**：默认**不展示 `system` 行**（勾选「显示诊断/配置」后展示）；`chat-message-format.ts` 折叠 PowerShell/ANSI 目录表等工具噪音（与「诊断」开关独立部分规则见代码）。
- [x] 更新 **`gateway-client-protocol-notes.md`**：已记 `chat` / `connect.challenge` 等（余事件待补）。

**阶段 B 完成标准**：左栏交互完整，会话切换无串台，abort 与连发策略符合 §4.1。

---

## 5. 阶段 C — 右栏 MVP

对应方案 **§7 阶段 C**。

- [x] 在 `features/preview` 实现**选中消息**的 **Markdown 渲染**（**markdown-it** + **DOMPurify**，`lib/markdown-render.ts`）。
- [x] **表格、代码块**：表格已随 Markdown；**代码高亮**（**highlight.js** + `github` 主题，`markdown-render.ts` / `PreviewPane.vue`）。
- [x] **与左栏联动**：点击消息 + **「跟随最新」**（`stores/preview.ts`）。
- [x] 右栏**独立滚动**（`PreviewPane` + 布局 `overflow`）；左栏列表自有滚动容器。
- [x] **文件类 Markdown/纯文本**（`.md`/`.txt` 等）：`lib/render-markdown-preview.ts` + `stores/filePreview.ts` + `preview-kind.ts`（与消息内 Markdown 渲染共用安全策略思路）。

**阶段 C 完成标准**：右栏稳定渲染 Markdown/表格/代码；**文件链接**可预览 md/txt（本地 Electron 或受 CORS 允许的 http）。

---

## 6. 阶段 D — 右栏增强

对应方案 **§7 阶段 D**。

- [x] **ECharts**：约定围栏语言 **`echarts-json`**；**Zod** 校验（`lib/echarts-option-schema.ts`），失败时右栏 `<pre class="lclaw-chart-error">` 占位。
- [x] **ECharts 按需引入**（`echarts/core` + charts/components/renderers，`composables/usePreviewEcharts.ts`）。
- [x] **工具调用时间线**：`stores/toolTimeline.ts` + `PreviewPane` 底部列表；载荷摘要脱敏；切换会话时清空。
- [x] **外链白名单**：`lib/url-allowlist.ts` + DOMPurify 钩子；`VITE_LINK_ALLOWLIST`；允许的 `http(s)` 链接统一 `target=_blank` + `rel=noopener noreferrer`（方案 §4.2）。
- [x] 高频工具输出：**120ms 节流 + 同事件同摘要合并计数**（`toolTimeline` ingest，方案 §6.1）。
- [x] **PDF / 图片 / Office**：`electron/main.ts` 本地读盘；Office → **LibreOffice** 转 PDF；**IPC** 安装引导（`preview:libreOfficeStatus`、下载页、对话框）与 **`shell.openPath`** 系统打开降级；HTTPS Office **Office Online** 嵌入。
- [x] **聊天内可点击链接** → `filePreview.openUrl`（`ChatLineBody.vue`）；Electron **选文件**对话框含 Markdown/文本类型。

**阶段 D 完成标准**：图表、工具线、安全链接与**文件预览**（含 Office 本地链路）可用；右栏性能在长对话下可接受。

---

## 7. 阶段 E — 硬化与发布

对应方案 **§7 阶段 E**。

- [x] **Zod** 覆盖核心 RPC 响应（`sessions.list`、`chat.history`）与下行 **`chat`** 事件；校验失败有中文说明（`formatZodIssues`）；RPC 异常走 `describeGatewayError`（`lib/gateway-errors.ts`）。
- [x] **同步 `gateway-client-protocol-notes.md`**：方法表、事件表、schema 索引、版本字段。
- [x] **可观测性**：顶栏 **复制诊断信息**（脱敏 JSON，无 token/密码明文）；常见 JSON-RPC 码中文对照（`gateway-errors.ts`）。*（错误上报 SDK 未接，按需再加。）*
- [x] **回归**：版本锁定与升级后冒烟步骤写入 **`docs/lclaw-ui-内网部署.md`** §联调冒烟清单。
- [x] **构建**：`pnpm typecheck` + `pnpm build`；SPA fallback 配置示例见 **`docs/lclaw-ui-内网部署.md`**（Nginx/Caddy/IIS）。
- [x] **文档**：**`docs/lclaw-ui-内网部署.md`**（环境变量、前置条件、部署命令）。
- [ ] （按需）**BFF / SSO / 审计**（方案 §2、§6）。
- [ ] （按需）**无障碍**、**i18n** 文案外置（方案 §7 阶段 E）。

**阶段 E 完成标准**：可交付内网 SPA（及可选安装包）；协议与版本可追溯。

---

## 8. 桌面安装包（Electron）

方案 §5.2、§1.4；细节见 **`docs/lclaw-ui-electron-local-preview.md`**。

- [x] 采用 **Electron + Vite**（`vite-plugin-electron`）；开发态 `pnpm dev` 联调；生产态 **127.0.0.1 静态服务** 避免 `file://` Origin 被拒。
- [x] **网关本地配置**：`gateway-local.json` + 界面「网关本地设置」（打包后无 `.env` 时使用）。
- [x] **本机文件预览**：主进程 IPC（`preview:openLocal` 等）；文本上限、LibreOffice 路径探测见 electron 文档。
- [ ] Windows **代码签名**与 **electron-updater** 自动更新按法务/运维排期。

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
| [lclaw-ui-electron-local-preview.md](./lclaw-ui-electron-local-preview.md) | Electron、LibreOffice、本地预览 IPC |
| [lclaw-ui-功能补全清单.md](./lclaw-ui-功能补全清单.md) | 对照官方文档的增量功能与设置排期 |

---

*文档结束。*
