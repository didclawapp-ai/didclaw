# DidClaw「公司制多 Agent」方案与实施

> **状态**：**Phase 1（MVP）代码与主文档已落地**（2026-04-04）；**人工验收（§8）与 Phase 0 手配回归**仍建议在目标环境执行。Phase 2+ 未开始。  
> **复杂度**：当前 DidClaw 路线中**最高**之一（产品隐喻 + 官方 multi-agent 配置 + 多表面 UI + 配置热更新与网关行为一致）  
> **维护**：OpenClaw 升级后优先核对本文 [§2 官方文档索引](#2-官方文档索引与修订时必查) 所列页面及 `agents` / `bindings` / `tools.agentToAgent` 等 schema。  
> **关联文档**：[`didclaw-openclaw-alignment.md`](./didclaw-openclaw-alignment.md) · [`openclaw-features.md`](./openclaw-features.md) · [`gateway-client-protocol-notes.md`](./gateway-client-protocol-notes.md) · **新开对话粘贴用** [`didclaw-multi-agent-company-new-chat-briefing.md`](./didclaw-multi-agent-company-new-chat-briefing.md)

---

## 1. 背景与目标

### 1.1 问题

OpenClaw 的 **多 Agent** 能力通过 `openclaw.json` 中 `agents.list`、`bindings` 等表达，对**普通用户**不直观。DidClaw 希望用 **「公司—职务—规则」** 隐喻降低认知成本，同时在实现上 **严格映射官方语义**，避免自造平行模型导致 **Gateway 升级后行为漂移**。

### 1.2 目标

| 维度 | 说明 |
|------|------|
| **产品** | 成立公司 → 架构（扁平/金字塔等模板）→ 职务与人数 → 每职务模型 → 公司章程；**仪表盘浮窗 + 组织图**；点击职务打开/关闭聊天表面；支持「一键打开全部职务窗口」。 |
| **技术** | UI 状态与 **官方 `agentId` / sessionKey** 一致；配置变更走 **官方支持的写入路径**（见 §2）；多职务表面共享 **同一条 Gateway WebSocket**（见 §5）。 |
| **非目标（MVP）** | 不做与官方无关的私有路由协议；不强制要求多 OS 级独立窗口（见 §5.2）。 |

---

## 2. 官方文档索引（修订时必查）

以下链接为 **OpenClaw 官方文档** 权威入口；实施与评审时以**当前线上文档**为准（若链接调整，用 [文档索引](https://docs.openclaw.ai) / `llms.txt` 重新定位）。

| 主题 | 官方文档 | 用途（本方案） |
|------|-----------|----------------|
| Multi-Agent 总览 | [Multi-Agent Routing](https://docs.openclaw.ai/concepts/multi-agent) | `agentId`、workspace、agentDir、会话隔离；`bindings` 路由规则；`tools.agentToAgent`；与 WhatsApp/Telegram 等示例 |
| 网关配置（多 Agent 段） | [Gateway configuration — Configure multi-agent routing](https://docs.openclaw.ai/gateway/configuration#configure-multi-agent-routing) | `agents.list` + `bindings` 最小示例 |
| 配置完整参考 | [Configuration reference](https://docs.openclaw.ai/gateway/configuration-reference)（检索 `agents`、`bindings`、`multi-agent`） | 字段级细节与默认值 |
| 会话模型 | [Session](https://docs.openclaw.ai/concepts/session) | `sessionKey`、主会话、群组隔离；与 UI 多表面选会话一致 |
| 通道路由 | [Channel routing](https://docs.openclaw.ai/channels/channel-routing) | 入站如何落到某 `agentId`；与 `bindings` 互补理解 |
| 会话工具（跨会话协作） | [Session tools](https://docs.openclaw.ai/concepts/session-tool) | `sessions_list` / `sessions_history` / `sessions_send` 等与「职务间协作」关系 |
| 子代理 | [Sub-Agents](https://docs.openclaw.ai/tools/subagents) | 与「后台职务/一次性任务」差异化；MVP 可推迟 |
| 多 Agent 沙箱与工具 | [Multi-Agent Sandbox & Tools](https://docs.openclaw.ai/tools/multi-agent-sandbox-tools) | 每 agent `tools.allow/deny`、`sandbox`；公司规则编译时需对齐 |
| 安全 | [Security](https://docs.openclaw.ai/gateway/security) | DM、沙盒、暴露面；公司规则文案与安全策略一致 |
| 配置热更新 | [Gateway configuration — Config hot reload](https://docs.openclaw.ai/gateway/configuration#config-hot-reload) | `agents` / `bindings` 等变更是否热应用（表中以官方为准） |
| 程序化改配置 | [Gateway configuration — Config RPC](https://docs.openclaw.ai/gateway/configuration#config-rpc-programmatic-updates) | `config.patch` / `config.apply` 速率限制与重启行为；DidClaw 写入策略 |

**仓库级实现索引（非文档，升级时 diff）**

| 内容 | 位置 |
|------|------|
| Gateway RPC 方法实现 | `openclaw/openclaw` 仓库 [`src/gateway/server-methods/`](https://github.com/openclaw/openclaw/tree/main/src/gateway/server-methods)（如 `agents.ts`、`config.ts`、`sessions.ts`） |

**DidClaw 既有契约**

| 文档 | 用途 |
|------|------|
| [`gateway-client-protocol-notes.md`](./gateway-client-protocol-notes.md) | 已实现 `sessions.list`、`chat.*`、`sessions.patch` 等；扩展前更新此笔记 |

---

## 3. 概念映射（产品 → 官方）

| 产品概念 | 官方概念 | 说明 |
|----------|-----------|------|
| **公司** | 一组 `agents.list` 条目 + 对应 `bindings` +（可选）`tools.agentToAgent` 等 | 不在官方单键名；DidClaw 可用 **profile 名** 存于本地 UI 状态，**落盘仅写标准 openclaw 配置** |
| **职务** | `agents.list[]` 的一项：`id`（稳定键）、`name`、`workspace`、`model`、可选 `tools`/`sandbox`/`skills` | `id` 与界面「职务」一一对应；展示名可 i18n |
| **主会话窗口** | 用户选定的 **default agent**（或显式「总经理」agent）的 **主会话** `sessionKey` | 与 [Session](https://docs.openclaw.ai/concepts/session) 一致；具体 key 以 `sessions.list` 为准 |
| **职务聊天表面** | 同一 `agentId` 下用户选择的会话，或固定为该 agent 的 main session | MVP 建议：**每职务面板默认对应该 agent 的 main** |
| **公司规则** | 各 agent 的 `AGENTS.md`/`SOUL.md`、以及 `tools`/`sandbox`/`groupChat` 等配置片段 | 可向导化编辑；写入 workspace 文件或 `config.patch` |
| **职务 A → 职务 B 的线（未来）** | 非独立官方图结构；编译为 **`tools.agentToAgent.allow` 允许的协作关系** 或依赖 **会话工具** 的策略 | 见 [Multi-Agent Routing](https://docs.openclaw.ai/concepts/multi-agent) 中 `tools.agentToAgent` 示例 |

**重要约束（官方语义）**

- 多 Agent **默认隔离**；跨 Agent 对话需 **显式开启** `tools.agentToAgent` 等（见 [Multi-Agent Routing](https://docs.openclaw.ai/concepts/multi-agent)）。
- `bindings` 为 **入站路由**（渠道/账号/peer → `agentId`），与「职务之间拉线」是不同层；**拉线是 DidClaw 对配置的可视化编辑**，必须编译成官方字段。

---

## 4. UI 方案

### 4.1 仪表盘浮窗 + 组织图

- **形态**：单应用内 **顶层浮层**（或 Tauri 子窗口，见 §5.2），展示当前「公司」内职务节点；支持折叠/固定。
- **交互**：点击节点 → 打开/聚焦对应 **职务聊天面板**；提供 **「打开全部职务」**（批量展开，注意性能与可读性）。
- **组织图边（MVP）**：可用 **模板** 表示扁平/金字塔（仅视觉或弱编辑）；**自由拉线** 推迟到 Phase 2，编译目标为 §3 表中 `agentToAgent` / 会话策略。

### 4.2 主会话 + 多职务面板

- 与产品原型一致：**左侧主会话** + **右侧多块职务区域**（栅格或可调整 dock）。
- 每块区域：**独立会话上下文**（独立 `sessionKey` 或固定 main）、复用现有消息列表/Composer/流式逻辑。

### 4.3 普通用户降噪

- 默认 **仅主会话 + 1～2 个职务**；其余职务在组织图内 **折叠** 或 **未打开面板**。
- 「成立公司」向导：步骤与产品五步法一致，每步 **仅暴露少量字段**，高级项折叠。

---

## 5. 技术架构要点（DidClaw）

### 5.0 仓库现状：`openclaw.json` / `agents`（截至 2026-04-04，随代码更新）

- **已有**：Tauri 侧 `openclaw_providers`、`openclaw_model_config`、`openclaw_channel_config`，以及配置 **备份/恢复** 等；命令注册在 **`didclaw-ui/src-tauri/src/commands.rs`** 与 **`lib.rs`**。
- **`agents.list`（已落地）**：模块 **`openclaw_agents_config.rs`** — **`read_open_claw_agents_list`**（返回 `{ ok, list }`）、**`write_open_claw_agents_list_merge`**（`payload.agents` 为对象数组，按 `id` 覆盖或追加；写前备份 `openclaw.json`）。
- **Gateway**：**`config.get` / `config.patch`**（与官方 [Config RPC](https://docs.openclaw.ai/gateway/configuration#config-rpc-programmatic-updates) 一致；需 `baseHash`、权限与限频）；**已接** `GatewayClient`（向导优先）；与 Rust 合并并存为回退。

### 5.1 Gateway 连接

- **一条** `GatewayClient` WebSocket；所有职务面板共享，按 `sessionKey` 区分 `chat.send` / `chat.history` / 事件过滤。
- 参考：[`gateway-client-protocol-notes.md`](./gateway-client-protocol-notes.md)；扩展 `sessions.*` 前更新 Zod/校验与上游 TypeBox。

### 5.2 窗口形态建议

| 阶段 | 建议 |
|------|------|
| **MVP** | **单 Tauri 主窗口 + 内嵌可拖拽面板 / 浮层**；状态集中在 Pinia（或等价），避免多 WebView 同步问题。 |
| **后续** | 可选 **职务面板 detach 为子窗口**（第二块屏需求）；需设计 **跨窗口状态同步**（Tauri event / 共享 store）。 |

### 5.3 配置写入策略

- **优先**：调用网关 **`config.patch`**（若客户端已具备权限与 `baseHash` 流程），与 [Config RPC](https://docs.openclaw.ai/gateway/configuration#config-rpc-programmatic-updates) 一致；注意 **速率限制**（文档：每 deviceId+clientIp 每 60 秒 3 次等，以线上为准）。
- **备选**：与现有桌面能力一致时，经 Tauri **读写 `openclaw.json`**（合并规则与备份策略对齐 `openclaw_providers.rs` 等现有实现），并提示用户 **热重载**（见 [Config hot reload](https://docs.openclaw.ai/gateway/configuration#config-hot-reload)）。
- **禁止**：单独维护一份与 `openclaw.json` 长期分叉的「公司私有协议」而不提供 **导出为标准配置** 的路径。

### 5.4 「公司」向导 → JSON 编译器

- 输入：向导表单 + 模板（扁平/金字塔…）。
- 输出：`agents.list` 增量、`bindings`（若向导包含通道绑定则需谨慎，MVP 可 **仅创建 agents，bindings 沿用现有通道设置或文档引导**）。
- 单元测试：对 **官方文档中的最小示例** 做 snapshot（结构合法、关键字段存在）。

---

## 6. 分阶段实施

### Phase 0 — 调研与冻结

- 精读 §2 链接；在目标 OpenClaw 版本上 **手配** 一组 `agents.list` + `bindings`，用现有 DidClaw **会话列表**验证多 `sessionKey` 可切换聊天（**团队环境回归**，**未完成 = 非代码项，按需执行**）。
- 更新 [`gateway-client-protocol-notes.md`](./gateway-client-protocol-notes.md) 中与本功能相关的说明（**多表面 chat / agent** + **`config.get`/`config.patch`** + **桌面 IPC agents**，2026-04-04 已更新）。✅

### Phase 1 — MVP（建议范围）— **代码交付：已完成**

- **UI + 本地向导**：**`CompanyAgentsHubDialog`** 合并 **`agents.list`**（workspace 等字段与官方一致）；**不实现**自由组织图拉线。✅  
  - *说明*：与 **§4.3「五步成立公司」** 完整分步 UI 相比，当前为 **单页表格合并**，属 MVP 范围；完整向导归 Phase 2。
- **主会话 + N 职务侧栏**：**`RoleChatColumn`** + **`companyRolePanels`**；**`chat` store** 按 `sessionKey` 分表面；默认 **`agent:<id>:main`**；**职务列头下拉**从 **`sessions.list`**（`allSessions`）筛选 `agent:<该 id>:*` 并切换绑定（`setPanelSessionKey`）。✅
- **仪表盘（列表）**：顶栏打开完整向导；**右下角「组织/职务」浮层**列出已开列与配置中 agents、一键开向导。✅（**§4.1 组织图模板/可编辑边**：未做，Phase 2）
- **配置写入**：**Gateway `config.get` / `config.patch`**（已连接时优先；`lib/openclaw-gateway-config.ts`）+ **Rust 合并回退** + 热重载与 **网关/本地** 成功提示区分 + **hash 过期 / 校验失败 / 限流** 等错误文案。✅
- **§5.4 单测**：以官方最小示例为 snapshot 的 **JSON 编译器单测** — **尚未添加**（可选后续，不阻塞 Phase 1 代码闭环）。

### Phase 2 — 增强

- **职务间协作可视化**：边 → `tools.agentToAgent` 编译；预设模板（仅主连子、全连接白名单等）。
- **与通道向导结合**：在理解 [Channel routing](https://docs.openclaw.ai/channels/channel-routing) 前提下，向导内编辑 **bindings**（高风险，需充分校验与回滚）。
- **可选子窗口**：detach 职务面板。

### Phase 3 — 可选

- 与 [Sub-Agents](https://docs.openclaw.ai/tools/subagents) / 后台任务形态结合；会话工具高级编排（需单独安全评审）。

---

## 7. 风险与依赖

| 风险 | 缓解 |
|------|------|
| 官方配置 schema 变更 | §2 文档 + 发行说明 + `config.patch` 错误处理；DidClaw 版本说明中标注 **最低 OpenClaw 版本** |
| `config.apply` 全量替换误用 | 禁止向导默认走全量；优先 patch 或结构化合并 |
| 多面板同时流式 | 事件按 `sessionKey` 路由；单连接下注意 store 隔离与性能 |
| 用户误开「全职务可互聊」 | 默认关闭 `agentToAgent`；高级项强提示并链 [Security](https://docs.openclaw.ai/gateway/security) |

---

## 8. 验收要点（MVP）

以下 **不自动化替代**：需在团队选定的 OpenClaw + DidClaw 桌面环境中 **人工或半自动** 执行并记录结果。

| 要点 | 说明 |
|------|------|
| 配置合法 | 向导 / 合并写入后的 `agents.list` 可被 **`openclaw agents list --bindings`**（或等价）识别；Gateway **无启动错误**。 |
| 多表面隔离 | 主会话与至少 **两个职务** 面板可同时收发信息，且 **互不串会话**（`sessionKey` 与 UI 一致）。 |
| 写入路径 | 已连 Gateway 时 **`config.patch`** 成功或合理报错（刷新后重试）；离线仅桌面时 **Tauri 合并** 成功且文件有备份。 |
| 升级韧性 | 升级 OpenClaw 小版本后，在 §2 无 Breaking 声明场景下 **无需改 DidClaw 核心映射逻辑**（仅可能调整 patch 字段名）。 |

---

## 9. 修订记录

| 日期 | 作者/角色 | 说明 |
|------|-----------|------|
| 2026-04-04 | 方案草案 | 首版：产品隐喻、官方索引、映射表、分阶段与风险 |
| 2026-04-04 | 修订 | 增加 §5.0：Tauri 侧已有 openclaw_* 模块与 `agents.list` 缺口、MVP 写入路径（config.patch / Rust 合并） |
| 2026-04-04 | 实施 | §5.0 / Phase 1：`openclaw_agents_config`、多表面 `chat` store、职务列 UI、向导浮窗、组织浮层；简报 §6 进度同步 |
| 2026-04-04 | 实施 | 职务列 **`sessions.list` 会话下拉**（`agent-session-key` + `setPanelSessionKey`） |
| 2026-04-04 | 实施 | **`config.get` / `config.patch`** 接入向导（`openclaw-gateway-config.ts`）；hash/校验/限流提示与网关/本地成功文案区分 |
| 2026-04-04 | 文档 | **Phase 1 代码闭环**：更新简报 §6 结论表；spec 状态行、Phase 1 说明、§8 验收表；明确与 §4 完整向导/组织图的差距 |

---

*若本文与官方文档冲突，以官方文档与运行中 Gateway 行为为准。*
