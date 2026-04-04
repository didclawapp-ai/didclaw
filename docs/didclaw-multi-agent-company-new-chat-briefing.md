# 新对话用：DidClaw「公司制多 Agent」实现简报

> **用法**：在新 Cursor 窗口中打开本文件，**全选复制**到用户消息；或 `@` 引用本文件。  
> **仓库**：`F:\LCLAW`（根目录），客户端：`didclaw-ui/` + `didclaw-ui/src-tauri/`。  
> **原则**：**不 fork OpenClaw Gateway**；配置与行为 **严格对齐官方 multi-agent**，自研仅 DidClaw UI + 向导 + 配置合并/写入。

---

## 1. 产品目标（一句话）

让**普通用户**用「成立公司 → 职务 → 规则」隐喻使用 OpenClaw **官方多 Agent**（`agents.list` / `bindings` 等），主会话 + 多职务聊天表面；**不是**自造与网关无关的私有路由协议。

---

## 2. 权威方案文档（仓库内）

必读：**[`didclaw-multi-agent-company-spec.md`](./didclaw-multi-agent-company-spec.md)**（含官方文档链接表、概念映射、分阶段、风险）。

对齐总表：**[`didclaw-openclaw-alignment.md`](./didclaw-openclaw-alignment.md)**  
网关 RPC 笔记：**[`gateway-client-protocol-notes.md`](./gateway-client-protocol-notes.md)**  
上游能力清单：**[`openclaw-features.md`](./openclaw-features.md)**

---

## 3. 官方文档索引（修订时必查）

| 主题 | URL |
|------|-----|
| Multi-Agent Routing | https://docs.openclaw.ai/concepts/multi-agent |
| Gateway configuration（含 multi-agent routing 段） | https://docs.openclaw.ai/gateway/configuration |
| Configuration reference | https://docs.openclaw.ai/gateway/configuration-reference |
| Session | https://docs.openclaw.ai/concepts/session |
| Channel routing | https://docs.openclaw.ai/channels/channel-routing |
| Session tools | https://docs.openclaw.ai/concepts/session-tool |
| Sub-Agents | https://docs.openclaw.ai/tools/subagents |
| Multi-Agent Sandbox & Tools | https://docs.openclaw.ai/tools/multi-agent-sandbox-tools |
| Security | https://docs.openclaw.ai/gateway/security |

上游实现目录（diff 用）：`https://github.com/openclaw/openclaw/tree/main/src/gateway/server-methods`

---

## 4. 概念映射（实现时不得偏离）

| 产品 | 官方 |
|------|------|
| 职务 | `agents.list[]` 一项（`id`, `workspace`, `model`, …） |
| 主会话窗口 | 选定 agent 的 main session（`sessionKey` 以 `sessions.list` 为准） |
| 职务面板 | 同一 Gateway WS 上，按 **不同 `sessionKey`** 区分 `chat.history` / `chat.send` / 事件 |
| 公司规则 | workspace 内 `AGENTS.md`/`SOUL.md` + 各 agent 的 `tools`/`sandbox` 等配置 |
| 职务间「拉线」（后期） | 编译为 `tools.agentToAgent` 等**官方字段**，非私有图协议 |

**MVP**：向导生成/合并 **`agents.list`**；职务面板绑定各 `agentId` 的会话；**自由组织图拉线**可推迟。`bindings` 与通道强相关，MVP 可只做 agents + 文档引导，或分 Phase 2。

---

## 5. UI 与技术约定（来自已定方案）

- **单条** `GatewayClient` WebSocket；多面板共享连接，**按 sessionKey 隔离** store/事件。
- **MVP 窗口**：单 Tauri 主窗口内 **主会话 + 多职务面板** + **仪表盘浮窗（组织图/列表）**；可选后续 detach 子窗口。

### 5.1 `openclaw.json` / `agents` — 仓库现状（已核实，随实现更新）

- Tauri 侧**已有**：`openclaw_providers`、`openclaw_model_config`、`openclaw_channel_config`、备份/恢复等；入口 **`didclaw-ui/src-tauri/src/commands.rs`**、**`lib.rs`**。
- **`agents.list`（已实现）**：**`read_open_claw_agents_list`**、**`write_open_claw_agents_list_merge`**（`openclaw_agents_config.rs`，写前备份 `openclaw.json`，按 `id` 覆盖或追加）。
- **Gateway**：**`config.get` / `config.patch`** 已在向导中接入（`openclaw-gateway-config.ts`）；未连接或失败时回退 **Rust 合并**。详见 [`didclaw-multi-agent-company-spec.md`](./didclaw-multi-agent-company-spec.md) **§5.0**。
- **Auth profiles（官方 [Multi-Agent Routing](https://docs.openclaw.ai/concepts/multi-agent)）**：每 agent 独立 **`~/.openclaw/agents/<id>/agent/auth-profiles.json`**，主代理 Key **不自动共享**；官方推荐需共用时 **复制** 到子 agent 目录。DidClaw 在保存职务列表后，对凭据为空的子 agent **自动从 main 复制**（等价于文档中的 copy），实现见 **`sync_openclaw_subagent_auth_profiles_from_main`** / `write_open_claw_agents_list_merge` 尾部逻辑。

---

## 6. 建议实施顺序（含进度）

### 结论（截至 2026-04-04）

| 范围 | 状态 |
|------|------|
| **Phase 1 — 代码与文档（MVP）** | **已完成**：多表面 chat、`agents.list` 合并写入（Gateway 优先 + Tauri 回退）、职务列 UI、浮层、错误与成功提示文案。 |
| **Phase 1 — 验收** | **未替代人工**：见 spec **§8**（双职务不串会话、网关无报错、升级兼容等）需在目标 OpenClaw 环境跑一遍。 |
| **Phase 0 — 手配回归** | **仍建议**：团队在有真实 Gateway 的机器上勾选完成（非阻塞发版，但影响信心）。 |

### 与产品原型的差距（有意推迟，不算 Phase 1 欠账）

- Spec **§4** 中的 **「五步成立公司」完整向导**、**组织图模板（扁平/金字塔）**：当前实现为 **Hub 表格合并 + 右下角列表浮层**，属 **轻量 MVP**；完整步骤向导与可编辑组织图归 **Phase 2**。  
- **§5.4** 对官方最小示例的 **snapshot 单测**：仓库内 **尚未加**；可作为后续硬化工序。

---

1. **Phase 0 — 调研与冻结**  
   - [ ] （可选）在目标 OpenClaw 上手配 `agents.list` + `bindings`，用会话列表验证多 `sessionKey`。  
   - [x] 更新 **`gateway-client-protocol-notes.md`**：多表面、`config.get`/`config.patch`、桌面 IPC（已记）。  
   - *状态*：客户端与笔记已对齐；**手配回归**由团队按环境勾选。

2. **Phase 1 — MVP（代码）** — **全部完成**  
   - [x] 向导 / 浮窗合并写入 **`agents.list`**（`CompanyAgentsHubDialog` + Tauri merge）。  
   - [x] **主会话 + N 职务侧栏**：`RoleChatColumn` + `companyRolePanels` store，`chat` store 按 **`sessionKey` 分表面**；默认职务会话键 **`agent:<id>:main`**（与 `agent:main:main` 同模式）。  
   - [x] **顶栏入口**（盾牌图标）打开完整向导。  
   - [x] **职务仪表盘（列表）**：右下角可折叠 **组织/职务浮层**（已开列表面 + 配置中 agents 列表 + 打开向导）。  
   - [x] **`config.patch` / `config.get`**：已接 `GatewayClient`（保存/刷新 agents 优先）；未连接或失败时回退 Rust 合并；hash 过期 / 校验失败 / 限流等有用户可见文案。  
   - [x] 职务面板绑定 **从 `sessions.list` 选会话**（`RoleChatColumn` 下拉；默认 `agent:<id>:main`，可切到同 agent 下其它 key）。  

3. **Phase 2**：`agentToAgent` / bindings 向导化、拉线编译、detach 子窗口、五步向导与组织图模板等。

---

## 7. 新对话里需要先做的事（Agent 自检）

在改代码前在仓库内搜索并阅读：

- **`GatewayClient`**：**`config.patch` / `config.get`** 见 **`lib/openclaw-gateway-config.ts`** 与 **`CompanyAgentsHubDialog`**；写配置 **Gateway 优先**，回退 Tauri **`write_open_claw_agents_list_merge`**。Phase 1 代码已齐；**§6 结论表**区分「代码完成」与「人工验收」。
- **`agents.list`**：模块 **`openclaw_agents_config.rs`**、命令 **`read_open_claw_agents_list` / `write_open_claw_agents_list_merge`**；前端 **`CompanyAgentsHubDialog`**、**`desktop-api`**。
- **多表面**：**`stores/chat.ts`**（`surfaces` / `trackedSessionKeys`）、**`stores/companyRolePanels.ts`**、**`gateway-store-on-event.ts`**（职务列 `agent` 节流 history）；布局 **`AppShell.vue`** + **`RoleChatColumn.vue`**。

---

## 8. 用户原话（动机，可选）

多 Agent 目前偏开发者；希望 **普通用户也能在 OpenClaw 上「开公司」**，DidClaw 做降门槛壳层，对齐官方以便网关升级可跟。

---

*文件路径：`docs/didclaw-multi-agent-company-new-chat-briefing.md` — 与 spec 同步迭代时更新 §2–§7 即可。*
