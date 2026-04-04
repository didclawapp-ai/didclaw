# Gateway 客户端协议笔记（didclaw）

> 与 OpenClaw Gateway **WebSocket** 对接时的**版本化**备忘。升级 OpenClaw 后务必更新本文件并跑回归。  
> 主方案：`OpenClaw-顶层界面-开发方案.md`（§3.5、§9、§11）。  
> 部署与冒烟：`didclaw-内网部署.md`。

## 当前锁定版本

| 项 | 值 |
|----|-----|
| OpenClaw Gateway 版本 | npm `openclaw` 当前 **latest** 为 **2026.3.31**（[GitHub Release](https://github.com/openclaw/openclaw/releases) 2026-03-31）；本地 `openclaw-src` 以检出/tag 为准（**以实际 `openclaw --version` / 运行为准**） |
| didclaw 包版本 | 见 `didclaw/package.json` `version`（构建时写入 `__APP_VERSION__`） |
| 本笔记最后更新 | 2026-04-04 |
| 验证人 | （团队填写） |

## 连接参数

| 项 | 示例 / 说明 |
|----|----------------|
| WebSocket URL | `ws://127.0.0.1:18789`（以实际 `gateway.port`、`gateway.bind` 为准） |
| 鉴权 | `connect.params.auth.token` 或 `password`（与官方 Control UI 对齐） |
| 客户端标识 | `openclaw-control-ui`，`mode`: `webchat`（见 `gateway-types.ts`） |
| 开发联调 | 主方案 §3.4（Vite 与 Gateway 分端口）；安全上下文见 `didclaw/README.md` |

## 已实现 RPC（客户端 → Gateway）

| 方法 | 用途 | 请求 params 摘要 | 响应摘要 | Zod 校验 |
|------|------|------------------|----------|----------|
| （隐式）`connect` | 握手 hello | 由 `GatewayClient` 组装 auth、client、device 等 | `hello-ok` 等 | `gatewayHelloOkSchema`（`schemas.ts`） |
| `sessions.list` | 会话列表 | `includeGlobal`, `includeUnknown` | `sessions[]`：`key` 必填 | `sessionsListResponseSchema` |
| `chat.history` | 历史消息 | `sessionKey`, `limit`（didclaw 默认见 `didclaw-ui/src/lib/chat-history-config.ts`） | `messages[]`：见下「与官方 Control UI」 | `chatHistoryResponseSchema` |
| `chat.send` | 发送并触发 Agent | `sessionKey`, `message`, `deliver`, `idempotencyKey`，可选 **`attachments`**、**`thinking`**、**`timeoutMs`** 等（以网关 `validateChatSendParams` / TypeBox 为准）；**根级无 `model`**（模型由网关按 `openclaw.json` / 会话解析） | 依网关版本而定 | 未强校验（仅用 `request` 成功/失败） |
| `chat.abort` | 中断生成 | `sessionKey`，可选 `runId` | 依网关版本而定 | 未强校验 |
| `cron.status` | 调度器摘要 | `{}` | `enabled`、`jobs`、`nextWakeAtMs` 等 | 未强校验（`CronJobsDialog`） |
| `cron.list` | 定时任务列表 | 与官方 Control UI 对齐：优先 `enabled: "all"`、`includeDisabled: true`、`limit`、`offset`、`sortBy`、`sortDir`；旧网关失败时回退为 `{ enabled: "all", limit: 200 }`（可选 `offset`） | 多为 `{ jobs, total, hasMore, nextOffset, ... }` 或数组；**didclaw** 宽松解析 | 未强校验（`CronJobsDialog`） |
| `cron.runs` | 运行历史 | `scope`（`all` \| `job`）、`id`（`scope=job` 时）、`limit`、`offset`、`sortDir` 等 | `{ entries, total, hasMore, ... }`；**didclaw** 解析 `entries` 等键 | 未强校验 |
| `cron.add` | 新建任务 | 见 [定时任务](https://docs.openclaw.ai/zh-CN/automation/cron-jobs)：`schedule`（`at` / `every` / `cron`）、`sessionTarget`、`payload`、`delivery` 等 | 依网关版本而定 | 未强校验 |
| `cron.update` | 更新任务 | **`id`**（与官方 UI 一致）、`patch`（如 `enabled`） | 依网关版本而定 | 未强校验 |
| `cron.remove` | 删除任务 | **`id`** | 依网关版本而定 | 未强校验 |
| `cron.run` | 立即运行 | **`id`**，可选 `mode: "force"` | 依网关版本而定 | 未强校验 |
| `config.get` | 读取脱敏配置快照 | `{}`（以网关 `validateConfigGetParams` 为准） | 含 **`hash`**（供 `config.patch` 的 `baseHash`）、**`config`**（脱敏对象）等；与上游 `redactConfigSnapshot` 一致 | 未强校验（`openclaw-gateway-config.ts` 宽松解析） |
| `config.patch` | 合并补丁写 `openclaw.json` | **`raw`**（JSON5 兼容字符串，对象）、**`baseHash`**（须与最近一次 `config.get` 的 `hash` 一致）；可选 **`sessionKey`**、`note`、`restartDelayMs` | 成功体含 `ok`、`path`、`config`（脱敏）等；可能触发网关重启（见官方 Config RPC） | 未强校验 |

未实现：`chat.inject` 等，需要时在表中增行并补 Zod。

## DidClaw 桌面 IPC（非 Gateway WebSocket）

多 Agent / 「公司制」向导：**已连接 Gateway 时**优先 **`config.get` → `config.patch`** 合并 `agents.list`（与网关 `mergeObjectArraysById` 一致）；失败或未连接时回退为 Tauri 直写 **`openclaw.json`**。

| Tauri 命令 | 用途 |
|------------|------|
| `read_open_claw_agents_list` | 返回 `{ ok, list }`，`list` 为 `agents.list` 数组（缺文件时 `ok: true, list: []`） |
| `write_open_claw_agents_list_merge` | `payload: { agents: [...] }`，每项须含 `id`；按 `id` **字段级合并**已有项并保留 OpenClaw 其它键；写前备份 `openclaw.json`；成功后对 **per-agent auth** 执行与官方 [Multi-Agent](https://docs.openclaw.ai/concepts/multi-agent) 一致的 **main → 子 agent 复制 `auth-profiles.json`**（仅当子 agent `profiles` 为空或文件缺失，写前备份） |
| `sync_openclaw_subagent_auth_profiles_from_main` | 仅同步凭据：按当前 `openclaw.json` 的 `agents.list`，将 **`agents/main/agent/auth-profiles.json`** 复制到需补全的子 agent（同上条件）；供 **仅 `config.patch` 写入列表** 后前端再调一次 |

实现：`didclaw-ui/src-tauri/src/openclaw_agents_config.rs`。前端：`CompanyAgentsHubDialog` + `lib/openclaw-gateway-config.ts` + `getDidClawDesktopApi().readOpenClawAgentsList` / `writeOpenClawAgentsListMerge` / `syncOpenclawSubagentAuthProfilesFromMain`。

**官方依据**：OpenClaw 文档明确 **Auth profiles are per-agent**、**Main agent credentials are not shared automatically**；若需共用，**copy `auth-profiles.json` into the other agent's agentDir** — DidClaw 自动复制即实现该步骤，而非替代 `openclaw.json` schema。

### 网关主动推送（WebSocket `type: "event"`）

| `event` | didclaw 行为 | 官方 Control UI 参考 |
|---------|--------------|----------------------|
| `chat` | `useChatStore().handleGatewayEvent`：**主会话 + 已打开职务列**的 `sessionKey` 在 **`trackedSessionKeys`** 内时，只更新对应 **chat 表面**，不抢主会话；否则沿用原逻辑（异会话可自动跟随或节流 `sessions.refresh`）。流式/终态对该键 `loadHistory({ silent, sessionKey })` | `app-gateway.ts` → `handleChatGatewayEvent` |
| `sessions.changed` | **`sessions.refresh()`** + **`chat.loadHistory({ silent: true })`** | `loadSessions` |
| `agent` | 工具时间线（`toolTimeline`）；**若 `payload.sessionKey` 与当前选中会话一致**，didclaw **节流** `chat.history(silent)`；**若该 key 为已打开职务列**（`companyRolePanels`），对**该 key** 节流 `loadHistory(silent)`，**不**自动 `selectSession`（部分网关不下发 `chat` 时对齐侧栏时间线） | `handleAgentEvent`（工具流、compaction 等） |
| `cron` | didclaw **节流** `chat.history(silent)`（同上，与官方仅刷新 Cron 页不同） | 官方：`host.tab === "cron"` 时 `loadCron` |
| 其他 | `toolTimeline` 合并展示；调试日志见 DEV `console.debug` | 略 |

**推送排障日志**：`didclaw-ui/src/lib/gateway-debug-log.ts`。控制台过滤 **`[didclaw][gateway-push]`**；生产包执行 `localStorage.setItem("didclaw_debug_gateway","1")` 后刷新可打开（`"0"` 在开发构建下可关闭）。

**说明**：若某网关版本对 `webchat` 模式未开放 `cron.*`，界面会显示 RPC 错误；桌面壳使用 `ui` 模式时通常与官方 Control UI 能力更接近。详见官方 [定时任务](https://docs.openclaw.ai/zh-CN/automation/cron-jobs）。

### `chat.history` 与官方 Control UI（排序与时间）

上游 OpenClaw（参考 `ui/src/ui/controllers/chat.ts`）：

- **`loadChatHistory`**：将 `chat.history` 返回的 `messages` **原样**赋给界面（仅过滤静默助手回复），**不做客户端重排**。
- **本地追加**：用户发送、流式兜底等会带 **`timestamp: Date.now()`**（毫秒）。

网关侧（参考 `src/gateway/server-methods/chat.ts`）：

- 从会话 transcript 读出消息后 **`slice(-limit)`** 截最近 N 条，再经裁剪/脱敏后返回；条目中 **`timestamp` 一般为 number（毫秒）**。DidClaw 客户端将单次请求的 `limit` 配置为 **500**（`CHAT_HISTORY_LIMIT`），在网关未提供游标分页前减轻长会话截断；若上游对 `limit` 有硬顶则以其为准。

**didclaw**：在 `loadHistory` 内对 `messages` 调用 `sortHistoryMessagesOldestFirst`（`lib/chat-history-sort.ts`）：若每条都能解析时间则按 `timestamp` 升序；否则仅在「首尾时间倒置」时整体 `reverse`，以兼容异常顺序。列表行在 `messageToChatLine` 中展示与官方类似的 **本地 `HH:mm`**（来自 `timestamp`）。

## 下行事件（Gateway → 客户端）

| 事件 | 用途 | 载荷摘要 | UI 行为 |
|------|------|----------|---------|
| `connect.challenge` | 设备签名 nonce | `nonce` | `GatewayClient` 内部消费 |
| `chat` | 流式与终态 | 见下表 | `chatEventPayloadSchema` 校验通过后更新 `chat` store |
| `exec.approval.requested` | 宿主机命令待审批 | `{ id, request, createdAtMs, expiresAtMs }` | `approval` store 入队；弹窗展示 `request.command` 等 |
| `exec.approval.resolved` | 审批已处理 | 含 `id`、`decision` 等 | 按 `id` 从审批队列移除（与别处 `/approve` 同步） |
| 其他 | 工具/Agent 等 | 因版本而异 | DEV `console.debug`；`toolTimeline` 展示（按 `sessionKey` 过滤） |

**Exec 审批（运维要点）**：网关在发出 `exec.approval.requested` 后，若当时**没有任何**已连接客户端带有 `operator.admin` 或 `operator.approvals`，会立刻将该请求记为 **no-approval-route** 并过期；UI 仍可能短暂收到广播，但 `exec.approval.resolve` 会返回 `unknown or expired approval id`。DidClaw 建连时已请求 `operator.approvals`；若设备配对记录里从未包含该 scope，需完成一次 **scope 升级配对** 或保持本客户端在跑命令前已连接网关。另据上游 `exec-approvals` 文档，**`allow-always` 持久化的是“已解析到的可执行文件路径”**；若命令属于 shell 语法 / shell wrapper / PowerShell cmdlet（如 `Get-ChildItem`），且上游无法安全解包到稳定的二进制路径，则**不会自动写入 allowlist**，后续同类命令仍可能继续弹审批。

### `chat` 事件载荷（校验用）

| 字段 | 类型 | 说明 |
|------|------|------|
| `sessionKey` | string | 必填 |
| `state` | `delta` \| `final` \| `aborted` \| `error` | 必填 |
| `runId` | string | 可选 |
| `message` | unknown | `delta` 时取展示文本；亦可能仅在顶层带 `text` / `textDelta` / `content` 等（passthrough） |
| （实现说明） | — | 流式：`mergeAssistantStreamDelta` 区分全文快照与增量追加。历史：`chat.history` 若早于 user 落库则条数少于本地，`incoming.length < previous.length` 时拼回 `_didclawOptimistic` user，避免只剩「正在生成」占位 |
| `errorMessage` | string | `error` 时展示 |

## 与官方文档差异

| 主题 | 官方文档说法 | 本客户端实际行为 / 差异 |
|------|----------------|-------------------------|
| 下行事件全集 | 以官方为准 | 非 `chat` 事件仅时间线 + DEV 日志，未做全量 Zod |

## Zod / schema 索引

| 载荷 | 代码路径 |
|------|----------|
| `connect` hello 成功体 | `didclaw/src/features/gateway/schemas.ts` → `gatewayHelloOkSchema` |
| `sessions.list` 响应 | `sessionsListResponseSchema` |
| `chat.history` 响应 | `chatHistoryResponseSchema` |
| 下行 `chat` 事件 | `chatEventPayloadSchema` |
| 右栏 `echarts-json` | `didclaw/src/lib/echarts-option-schema.ts` |

## 变更日志（协议相关）

| 日期 | OpenClaw 版本 | 变更摘要 |
|------|-----------------|----------|
| 2026-03-20 | 参考 2026.3.14 | 阶段 E：核心 RPC/事件 Zod、错误中文映射、诊断复制、部署文档 |
| 2026-04-04 | （同锁定表） | 多 Agent MVP：**按 `sessionKey` 分 chat 表面**（主会话 + 职务侧栏）；`chat` / `agent` 推送行为见上表；**Tauri** `read_open_claw_agents_list` / `write_open_claw_agents_list_merge` 记入本文（非 Gateway RPC）。 |
| 2026-04-04 | （同锁定表） | **公司向导**：接 **`config.get` / `config.patch`** 写入 `agents.list`（Gateway 优先，Tauri 回退）；见上表 RPC 行与 `openclaw-gateway-config.ts`。 |
| 2026-04-01 | npm **2026.3.31** | 上游 [Latest](https://github.com/openclaw/openclaw/releases) 已推进至 2026.3.31；DidClaw 侧已确认 `exec.approval.requested` 仍为 `{ id, request, createdAtMs, expiresAtMs }`，命令详情在 `request` 内（与 2026.3.22 行为一致）。 |
| 2026-03-23 | npm **2026.3.22**（相对 **2026.3.13**） | 上游约一周内有大量提交；与 LCLaw 最相关：**网关启动**改为从已编译 `dist/extensions` 加载捆绑插件（冷启动明显加快，见上游 CHANGELOG `Gateway/startup`）；文档强调 `controlUi.allowedOrigins` 勿滥用 `["*"]`；另有大量插件迁移、exec 审批、Breaking（如弃用 `CLAWDBOT_*` / `.moltbot` 等）。完整差异见 [compare 61d171a…e7d11f6](https://github.com/openclaw/openclaw/compare/61d171ab0b2fe4abc9afe89c518586274b4b76c2...e7d11f6c33e223a0dd8a21cfe01076bd76cef87a)（npm 2026.3.13 与 2026.3.22 对应提交）。 |
| 2026-03-21 | openclaw `main` `chat.ts` | 确认 `chat.send` 无根级 `model`；didclaw 不再随请求附带 `model` |
| 2026-03-21 | [Configuration / hot reload](https://docs.openclaw.ai/gateway/configuration#config-hot-reload) | Gateway 监视 `openclaw.json`；`agents`/`models` 表列为可热更新；`gateway.reload.mode: off` 时需手动重启；UI 保存后提示用户 |

---

*文档结束。*
