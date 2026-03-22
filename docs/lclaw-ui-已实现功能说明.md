# LCLAW UI 已实现功能说明

> **产品**：LCLAW UI（`lclaw-ui`）  
> **版本**（与 `lclaw-ui/package.json` 同步）：**0.2.0**  
> **说明范围**：截至当前仓库已实现、可交付使用的功能；不含路线图中的「待开发」项。  
> **原则**：OpenClaw **Gateway 不改源码**；本客户端通过 WebSocket 协议与网关交互，并在桌面端读写本机 OpenClaw 配置文件。

---

## 1. 产品定位与运行形态

| 形态 | 说明 |
|------|------|
| **桌面端（推荐）** | Electron 壳：本地静态资源、完整本机设置、文件预览与系统集成能力。 |
| **浏览器开发联调** | `pnpm dev` / `dev:web`：通过环境变量 `VITE_GATEWAY_URL`、`VITE_GATEWAY_TOKEN`、`VITE_GATEWAY_PASSWORD` 指向网关；无 Electron 本机读写能力。 |

打包发布（需在 **`lclaw-ui` 目录**执行）：

- `pnpm dist:win:portable`：便携版  
- `pnpm dist:win:setup`：NSIS 安装包  
- `pnpm dist:win`：按 `package.json` 中 electron-builder 配置构建 Windows 产物  

---

## 2. 网关连接

### 2.1 连接开关与状态

- 顶栏提供 **连接开关**（滑块）与状态指示灯。  
- 状态包括：**未连接**、**连接中**、**已连接**、**异常**（展示 `lastError`）。  
- 已连接时展示网关 Hello 信息（如 **Gateway 版本**）。

### 2.2 鉴权

- 支持 **Token** 与 **密码**（与网关 `gateway.auth` 配置一致；按实际部署二选一或按官方要求）。  
- 桌面端优先从 **用户数据目录** 下的 `gateway-local.json` 读取；可与环境变量组合使用。

### 2.3 本机自动启动 OpenClaw 网关（桌面端）

在 **「本机设置 → ① 连助手」** 中可配置（并写入 `gateway-local.json`）：

| 项 | 说明 |
|----|------|
| **连接时自动在后台启动本机 OpenClaw 网关** | 默认开启。仅当 **WebSocket 地址为本机**（`127.0.0.1` / `localhost` / `::1`）且 **对应 TCP 端口尚未监听** 时，由主进程 **无控制台窗口**（`windowsHide`）启动 `openclaw gateway`。Windows 下通过 **`shell: true`** 兼容 npm 全局 `openclaw.cmd`。 |
| **退出本应用时结束由本应用启动的网关进程** | 默认关闭。开启后，退出 LCLaw 时会结束 **本次由应用拉起的** 子进程（不处理用户手动另开的终端）。 |
| **openclaw 可执行文件** | 可选。留空则从 PATH / `where openclaw` 解析；若找不到可填写 **完整路径**（如 `openclaw.cmd`）。 |

远程网关地址 **不会** 触发上述自动启动逻辑。

### 2.4 WebSocket 客户端行为

- 建立连接、**connect** Hello、下行事件分发。  
- 断线后 **自动重连**（含退避）；用户 **断开开关** 或切换配置时会取消孤儿重连，避免多实例抢连。

---

## 3. 本机设置（Electron）

通过顶栏 **「设置」** 打开 **本机设置** 对话框（分步 Tab）：

### 3.1 ① 连助手

- **连接地址**（WebSocket URL，默认示例 `ws://127.0.0.1:18789`）。  
- **口令（Token）**、**密码**（可选）。  
- 上文 **2.3** 中的三项网关启动相关选项。  
- **保存并重新连接**：合并写入 `gateway-local.json` 后断开并重连。

### 3.2 ② AI 账号（供应商）

- 读取并合并展示 **`~/.openclaw/openclaw.json`** 中 `models.providers` 与 **默认代理** 下 **`agents/<id>/agent/models.json`** 的 `providers`（与网关运行时合并规则一致：同 id 以代理目录为准；`models` 为对象时会按 key 合并）。  
- 支持 **新增 / 编辑 / 删除** 供应商（provider id、baseUrl、API Key、模型 id 列表、`api`、`authHeader` 等）。  
- **写入前** 会将各 provider 的 **`models`** 从「id → 对象」形态 **规范为非空数组**，满足 OpenClaw ModelRegistry 要求，避免出现 **Unknown model**。  
- 写入时同步维护 **`auth-profiles.json`**、必要时调整 **`openclaw.json`**（避免密钥重复落盘等，详见 `electron/openclaw-config.ts` 注释）。  
- 提供常见厂商 **预设**（一键填 URL 等），减少手写。  
- 保存前对 **openclaw.json** / **models.json** 等做备份（按实现生成带时间戳或约定前缀的备份文件）。

### 3.3 ③ 选模型

- 读取 / 写入 **`openclaw.json`** 中 **`agents.defaults.model.primary`**（默认对话模型）。  
- 维护 **`agents.defaults.models`** 别名表（模型 ref → `alias`）。  
- 支持从预设快速选择常见主模型。  
- 支持 **从最近备份恢复** `openclaw.json`（若实现提供该 IPC）。

---

## 4. 会话与聊天

- **会话列表**：拉取并展示会话；支持切换当前会话。  
- **消息列表**：虚拟列表、流式输出、乐观发送、**中止（abort）** 进行中的生成。  
- **聊天 RPC**：`chat.history`、`chat.send`、`chat.abort` 等与网关协议对齐（具体方法名以当前 Gateway 版本为准）。  
- **附件**：组合输入区支持附件能力（受连接状态等约束）。  
- 顶栏或相关区域可进入 **关于** 等页面。

---

## 5. 右栏与预览

- 选中消息：**Markdown 渲染**、代码高亮；支持 **echarts-json** 等约定格式。  
- **工具时间线**：合并展示除部分高频事件外的下行事件，便于调试。  
- **外链**：白名单策略（环境变量 `VITE_LINK_ALLOWLIST` 等，按实现为准）。  
- **本地文件预览**（Electron）：图片、PDF、Markdown/文本；Office 文档可通过 **LibreOffice** 转 PDF 后预览（未安装时可提示下载页）。  
- **链接/文件菜单**：另存为、系统默认程序打开、邮件附件准备、分享复制等（见 preload / 主进程实现）。

---

## 6. 诊断与复制

- 顶栏 **「诊断」**：生成 **脱敏** 结构化快照（应用版本、网关 URL、连接状态、会话与聊天摘要、是否配置 Token/密码等），**一键复制** JSON，便于排障。  
- **注意**：诊断内容设计为脱敏，**请勿**将真实 Token 粘贴到公共渠道；密钥仍以本机配置文件为准。

---

## 7. 环境与前置条件

| 项目 | 说明 |
|------|------|
| **OpenClaw 网关** | 需已安装并可运行 `openclaw`；本机场景下可由 LCLaw **自动后台启动**（见 2.3）。 |
| **配置文件路径** | 用户主目录下 **`.openclaw/`**（`openclaw.json`、代理目录下 `models.json`、`auth-profiles.json` 等）。 |
| **浏览器联调** | 需自行启动网关并配置 `VITE_GATEWAY_*`。 |

---

## 8. 已知边界（当前版本）

- **安装器内嵌 Node/OpenClaw 安装、国内镜像、首次启动自动从 `openclaw.json` 导入 Token** 等属于 **后续阶段**，本说明不包含。  
- 未实现的能力排期见 **`lclaw-ui-功能补全清单.md`**。  
- 协议细节与网关版本差异请维护 **`gateway-client-protocol-notes.md`**（若仓库中有该文件）。

---

## 9. 文档与代码索引

| 文档 | 用途 |
|------|------|
| `docs/OpenClaw-顶层界面-开发方案.md` | 总体方案与架构 |
| `docs/lclaw-ui-开发步骤.md` | 分阶段开发与勾选 |
| `docs/lclaw-ui-功能补全清单.md` | 增量功能排期 |
| `docs/lclaw-ui-桌面端专属-实现方案.md` | 桌面端专属能力 |
| `lclaw-ui/electron/openclaw-config.ts` | OpenClaw 配置读写与合并 |
| `lclaw-ui/electron/openclaw-gateway-process.ts` | 本机网关进程拉起与端口探测 |

---

*本文随版本迭代更新；若与代码不一致，以仓库实现为准。*
