# didclaw 功能补全清单

> **用途**：在 [`OpenClaw-顶层界面-开发方案.md`](./OpenClaw-顶层界面-开发方案.md) 与 [`didclaw-开发步骤.md`](./didclaw-开发步骤.md) 已列能力之外，对照 [OpenClaw 官方文档](https://docs.openclaw.ai/) 与产品预期，整理**可增量交付**的功能与设置项；用于排期与勾选跟踪。  
> **路线图（功能全貌对表）**：优先参考 [`didclaw-openclaw-alignment.md`](./didclaw-openclaw-alignment.md)；本清单保留为**增量条目**与勾选。  
> **原则**：OpenClaw Gateway **不改源码**；补全集中在 `didclaw` 与文档。  
> **当前包版本**（发版时请与 `didclaw/package.json` 同步）：**0.2.0**

---

## 1. 基线（已实现摘要）

以下已在 [`didclaw-开发步骤.md`](./didclaw-开发步骤.md) 阶段 A–D / Electron 中勾选，**本清单不再重复立项**，仅作对照：

| 领域 | 内容 |
|------|------|
| Gateway | WS 连接、鉴权、重连、`connect` hello |
| 会话与聊天 | `sessions.list`、`chat.history`、`chat.send`、`chat.abort`、流式、乐观消息、虚拟列表 |
| 右栏 | 选中/跟随消息 Markdown、**echarts-json**、工具时间线、外链白名单、PDF/图/Office/Markdown/文本预览 |
| 桌面 | Electron、网关本地设置、本地文件预览与 LibreOffice 链路、链接右键菜单（另存/系统打开/邮件/分享） |
| 体验 | 诊断复制、明亮主题 UI、会话切换 abort 等（见开发步骤） |

---

## 2. 协议与聊天能力补全

| 优先级 | 状态 | 项 | 说明 |
|:------:|:----:|----|------|
| P1 | [ ] | **`chat.inject` 前端** | 方案 §3.1 已列；需确认当前 Gateway 参数形态后做「插入消息、不触发 Agent」入口（高级用户/调试）。 |
| P1 | [ ] | **`chat.history` 分页 / 加载更多** | 大会话减负；与官方截断策略配合，UI 提示「摘要/截断」。 |
| P2 | [ ] | **会话列表元信息** | 若 `sessions.list` 返回渠道、标签等字段，在列表或详情区展示（依赖协议实际字段）。 |
| P2 | [ ] | **下行事件订阅扩展** | 除 `chat` 外，按 [`gateway-client-protocol-notes.md`](./gateway-client-protocol-notes.md) 与官方 Web/Control UI 行为，增量展示错误或运行态（避免仅靠「诊断」开关）。 |

---

## 3. 连接、设置与运维（对齐 OpenClaw 文档）

官方概览见 [OpenClaw Docs](https://docs.openclaw.ai/)：Dashboard 默认端口、配置路径 `~/.openclaw/openclaw.json`、多通道与节点等。

| 优先级 | 状态 | 项 | 说明 |
|:------:|:----:|----|------|
| P1 | [x] | **本机设置（Electron）** | 已移除独立 `/settings` Web 页；网关与 `openclaw.json` 模型在顶栏「本机」对话框（Tab：网关连接 / 模型）。纯浏览器联调依赖 `.env` 的 `VITE_GATEWAY_*`。 |
| P1 | [ ] | **一键打开官方 Control UI** | 文档默认 [http://127.0.0.1:18789/](http://127.0.0.1:18789/)：顶栏或关于页提供外链，与自研 UI 并存。 |
| P1 | [ ] | **设备配对帮助卡片** | 失败时固定展示 `openclaw devices list` / `approve` 等可复制命令（与官方 onboarding 一致）。 |
| P2 | [ ] | **Gateway 版本/能力展示** | 若 hello 或 RPC 可拿到版本字符串，在关于或诊断区展示，便于对照升级说明。 |
| P2 | [ ] | **配置说明只读面板** | 文案说明 `openclaw.json` 位置 + 链到官方 **Configuration**；Electron 可选「打开用户目录」。 |
| P2 | [ ] | **远程 / WSS / 代理说明** | 与方案 §3.3–3.4 一致，产品化短引导，并链到官方 **Remote access**。 |
| P3 | [ ] | **安全最佳实践链接** | UI 内链到官方 **Security**（token、allowlist、群组 mention 等），强调**网关口**配置为主。 |

---

## 4. 多通道与节点（展示与导流）

OpenClaw 强调多通道 Gateway 与 [Nodes](https://docs.openclaw.ai/) 等；本客户端**不重复实现通道逻辑**。

| 优先级 | 状态 | 项 | 说明 |
|:------:|:----:|----|------|
| P2 | [ ] | **通道状态摘要** | 若 Gateway 经 RPC/事件暴露已连接通道，在设置或状态区一行展示；否则用文案 + 官方 **Channels** 文档链接。 |
| P3 | [ ] | **节点配对说明页** | 内嵌说明 + 链到官方 **Nodes**，界定「聊天在 Gateway、节点能力在官方流程」完成。 |

---

## 5. 右栏与预览体验补全

| 优先级 | 状态 | 项 | 说明 |
|:------:|:----:|----|------|
| P2 | [ ] | **分栏宽度可拖拽** | 方案 §4.2 可选；左右栏之间 `resize` 手柄 + localStorage 记忆宽度。 |
| P2 | [ ] | **预览区「复制全文」** | 对当前预览 Markdown/纯文本一键复制。 |
| P3 | [ ] | **暗色主题切换** | 与当前明亮 `--lc-*` 变量并存，`prefers-color-scheme` 或手动切换。 |

---

## 6. 工程化与发布

| 优先级 | 状态 | 项 | 说明 |
|:------:|:----:|----|------|
| P2 | [ ] | **Playwright 冒烟** | 连接 mock 或固定 Gateway：`sessions.list`、发送、流式、abort 最短路径（阶段 E 可选项深化）。 |
| P3 | [ ] | **Windows 代码签名** | 见 [`didclaw-开发步骤.md`](./didclaw-开发步骤.md) §8。 |
| P3 | [ ] | **electron-updater** | 自动更新，与法务/运维排期。 |
| P3 | [ ] | **BFF / SSO / 审计** | 方案 §2、§6；不向浏览器暴露 Token 时引入。 |

---

## 7. 国际化与无障碍（阶段 E 延伸）

| 优先级 | 状态 | 项 | 说明 |
|:------:|:----:|----|------|
| P3 | [ ] | **i18n** | 文案外置，中/英至少一套（与官方英文文档用户并存）。 |
| P3 | [ ] | **无障碍** | 焦点顺序、`aria`、键盘快捷键说明（发送、中断、切换会话等）。 |

---

## 8. 刻意不在范围（防范围膨胀）

- 在 UI 内**完整替代** `openclaw.json` 编辑器与全部通道配置向导（仍以官方 CLI / Control UI / 文档为主）。
- **Fork 或修改** OpenClaw Gateway 源码以新增 RPC（除非未来走官方扩展机制）。

---

## 9. 相关文档

| 文档 | 用途 |
|------|------|
| [didclaw-会话状态与发送策略-实施步骤.md](./didclaw-会话状态与发送策略-实施步骤.md) | 工具内联 / 运行态 / token 展示 / 发送拦截与排队队列的分阶段实施顺序 |
| [OpenClaw-顶层界面-开发方案.md](./OpenClaw-顶层界面-开发方案.md) | 架构与契约 |
| [didclaw-开发步骤.md](./didclaw-开发步骤.md) | 阶段勾选与进度 |
| [gateway-client-protocol-notes.md](./gateway-client-protocol-notes.md) | 协议版本与方法表 |
| [didclaw-内网部署.md](./didclaw-内网部署.md) | 部署与冒烟 |
| [didclaw-electron-local-preview.md](./didclaw-electron-local-preview.md) | Electron 与本地预览 |
| [OpenClaw 官方文档](https://docs.openclaw.ai/) | 上游能力与配置说明 |

---

*修订时请在文首或本节更新「当前包版本」与变更说明。*
