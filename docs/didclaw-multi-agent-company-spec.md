# DidClaw「公司制多 Agent」方案与实施

> **状态**：**Phase 1（MVP）代码与主文档已落地**（2026-04-04）；**人工验收（§8）与 Phase 0 手配回归**仍建议在目标环境执行。**Phase 2 方案已扩写（§6）**，实现未开始。  
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
- **`agents.list`（已落地）**：模块 **`openclaw_agents_config.rs`** — **`read_open_claw_agents_list`**（返回 `{ ok, list }`）、**`write_open_claw_agents_list_merge`**（`payload.agents` 为对象数组，按 `id` **字段级合并**已有项并保留 OpenClaw 其它键；写前备份 `openclaw.json`）。
- **Gateway**：**`config.get` / `config.patch`**（与官方 [Config RPC](https://docs.openclaw.ai/gateway/configuration#config-rpc-programmatic-updates) 一致；需 `baseHash`、权限与限频）；**已接** `GatewayClient`（向导优先）；与 Rust 合并并存为回退。
- **Auth profiles（与官方 [Multi-Agent Routing](https://docs.openclaw.ai/concepts/multi-agent) 一致）**：凭据按 **agent 隔离**，每个 agent 只读自己的 **`~/.openclaw/agents/<agentId>/agent/auth-profiles.json`**；**主代理凭据不会自动下发**到子 agent；官方说明若要在多 agent 间共用 Key，应 **把 `auth-profiles.json` 复制到目标 agent 的 agentDir**（且勿错误复用 `agentDir` 以免会话/鉴权冲突）。DidClaw **不另造协议**：在合并保存 **`agents.list`** 之后（Tauri 写入成功，或仅 Gateway 保存时随后调用桌面 IPC），对 `agents.list` 中 **非 `main`、且 `profiles` 为空或文件缺失** 的 id，自动执行与官方相同的 **从 `main` 复制整份 `auth-profiles.json`**（写前备份已有文件）。推荐工作流仍可与 CLI 并用：例如 `openclaw agents add <id>` 生成目录与工作区后，再在 DidClaw 向导中合并列表并保存以触发同步（或手动 copy，与文档一致）。

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

### Phase 2 — 职务互联与「无人公司」闭环（**关键；相对 Phase 1 为能力补全**）

> **产品断层（Phase 1 已暴露）**：多列 UI 仅提供 **并列会话**；主 agent 在自然语言里说「已发通知」**不会**自动写入子 agent 会话。要实现「开无人公司」——**总经理发指令、职务 agent 侧可核验、可继续执行**——必须让运行时走 **OpenClaw 官方支持的跨 agent / 跨会话机制**，而不是再叠一层 DidClaw 私有总线。

#### 2.0 目标定义（验收口径）

| 能力 | Phase 1 | Phase 2 目标 |
|------|---------|----------------|
| 多职务并排聊天 | ✅ 用户可切换列、各 `sessionKey` 隔离 | 保持 |
| 主会话「叙事」通知子职务 | ⚠️ 仅为模型幻觉式描述 | ❌ 不足；需 **可验证的侧效果** |
| 主 → 子 的真实投递 | ❌ | ✅ 仅通过 **官方配置 + 网关工具** 实现；子 agent 会话 **history 中可出现** 可归因于工具调用的内容（具体形态以 OpenClaw 当前实现为准） |
| 拓扑可编辑、可落盘 | ❌ | ✅ 与 `agents.list` **同一写入路径**（`config.patch` 优先，Tauri 合并回退），可导出为标准 `openclaw.json` 片段 |

#### 2.1 官方能力锚点（实施前在目标版本上 **重读并重做最小实验**）

以下顺序为 **建议阅读 → CLI/手配验证**；字段名以当时文档与网关行为为准。

1. **[Multi-Agent Routing](https://docs.openclaw.ai/concepts/multi-agent)** — **`tools.agentToAgent`**（allow/deny、方向、与多 agent 隔离的默认策略）。**首选**作为「总经办 → 职务」投递的主机制。
2. **[Session tools](https://docs.openclaw.ai/concepts/session-tool)** — 如向其它会话 **发送/列出/读历史** 等能力（具体方法名以当时网关 RPC 与文档为准）：在 `agentToAgent` 不足以覆盖产品语义时，作为 **显式跨 `sessionKey` 写入** 的补充（需严格权限与审计认知）。
3. **[Multi-Agent Sandbox & Tools](https://docs.openclaw.ai/tools/multi-agent-sandbox-tools)** — 各 agent 的 **`tools.allow` / `tools.deny` / `sandbox`**：编译拓扑时必须 **不放宽** 用户未授权的能力。
4. **[Configuration reference](https://docs.openclaw.ai/gateway/configuration-reference)** — `agents`、`tools`、`bindings` 等 **字段级** 细节与默认值。
5. **[Channel routing](https://docs.openclaw.ai/channels/channel-routing)** — **bindings** 仍为 **入站** 路由；与「职务间互发」不同层，但 **Phase 2 可选** 做向导化（见 2.5）。

**冻结产出**：在团队选定的 OpenClaw 版本上，完成 **一条** 可重复的「main → sales」成功投递最小配置 + 截图/笔记（写入 `gateway-client-protocol-notes.md` 或本仓库 wiki，避免口口相传）。

#### 2.2 里程碑（建议实现顺序）

**Milestone 2.1 — 调研冻结**（阻塞后续开发）

- 用官方 CLI / 手写 JSON 验证：`tools.agentToAgent` **最小 allow 集** 下，main 中模型 **实际调用** 工具后，sales（或等价子 agent）会话 **可见变化**。
- 若上游以 **session 工具** 为主路径，同样做 **最小 E2E**，并记录 **与 agentToAgent 的取舍**（写进本文 §6.2 脚注或 `gateway-client-protocol-notes.md`）。
- 核对 [Config hot reload](https://docs.openclaw.ai/gateway/configuration#config-hot-reload)：拓扑变更后是否需重启网关；DidClaw 提示文案对齐。

**Milestone 2.2 — 拓扑 → 配置编译器（DidClaw 核心后端逻辑）**

- **输入**：DidClaw 内部 **有向边** 模型 `fromAgentId` → `toAgentId`（可选：`label`、`policy` 占位，但 **落盘仅官方字段**）。
- **输出**：合并写入 **`openclaw.json`（及网关可见的等价结构）** 中的 **`tools.agentToAgent`**（及必要的 per-agent `tools` 片段），**禁止**引入私有键名。
- **预设模板**（降低用户成本）：例如 **星型（仅 main→各子）**、**主↔子双向白名单**、**全连接（强危险，默认关闭 + 二次确认）**；自定义边表需 **边数上限** 与循环检测（产品层防误配）。
- **测试**：对官方文档 **最小 JSON 片段** 做 **snapshot / 结构断言**；编译器 **round-trip**（边表 → JSON → 边表）在单测中覆盖。

**Milestone 2.3 — UI：组织图与协作拓扑**

- **§4.1 未竟部分**：组织图 **边** 可编辑（可先 **模板 + 下拉** 再 **拖拽**）；与 **`CompanyAgentsHubDialog`** 或独立 **「协作拓扑」** 对话框联动保存。
- **用户可见说明**（必填）：明确区分 **「仅并列聊天」** 与 **「已启用职务间官方协作」**；未启用时，主会话中的「已通知某职务」**不应被产品文案暗示为真**（可选：主会话内轻提示「职务间投递需在协作拓扑中开启」—— copy 与 i18n 另列）。
- 与 **职务列** 联动：保存拓扑后提示 **热重载 / 重启网关**（行为以 2.1 冻结结果为准）。

**Milestone 2.4 — 可观测性（增强信任，非阻塞闭环）**

- 当网关事件可区分 **跨 agent 工具结果** 时，主会话或全局 **简短提示**（不泄露密钥）。
- 职务列：若技术上可靠，可对 **非用户手打的 inbound** 做轻量标记（需避免误报；做不到则仅文档说明「到子 agent 列查看 history」）。

**Milestone 2.5 — bindings 向导化（可选；高风险）**

- 在理解 [Channel routing](https://docs.openclaw.ai/channels/channel-routing) 前提下，于向导 **高级** 区提供 **bindings** 编辑：**强校验、写前备份、回滚提示**；默认不引导新手修改。
- **与 2.2 的关系**：bindings 解决 **渠道进来找谁**；**不替代** agentToAgent / session 工具解决 **职务间互发**。

**Milestone 2.6 — 子窗口 detach（可选）**

- **§5.2**：职务面板 **Tauri 独立窗口** + **Pinia / Tauri event** 状态同步；与 Phase 2 闭环 **无硬依赖**，可并行排期。

#### 2.3 Phase 2 验收要点（建议写入测试清单）

| # | 场景 | 期望 |
|---|------|------|
| A | 仅开启 **main→sales** allow；用户在 **main** 发出「请通知 sales：……」类指令（具体措辞以模型为准） | **不得** 要求用户同时打开 sales 列打字；sales 绑定会话的 **history** 中出现 **可归因于官方工具链** 的新增内容（与 2.1 冻结形态一致） |
| B | 关闭或收紧 `agentToAgent` 后重复 A | **不应** 出现跨会话注入 |
| C | 配置经 **Gateway `config.patch`** 与 **仅 Tauri 写入** 各测一遍 | 网关与磁盘上 **拓扑语义等价**（允许 hash/格式差异，不允许语义分叉） |
| D | 安全默认 | 新用户/新向导默认 **非全互聊**；开启全连接需 **确认 + [Security](https://docs.openclaw.ai/gateway/security) 链接** |

#### 2.4 与 Phase 3 边界

- **Phase 2**：**同步/近实时**「把一句话或任务投递到另一职务会话」+ **拓扑配置 UI** + 可选 bindings、detach。
- **Phase 3**：[Sub-Agents](https://docs.openclaw.ai/tools/subagents)、**Cron / 班表式** 无人值守、多步编排与更长周期任务；**需单独安全与配额评审**。

### Phase 3 — 可选

- 在 Phase 2 闭环稳定后：与 [Sub-Agents](https://docs.openclaw.ai/tools/subagents) / **Cron** / 后台任务形态结合；会话工具 **高级编排**（单独安全评审）。

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
| 2026-04-04 | 文档 | §5.0：对齐官方 **Multi-Agent** 中 **per-agent auth-profiles** 与「复制到另一 agentDir」做法；记录 DidClaw 在保存 `agents.list` 后的 **main → 子 agent** 自动复制行为 |
| 2026-04-04 | 文档 | **§6 Phase 2 扩写**：无人公司闭环（`agentToAgent` / session 工具）、里程碑 2.1–2.6、验收表、与 Phase 1 断层说明及 Phase 3 边界 |

---

*若本文与官方文档冲突，以官方文档与运行中 Gateway 行为为准。*
