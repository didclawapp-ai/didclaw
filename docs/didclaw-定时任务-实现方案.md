# didclaw 定时任务实现方案

> 本文档对应 **didclaw** 中基于 OpenClaw Gateway **内置调度器（cron）** 的定时任务能力：界面形态、与网关 RPC 的映射、列表解析与排障要点。  
> 官方行为与字段语义以 [OpenClaw 定时任务（中文）](https://docs.openclaw.ai/zh-CN/automation/cron-jobs) 为准。

## 1. 目标与边界

| 项 | 说明 |
|----|------|
| **目标** | 在已连接 Gateway 的前提下，提供定时任务的**列表、新建、启用/暂停、立即运行、删除**；新建表单对齐「调度 → 执行 → 投递」心智，并支持选择常见代理 ID。 |
| **不负责** | 不在 UI 内编辑 `openclaw.json` 的 `cron.store` 路径；不替代网关侧调度执行与运行历史文件格式；**任务编辑（除启用状态外）** 当前未做完整表单，需 CLI 或后续迭代。 |
| **依赖** | `GatewayClient` WebSocket、`useGatewayStore` 已连接；网关需开启 cron（默认开启；完全禁用见官方文档 `cron.enabled` / `OPENCLAW_SKIP_CRON`）。 |

## 2. 架构关系

```
用户 ──► didclaw（CronJobsDialog）
           │  WebSocket JSON-RPC：cron.list / cron.add / cron.update / cron.remove / cron.run
           ▼
      OpenClaw Gateway（cron 服务）
           │  读写持久化（默认 ~/.openclaw/cron/，见官方文档）
           ▼
      jobs.json + runs/*.jsonl
```

- **持久化位置**在 **运行 Gateway 进程所在操作系统用户** 下，一般为 `~/.openclaw/cron/`；Windows 常见为 `%USERPROFILE%\.openclaw\cron\`。  
- 若 UI 连接**远程** Gateway，本地磁盘上**不会**出现上述目录下的任务文件，属预期。

## 3. 代码与入口

| 路径 | 职责 |
|------|------|
| `didclaw/src/features/cron/CronJobsDialog.vue` | 定时任务弹窗：列表、新建、RPC 调用与响应解析。 |
| `didclaw/src/app/AppHeader.vue` | 顶部工具栏「定时任务」按钮，`v-model` 控制弹窗开关。 |
| `didclaw/src/features/gateway/gateway-client.ts` | 通用 `request(method, params)`，成功时 `resolve(res.payload)`。 |
| `docs/gateway-client-protocol-notes.md` | 维护 `cron.*` 与客户端能力对照（升级网关时同步核对）。 |

## 4. 界面结构

### 4.1 弹窗 Tab

- **已有任务**：表格展示名称、调度摘要、启用状态；操作「立即运行」「暂停/启用」「删除」；支持「刷新」。  
- **新建**：分块表单（与官方 Control UI 分段思路一致）。

### 4.2 新建表单字段与网关映射

**基本信息**

| UI | 网关字段 | 说明 |
|----|-----------|------|
| 名称 * | `name` | 必填。 |
| 描述 | `description` | 可选。 |
| 代理 | `agentId` | 可选；见 §6。 |
| 已启用 | `enabled` | 默认 `true`；为 `false` 时任务仍会被持久化，但需列表侧拉「全量」才可见（见 §5.2）。 |

**调度**

| UI | `schedule` | 说明 |
|----|--------------|------|
| 一次性 | `{ kind: "at", at: ISO8601 }` | `datetime-local` 按本地时间解析后 `toISOString()`。 |
| 每隔 | `{ kind: "every", everyMs }` | 由分钟/小时/天换算为毫秒。 |
| Cron | `{ kind: "cron", expr, tz? }` | 五段表达式；`tz` 为可选 IANA。 |
| 运行成功后删除（仅一次性） | `deleteAfterRun` | 仅当 `schedule.kind === "at"` 时提交；执行成功后任务会从存储移除，列表中消失属正常。 |

**执行**

| UI | 网关字段 | 说明 |
|----|-----------|------|
| 会话：主会话 | `sessionTarget: "main"` | 配合 `payload.kind: "systemEvent"`。 |
| 会话：隔离 | `sessionTarget: "isolated"` | 配合 `payload.kind: "agentTurn"`。 |
| 唤醒模式 | `wakeMode` | `now` / `next-heartbeat`。 |
| 系统事件内容 | `payload: { kind: "systemEvent", text }` | 仅主会话。 |
| 助手任务提示 | `payload: { kind: "agentTurn", message }` | 仅隔离；可选 `timeoutSeconds`。 |

**投递（仅隔离会话）**

| UI | `delivery` | 说明 |
|----|-------------|------|
| 不投递 | `{ mode: "none" }` | 显式传入，避免依赖网关对缺省字段的推断。 |
| 发布摘要 | `{ mode: "announce", channel?, to?, bestEffort? }` | 渠道枚举与 `to` 格式以官方文档为准。 |

## 5. RPC 约定与实现要点

### 5.1 已使用的方法

| 方法 | 用途 | didclaw 请求要点 |
|------|------|-------------------|
| `cron.list` | 拉取任务列表 | **`{ enabled: "all", limit: 200 }`**：网关默认分页接口往往只返回「已启用」任务；必须拉全量否则「未勾选已启用」的新建任务看起来像未持久化。 |
| `cron.add` | 新建 | 正文为 §4.2 映射后的对象；成功后再 `refreshList()`。 |
| `cron.update` | 更新 | 当前仅用于 `patch: { enabled }` 切换暂停/启用；参数使用 `jobId`（见 §5.3）。 |
| `cron.remove` | 删除 | `jobId`；删除前 `confirm`。 |
| `cron.run` | 立即运行 | `{ jobId, mode: "force" }`。 |

网关侧较新版本对 `id` / `jobId` 多已做兼容；客户端统一用列表里解析出的字符串作为 `jobId` 传参即可。

### 5.2 `cron.list` 响应解析（`extractJobs`）

OpenClaw 当前主线常见返回为**分页对象**：

```json
{ "jobs": [ /* CronJob */ ], "total": 0, "offset": 0, "limit": 200, "hasMore": false, "nextOffset": null }
```

实现上还对以下形态做了宽松兼容，以降低网关版本差异带来的空列表：

- 顶层即为任务数组；  
- `jobs` / `items` / `list` / `entries` 为数组；  
- `jobs` 为「id → 任务对象」的字典（`Object.values`）；  
- 外层再包一层 `data` / `result`。

### 5.3 任务主键展示与 RPC

列表行内展示与 `cron.run` / `cron.update` / `cron.remove` 使用的标识符由 **`jobIdOf`** 解析：

- 优先非空字符串 **`jobId`**（兼容旧数据）；  
- 否则使用 **`id`**（新存储常见字段）。

## 6. 代理（agentId）选择策略

网关侧存在多代理时，任务可带 **`agentId`** 指定运行上下文。

当前 UI **不调用** 独立的 `agents.list` 类 RPC，而是：

1. 使用 `useSessionStore` 中已由 `sessions.list` 填充的会话行；  
2. 从会话键 **`agent:<代理ID>:…`** 中解析第一段代理 ID 并去重；  
3. 下拉选项：**默认（不指定）**、已推断的代理、**自定义 ID**（文本框）。

打开弹窗且已连接时，会 **`sessions.refresh()`**，以尽量与网关会话列表同步。

**限制**：从未产生会话的代理不会出现在下拉里，需选「自定义 ID」手动填写。后续若网关暴露稳定配置列表，可改为直连配置源。

## 7. 连接与权限

- 浏览器 / 非桌面壳默认 `clientMode` 为 **`webchat`**；若某网关版本对 `webchat` 限制 `cron.*`，界面将收到 RPC 错误。桌面壳通常使用 **`ui`** 模式，与官方 Control UI 能力更接近（见 `gateway-types.ts` 与 `useGatewayStore` 中的模式选择）。  
- 具体以当前连接的 Gateway 版本与策略为准。

## 8. 用户体验与排障

| 现象 | 可能原因 |
|------|-----------|
| 创建成功但列表始终为空 | 旧逻辑只打 `cron.list` 默认参数，看不到 `enabled: false` 的任务；**现实现已传 `enabled: "all"`**。仍为空时检查是否 RPC 报错、网关 cron 是否禁用。 |
| 执行一次后任务消失 | 一次性任务且 **`deleteAfterRun: true`**。 |
| 本机找不到 `~/.openclaw/cron` | Gateway 不在本机或未以该用户启动；或远程连接。 |
| 代理下拉没有预期项 | 该代理尚无会话键进入 `sessions.list`；用自定义 ID。 |

## 9. 后续演进（建议）

1. **Zod**：为 `cron.list` 响应与 `cron.add` 成功回包增加可选校验，便于升级网关时快速失败并记录原始 payload。  
2. **编辑任务**：对选中任务打开表单，调用 `cron.update` 提交 `patch`（调度、payload、delivery 等）。  
3. **运行历史**：只读展示 `cron.runs`（若产品需要）。  
4. **代理列表**：读取 `openclaw.json` 的 `agents.list`（桌面 IPC 已具备读配置能力时）或网关未来 RPC，替代纯会话推断。  
5. **分页**：任务数超过 `limit: 200` 时，根据 `hasMore` / `nextOffset` 翻页或加载更多。

## 10. 文档与版本

| 日期 | 说明 |
|------|------|
| 2026-03-24 | 初稿：与当前 `CronJobsDialog` / `AppHeader` 实现及 `cron.list` 全量列表修复对齐。 |

维护时请同步更新：`docs/gateway-client-protocol-notes.md` 中 `cron.*` 行、以及官方 OpenClaw 文档链接。
