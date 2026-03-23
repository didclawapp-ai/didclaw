# Gateway 客户端协议笔记（lclaw-ui）

> 与 OpenClaw Gateway **WebSocket** 对接时的**版本化**备忘。升级 OpenClaw 后务必更新本文件并跑回归。  
> 主方案：`OpenClaw-顶层界面-开发方案.md`（§3.5、§9、§11）。  
> 部署与冒烟：`lclaw-ui-内网部署.md`。

## 当前锁定版本

| 项 | 值 |
|----|-----|
| OpenClaw Gateway 版本 | npm `openclaw` 当前 **latest** 为 **2026.3.22**（2026-03-23）；本地 `openclaw-src` 以检出/tag 为准（**以实际 `openclaw --version` / 运行为准**） |
| lclaw-ui 包版本 | 见 `lclaw-ui/package.json` `version`（构建时写入 `__APP_VERSION__`） |
| 本笔记最后更新 | 2026-03-23 |
| 验证人 | （团队填写） |

## 连接参数

| 项 | 示例 / 说明 |
|----|----------------|
| WebSocket URL | `ws://127.0.0.1:18789`（以实际 `gateway.port`、`gateway.bind` 为准） |
| 鉴权 | `connect.params.auth.token` 或 `password`（与官方 Control UI 对齐） |
| 客户端标识 | `openclaw-control-ui`，`mode`: `webchat`（见 `gateway-types.ts`） |
| 开发联调 | 主方案 §3.4（Vite 与 Gateway 分端口）；安全上下文见 `lclaw-ui/README.md` |

## 已实现 RPC（客户端 → Gateway）

| 方法 | 用途 | 请求 params 摘要 | 响应摘要 | Zod 校验 |
|------|------|------------------|----------|----------|
| （隐式）`connect` | 握手 hello | 由 `GatewayClient` 组装 auth、client、device 等 | `hello-ok` 等 | `gatewayHelloOkSchema`（`schemas.ts`） |
| `sessions.list` | 会话列表 | `includeGlobal`, `includeUnknown` | `sessions[]`：`key` 必填 | `sessionsListResponseSchema` |
| `chat.history` | 历史消息 | `sessionKey`, `limit` | `messages[]`：见下「与官方 Control UI」 | `chatHistoryResponseSchema` |
| `chat.send` | 发送并触发 Agent | `sessionKey`, `message`, `deliver`, `idempotencyKey`，可选 **`attachments`**、**`thinking`**、**`timeoutMs`** 等（以网关 `validateChatSendParams` / TypeBox 为准）；**根级无 `model`**（模型由网关按 `openclaw.json` / 会话解析） | 依网关版本而定 | 未强校验（仅用 `request` 成功/失败） |
| `chat.abort` | 中断生成 | `sessionKey`，可选 `runId` | 依网关版本而定 | 未强校验 |

未实现：`chat.inject` 等，需要时在表中增行并补 Zod。

### `chat.history` 与官方 Control UI（排序与时间）

上游 OpenClaw（参考 `ui/src/ui/controllers/chat.ts`）：

- **`loadChatHistory`**：将 `chat.history` 返回的 `messages` **原样**赋给界面（仅过滤静默助手回复），**不做客户端重排**。
- **本地追加**：用户发送、流式兜底等会带 **`timestamp: Date.now()`**（毫秒）。

网关侧（参考 `src/gateway/server-methods/chat.ts`）：

- 从会话 transcript 读出消息后 **`slice(-limit)`** 截最近 N 条，再经裁剪/脱敏后返回；条目中 **`timestamp` 一般为 number（毫秒）**。

**lclaw-ui**：在 `loadHistory` 内对 `messages` 调用 `sortHistoryMessagesOldestFirst`（`lib/chat-history-sort.ts`）：若每条都能解析时间则按 `timestamp` 升序；否则仅在「首尾时间倒置」时整体 `reverse`，以兼容异常顺序。列表行在 `messageToChatLine` 中展示与官方类似的 **本地 `HH:mm`**（来自 `timestamp`）。

## 下行事件（Gateway → 客户端）

| 事件 | 用途 | 载荷摘要 | UI 行为 |
|------|------|----------|---------|
| `connect.challenge` | 设备签名 nonce | `nonce` | `GatewayClient` 内部消费 |
| `chat` | 流式与终态 | 见下表 | `chatEventPayloadSchema` 校验通过后更新 `chat` store |
| 其他 | 工具/Agent 等 | 因版本而异 | DEV `console.debug`；`toolTimeline` 展示（按 `sessionKey` 过滤） |

### `chat` 事件载荷（校验用）

| 字段 | 类型 | 说明 |
|------|------|------|
| `sessionKey` | string | 必填 |
| `state` | `delta` \| `final` \| `aborted` \| `error` | 必填 |
| `runId` | string | 可选 |
| `message` | unknown | `delta` 时取展示文本；亦可能仅在顶层带 `text` / `textDelta` / `content` 等（passthrough） |
| （实现说明） | — | 流式：`mergeAssistantStreamDelta` 区分全文快照与增量追加。历史：`chat.history` 若早于 user 落库则条数少于本地，`incoming.length < previous.length` 时拼回 `_lclawOptimistic` user，避免只剩「正在生成」占位 |
| `errorMessage` | string | `error` 时展示 |

## 与官方文档差异

| 主题 | 官方文档说法 | 本客户端实际行为 / 差异 |
|------|----------------|-------------------------|
| 下行事件全集 | 以官方为准 | 非 `chat` 事件仅时间线 + DEV 日志，未做全量 Zod |

## Zod / schema 索引

| 载荷 | 代码路径 |
|------|----------|
| `connect` hello 成功体 | `lclaw-ui/src/features/gateway/schemas.ts` → `gatewayHelloOkSchema` |
| `sessions.list` 响应 | `sessionsListResponseSchema` |
| `chat.history` 响应 | `chatHistoryResponseSchema` |
| 下行 `chat` 事件 | `chatEventPayloadSchema` |
| 右栏 `echarts-json` | `lclaw-ui/src/lib/echarts-option-schema.ts` |

## 变更日志（协议相关）

| 日期 | OpenClaw 版本 | 变更摘要 |
|------|-----------------|----------|
| 2026-03-20 | 参考 2026.3.14 | 阶段 E：核心 RPC/事件 Zod、错误中文映射、诊断复制、部署文档 |
| 2026-03-23 | npm **2026.3.22**（相对 **2026.3.13**） | 上游约一周内有大量提交；与 LCLaw 最相关：**网关启动**改为从已编译 `dist/extensions` 加载捆绑插件（冷启动明显加快，见上游 CHANGELOG `Gateway/startup`）；文档强调 `controlUi.allowedOrigins` 勿滥用 `["*"]`；另有大量插件迁移、exec 审批、Breaking（如弃用 `CLAWDBOT_*` / `.moltbot` 等）。完整差异见 [compare 61d171a…e7d11f6](https://github.com/openclaw/openclaw/compare/61d171ab0b2fe4abc9afe89c518586274b4b76c2...e7d11f6c33e223a0dd8a21cfe01076bd76cef87a)（npm 2026.3.13 与 2026.3.22 对应提交）。 |
| 2026-03-21 | openclaw `main` `chat.ts` | 确认 `chat.send` 无根级 `model`；lclaw-ui 不再随请求附带 `model` |
| 2026-03-21 | [Configuration / hot reload](https://docs.openclaw.ai/gateway/configuration#config-hot-reload) | Gateway 监视 `openclaw.json`；`agents`/`models` 表列为可热更新；`gateway.reload.mode: off` 时需手动重启；UI 保存后提示用户 |

---

*文档结束。*
