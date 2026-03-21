# lclaw-ui：会话状态、发送策略与展示增强 — 实施步骤

> **用途**：在协议与 UI 关系已理清的前提下，把「token/上下文占用」「AI 忙时发消息」「工具与运行态展示」等能力拆成**可执行顺序**；与 [`lclaw-ui-功能补全清单.md`](./lclaw-ui-功能补全清单.md) 互补（本文件偏**步骤与依赖**，清单偏**长期勾选**）。  
> **原则**：Gateway **不改源码**；优先做**不依赖新 RPC 字段**的纯前端展示，再补数据依赖项。

### 已落地（2026-03-20）

- **阶段 A + B（部分）**：`toolTimeline` 条目带可选 `runId`；`chat` store 增加 `runStartedAtMs` / `lastDeltaAtMs` / `agentBusy` / `composerPhase`、正常结束时 `lastCompletedRunDurationMs`；`InlineToolTimeline.vue`（消息列表上方内联工具条）、`ChatRunStatusBar.vue`（阶段文案 + 耗时 + 卡住提示 + 完成后约 10s「本轮用时」）；`sendMessage` 在 `runId != null` 时拒绝并发发送；输入区仍可编辑，仅禁用「发送」与 Enter 发送。
- **未做**：`sessions.list` token 进度条、可选本地排队队列（阶段 D）、可配置化阈值等。

---

## 一、策略定稿（产品）

### 1. Token / 上下文占用

| 步骤 | 动作 |
|------|------|
| 1.1 | **先验数据**：在 dev 下对 `sessions.list` 的原始响应打日志（或临时 `console.log`），确认是否存在 `contextTokens`、`inputTokens`、`outputTokens`、`totalTokens` 等与官方 [Session Management](https://docs.openclaw.ai/concepts/session) 描述一致的字段。`sessionRowSchema` 已 `.passthrough()`，不会挡未知字段。 |
| 1.2 | **有字段**：扩展 [`session.ts`](../lclaw-ui/src/stores/session.ts) 的 `SessionRow`（或并行 `sessionsMeta`），在 `refresh()` 映射中写入；会话列表项旁展示**条形进度或百分比**（需约定分母：如模型 `contextWindow` 若列表未带则只展示分子或「已用 tokens」文案）。 |
| 1.3 | **无字段**：文档记录「当前网关版本未暴露」；排期与 **Gateway / 官方** 确认能否在 `sessions.list` 或别 RPC 附带；在此之前 UI 可显示「—」或隐藏模块。 |

### 2. 「AI 还在跑时用户发消息」

| 模式 | 行为 | 实现要点 |
|------|------|----------|
| **默认（拦截）** | `sending === true` 或存在进行中的 **`runId`**（流式未结束）时，禁用发送按钮、Enter 发送；文案明确「助手处理中，请稍候」。 | 与现有 [`chat.ts`](../lclaw-ui/src/stores/chat.ts) 状态对齐；注意 `final`/`aborted`/`error` 后清 `runId`/`streamText`。 |
| **可选（排队）** | 用户打开「排队发送」或点「加入队列」后，本条不立即 `chat.send`，进入**本地 FIFO**；在收到当前会话的 `chat` 事件 **`final` / `aborted` / `error`** 后自动发送队首。 | 新状态：`composerQueue: string[]`（或含附件占位结构）、`queueModeEnabled`；**切换会话**时队列策略要定：清空 / 按 session 分桶（建议**按 `sessionKey` 分桶**，避免串会话）。 |

两种模式并存：**默认拦截**；仅当用户显式选择排队时，才在忙时入队。

---

## 二、优先级总表（建议交付顺序）

| 优先级 | 内容 | 工作量 | 依赖 |
|:------:|------|:------:|------|
| **1** | 工具调用实时卡片：`toolTimeline` → **聊天区内联**展示 | 中 | 无新 RPC；已有 [`toolTimeline.ts`](../lclaw-ui/src/stores/toolTimeline.ts)、右栏时间线 |
| **2** | 发送时状态细化：思考中 / 调工具 / 生成中 / 完成 | 小 | 组合 `sending`、`runId`、`streamText`、工具事件或时间线非空 |
| **3** | 运行耗时计时器（本轮从首包 delta 或 `runId` 设定起计时，至 `final`/`aborted`/`error`） | 小 | 同 2 |
| **4** | 上下文 token 占用展示 | 小～中 | **须先完成 §一.1.1 字段确认** |
| **5** | 本地消息队列（等 `final` 后自动发） | 中 | `chat` 事件监听；§一.2 产品规则 |
| **6** | 超时/卡住检测（无 delta 超过 N 秒提示） | 小 | 定时器 + `lastDeltaAt` |

建议迭代：**先做 1 + 2 + 3**（用户感知强、无网关新字段）；**4 前置探测**；**5、6 随后**。

---

## 三、阶段 A：1 + 2 + 3（纯展示，优先做）

### A.1 工具时间线内联（优先级 1）

| 步骤 | 说明 |
|------|------|
| A.1.1 | 定 UI 位置：在 [`MessageThread` / 消息列表容器](../lclaw-ui/src/features/chat/) 底部上方插入「本轮运行」条带，或挂在最后一条助手占位旁；仅展示**当前 `activeSessionKey`** 与**当前 `runId`** 匹配的工具条目（若事件无 `runId`，可退化为「有 `runId` 时过滤，无则全显当前会话」）。 |
| A.1.2 | 复用 [`toolTimeline`](../lclaw-ui/src/stores/toolTimeline.ts) 的 `entries`，或抽**按 run 切片**的 computed；避免与右栏 [`PreviewPane`](../lclaw-ui/src/features/preview/PreviewPane.vue) 重复逻辑时，抽 `useToolTimelineForSession(runId)`。 |
| A.1.3 | 卡片样式：事件名 + 摘要（沿用 `summarizePayload` 红线）；可折叠；`final` 后可保留最后一帧或清空（产品定）。 |
| A.1.4 | 自测：发一条触发工具的对话，确认内联列表与右栏一致、切换会话过滤正确。 |

### A.2 发送状态细化（优先级 2）

| 步骤 | 说明 |
|------|------|
| A.2.1 | 在 `chat` store 或独立 computed 定义 **`composerPhase`**：`idle` \| `sending` \| `streaming` \| `tooling`（工具时间线在当前 run 有更新）\| `done`。 |
| A.2.2 | 在 [`MessageComposer`](../lclaw-ui/src/features/chat/MessageComposer.vue) 或顶栏 [`AppShell`](../lclaw-ui/src/app/AppShell.vue) 展示简短文案或步骤点（如「正在调用工具…」「正在生成…」）。 |
| A.2.3 | 与 **默认拦截**一致：`composerPhase !== 'idle'` 且非排队模式时禁用发送（见 §四）。 |

### A.3 运行耗时计时器（优先级 3）

| 步骤 | 说明 |
|------|------|
| A.3.1 | 在收到本轮首个 **`delta`**（或 `sendMessage` 成功 ack 后）记录 `runStartedAt`；在 `final`/`aborted`/`error` 清除并可选展示「本轮耗时 x.xs」。 |
| A.3.2 | 展示位置：与 A.2 同一状态条，或消息列表助手气泡顶部。 |

---

## 四、阶段 B：默认拦截强化（与 A 同步或可紧接 A）

| 步骤 | 说明 |
|------|------|
| B.1 | 统一「是否允许发送」：`canSend = connected && !sending && runId == null && draftValid`（若有「随信附件」条件保持现有 `hasSendableAttachments`）。 |
| B.2 | 若仅 `sending` 为 true 但尚未收到 delta，显示「发送中…」；若 `runId` 已有且 `streamText` 有更新，显示「生成中…」（与 A.2 合并）。 |
| B.3 | **排队模式**开启时：Busy 不调用 `chat.send`，改 `enqueue`（见阶段 D）。 |

---

## 五、阶段 C：上下文 token（优先级 4）

| 步骤 | 说明 |
|------|------|
| C.1 | 执行 §一.1.1，把样例 JSON **脱敏**后记入 [`gateway-client-protocol-notes.md`](./gateway-client-protocol-notes.md)「sessions.list 扩展字段」小节。 |
| C.2 | 扩展 `SessionRow` 与 `refresh()` 映射；会话列表组件增加进度条/数字。 |
| C.3 | 若无窗口上限字段，仅显示「已用 tokens」或链接文案「在聊天中发送 /status 查看详情」（与官方 [Context](https://docs.openclaw.ai/concepts/context) 一致）。 |

---

## 六、阶段 D：本地队列（优先级 5）

| 步骤 | 说明 |
|------|------|
| D.1 | `useChatStore` 或 `useComposerStore`：`queueBySessionKey: Record<string, QueuedTurn[]>`，`QueuedTurn` 含文本草稿 + 待发附件快照（或引用 id，注意 ObjectURL 生命周期）。 |
| D.2 | UI：`MessageComposer` 增加开关「排队发送」或按钮「忙时加入队列」。 |
| D.3 | 在 [`handleGatewayEvent`](../lclaw-ui/src/stores/chat.ts) 中，当 `state` ∈ `final` \| `aborted` \| `error` 且 `sessionKey === activeSessionKey`，`runId` 清空后 **`flushOneQueuedMessage()`**。 |
| D.4 | 边界：队列为空、发送失败、用户点中断后是否丢弃队列首条（建议：**失败保留队列并 toast**；abort **不自动 dequeue**，由产品定）。 |

---

## 七、阶段 E：卡住检测（优先级 6）

| 步骤 | 说明 |
|------|------|
| E.1 | 维护 `lastDeltaAt`：每次 `delta` 更新时刷新；`setInterval` 或 `watch`：若 `runId != null` 且 `Date.now() - lastDeltaAt > N`（如 45s 可配置），显示「长时间无响应，可尝试中断或检查网关」。 |
| E.2 | 首包延迟：可从 `runId` 设定到首个 delta 单独计时，避免刚发起就误报。 |

---

## 八、验收清单（每阶段）

- [ ] `npm run typecheck` / `npm run lint` 通过。  
- [ ] 切换会话：内联工具卡片、队列分桶、token 展示与当前会话一致。  
- [ ] 默认拦截：忙时无法重复发送；排队模式忙时可入队且结束后自动发出。  
- [ ] 文档：`gateway-client-protocol-notes.md` 与实际字段同步。

---

## 九、相关代码索引

| 模块 | 路径 |
|------|------|
| 聊天状态 / 发送 / 事件 | `lclaw-ui/src/stores/chat.ts` |
| 会话列表 | `lclaw-ui/src/stores/session.ts` |
| 工具时间线 | `lclaw-ui/src/stores/toolTimeline.ts` |
| 网关事件入口 | `lclaw-ui/src/stores/gateway.ts` |
| 输入区 | `lclaw-ui/src/features/chat/MessageComposer.vue` |
| 协议备忘 | `docs/gateway-client-protocol-notes.md` |

---

*修订时请更新文首日期与已确认的 `sessions.list` 字段表。*
