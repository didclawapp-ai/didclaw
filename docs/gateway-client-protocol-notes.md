# Gateway 客户端协议笔记（lclaw-ui）

> 与 OpenClaw Gateway **WebSocket** 对接时的**版本化**备忘。升级 OpenClaw 后务必更新本文件并跑回归。  
> 主方案：`OpenClaw-顶层界面-开发方案.md`（§3.5、§9、§11）。

## 当前锁定版本

| 项 | 值 |
|----|-----|
| OpenClaw Gateway 版本 | 参考本地 `openclaw-src`：**2026.3.14**（以实际运行网关为准） |
| 本笔记最后更新 | 2026-03-20 |
| 验证人 | （团队填写） |

## 连接参数

| 项 | 示例 / 说明 |
|----|----------------|
| WebSocket URL | `ws://127.0.0.1:18789`（以实际 `gateway.port`、`gateway.bind` 为准） |
| 鉴权 | `connect.params.auth.token` 或 `password` |
| 开发联调 | 见主方案 §3.4（Vite 与 Gateway 分端口） |

## 已实现 / 待实现的 RPC 与事件

### 请求方法（客户端 → Gateway）

| 方法 | 用途 | 请求要点摘要 | 响应要点摘要 | 备注 |
|------|------|----------------|----------------|------|
| `sessions.list` | 会话列表 | | | |
| `chat.history` | 历史消息 | | | 注意官方截断策略 |
| `chat.send` | 发送并触发 Agent | | | |
| `chat.abort` | 中断生成 | | | |
| `chat.inject` | 插入不触发 Agent | | | |

（随开发增行。）

### 下行事件（Gateway → 客户端）

| 事件类型 / topic | 用途 | 载荷字段摘要 | 与 UI 绑定（session / run） |
|------------------|------|----------------|------------------------------|
| `chat` | 会话流式与终态 | `sessionKey`, `runId`, `state`: `delta` \| `final` \| `aborted` \| `error`；`message` / `errorMessage` | `lclaw-ui`：`chat` store 按当前 `activeSessionKey` 更新流式文本或 `loadHistory` |
| `connect.challenge` | 握手 nonce | `payload.nonce` | `GatewayClient` 内消费，不暴露 UI |
| `agent` / 其他 | 工具流、节点等 | （待补充） | **开发环境** `console.debug`；**右栏底部** `toolTimeline`：非 `chat` / `connect.challenge` 事件经节流合并展示（按 `sessionKey` 过滤当前会话） |

（建议从官方 `openclaw-src/ui` 或浏览器 DevTools WS 帧对照填写。）

## 与官方文档差异

| 主题 | 官方文档说法 | 本客户端实际行为 / 差异 |
|------|----------------|-------------------------|
| | | |

## Zod / TypeBox schema 索引

| 载荷 | 代码路径（lclaw-ui 内） | 备注 |
|------|-------------------------|------|
| 例：`ChatHistoryResponse` | `src/...` | |
| 右栏 `echarts-json` 图表 option 子集 | `lclaw-ui/src/lib/echarts-option-schema.ts` | `z.strict()`，通过后再 `setOption` |

（实现校验层后把路径补全，便于 Code Review。）

## 变更日志（协议相关）

| 日期 | OpenClaw 版本 | 变更摘要 |
|------|-----------------|----------|
| | | |
