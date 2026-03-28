# Changelog

本文件记录 DidClaw / LCLAW 仓库面向协作者与用户的可见变更。**每次提交请同步追加条目**（见 `.cursor/rules/didclaw-project.mdc`）。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/）。**版本号规则**（SemVer、`package.json` / `tauri.conf.json` / `Cargo.toml` 同步、标签 `v*`）见 `.cursor/rules/didclaw-project.mdc` 中的「版本号与发版」。

## [未发布]

### 新增

- **会话栏切换体验收敛**：会话栏从叠加式按钮列表改为单个下拉选择，减少多渠道 / 多子会话时的顶部占用；新增 `Ctrl + Tab` / `Ctrl + Shift + Tab` 快捷键用于前后切换会话，并对常见会话 key 做显示过滤（如 `WhatsApp +手机号`、`WeChat`、`agent:main`），降低长 session key 的视觉噪音。
- **会话支持本地关闭隐藏**：会话栏新增「关闭」按钮，可将当前非主会话仅从本地列表中隐藏，方便用户暂时收起微信 / WhatsApp 等会话；该操作不会删除后端真实会话，若后续该会话又收到新消息、`lastActiveAt` 更新后会自动重新出现。

### 修复

- **飞书渠道安装配置体验补齐**：飞书安装向导现在会先检查 OpenClaw 环境是否已初始化，未安装时直接给出明确提示；安装成功后自动补写 `channels.feishu.enabled=true`，并在弹窗中提示后续的 `重启 Gateway`、`/feishu start` 与 `/feishu auth` 验证步骤。手动配置路径新增 `Feishu / Lark` 区域选择，同时过滤安装日志里与飞书无关的重复 WhatsApp 插件警告，避免误导用户。
- **飞书安装失败时支持一键清理残留**：新增桌面端飞书残留清理能力；当安装日志出现 `plugin already exists` / `openclaw-lark` 残留特征时，渠道弹窗会直接提示并提供「清理飞书残留」按钮，自动清掉 `channels.feishu`、`plugins.entries/install` 中的飞书残项以及 `~/.openclaw/extensions/openclaw-lark` 目录，方便用户立即重试安装。
- **飞书插件已安装时跳过重装，直接进入扫码配置**：桌面端现在会先检查 `~/.openclaw/extensions/openclaw-lark` 是否已完整安装（含 `package.json` 与 `node_modules`）。若已存在，则不再重复执行 `@larksuite/openclaw-lark install` 的安装/更新链路，而是直接调用飞书注册接口生成二维码并轮询返回的机器人凭据，写回官方插件所需的 `channels.feishu.appId/appSecret/domain` 与 `plugins.entries.openclaw-lark` 配置，显著减少重复安装导致的失败与日志噪音。
- **清理两处历史 lint error**：`InlineToolTimeline.vue` 中恒为 `false && ...` 的占位表达式改为直接 `false`，去掉 `no-constant-binary-expression`；`AboutView.vue` 空模板改为最小合法根节点，去掉 `vue/valid-template-root`。以上调整不改变现有功能行为。

## [0.5.0] - 2026-03-28

### 新增

- **WhatsApp 绑定状态真实验证**：扫码/CLI 完成后不再仅凭 `web.login.wait` 的 `connected` 或进程退出码判断「绑定成功」，而是额外调用网关 `channels.status` RPC（`probe:true`）验证 `channels.whatsapp.linked === true`（与官方 Control UI 完全一致）。若 linked 为 false 则明确报错提示重试，防止「界面显示成功但实际未关联」；CLI 降级路径增加软重连后再做验证。
- **个人微信绑定后 Gateway 重连策略彻底重写**：原策略（12s 软连超时 → kill 进程硬重启）会打断 Gateway 自行加载微信插件的过程，导致必然失败。新策略：CLI 退出后先等 5s 沉淀，再纯轮询等待 Gateway 自行恢复（最多 35s），不主动 kill 进程；35s 后若仍未连接则显示「绑定已完成，点「重启 Gateway」使配置生效」（`pending-restart` 状态）而非标记为失败，避免误导用户重试。
- **个人微信扫码绑定可靠性修复**：①为每次绑定流程生成唯一 `flowId`，Tauri 事件（`channel:line/qr/done`）均携带该 ID，前端只处理 ID 匹配的事件，彻底解决重试或并发时事件串台导致的假成功/假失败问题；②扫码成功后显式调用 `writeChannelConfig("openclaw-weixin", { enabled: true })` 写入 `openclaw.json`，确保网关加载该渠道（修复「扫码成功但数据没写入」的根本问题）；③允许二维码 URL 刷新更新（去掉「只取第一个 QR URL」的限制）；④stderr 同步做 QR URL 检测（部分 CLI 版本将 URL 输出到 stderr）；⑤插件检测由目录存在改为检查 `package.json` 存在，避免空目录误判为已安装；⑥`channel:done` 失败时在日志中显示退出码与错误信息，方便排查。
- **后台子代理状态栏增加可点击跳转**：「后台子代理运行中」状态栏的提示文字改为可点击的「切换会话查看进度 →」按钮，点击后直接切换到后台代理所在会话，解决原有提示有文字无操作路径的问题。
- **连接后 20 秒后台静默数据同步**：Gateway 每次成功连接后约 20 秒，自动执行一次 `session.refresh()` + `loadHistory(silent)`，确保 OpenClaw 与桌面端会话/历史数据完全对齐（覆盖连接建立时渠道尚未就绪等边缘情况）。
- **WhatsApp 状态指示器 + 渠道健康轮询**：在聊天输入栏底部新增 WhatsApp 图标按钮（绿色=已连接，橙色=已绑定但未运行/连接，红色=未关联，灰色=Gateway 未连接）。点击图标弹出轻量级弹窗：未关联时直接显示 QR 码供扫码绑定，绑定但未运行时提供「重新连接」/「重启 Gateway」操作，已连接时显示确认状态。后台每 30 秒轮询 `channels.status` RPC 保持图标颜色与实际状态同步；检测到 `linked=true, running=false` 时自动尝试一次 `web.login.start` 恢复连接。
- **微信状态指示器**：在聊天输入栏底部新增微信图标按钮（绿色=已连接，橙色=已绑定但未运行，红色=未关联，灰色=Gateway 未连接）。点击图标弹出轻量级弹窗：未关联时触发 CLI 扫码流程（`startChannelQrFlow("wechat", ...)`），扫码前自动检测并安装微信插件（`checkChannelPluginInstalled` → `openclawPluginsInstall`，含已安装判断兜底），二维码实时渲染显示，扫码成功后自动写入渠道配置并等待渠道启动；已绑定未运行时提供「重启 Gateway」和「重新关联」操作；`useChannelHealth` 轮询同步更新微信/WhatsApp 双渠道状态。
- **UI 布局重构 — 左侧自动隐藏工具栏**：将顶栏中的功能按钮（定时任务、渠道管理、技能、主题切换、语言切换、重启 Gateway、Doctor 诊断、备份恢复、重做引导、复制诊断、关于）全部迁移到左侧 overlay 侧边栏（`ToolSidebar.vue`）。侧边栏默认隐藏，鼠标悬停窗口左边缘时滑出，离开后 300ms 自动收起，不影响主内容区宽度。顶栏简化为仅保留 DidClaw Logo 和连接状态 LED/开关，高度从 52px 降至 42px，为消息区腾出更多空间。

### 修复

- **微信渠道配置写入 key 错误**：`writeChannelConfig("wechat", ...)` 写入的是 OpenClaw 不认识的 channel id `wechat`，导致 `openclaw doctor` 报 `unknown channel id: wechat`。正确 channel key 为插件注册名 `openclaw-weixin`。修复 `ChannelSetupDialog.vue` 和 `WeChatIndicator.vue` 两处调用，并清理已污染的 `~/.openclaw/openclaw.json` 中的 `channels.wechat` 字段。
- **微信图标状态兜底修复**：腾讯微信插件在 `channels.status` 中虽然返回了 `openclaw-weixin` 条目，但 `linked/running/connected` 字段对前端不可可靠消费，导致实际已能收发消息时底部图标仍显示红色未关联，并且重复点击会再次拉起二维码。修复：微信图标除读取 `channels.status` 外，额外检测会话列表中是否已存在 `agent:main:openclaw-weixin:*` 会话；一旦存在即直接视为已在线并显示绿色，保证图标状态与真实通信能力一致。
- **OpenClaw 卸载后 FirstRunWizard 不弹出**：用户此前完成过初始化向导后，`isFirstRunModelStepComplete()` 标记留在 KV 中。如果之后卸载了 OpenClaw（`~/.openclaw` 目录不存在），向导仍被跳过。修复：在 `refreshStatus` 中优先检查 `openclawDirExists`，若为 false 则无论 KV 标记如何均显示环境安装步骤。同时在 WhatsApp 指示器的自动安装流程中增加 OpenClaw 环境预检，未安装时提示用户先完成初始化。
- **WhatsApp 扫码绑定成功后渠道未运行**：扫码绑定成功（`linked=true`）但渠道进程未启动（`running=false`），点击"重新连接"仅发一次 `web.login.start` 无后续验证。修复：① 扫码成功后等待 3 秒验证渠道 `running` 状态，若仍未启动则自动重启 Gateway 并等待渠道就绪；② "重新连接"按钮改为渐进式策略：先尝试 `web.login.start` + 等待验证，失败后自动升级为 Gateway 重启，并在弹窗中实时显示进度文字；③ 后台自动恢复（`tryAutoRecovery`）同样增加 Gateway 重启兜底，覆盖 `linked=true, running=false` 长期停滞的场景。
- **WhatsApp「已绑定」状态与官方 UI 不一致**：当 WhatsApp 会话 `linked=true` 但渠道实际未运行（`running=false`）或未连接（`connected=false`）时，DidClaw 仍显示绿色「已有绑定会话，无需重新扫码」。修复：在检测到无需扫码后额外调用 `channels.status` 获取完整渠道健康状态（`running`、`connected`、`lastError`），若渠道未正常运行则以警告色显示具体原因（含网关返回的 `lastError`），并提示用户「重新连接」或「重启 Gateway」；此状态下不再自动关闭对话框。
- **微信渠道绑定后误报「绑定失败」及 Gateway 重连超时**：插件安装后网关自行重启（WS close 1012 "service restart"），但 `startWechatInstall` 未等待网关恢复即启动 `channels login` CLI；登录成功后的 `restartGatewayAndReconnect` 又尝试重启网关进程，与已自行重启的进程端口冲突，导致连接超时 → 「绑定失败，请重试」。修复：① 插件安装后若网关断开，先通过软重连（`reloadConnection`，不杀进程）等待网关恢复，再启动扫码登录；② `channel:done` 成功后优先软重连，仅在软重连失败时才走完整重启路径，避免与自启进程冲突。

- **首次启动 Gateway 后会话/渠道状态不完整**：`ensureOpenClawGateway` 返回 `{started: true}` 时（即本次刚拉起新进程），`onHello` 触发后额外等待 4 秒再做一次静默 `session.refresh()` + `loadHistory()`，等待插件（WhatsApp / 微信等）完成初始化后补全状态。已在运行的 Gateway 重连时不触发额外刷新。
- **渠道绑定后自动关闭窗口并重连**：WhatsApp（RPC 路径）和微信扫码成功后，对话框在 1.8 秒后自动关闭，无需用户手动点击；关闭时若 Gateway 未连接则自动触发重连（兜底用户手动关闭场景）。WhatsApp CLI 降级路径因仍需手动重启 Gateway，不触发自动关闭。
- **微信渠道绑定优化**：① 新增桌面端 `check_channel_plugin_installed` Tauri 命令，按需检测本地插件，已安装则跳过重复下载，直接进入 `openclaw channels login --channel openclaw-weixin`；② 登录流程结束后自动从输出中提取扫码 URL，用 `qrcode` 库渲染为可直接扫描的图片二维码；③ 将大块滚动终端输出替换为单行黑底滚动状态条，交互界面更简洁；④ 降级路径补全：命令未注册或插件已存在时均不再中断流程。
- **TypeScript 构建报错修复**：全项目将 `ReturnType<typeof setTimeout>` / `ReturnType<typeof setInterval>` 类型声明统一改为 `number`，与 `window.setTimeout` 的浏览器返回值一致，消除 11 处 TS2322 / TS2345 编译错误。

### 新增

- **个人微信（WeChat）渠道接入**：通过腾讯官方 ClawBot 插件接入个人微信，零封号风险。渠道设置新增「微信」标签页，包含前置步骤说明（在微信中开启 ClawBot 插件）、流式安装向导（`npx -y @tencent-weixin/openclaw-weixin-cli@latest install`）、自动检测输出中的扫码 URL 并以高亮链接展示（方便在浏览器中扫码）、ASCII 二维码终端输出、成功后重启 Gateway 按钮。当前仅支持 iPhone 微信 8.0.70+，Android 版即将推出。

- **WhatsApp 渠道对话框新增「重新连接」按钮**：当检测到已有绑定会话时（无需重新扫码），在操作区展示「重新连接」主按钮，点击后触发 `web.login.start` 唤醒因 Gateway 重启而进入 stopped/disconnected 状态的插件，无需重新扫码也无需重启 Gateway；「重启 Gateway」退为次选操作。注意：「开始扫码登录」仍需手动点击触发，不再自动调用（自动探测会中断已有的活跃 WhatsApp 连接）。

- **deviceToken 持久化与有界重试**：Gateway 在 `hello` 响应中颁发的 `deviceToken` 现已自动保存到设备身份存储（桌面端使用 Tauri KV，浏览器端使用 `localStorage`）。重连时若无用户配置的 `token`/`password`，自动携带已保存的 `deviceToken`，避免重复配对审批。若用户凭证触发 `AUTH_TOKEN_MISMATCH`，按协议规范尝试一次以 `deviceToken` 为凭证的有界重试；认证错误时自动清除失效的 `deviceToken` 缓存。

### 修复

- **渠道设置插件安装后重启 Gateway，立即扫码报"invalid handshake: first request must be connect"**：`restartGatewayAndReconnect` 和 `tryStartWhatsAppRpc` 原先使用 `client.connected`（仅检查 WebSocket `readyState === OPEN`）判断 Gateway 是否就绪，但此时 `connect` 握手可能还未完成。修复后改为检查 `gwStore.status === "connected"`（仅在 `onHello` 回调后设置），并在握手完成后额外等待 800ms，确保 Gateway 插件完成初始化后再发送 RPC。

- **WhatsApp 等渠道收到消息后仅显示"后台子代理运行中"、未自动切换到会话窗口**：WhatsApp 等渠道消息处理时 Gateway 只发 `agent` 事件（走 announce 投递），不发 `chat.delta`，导致原先依赖 `chat.delta` 的 shouldFollow 自动切换逻辑从未触发。修复后：当某个后台会话首次出现 `agent` 事件（`flashingSessionKeys` 尚未包含该会话，即 5 秒内未曾高亮过）且 composer 空闲时，自动切换到该会话，与 `chat.delta` 的行为对齐；此后同一会话的后续 `agent` 事件不会重复触发切换。

- **定时任务投递频道选了 WhatsApp 但消息未发送到手机**：官方文档明确指出，当 `delivery.to` 为空时，无论 `delivery.channel` 设置了什么，网关均回退到"最后活跃路由"而忽略指定的频道。修复内容：① 选了具体频道（非"自动"）时，收件人/目标字段标注为必填并展示该频道对应的格式示例（WhatsApp → 手机号如 `+8613XXXXXXXXX`；Telegram → 群 ID 或 `:topic:` 格式；Slack → `channel:CXXXXX` 等）；② `submitCreate` 增加校验，频道已选但 `to` 为空时阻止提交并提示；③ 选"自动（最后使用的渠道）"时仍保持可选行为不变。

## [0.4.0] - 2026-03-26

### 新增

- **后台会话收到消息时，会话按钮高亮闪动提示**：当 WhatsApp 等渠道在后台收到消息并触发 agent 活动时，左侧会话列表中对应的会话按钮会短暂亮起青色边框与背景（约 5 秒），帮助用户快速感知有新消息待处理，点击即可切换。
- **切换到正在处理中的后台会话时显示 AI 运行计时器**：用户手动切换到仍在运行的后台会话后，首个到达的 `chat.delta` 事件会自动启动计时器，状态栏与以往主窗口保持一致（阶段标签 + 秒数 + 超时提示），不再因 `loadHistory` 清空 `runStartedAtMs` 而导致计时无法显示。

### 修复

- **`--unonboard` 安装后首次接入渠道缺少插件的问题**：渠道向导现在会在用户点击接入时按需补齐常见渠道的最小启用配置；WhatsApp 检测到 Gateway 缺少 provider 时，会先自动安装 `@openclaw/whatsapp`、写入 `channels.whatsapp.enabled=true`、重启并重连 Gateway，然后重试 `web.login.start`，不再直接卡在交互式插件安装提示。
- **WhatsApp CLI 降级误把插件安装提示当成登录成功**：命令行回退路径现在会识别 `Install WhatsApp plugin?` / `Use local plugin path` / `Skip for now` 等交互提示，避免把“尚未真正开始登录”的退出结果错误显示成“登录成功”；同时将 RPC 成功与 CLI 成功的后续操作区分开来，只有 CLI/已有会话场景才强调重启 Gateway 生效。
- **WhatsApp 向导 CLI 降级提示命令名错误**：警告横幅和注销提示中写的是 `openclaw channel ...`（单数），已更正为与 Rust 实际执行一致的 `openclaw channels login --channel whatsapp` 和 `openclaw channels logout --channel whatsapp`。
- **WhatsApp 登录成功后的操作引导更准确**：CLI 降级路径或“已有绑定会话”场景会明确展示「🔄 重启 Gateway 立即生效」；直接走 Gateway RPC 扫码成功时则只保留刷新，避免误导用户做不必要的重启。
- **WhatsApp 向导点「开始扫码登录」误报「请先连接 Gateway」**：Pinia store 对 `shallowRef` 自动解包，`gwStore.client` 已是 `GatewayClient | null`，代码中多写了一层 `.value` 导致连接检测永远为 false。移除多余的 `.value` 后恢复正常。
- **WhatsApp 接入改为双路径**：① 优先尝试 Gateway RPC `web.login.start`（插件可用时直接返回 `qrDataUrl` 图片显示）；② provider 仍不可用时再回退到 `openclaw channels login --channel whatsapp` 的命令行登录。终端框在 CLI 路径下扩大至 400px 高度，字号缩小以完整展示 ASCII art 二维码供手机扫描。
- **`SlashCommandPicker` Vue warn `update:activeIndex` 未声明**：鼠标悬停时通过 `$emit('update:activeIndex', i)` 更新高亮索引，但该事件未在 `defineEmits` 中声明。已补充 `"update:activeIndex": [index: number]` 声明，消除控制台警告。

- **WhatsApp 渠道向导无法显示二维码**：原实现通过运行 `openclaw channels login --channel whatsapp` CLI 并从 stdout 提取 URL 的方式获取 QR 码，但 WhatsApp 插件不走该路径输出 QR URL。正确方式是通过 **Gateway WebSocket RPC** 调用 `web.login.start`（直接返回 `qrDataUrl` base64 图片）→ 显示 QR 图片 → 调 `web.login.wait` 等待扫码确认。新增「插件未加载」友好错误提示（当上游 `@openclaw/whatsapp` 插件不可用时）。`channel:line` / `channel:qr` Tauri 事件监听不再用于 WhatsApp，相关冗余代码已清除。Rust 侧同步保留了 `strip_ansi()` 辅助函数以备其他渠道扩展使用。

### 新增

- **消息渠道接入向导（P1-3）**：顶栏新增「渠道」按钮（与「定时任务」「技能」并列），点击打开四渠道向导：
  - **WhatsApp**：流式运行 `openclaw channels login --channel whatsapp`，自动接受插件选择提示（3 次 Enter/1.5s 间隔），已有本地 session 时提示「无需重新扫码，重启 Gateway 即可使用」并提供快捷重启按钮。
  - **飞书 / Lark**：主路径为运行官方插件安装向导 `npx -y @larksuite/openclaw-lark install`（流式输出，自动创建机器人并写入配置）；备用路径可折叠展开，手动填写 App ID / App Secret。
  - **Discord**：Bot Token 表单，直接写入 `openclaw.json` 的 `channels.discord`。
  - **企业微信（WeCom）**：Bot ID + Secret 表单 + 一键安装插件按钮（`@wecom/wecom-openclaw-plugin`），写入 `channels.wecom`。
  - Rust 新增 `write_channel_config` / `start_channel_qr_flow` / `resolve_npx_executable` 命令；个人微信列为后续迭代。

- **Exec 审批 UI（P1-2）**：AI 执行终端命令前，DidClaw 桌面端通过 Gateway `exec.approval.requested` 事件弹出审批对话框，显示待执行命令、工作目录和所属 Agent；用户可选择「仅此次允许」「总是允许」或「拒绝」，响应通过 `exec.approval.resolve` RPC 发回网关（参数字段为 `id`，已通过真实 gateway 响应校验）。支持多请求排队，队列不为空时弹窗持续展示。

- **模型故障切换配置（P1-5）**：AI 配置面板新增「备用模型（故障切换）」区块。用户可从已配置服务商的模型列表中选择备用模型，也可手动输入 `provider/model` 格式添加。保存后写入 `agents.defaults.model.fallbacks`，主力模型不可用时 OpenClaw 自动按顺序切换。

- **Slash 命令提示面板（P1-4）**：消息输入框输入 `/` 时自动弹出命令选择浮层，预置 `/new`、`/remember`、`/forget`、`/status`、`/usage`、`/model` 六条命令；支持键盘 ↑↓ 导航、Enter/Tab 选中、Esc 关闭；选中后自动填入草稿，有参数的命令末尾留空格供继续输入。

- **配置备份与恢复（P0-5）**：顶栏「···」菜单新增「备份与恢复」入口（仅桌面端可见）。点击后可将 `~/.openclaw/` 打包为 zip 文件保存到任意位置，或从备份 zip 还原配置。备份自动跳过 `logs/`、`completions/`、`agents/*/sessions/` 等大体积目录，同时估算并展示备份体积。

- **会话 Token 用量展示**：消息面板标题栏右侧新增 Token 用量指示器，显示本次会话累计输入（↑）与输出（↓）数量（来自 Gateway `sessions.list`，每次刷新会话列表后更新）。无数据时自动隐藏。

- **修复 AI配置模型列表编辑后保存丢失**：点「完成」退出编辑模式后再点「应用」，之前 `editedModels` 会读旧 snap 数据，导致用户的修改被丢弃。现改为只要 `modelEditText` 有内容就以它为准，点「完成」仅切换显示形态，实际数据不回滚。

- **兼容 OpenClaw CLI 老用户的 API Key 读取**：老用户通过 `openclaw configure` 设置的密钥仅存于 `auth-profiles.json`，不存于 `models.json`。现读取 provider 时自动从 `auth-profiles.json` 补充缺失的 `apiKey`，老用户打开 AI配置界面可正确显示"已配置"和现有密钥，无需重新输入。

- **修复 AI配置 Tab 重新打开后 API Key 显示为空**：`AiProviderSetup` 组件通过 `v-if` 懒渲染，每次切换 tab 均为全新挂载；watch 缺少 `immediate: true` 导致挂载时 `loadAll()` 未被调用，已修复。

- **修复「No new output for a while」误报**：卡住检测现在同时考虑文本 delta 和工具时间线事件；纯工具调用阶段（无文字输出）不再误触发卡住提示。

- **后台子代理运行感知**：当后台子代理（运行在非当前选中会话的 agent）活跃时，消息面板运行状态栏会显示「后台子代理运行中…」蓝色脉冲指示，提示用户有任务在进行中，避免误认为程序已停止。120 秒内无新事件时自动消失；用户切换至对应会话后指示器隐藏。

### 修复

- **Windows 重启 Gateway 报 `ERR_UNKNOWN_SIGNAL: SIGUSR1`**：`openclaw gateway restart` 内部对运行中的进程发送 SIGUSR1 信号（Unix 专有）；Windows 不存在此信号导致 `TypeError`。修复：Windows 下改为直接 kill 托管子进程 + spawn 全新进程（等待 2s 启动），完全绕开信号问题；非 Windows 仍走原 `openclaw gateway restart` 服务路径。

- **Windows 重启 Gateway PowerShell `MethodArgumentConversionInvalidCastArgument`**（早期更早的路径）：PowerShell 脚本中 `$q=[char]34` 与 `$q+$q`（结果为 `[string]`）类型不一致，`String.Replace(char, string)` 重载不存在。已改为 `$q=[string][char]34`，两参数统一为 `string`。

- **「网关诊断」弹窗背景透明**：对话框使用了未在主题中定义的 CSS 变量 `--lc-bg`，导致 `background` 无效、底层界面透出。已改为与「关于」弹窗相同的 `var(--lc-surface)` 及阴影 token。

- **网关诊断结果难读**：结果改为「错误 / 警告 / 建议」三块摘要，不再逐行堆砌终端原文；「自动修复」仅在存在 doctor 标出的严重项（✓/⚠/✗ 中的 ✗ 及 `[error]`/`[fail]`）时显示。完整 CLI 输出仍在「原始输出」中折叠查看。

- **网关诊断进行中无反馈**：诊断 / 自动修复为单次 IPC，无法显示真实百分比；在按钮下方增加不确定（往返滑动）进度条，并尊重 `prefers-reduced-motion`。

- **网关诊断列表出现灰色方块**：`openclaw doctor` 终端输出里的 Unicode 进度条/块字符在无衬线界面字体中常显示为「豆腐块」。解析结果列表现仅保留含字母数字或中文的可读行；装饰性纯符号行不再列入卡片，完整原文仍在「原始输出」中查看。

### 变更

- **「① 连助手」Tab UI 精简**：去掉顶部冗余说明文段；口令/Token Placeholder 缩短；两个 checkbox 合并进一个带浅底的分组框；「openclaw 可执行文件」移入可折叠「高级选项」，默认收起，普通用户不会看到；autoStart 说明缩短为一句。

- **「网关诊断」入口上移至顶栏「···」菜单**：原先隐藏在「本机设置 → ① 连助手」Tab 最底部折叠区的 Doctor 面板，改为从顶栏「···」菜单直接打开独立对话框（Tauri 桌面端可见）。移除了设置对话框内的折叠入口。

- **「关于」改为弹窗**：点击顶栏「···」菜单中「关于」改为弹出小对话框，不再跳转整页。对话框展示：DidClaw 版本号、OpenClaw 网关版本号（已连接时）、软件简介、主要开源技术栈（Tauri 2、Vue 3、TypeScript、OpenClaw、Vite）和版权信息。原 `/about` 路由保留但自动重定向到首页。

### 修复

- **顶栏「···」菜单点击无效**：`#app` 有 `position:relative; z-index:1` 建立了层叠上下文，Teleport 到 body 的 scrim（z-index 50）位于 `#app`（z-index 1）之上，导致整个菜单被 scrim 遮盖，所有点击都被拦截。彻底修复：移除 Teleport scrim，改用 `document.addEventListener('click', ...)` 监听区域外点击来关闭菜单，不再依赖 z-index。

- **生产构建 CSP 错误**：`dist/index.html` 注入的 CSP 缺少三项必要指令，导致 Tauri IPC 全部失败、主题初始化脚本被拦截、界面空白。修复：`script-src` 补加 `'unsafe-inline'`（内联主题脚本）和 `'unsafe-eval'`（vue-i18n v9 运行时消息编译），`connect-src` 补加 `http://ipc.localhost`（Tauri 2 IPC 协议）。

### 新增

- **Doctor 图形化诊断**：「本机设置 → 连助手」Tab 底部新增可折叠的「网关诊断」面板。点击「运行诊断」调用 `openclaw doctor --non-interactive`，前端解析 ✓/⚠/✗ 前缀输出行并以颜色卡片展示；发现错误时出现「自动修复」按钮执行 `--repair`；支持展开原始输出。Tauri 侧新增 `run_openclaw_doctor` 命令（自动查找 `openclaw` 可执行文件，可传自定义路径）。

- **国际化（i18n）支持**：接入 `vue-i18n v9`，界面支持中文 / 英文双语。在「本机设置」对话框标题栏增加"中 / EN"语言切换按钮，选择结果持久化到 `localStorage` 并跟随系统语言自动检测。涉及 `AppHeader`、`MessageComposer`、`AboutView`、`GatewayLocalDialog`、`CronJobsDialog` 等核心组件的全量汉字字符串均已提取至 `src/i18n/zh.ts` 与 `src/i18n/en.ts`。

- **卡片式 AI 配置界面**：新增"② AI 配置"Tab，用卡片替代原有的"② AI 账号 + ③ 选模型"两步流程。用户在对应服务商卡片填入 API Key 后点"应用并设为主力"，即可自动完成 Provider 写入 + 主力模型设置，无需手动填写接口地址或模型列表。预置 11 家主流服务商（智谱/DeepSeek/MiniMax/Kimi/Qwen/小米/Anthropic/OpenAI/OpenRouter/xAI/Mistral/Ollama），含国内/国际节点切换。原高级 Tab 保留供需要精细控制的用户使用。

### 修复

- **OpenClaw 升级按钮实际上不执行升级的 Bug**：原脚本在 openclaw 已安装时进入 "already installed" 分支直接跳过 `npm install`，再命中 `-SkipOnboard` 立刻退出，导致点击"升级"后什么都没发生。修复：在 `ensure-openclaw-windows.ps1` 中新增 `-Upgrade` 开关，当该开关启用时，强制执行 `npm install -g openclaw@latest`，再自动运行 `openclaw doctor`（配置迁移），与 OpenClaw 官方推荐更新流程对齐。
- **升级后缺少网关重启步骤**：升级完成后现在展示"升级完成"面板，提供"立即重启网关"按钮，点击后自动重启网关并重新连接，无需手动操作。

- **定时任务触发后消息在会话中出现后消失**：根因是 `cron` WS 事件在 delivery/announce 落库前就触发 `loadHistory`，导致以旧快照覆盖了界面上已流式显示的投递消息。修复：移除 `cron` 事件 → `loadHistory` 的直接触发，让后续 `agent` 事件（携带 `sessionKey`，在 delivery 完成后发出）来负责同步；同时将防抖延迟从 750ms 提高到 1500ms，给落库留足余量。

### 改进

- **新建会话后不再显示 UUID**：会话选择区将无标签的 UUID 格式会话 key 显示为"新对话"，会话切换列表同步处理；chip 字体改为正文字体，中文标签显示更自然。

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
