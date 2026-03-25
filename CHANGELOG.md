# Changelog

本文件记录 DidClaw / LCLAW 仓库面向协作者与用户的可见变更。**每次提交请同步追加条目**（见 `.cursor/rules/didclaw-project.mdc`）。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/）。**版本号规则**（SemVer、`package.json` / `tauri.conf.json` / `Cargo.toml` 同步、标签 `v*`）见 `.cursor/rules/didclaw-project.mdc` 中的「版本号与发版」。

## [未发布]

### 修复

- **定时任务触发后消息在会话中出现后消失**：根因是 `cron` WS 事件在 delivery/announce 落库前就触发 `loadHistory`，导致以旧快照覆盖了界面上已流式显示的投递消息。修复：移除 `cron` 事件 → `loadHistory` 的直接触发，让后续 `agent` 事件（携带 `sessionKey`，在 delivery 完成后发出）来负责同步；同时将防抖延迟从 750ms 提高到 1500ms，给落库留足余量。

### 改进

- **定时任务界面小幅优化**：执行历史默认折叠；任务卡片改为固定三列网格，尺寸更紧凑，窗口最大化时可同时展示两行六张卡片。

- **定时任务「已有任务」列表重新设计**：
  - 表格改为颜色卡片列表：执行中→绿色左边框，已运行→黄色左边框，未运行→红色左边框，已暂停→灰色半透明。
  - 每张卡片显示任务名、调度频率（人类语言）、下次执行相对时间，操作按钮紧凑排列。
  - 空状态改为居中图标 + 标题 + 一键「新建任务」按钮。
  - 状态栏重排为等宽三格（调度器、任务数、下次唤醒），下次唤醒改显示相对时间。
  - 工具栏精简为一行（刷新 + 排序字段 + 顺序），移除冗余标签。
  - 「执行历史」提取为独立可折叠区块，筛选栏紧凑化，运行记录条目加颜色左边框（绿/红/蓝）。

- **定时任务「新建」表单全面去技术化**：
  - 调度类型下拉框改为「每天 / 每周 / 每月 / 只运行一次 / 自定义」丸形选择按钮，选择后只显示与该频率相关的时间选项（星期几、几号、时间），彻底隐藏 Cron 表达式。
  - 「会话模式（sessionTarget）」和「唤醒模式（wakeMode）」默认隐藏，系统自动选择最优值（隔离会话 + 下次心跳），移入「高级设置」折叠区。
  - 「投递」章节替换为一个「任务完成后，将结果发送到聊天窗口」勾选框；频道/收件人等细节折叠在高级设置中。
  - 「助手任务提示」改为「告诉 AI 要做什么」，附带示例 placeholder，降低填写门槛。
  - 整体从 4 个 fieldset（~15 字段可见）简化为 3 张卡片（3 字段 + 1 勾选框可见）。
- **任务列表更人性化**：
  - `formatScheduleSummary` 将 Cron 表达式解析为「每天 09:00」「每周一 09:30」「每月 15 日 09:00」等自然语言，一次性任务显示本地化日期。
  - 每行调度列新增「下次：3 小时后」相对时间，使用 `formatRelativeTime` 输出人类可读时差，同时保留精确时间作为 hover tooltip。

### 修复

- **定时任务窗口**：
  - `createOk`（任务创建成功提示）不再永久停留，8 秒后自动消失；关闭对话框时立即清除计时器，`onUnmounted` 也做兜底清理。
  - 创建任务成功后自动重置整个表单（名称、调度、执行、投递字段），方便连续创建多个任务。
  - `refreshOverview` 原先串行执行 `cron.status`、`cron.list`、`cron.runs` 三个请求；改为 `Promise.all` 并行发起，页面刷新速度提升约 2–3×。
  - `onJobsSortChange` 不再重新加载运行记录，任务排序变更仅刷新任务列表本身（`cron.runs` 与任务排序无关）。

- **技能窗口功能缺陷**：
  - 详情面板「安装到本机」绕过 `isSuspicious` 检查，直接安装可疑技能。现在 `installHubSkill` 统一执行恶意/可疑检查，调用方已知道 moderation 结果时可传 `skipSuspiciousCheck: true` 避免重复请求。
  - `onDeleteInstalled` 未设置 `installBusy`，删除操作与安装操作可并发导致 `loadInstalled` 竞争。现在删除前检查并锁定 `installBusy`，finally 中释放。

### 改进

- **定时任务窗口 UI**：
  - 关闭按钮改为 ✕ 圆形图标，hover 显示红底，与技能窗口风格一致；支持 ESC 键关闭。
  - 顶部说明段落从 5 句技术文档式长文缩短为 1 句 + 文档链接。
  - 任务列表"启用"列从纯文字改为颜色徽章（启用→绿色，暂停→灰色）。
  - 任务列表"运行态"加颜色：运行中→蓝色加粗，已运行/未运行→灰色。
  - 操作列"删除"按钮加红色危险样式（hover 红底），与技能窗口一致。
  - 运行记录 `status` 字段加颜色识别：success/done→绿色，error/fail/timeout→红色，running/pending→蓝色。
  - 成功提示 `createOk` 使用 CSS 变量 `--lc-success`（绿色），不再沿用 accent 青色。

- **技能窗口 UI**：
  - 消息条新增三种语义样式：成功（绿色左边框）、失败（红色）、信息（青色）；成功/信息消息 8s 后自动消失，失败消息保留直到下次操作；消息条右侧加 ✕ 关闭按钮。
  - 头部说明文从 3 句技术性长段缩短为 1 句用户友好描述。
  - 关闭按钮改为 ✕ 图标按钮，hover 显示红底。
  - 「删除」按钮文字改为红色，hover 显示红底边框。
  - 搜索结果卡片添加 `cursor: pointer` 与 hover 边框高亮。
  - 搜索输入框添加 `font-family: inherit; font-size: 13px`，消除字体渲染差异。
  - 本机安装成功/失败消息使用对应颜色（绿色/红色）而非统一灰色。
  - 清除 7 个从未被使用的死 CSS 类（`.hit-btn`、`.hit-slug`、`.hit-name`、`.explore-bar`、`.explore-sort`、`.skills-select`、`.skills-hit-list`）。

- **Header 菜单细化**：移除重复的「⚙ 设置」按钮（与会话区「更多设置」功能重复）；「定时任务」缩短为「定时」节省空间；「···」溢出菜单将背景遮罩通过 `<Teleport to="body">` 挂到 body 最外层，修复 `backdrop-filter` 创建层叠上下文导致点击空白处无法关闭菜单的问题。
- **暗色模式对话框边框**：`--lc-border` dark 值从 `rgba(255,255,255,0.08)` 提升至 `0.13`；`.cron-panel`/`.skills-panel` 在暗色下追加专属 `border-color: rgba(255,255,255,0.18)` 和多层 `box-shadow`，对话框轮廓清晰可见；遮罩层背景加深至 `rgba(0,0,0,0.6)`。

### 新增

- **夜间模式（Dark Mode）**：
  - `AppHeader.vue` 右侧新增 🌙/☀ 图标按钮（圆形，支持 hover 旋转动效），一键切换日间/夜间模式。
  - `stores/theme.ts`：新增 `useThemeStore`（Pinia），持久化到 `localStorage("didclaw_theme")`，优先读取用户偏好，回退到系统 `prefers-color-scheme`；切换主题时同步调用 `getCurrentWindow().setTheme()` 修改 **Tauri 原生标题栏**深/浅色，非桌面环境静默忽略。
  - `capabilities/default.json` 与 `dev.json` 补充 `core:window:allow-set-theme` 权限，修复标题栏颜色实际不变的问题。
  - `index.html` 注入微型内联脚本，在 Vue 加载前立即应用主题，消除闪白（FOUC）。
  - `style.css` 追加 `[data-theme="dark"]` 覆盖块（约 30 个 CSS token）；body 背景渐变、网格装饰色、代码块（github-dark 配色）、所有组件颜色均随主题切换；`body` 加 `transition: background-color 0.25s ease` 平滑过渡。
  - 修复 `ChatRunStatusBar` stall 警告色从硬编码 `#b45309` 改为 `--lc-warning-text` token；会话芯片颜色改用 `--lc-accent` token。

### 改进

- **UI Phase 1 — Header 精简 + 气泡分层**：
  - `AppHeader.vue` 重构为单行布局（节省 ~40px 高度）；「诊断」「引导」「重启网关」「关于」收入右侧「···」溢出菜单，普通用户不再面对技术按钮。`window.alert` 替换为 Header 底部内联错误条（含 6s 自动消失）。
  - `AppShell.vue` 在会话区顶部新增「＋ 新建对话」按钮，直接开启一个新会话。
  - `ChatMessageList.vue` 消息气泡视觉分层：用户消息右对齐 + 淡紫底色，助手消息左对齐 + 淡青底色，system/tool 消息缩小并置灰，聊天层次感更强。
  - `MessageComposer.vue` 删除占用垂直空间的长提示段落，改为输入行内「?」圆形 tooltip 图标按钮，悬停可查看所有快捷键说明。
  - `ChatRunStatusBar.vue` 状态文字改为英文（Sending / Generating / Done），消除遗留中文。
  - `style.css` 补全 `--lc-radius-md`、`--lc-surface`、`--lc-spacing-{xs,sm,md,lg,xl}` 五组 token；新增 `.lc-btn-primary` 类（加强 `box-shadow` 与最小宽度），使主操作按钮在视觉上更突出。

### 修复

- **安装向导 Node.js 缺失处理**：无 winget 的旧系统（企业镜像等）安装会直接失败。现在当 npm 不可用时，先尝试 winget 安装 Node.js LTS，再回退到从 nodejs.org 下载 MSI（per-user 安装，无需 UAC）；若两种方式均失败，脚本以退出码 6 退出并在 UI 展示「需要手动安装 Node.js」面板，含「打开 nodejs.org 下载页」按钮。
- **安装向导退出码 1 根因修复**：
  - `ensure-openclaw-windows.ps1` 改以 **UTF-8 with BOM** 保存，修复 Windows PowerShell 5.1 因编码误读中文字符串导致的 ParserError；所有输出语句改为英文，彻底消除乱码。
  - 安装逻辑重构：若本机已有 `npm`（Node 已安装），直接执行 `npm install -g openclaw@latest` 跳过下载 `https://openclaw.ai/install.ps1`，避免依赖服务器可用性；仅当 npm 不可用时才下载官方安装脚本（含自动装 Node）。
  - `openclaw_ensure_install.rs`：将 `BufReader::lines()`（遇非 UTF-8 字节直接 break）替换为自实现的容错逐行读取（`from_utf8_lossy`），乱码环境下仍可将错误输出回传前端。
  - `FirstRunWizard.vue`：安装脚本退出非零且日志为空时，展示具体可能原因与操作建议，不再只显示裸"退出码 1"。

## [0.3.2] - 2026-03-25

### 安全与加固

- **Capabilities 拆分**：将 `src-tauri/capabilities/default.json` 的开发 Vite 端口（5173）移至独立的 `capabilities/dev.json`；生产构建通过 `tauri.build.conf.json` 仅加载 `default`，`tauri dev` 通过 `tauri.dev.conf.json` 同时加载二者，消除生产包内开发端口可信来源。
- **Gateway 帧 Zod 验证**：`gateway-client.ts` 的 `handleMessage` 对所有 `event` / `res` 帧在使用前经 `gatewayEventFrameSchema` / `gatewayResponseFrameSchema` 做 safeParse，不再依赖裸 `as` 断言。
- **异步错误可见性**：`chat.ts` 的 async IIFE 及 `gateway.ts` 所有 `void import().then()` 均补充 `.catch(e => console.error(...))` ，消除静默吞错。
- **输入大小前置检查**：`dialog_save_base64_file` 在 base64 过滤前限制 68MB 输入；`install_zip_base64` 在解码前限制 110MB 输入，均早于内存分配。
- **openclawExecutable 路径校验**：写入前校验长度上限与 shell 元字符，拒绝 `|`、`;`、`` ` `` 等注入字符。
- **mXSS 防护**：将 `applyExternalLinkTargets` 中的 `innerHTML` 二次解析改为 DOMPurify `afterSanitizeAttributes` hook 直接操作 DOM 节点，消除净化后二次解析的 mutation XSS 向量。
- **CSP 收紧**：`vite.config.ts` 中移除 `img-src http:`；`connect-src` 的 WebSocket 限收到 `ws://127.0.0.1:*` 与 `wss://127.0.0.1:*`；`frame-src` 移除 `data:`。

### 改进

- **static_server.rs**：移除 `sleep(200ms)` 的脆弱时机假设；`TcpListener::bind` 成功后端口已在 OS 层处于 LISTEN 状态，无需等待 axum accept 循环预热。
- **Mutex 毒化显式化**：`openclaw_gateway.rs` 三处 `MANAGED_CHILD` 锁操作从 `unwrap_or_else(|e| e.into_inner())` 改为 `expect("MANAGED_CHILD mutex poisoned")`，使异常状态可见而非静默恢复。
- **skills.rs zip 安装**：`install_zip_path` 不再将文件内容 base64 编码后再解码，直接将文件字节传入公用函数 `extract_zip_bytes_to_dest`，消除约 2.33x 的内存峰值。

### 修复

- **一次性定时任务**等结束后，网关从 `sessions.list` 移除对应会话时，不再把当前选中强行改回 `sessions[0]`（主会话），避免聊天区**刚切到定时会话又立刻消失**；对已从列表消失的当前键在本地挂一条 **「…（已结束）」** 占位行，切走其它会话后下次刷新即与网关列表对齐。
- **`sessions.changed`**：先 **`await` 会话 `refresh()`** 再按需 **`loadHistory(silent)`**（与 `onHello` 一致），避免静默历史抢先拉主会话与刷新竞态。
- **Windows 初始化 / 拉起 OpenClaw**：从桌面启动时若系统 **PATH 缺少 `System32`**，仅写 `powershell.exe` 会报 **「无法启动 PowerShell：program not found」**。现对 `powershell` 使用 **`%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`**（存在时），并对子进程 **`PATH` 前置 System32、PowerShell、Wbem**（与 `windows_enhanced_path` 一致）。

### 变更

- 首次向导「安装并初始化」：用 **分步状态列表**（环境检测 → Node.js → OpenClaw CLI → onboard → 完成）替代仅无限进度条；阶段来自 `ensure-openclaw-windows.ps1` 的 `ui=…` 标记与 Tauri 的 `didclaw-ensure-install-phase`（spawn 前 `precheck_ok`）。下方日志区仍可展开查看细节。
- 定时任务列表「运行态」列改为 **运行中 / 已运行 / 未运行**（依据网关 `state.runningAtMs`、`lastRunAtMs` 与 `lastStatus`/`lastRunStatus`）；原「最近 / 下次 / 上次」细项保留为单元格悬停提示。

## [0.3.1] - 2026-03-24

### 修复

- 网关下行 **`cron`** / 与当前选中会话同 **`sessionKey` 的 `agent`**：在**本机未发送且无本地 `runId`** 时 **750ms 防抖** 拉 **`chat.history`（silent）**。实测部分版本定时任务期间仅有 `cron`/`agent`、**无 `chat`**，仅靠原逻辑主时间线不刷新，与重连后拉历史不对齐。
- 网关下行 **`sessions.changed`**（与官方 Control UI `app-gateway.ts` 一致）：收到后刷新会话列表并对当前会话静默 **`chat.history`**，避免定时任务等写入主时间线后界面不更新、仅重连才对齐。
- **`chat` 事件**若因载荷与 Zod 校验不完全匹配而被丢弃，对**当前选中会话**增加节流的 **`loadHistory` 兜底**，降低主会话 systemEvent / 网关新状态枚举导致「无实时刷新」的概率。
- 定时任务「已有任务」：`cron.list` 响应解析增加 `rows` / `records` / `values`、`payload` 与 `cron` 嵌套等兼容，并在结构化字段不匹配时用**浅层启发式**识别任务数组，降低网关返回形态升级后出现空列表的概率。
- 网关 `connect` 的 `caps` 改为默认空数组（不再仅声明 `tool-events`），以接收 **`chat` 下行事件**；避免定时任务等在 `cron:` 等会话运行时界面不刷新、需重连才出现历史（参见 [OpenClaw Session 文档](https://docs.openclaw.ai/concepts/session) 中 cron 会话键说明）。

### 新增

- **网关推送诊断日志**：`src/lib/gateway-debug-log.ts`。开发环境默认在控制台输出 `[didclaw][gateway-push]`（`chat` / `sessions.changed` / `loadHistory` 等关键路径）；生产或 Tauri 可 `localStorage.setItem("didclaw_debug_gateway","1")` 后刷新开启，设为 `"0"` 可在开发构建下关闭。
- 定时任务弹窗：对接 **`cron.status`**（顶部调度摘要）、**`cron.runs`**（运行记录列表、范围/排序、分页加载、带 `sessionKey` 时「打开会话」）；**`cron.list`** 请求参数与官方 Control UI 对齐（`includeDisabled`、`offset`、`sortBy`、`sortDir` 等，失败时回退简化参数）。**`cron.update` / `cron.remove` / `cron.run`** 改用与官方一致的 **`id`** 字段。辅助解析见 `src/lib/cron-gateway.ts`。
- `public/logo-didclaw-variants.html`：DidClaw Logo 字体与样式对比静态页，便于选型与评审。

### 变更

- 网关 **`agent`** 下行：仅在 **`stream` 非 `tool`**（lifecycle / compaction 等）或 **`tool` 且 `phase === "result"`** 时参与防抖静默拉 **`chat.history`**，跳过高频 **`tool` start/update**，减轻请求与 `incomingCount` 抖动；**`cron`** 仍按原逻辑触发。
- 定时任务创建表单：「会话」选项与说明对齐 [OpenClaw Cron](https://docs.openclaw.ai/automation/cron-jobs) / [Session](https://docs.openclaw.ai/concepts/session) 主会话与隔离行为，便于理解主聊天窗与 `cron:` 会话的差异。
- 顶栏品牌区：DidClaw 标题分色（D / idCl / aw）、Righteous 字体与菱形标配色调整；`index.html` 补充加载 Righteous 字重。
- 聊天：网关 `chat` 事件若针对**非当前选中会话**（如定时任务在隔离会话跑），在输入区空闲时**自动切换到该会话**并展示流式/结果；若本地仍在发送或生成中则仅节流刷新会话列表，避免打断当前轮次。

## [0.3.0] - 2026-03-24

### 新增

- **桌面端 DidClaw 本地存储**：在应用数据目录使用 SQLite（`didclaw.db`）存放网关本机合并配置及白名单 KV（设备身份、首次引导、Skills 安装根、OpenClaw 更新提示等）；纯浏览器仍使用 `localStorage`。未发版阶段**不**做自旧 `gateway-local.json` 或 `localStorage` 的自动迁移。OpenClaw 的 `~/.openclaw` 文件逻辑未改。

### 变更

- DidClaw 本地 SQLite：**移除**自 `gateway-local.json` 与自 WebView `localStorage` 的自动迁移逻辑（未发版阶段不维护老数据恢复路径）。
- Tauri：`permissions/didclaw.toml` 的 `invoke-all` 白名单补充 `didclaw_kv_get` / `didclaw_kv_set` / `didclaw_kv_remove`（及遗漏的 `dialog_save_base64_file`），避免 ACL 拒绝 IPC。

### 文档

- 新增 `docs/didclaw-sqlite-storage-migration.md`：DidClaw 自有数据统一 SQLite 的方案与实施说明（OpenClaw `~/.openclaw` 不在此范围）。
