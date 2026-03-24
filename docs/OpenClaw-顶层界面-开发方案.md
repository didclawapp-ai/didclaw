# OpenClaw 顶层界面 — 开发方案

> **版本**：1.7  
> **前提**：OpenClaw 作为底层黑盒服务运行，**不修改**其源码；上层自研「左聊天 + 右预览」客户端。  
> **参考文档**：[OpenClaw Control UI](https://docs.openclaw.ai/web/control-ui) · [WebChat](https://docs.openclaw.ai/web/webchat)  
> **技术选型**：`didclaw` 以 **Vue 3 + TypeScript + Vite** 为主（团队熟悉 Vue）。  
> **当前客户端版本**（`didclaw/package.json`）：**0.2.0**（与实现进度同步时更新）。

### 修订记录

| 版本 | 说明 |
|------|------|
| 1.7 | §9 增加 **`didclaw-功能补全清单.md`** 引用（对照官方文档的增量排期） |
| 1.6 | 对齐 `didclaw` **v0.2.0**：§1.3/§4.1/§4.2 补充流式、乐观消息、system 默认隐藏、终端噪音过滤、右栏文件预览（PDF/图/Office/Markdown/文本）、Electron 与 LibreOffice；§7 阶段说明与实现状态脚注 |
| 1.5 | 新增 `didclaw-开发步骤.md`；§9 与 `didclaw/README` 增加引用 |
| 1.4 | 复审完善：§3.4/3.5 联调与协议类型化；§4.1/4.2 会话切换与 Office 预期；§6.1 可观测性；阶段 E 与 §11 复审补充；新增 `gateway-client-protocol-notes.md` 模板 |
| 1.3 | 明确 **Vue 3** 为默认前端栈；§5.1 改为 Vue 生态选型；与 `didclaw/README` 对齐 |
| 1.2 | 基线标注：确认 §1.4 / §5 全文 / §9 / `didclaw/README` 摘要均已纳入 |
| 1.1 | 扩展 §5 为「技术栈与打包方案」；更新 §9；版本号调整 |
| 1.0 | 初版方案 |

---

## 1. 目标与范围

### 1.1 产品目标

- 提供桌面壳或浏览器内的**双栏主界面**：左侧会话与对话，右侧富预览。
- 所有对话能力由 **OpenClaw Gateway** 提供；上层仅负责 UI、状态聚合与安全策略。

### 1.2 不在范围内（首期）

- Fork 或内嵌修改 `openclaw` 仓库。
- 在 OpenClaw 内新增自定义 RPC（除非后续有强需求且走官方扩展机制）。

### 1.3 成功标准（建议）

- 能完成：选会话 → 拉历史 → 发送 → **流式**增量展示（含乐观用户消息、delta 与终态历史一致）→ 中断。
- 左栏默认面向对话：**`system` 角色消息默认不进入列表**（勾选「显示诊断/配置」后可见）；工具 stdout/stderr 类噪音可按规则折叠（详见 `didclaw` 实现与协议笔记）。
- 右栏能稳定展示：**消息内 Markdown**（选中/跟随最新）、约定 **ECharts**、工具时间线、**可点击的 http(s)/file 链接**；**文件预览**支持 PDF/图片、**Markdown/纯文本文件**（`.md`/`.txt` 等）、Office（HTTPS 在线嵌入；**Electron** 下本地 Office 经 **LibreOffice** 转 PDF，未安装时可引导下载或用系统程序打开）。
- **Electron**：无活跃文件预览时右栏可收起以扩大聊天区；有预览时自动展开。
- Gateway 升级小版本后，通过既定回归用例仍可用。

### 1.4 仓库与目录布局（DidClaw 工作区）

顶层界面**单独一个文件夹**开发，与 OpenClaw 源码目录并列，避免混在一起、也方便以后单独开 Git 仓库或发版。

```
DidClaw/
├── docs/                              # 工作区级文档（方案、协议笔记等）
│   └── OpenClaw-顶层界面-开发方案.md
├── openclaw-src/                      # OpenClaw 上游：本地跑 Gateway、只读参考（勿改业务逻辑）
└── didclaw/                          # 自研「左聊天 + 右预览」客户端（本方案主工程）
    ├── README.md                      # 如何安装、如何连 Gateway、环境变量说明
    ├── package.json                   # 若用 Node 前端工具链
    ├── src/
    │   ├── app/                       # 应用壳：路由、布局（左右分栏）、主题
    │   ├── features/
    │   │   ├── chat/                  # 会话列表、消息列表、输入框、WS 发送
    │   │   ├── preview/               # Markdown、ECharts、工具时间线、下载区
    │   │   └── gateway/               # WebSocket 客户端、重连、鉴权、RPC 封装
    │   ├── components/                # 跨 feature 的纯 UI 组件
    │   └── lib/                       # 工具函数、安全（URL 白名单）、常量
    ├── public/
    └── e2e/ 或 tests/                 # 按需：端到端或单测
```

**命名说明**：`didclaw` 可按团队习惯改名（如 `openclaw-client`）；原则只有一个——**与 `openclaw-src` 平级、职责清晰**。

若后续引入 **BFF**，推荐仍在 **本仓库根目录**（`DidClaw/`）下并列新建目录（例如 `didclaw-api/`），不要让 BFF 嵌进 `didclaw` 源码树深处，便于独立部署与扩缩。

**桌面壳（Electron / Tauri）**：可在 `didclaw` 内增加 `src-tauri/` 或 `electron/`，或拆成 `didclaw/packages/desktop`（pnpm workspace）；首期用纯 Web + 浏览器验证协议即可，再包壳。

---

## 2. 总体架构

```
┌─────────────────────────────────────────────────────────────────┐
│  前端：桌面壳 / 浏览器                                              │
│  ┌──────────────────────┬──────────────────────────────────────┐ │
│  │ 左栏：聊天窗口         │ 右栏：预览窗口                          │ │
│  │ · 会话列表             │ · Markdown / 表格                      │ │
│  │ · 消息历史             │ · 图表（ECharts）                       │ │
│  │ · 发送 / 中断          │ · 下载链接（PPT/Excel 等）               │ │
│  │ · 流式响应             │ · 工具调用结果可视化                     │ │
│  └──────────────────────┴──────────────────────────────────────┘ │
└────────────────────────────┬──────────────────────────────────────┘
                             │ WebSocket（JSON-RPC 风格，与官方 Control UI 一致）
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  OpenClaw Gateway（黑盒）                                           │
│  默认示例：ws://127.0.0.1:18789（以实际 gateway.port / bind 为准）    │
└─────────────────────────────────────────────────────────────────┘
```

可选中间层（按需引入）：

```
前端 → BFF（自有） → Gateway
```

**适用场景**：不向浏览器暴露 Gateway Token、企业 SSO、审计日志、多租户路由等。BFF 可透传 WebSocket 或将 RPC 聚合为自有 REST，**仍无需改 OpenClaw**。

---

## 3. 与 OpenClaw 的契约

### 3.1 必须实现的能力（首期）

| 能力 | 用途 |
|------|------|
| `sessions.list` | 会话列表（左栏） |
| `chat.history` | 历史消息（注意官方对过长字段的截断/省略策略） |
| `chat.send` | 发送用户消息并触发 Agent |
| `chat.abort` | 中断当前生成 |
| `chat.inject` | 插入消息但不触发 Agent（系统提示、旁注等） |
| **下行事件流** | Agent 文本流式输出、工具调用生命周期、错误与元数据 |

> 具体字段与消息形态以**当前运行的 Gateway 版本**为准；实现阶段建议抓包对照官方 `ui` 或文档，并在仓库中维护一份「客户端兼容说明」（版本号 + 已知差异）。

### 3.2 连接与鉴权

- 握手阶段通过 `connect.params.auth` 传入 **token** 或 **password**（与 [Control UI](https://docs.openclaw.ai/web/control-ui) 一致）。
- **非本机首次连接**可能触发设备配对：界面需展示明确错误文案，并引导用户执行 `openclaw devices list` / `approve`（见官方 Device pairing 说明）。
- 开发时可采用官方模式：独立前端开发服务器 + 查询参数 `gatewayUrl`、`token` 指向远端 Gateway。

### 3.3 地址与部署约定

| 环境 | 说明 |
|------|------|
| 本地开发 | `ws://127.0.0.1:<port>`，port 与 `openclaw gateway` 配置一致 |
| 局域网 / 远程 | `wss://` + 反向代理；配置 `gateway.auth`、TLS、可信代理等 |
| 配置来源 | 环境变量、本地配置文件或首次向导写入（由上层应用定义，不写死密钥进仓库） |

### 3.4 本地开发联调与跨源

- 常见形态：Vite 开发服务器在 **`http://localhost:5173`**（或等价端口），Gateway 在 **`ws://127.0.0.1:18789`**（示例）。**WebSocket 与 HTTP 页面不同源时，浏览器仍可按 URL 直连 WS**；若出现无法连接，再排查：本机防火墙、Gateway `bind`、是否误用 `https` 页连 `ws://`（混合内容 blocked）等。
- 开发环境宜使用 **环境变量或 URL 查询参数** 注入 `gatewayUrl`、`token`，与官方 Control UI 远程开发方式一致（见 [Control UI](https://docs.openclaw.ai/web/control-ui)）。
- 若需由开发服务器代转 HTTP 接口（非 WS），可在 Vite 配置 `server.proxy`；**Gateway 的 WS 一般仍建议直连**，避免多余 hop，除非有统一网关策略。

### 3.5 协议载荷与类型安全（建议）

- 在 `didclaw` 内对 **下行事件、RPC 响应** 建立一层 **运行时校验**（推荐 **Zod**；与 OpenClaw 内部风格接近者可用 **TypeBox**，二选一即可），避免 Gateway 小版本字段增减导致静默错误。
- 校验失败时：**打结构化日志（脱敏）+ 对用户给出可理解错误文案**，勿直接白屏。
- 与 §9 中 **`docs/gateway-client-protocol-notes.md`** 同步维护：OpenClaw **版本号、方法名、示例 JSON、已知差异**。

---

## 4. 前端功能设计

### 4.1 左栏：聊天窗口

| 模块 | 说明 |
|------|------|
| 会话列表 | 绑定 `sessions.list`；支持当前选中 session |
| 消息区 | `chat.history` 分页或增量；展示用户/助手消息；**`system` 默认隐藏**（诊断开关打开后显示） |
| 输入区 | 发送前校验；支持 `chat.abort` |
| 流式展示 | 订阅 `chat` 下行事件；**delta** 支持「全文快照」与「纯增量」合并（`mergeAssistantStreamDelta`）；首包前可展示助手占位行；**乐观**用户消息与 **`chat.history` 短快照**合并，避免未落库时列表被冲掉 |
| 状态 | 连接中 / 已连接 / 需配对 / 鉴权失败 / 断线重连 |

**状态模型（建议）**

- `activeSessionId`：当前会话。
- `messages[]`：该会话下的消息列表（含本地乐观更新与服务端确认）。
- `currentRunId` 或等价标识：用于把流式 token 与 tool 事件钉在同一轮回复上（具体字段名以 Gateway 事件为准）。

**会话切换与在途生成（须事先约定）**

- 用户从左栏**切换到另一会话**时，若当前会话仍有**未结束的流式生成**：建议默认调用 **`chat.abort`**（或等价取消）再切换，避免下行事件写入错误会话。
- 切换后：**右栏**建议清空或切换为「新会话上下文」（避免上一会话的图表/工具时间线残留）；若需保留「上次预览」，可作为进阶选项，但须在 UI 上明确当前所属会话。
- 同一会话内**快速连续发送**：以实现为准决定是否自动 abort 上一轮；至少须在 UI 上禁用发送或排队，避免状态机混乱。

### 4.2 右栏：预览窗口

右栏是「**当前上下文的可视化投影**」，建议由以下数据源驱动（可组合）：

| 预览类型 | 数据来源 | 实现要点 |
|----------|----------|----------|
| Markdown / 表格 | 当前选中消息或「最后一则助手消息」的文本 | 使用可信 Markdown 渲染库；表格与代码块默认安全模式（无裸 HTML 或严格消毒） |
| **Markdown / 纯文本文件** | 用户点击消息内 **http(s)** 或 **Electron `file://`** 的 `.md`/`.txt`/`.log`/`.csv` 等 | **`markdown-it` + `DOMPurify` + `highlight.js`**；本地文件经主进程读盘（体积上限如 2MB）；远程受 **CORS** 限制时需提示或新窗口打开 |
| ECharts | 助手消息中的**约定代码块**（如 ` ```echarts` JSON）或工具返回的**固定 JSON Schema** | **必须**固定 schema，前端校验后再 `JSON.parse` + `setOption`；禁止执行任意 JS |
| PDF / 图片 | 同上可点击链接或本地选择 | 内嵌 `<iframe>` / `<img>`；Blob URL 须在关闭预览时 **revoke** |
| Office（doc/xls/ppt） | 可点击链接 | **HTTPS 公网**：**Office Online** 嵌入尝试；**Electron 本地**：**LibreOffice headless → PDF** 内嵌；未检测到 LibreOffice 时 **原生对话框引导安装** + **系统默认程序打开**降级 |
| 工具调用可视化 | 下行事件流中的 tool 开始/结束/参数/输出 | 时间线 UI；与 `currentRunId` / session 关联；敏感参数脱敏展示 |

**交互建议**

- 左右栏独立滚动；右栏宽度可拖拽调整（分栏条）——**可选**，当前实现以固定分栏为主。
- 「跟随最新」开关：开启时右栏默认跟最后一则助手消息；关闭时跟用户选中消息。
- **右栏显隐**：无文件类预览任务时**默认收起**右栏；产生预览（含加载中/错误态）时**自动展开**；关闭预览后收起。**Electron** 在右栏收起时可在左栏提供「本地文件…」入口。

### 4.3 与 Agent 的协作约定（提示词 / 工具）

为保证右栏可解析，建议在系统侧（配置或模板）约定：

- 图表：仅输出指定 fenced 块格式，且 JSON 符合前端校验。
- 文件链接：仅输出 `https://` 且域名在允许列表中。
- 表格：优先 Markdown 表格，避免截图代替结构化数据。

（具体模板由业务定稿，本文档只要求**前后端与 Agent 输出形状一致**。）

---

## 5. 技术栈与打包方案

### 5.1 推荐默认组合（本仓库：**Vue 3**）

以 **「先 Web 验证协议，再按需包桌面」** 为路径；**`didclaw` 默认采用 Vue 3 技术栈**（团队熟悉、双栏与长列表场景成熟）。

| 层级 | 选型 | 说明 |
|------|------|------|
| 语言 | **TypeScript** | 与 Gateway JSON 载荷协作、长期维护成本更低 |
| 构建工具 | **Vite 6.x** | 与 Vue 官方模板一致；冷启快 |
| UI 框架 | **Vue 3**（**Composition API** + `<script setup>`） | 主界面、左聊天、右预览 |
| 路由 | **Vue Router 4** | 若需多页（如设置页、关于页）；纯单页双栏可延后 |
| 包管理 | **pnpm** | 与 `openclaw-src` 一致 |

**状态与数据流**

| 用途 | 选型 | 说明 |
|------|------|------|
| 全局 / 跨组件状态 | **Pinia** | 会话选中、Gateway 连接状态、当前 run、消息列表；Vue 官方推荐 |
| 异步 / 缓存（若有 REST BFF） | **@tanstack/vue-query** | 可选；纯 WebSocket 为主时仅用于少量 HTTP（如拉配置） |
| 长列表 | **@tanstack/vue-virtual** | 消息很多时虚拟滚动，避免 DOM 过重 |

**UI 组件（可选，择一即可）**

| 选型 | 说明 |
|------|------|
| **Naive UI** | TypeScript 友好、主题可调，适合中后台式布局 |
| **Element Plus** | 生态大、文档全，企业项目常见 |
| **无头 + 自建样式** | 仅用 **Tailwind CSS** 等，控制力强、依赖少 |

**备选（非默认）**：若未来有人更熟 **React**，可单独文档约定第二套模板；与 OpenClaw 对接仍只依赖 **WebSocket 协议**，与框架无关。

**右栏依赖**

| 能力 | 选型 | 说明 |
|------|------|------|
| Markdown | **markdown-it** + **DOMPurify**（或 mdast + rehype-sanitize） | 统一解析管道，气泡与右栏复用 |
| 代码高亮 | **Shiki** 或 **highlight.js** | Shiki 主题更统一，体积略大 |
| 图表 | **Apache ECharts 5** | 与「JSON option」约定匹配；按需 `import * as echarts from 'echarts/core'` 做按需引入减小包体 |

**质量**

| 用途 | 选型 |
|------|------|
| 单元测试 | **Vitest**（与 Vite 同源） |
| E2E | **Playwright**（可选，阶段 E 再上） |
| Lint / 格式 | **ESLint 9 + Prettier** 或 **Biome**（二选一，全仓统一） |

**不要求**与 OpenClaw 官方 Control UI（Vite + Lit）一致；**协议对齐 Gateway** 即可。

---

### 5.2 打包与交付形态

| 阶段 | 形态 | 做法 |
|------|------|------|
| **开发** | 浏览器 + Vite dev server | `gatewayUrl` / `token` 用环境变量或 URL 查询参数注入（与[官方 Control UI 远程开发说明](https://docs.openclaw.ai/web/control-ui)同思路） |
| **内网 Web 部署** | 静态 SPA | `pnpm build` → `dist/`，由 **Nginx / Caddy / IIS** 托管；配置 **History fallback** 到 `index.html` |
| **桌面安装包** | 二选一（见下表） | 仍用同一套 Vite 构建的 `dist`，由壳加载本地或远程入口 |

**桌面壳对比**

| 方案 | 优点 | 缺点 |
|------|------|------|
| **Tauri 2 + Vite** | 安装包小、内存占用相对低、Windows 可做单文件感 | 需 Rust 工具链；部分系统 API 要学 |
| **Electron + Vite** | 生态资料多、与 Node 能力结合简单 | 体积与内存偏大 |

**建议**：若团队无 Rust 经验、又要快速出 **Windows 安装包**，可优先 **Electron**；若强调体积与常驻资源，再评估 **Tauri**。

**签名与更新（桌面）**

- Windows：后续用 **代码签名证书**（EV/OV）签 `exe`/`msi`，减少 SmartScreen 拦截。
- 自动更新：Electron 常用 **electron-updater**；Tauri 用官方 updater 插件。首期可「手动下载安装包」省略。

---

### 5.3 CI/CD（建议）

| 环节 | 做法 |
|------|------|
| 版本源 | `package.json` version + Git tag（如 `didclaw/v0.1.0`） |
| CI | **GitHub Actions** / 自建 Runner：`pnpm i --frozen-lockfile` → `pnpm lint` → `pnpm test` → `pnpm build` |
| 产物 | Web：`dist` 归档为 zip 或上传对象存储；桌面：各平台 artifact 分开展示 |

---

### 5.4 与 OpenClaw 的衔接方式（不变）

- 运行时不依赖把 `didclaw` 放进 `openclaw-src`：**独立进程、独立端口**；仅通过 **WebSocket** 连 Gateway。
- Node 版本：与前端工具链一致即可（建议 **Node 22 LTS**）；Gateway 仍按 OpenClaw 要求单独安装/运行。

---

## 6. 安全与合规

- **Token**：优先内存或短期存储；避免写入可被 XSS 读取的持久化明文。
- **XSS**：Markdown、工具输出、链接跳转均走消毒与白名单。
- **下载**：校验 Content-Disposition / MIME，必要时经 BFF 代理扫描或记录审计。
- **日志**：生产环境对鉴权头、token、用户消息做脱敏。

### 6.1 可观测性与错误呈现

- **前端错误**：接入团队统一的错误上报（如 Sentry 自建等价物），**剔除 token 与消息正文**或哈希化后再上报。
- **Gateway 连接**：记录 **断连次数、重连成功/失败、最后一次错误码**（可在设置页提供「复制诊断信息」供运维，内容需脱敏）。
- **用户可见文案**：为常见失败建立对照表（配对拒绝、鉴权失败、超时、协议校验失败），避免仅展示原始英文堆栈。
- **性能**：对高频下行事件可做 **合并/节流**（如工具流式输出），防止 Vue 渲染与 ECharts 更新拖垮主线程。

---

## 7. 分阶段交付计划

### 阶段 A — 基础设施（约 1～2 周，视人力）

- [x] WebSocket 客户端：连接、鉴权、心跳/重连、错误分类（配对、403、断线）。*`didclaw` 已具备*
- [x] 最小会话列表 + 历史消息只读。
- [x] 发送消息并展示**流式**结果（含 delta 合并、乐观消息、终态静默刷新等）。*持续随 Gateway 形态微调*

### 阶段 B — 左栏完整闭环

- [x] `chat.abort`、发送中状态、历史刷新策略。
- [x] 下行事件与 UI 对齐；工具事件时间线；**列表噪音过滤**与 **`system` 默认隐藏**（诊断开关）。

### 阶段 C — 右栏 MVP

- [x] Markdown + 表格 + 代码高亮（消息正文预览）。
- [x] 消息选中与右栏联动；**文件类** Markdown/文本预览见阶段 D 补充。

### 阶段 D — 右栏增强

- [x] ECharts（schema + 校验 + 错误兜底）。
- [x] 工具调用时间线组件。
- [x] 链接白名单与统一「安全打开」流程；**PDF/图片/Office/Markdown/文本文件**预览路径；**Electron + LibreOffice** 本地 Office 预览与安装引导。

### 阶段 E — 硬化与发布

- [x] 下行/响应 **Zod** 校验核心路径；与 `gateway-client-protocol-notes.md` 同步更新。
- [x] **可观测性**：连接诊断复制（脱敏）；用户可见错误文案。
- [ ] Gateway 版本矩阵回归（记录兼容的 OpenClaw 版本号）——*随每次升级执行冒烟，文档持续记版本*。
- [ ] 可选 BFF、SSO、审计。
- [x] 内网部署文档；**Electron** Windows 打包脚本（签名/自动更新仍按需）。
- [ ] （按需）**无障碍**；**国际化** 文案外置。

（周期为估算，按团队规模调整。`[x]` 表示 `didclaw` **0.2.0** 已覆盖的主线能力。）

---

## 8. 测试与验收

| 类型 | 内容 |
|------|------|
| 手工 | 本地起 Gateway；**跨端口联调**（如 5173 → 18789）；会话切换 + **在途 abort**；断网重连 |
| 自动化 | WS 客户端 mock；对 Markdown/ECharts 解析做快照测试；**协议校验**对异常 payload 的降级行为 |
| 兼容 | 升级 OpenClaw 一个小版本后跑冒烟用例 |

---

## 9. 文档与仓库建议

- 在本工作区维护：`docs/OpenClaw-顶层界面-开发方案.md`（本文）、**`docs/didclaw-开发步骤.md`**（按阶段可勾选的开发顺序）、**`docs/didclaw-功能补全清单.md`**（对照 [OpenClaw 文档](https://docs.openclaw.ai/) 的增量功能排期）、**`docs/gateway-client-protocol-notes.md`**（**必填维护**：按 Gateway 版本记录方法名、示例 JSON、与官方行为差异；见该文件头模板）。
- 自研客户端代码根目录：`didclaw/`（见 §1.4）。
- OpenClaw 本体：`openclaw-src/` 仅作**只读参考**与本地启动 Gateway，不作为魔改主战场。

---

## 10. 风险与对策

| 风险 | 对策 |
|------|------|
| Gateway RPC 变更 | 锁定 OpenClaw 版本；升级前读 Release Note；**Zod/TypeBox 校验失败可观测**；维护 `gateway-client-protocol-notes.md` |
| `chat.history` 大消息被省略 | 产品提示「摘要模式」；必要时扩展为「点击查看原文」若官方后续提供细粒度 API |
| 右栏任意 JSON 导致 XSS | 严格 schema + 禁止 `eval`；ECharts 仅 option 对象 |
| Token 泄露 | BFF、HttpOnly Cookie、或桌面壳安全存储 |
| 会话切换导致串台 | 见 §4.1：**切换前 abort**、右栏上下文随会话清空、发送按钮与状态机互斥 |

---

## 11. 复审补充（工程约定汇总）

本节将复审结论固化为可执行约定，避免散落在各章不易检索。

| 主题 | 约定 |
|------|------|
| 联调 | §3.4：Vite 与 Gateway 分端口为常态；WS 一般直连；混合内容（https 页连 ws）注意浏览器拦截 |
| 协议演进 | §3.5：下行与响应做 **Zod/TypeBox** 校验；与协议笔记同步版本 |
| 会话与 UI | §4.1：切换会话 abort、右栏上下文、连发策略 |
| Office 范围 | §4.2：**Web** 以在线嵌入 + 安全打开为主；**Electron** 已实现 **LibreOffice 转 PDF** 内嵌预览与安装引导 |
| 运维可见 | §6.1：脱敏上报、连接诊断、用户可见错误码表、渲染节流 |
| 阶段门槛 | §7 阶段 E：校验、可观测性、协议笔记、（按需）a11y/i18n |

---

## 12. 附录：参考链接

- [Control UI（浏览器控制面）](https://docs.openclaw.ai/web/control-ui)
- [WebChat 行为说明](https://docs.openclaw.ai/web/webchat)
- [OpenClaw 官网与文档索引](https://openclaw.ai)

---

*文档结束。*
