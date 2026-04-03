# DidClaw 工程改进方案（架构 / 安全 / 质量 / 性能）

> 本文与 [didclaw-roadmap-0x.md](./didclaw-roadmap-0x.md) 互补：路线图偏**产品功能**，本文偏**可维护性、风险与迭代效率**。  
> 目标：把评审中可落地的项排成**分阶段、可验收**的 backlog，便于在版本迭代中逐步消化，避免一次性大重构。

---

## 原则

1. **先止血、再结构、再优化**：安全与误提交风险 → 可观测性与测试 → 大文件拆分与类型收紧 → 性能微优化。  
2. **每个阶段有可合并的 PR**：单 PR 最好 1～3 个主题，便于 review 与回滚。  
3. **与 OpenClaw Gateway 行为对齐**：连接、事件、重连策略变更前对照官方 Control UI / 网关文档，避免「客户端自作聪明」导致联调问题。

---

## 阶段 0 — 低成本风险收敛（建议下一两个补丁版本内完成）

| 项 | 做什么 | 验收标准 |
|----|--------|----------|
| **忽略本地环境文件** | 在仓库根 `.gitignore` 增加 `.env.test`、可选 `.env*.local`（若团队常用） | `git status` 不再误列敏感本地文件；文档中注明「勿提交密钥」 ✅ 根目录已忽略 `.env.test` |
| **Token / URL 日志审计** | 全局检索 `connect_url`、`ws://`、`wss://`、含 `token` 的 `log`/`println!`/`tracing` | 生产路径不输出完整 WebSocket URL；调试日志若必须，对 query 做脱敏（如仅打印 host + path） ✅ `gateway_tunnel.rs` 建连路径未打印含 token 的 URL；后续新增日志请遵守 |
| **硬编码文案登记** | 建立短清单：`chat.ts` 中随消息说明块、Rust `commands.rs` 等与 i18n 并行的用户可见中文 | 清单入本文或 issue；P0 先改**前端**用户高频路径（与路线图 P0-1 未完成项一致） ✅ 发送非图片附件时的说明与网关 error 兜底已走 `composer.*` i18n；Rust 用户可见串仍待路线图 P0-1 |

**说明**：Gateway 在握手阶段同时使用 `?token=` 与 `Authorization: Bearer` 往往受限于 WebSocket 客户端与网关实现；改进重点是**日志与崩溃上报不落盘密钥**，而非武断去掉 query token。

---

## 阶段 1 — 可观测性与连接行为（1～2 个迭代）

| 项 | 做什么 | 验收标准 |
|----|--------|----------|
| **Gateway 空 catch 策略** | `gateway.ts` 等处 `catch { }`：统一为「可配置调试日志」或集中 `reportError` | 开发构建可打开 verbose；发布构建不刷屏，但关键错误有单一出口可排查 ✅ `client-dev-log.ts` 的 `logSwallowedError`（DEV-only）已覆盖 gateway / chat 若干吞错点 |
| **WebSocket 重连策略** | 为「1012 Service Restart」等路径增加：**指数退避 + 可选上限 + 用户可见状态**（非静默死循环） | 网关持续崩溃时 UI 显示「重连失败/请检查网关」而非无限无反馈重试；行为写进代码注释 ✅ `MAX_SERVICE_RESTART_ATTEMPTS=15`、指数退避、`gatewayConn.serviceRestart*` 文案 |
| **`connect()` 可读性** | 将 `onHello` / `onEvent` / `onClose` 抽成具名函数或同文件内模块级函数，减少 4 层以上嵌套 | 新同事能在 10 分钟内跟完连接生命周期，无需单函数滚动几百行 ✅ `onEvent` → `gateway-store-on-event.ts`；`onHello`/`onClose` → `gateway-store-lifecycle.ts`；类型 → `gateway-store-types.ts`；桌面拉起网关 + 400ms 防抖 → `gateway-store-connect-flow.ts`（`ensureDesktopOpenClawGatewayForConnect`） |
| **`handleGatewayEvent` 风格** | 将 `(() => { ... })().catch(...)` 改为 `async function` + 顶层 `void handle()` 或显式 `catch`，与 `chat.ts` 其余错误处理一致 | ESLint/团队风格一致；错误必达 `console` 或统一 logger ✅ `processChatGatewayEventPayload` + `void …catch` |

---

## 阶段 2 — 结构与复用（并行度高的「技术债」）

| 项 | 做什么 | 验收标准 |
|----|--------|----------|
| **AppShell 拆分** | 按域提取 composable：`useGlobalKeyboardShortcuts`、`useTrayOrWindowHooks`（若适用）、首跑/横幅相关逻辑等 | `AppShell.vue` 行数显著下降；行为与快捷键与现网一致（需人工回归清单） ✅ `useAppShellGlobalShortcuts.ts`（键盘）；✅ `useAppShellExternalDocumentClick.ts`（外链）；✅ `useAppShellOnboardingBanners.ts`；✅ `useAppShellLifecycle.ts`（托盘/首连网关）；✅ `useAppShellSessionToolbar.ts`；✅ `useAppShellConversationPanel.ts` |
| **节流/去抖统一** | `chat.ts` 内多处手写时间戳节流 → `useThrottle` / 小工具函数（纯函数 + 单测） | 新同步逻辑默认复用同一工具，避免再复制 `lastXxxMs` 模式 ✅ `min-interval-throttle.ts` + `test/lib/min-interval-throttle.test.ts`；已用于 chat 两处节流 |
| **Rust 命令注册分模块** | `lib.rs` 中 60+ 命令按域拆到 `gateway_commands.rs`、`skill_commands.rs` 等，各模块 `register(app)` | `lib.rs` 只保留聚合；无行为变化 ✅ `src-tauri/src/command_registration.rs`：`didclaw_invoke_handlers!` 宏集中列表（按域注释）；**勿**把 `generate_handler!` 放进泛型辅助函数，否则 Tauri 2 下 `AppHandle` 推断会失败 |
| **Electron 桥清理策略** | 盘点 `electron-bridge` 与 `isDidClawElectron` 分支：能删则删，暂不能删则集中文档说明「兼容期截止版本」 | 减少双栈心智负担；Tauri 路径为默认测试路径 ✅ `electron-bridge.ts` 头注释已写明「以 Tauri 为主力」与移除前需全仓检索 |

---

## 阶段 3 — 类型安全与 Rust 质量

| 项 | 做什么 | 验收标准 |
|----|--------|----------|
| **Tauri 命令返回类型** | 高频命令从 `Result<Value, String>` 过渡到 `serde` 结构体 + `Result<T, String>` 或统一错误枚举 | 前端 invoke 侧类型收窄；至少覆盖网关/配置/会话相关命令 |
| **Base64 清洗性能** | `dialog_save_base64_file`（及同类路径）：避免对大 `String` 做 `chars()` 全量遍历；可用 bytes 过滤空白、`Vec` 预分配或与 `MAX` 一致的策略 | 68MB 边界下不额外分配一倍 UTF-32 逻辑；有简单 benchmark 或注释说明复杂度 ✅ 已改为 ASCII 字节过滤 + `decode(&[u8])` |

---

## 阶段 4 — 性能（按数据规模触发）

| 项 | 做什么 | 验收标准 |
|----|--------|----------|
| **Pheromone 图更新** | `didclaw-ui/src/lib/pheromone-engine.ts` 中 `JSON.parse(JSON.stringify(graph))` → 结构化克隆或增量更新 | 千级节点场景下交互仍流畅；或明确文档说明上限 ⏸️ **main 分支当前无该文件**（可能在其它功能分支）；合入后再做 |
| **聊天历史加载** | `loadHistory` 200 条上限：长会话分页或「向上滚动加载」 | 无游标 API 前已将单次 `limit` 提至 **500**（`chat-history-config.ts`）；真正「向上滚动加载更早消息」仍依赖网关支持 `before`/`offset` 等 ⏳ |
| **`extractTopics` 等热点** | 对重复文本结果做 LRU 或小缓存（注意失效条件） | Profiler 或手动场景下重复发送相同前缀时 CPU 明显下降 |

---

## 阶段 5 — 测试金字塔补全

**优先级（与评审一致，略调整路径）**：

1. **`pheromone-engine.ts` 纯函数单测**（图谱更新、衰减、边界输入）。  
2. **`gateway.ts` 事件分发与重连**（可抽纯函数 + mock WebSocket / 假 client）。  
3. **`live_edit_patch.rs` 或等价补丁应用路径**（Rust 单元测试，覆盖换行与边界）。  
4. **`session` / `chat` store 关键状态机**（会话切换、历史合并）。

**验收标准**：CI 中 `pnpm test`（或项目既定命令）稳定执行；核心回归用例与上述模块目录对应，避免只堆 UI 快照。✅ `min-interval-throttle`、`gateway-debug-log`（摘要与 agent 同步判定）单测；pheromone / gateway store 集成测试仍待补。

---

## 阶段 6 — 可选加固

| 项 | 说明 |
|----|------|
| **`liveEdit.ts` 的 `fnv1aHex`** | 若补丁去重出现误判风险，再升级为 64 位或加密哈希；评估异步 `crypto.subtle` 对 UX 的影响。 |
| **`__APP_VERSION__`** | 在 `vite.config.ts` 与类型声明处做一次核对，保证发布流水线与本地一致。 ✅ `vite.config.ts` 已交叉注释 `vite-env.d.ts` |

---

## 与路线图的衔接

- **i18n**：继续完成路线图 **P0-1** 中「Rust 侧用户可见错误英文化」与本文阶段 0 的文案清单。  
- **产品功能**：不替代路线图中的 P0/P1 功能项；工程改进 PR 应尽量**不夹带**大功能，以免 review 爆炸。

---

## 建议的迭代节奏（示例）

| 版本补丁 | 建议纳入 |
|----------|----------|
| v0.8.x / v0.9.x | 阶段 0 + 阶段 1 各 1～2 项 |
| v0.9.x | 阶段 2 任选 1 项（如 AppShell 或 Rust 注册拆分） |
| v1.0 前 | 阶段 5 至少覆盖 pheromone + gateway 关键路径 |

（具体版本号按发布计划调整；上表仅为「不要堆到一个版本」的拆分示例。）

---

## 文档维护

- 完成某项后，可在本文件对应表格打勾或链接 PR/issue。  
- 若与 OpenClaw 上游行为变更冲突，在表格下追加一行「决策记录」即可。
