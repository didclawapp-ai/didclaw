# OpenClaw 功能清单（仓库对齐版）

> **用途**：DidClaw 对照上游时的开发参考；发版或升级 OpenClaw 后按文末 [维护与同步](#文档维护与同步) 更新。  
> **权威来源**（优先级）：`openclaw/openclaw` 仓库 **README.md** → **`extensions/` 目录** → **`package.json`** → [官方文档](https://docs.openclaw.ai)（细节以文档为准）。  
> **同步锚点**：GitHub `main` @ **2026-04-04**；npm 包版本示例 **2026.4.4**（以你本地 `openclaw --version` / `npm view openclaw version` 为准）。

---

## 文档维护与同步

每次 OpenClaw 大版本或 DidClaw 要做协议对齐时，建议按顺序核对：

| 步骤 | 内容 |
|------|------|
| 1 | 阅读 [README.md](https://github.com/openclaw/openclaw/blob/main/README.md) 首段与 **Channels**、**Highlights**、**Everything we built** |
| 2 | 浏览仓库 [`extensions/`](https://github.com/openclaw/openclaw/tree/main/extensions) 子目录名（通道、模型、搜索、语音等以包为准） |
| 3 | 查看 `package.json` 的 `version`、`engines.node` |
| 4 | 客户端相关：[`src/gateway/server-methods/`](https://github.com/openclaw/openclaw/tree/main/src/gateway/server-methods)（Gateway RPC 面） |
| 5 | 更新本文 **同步锚点** 日期与版本行 |

**不在此文档保证范围**：具体配置键名、RPC 参数以运行中的 Gateway 与 TypeBox/schema 为准；数字类营销表述（如「35+ 厂商」）改为「以 `extensions/` 与已安装插件为准」。

---

## 一、核心架构

| 组件 | 说明 |
|------|------|
| **Gateway（网关）** | 本地优先控制平面：会话、通道、工具、事件；默认 WebSocket `ws://127.0.0.1:18789`（端口以配置为准） |
| **CLI** | `openclaw` 单二进制入口（`openclaw.mjs`） |
| **Pi Agent Runtime** | RPC 模式代理运行时，工具流式与块流式 |
| **Control UI / WebChat** | 由 Gateway 直接提供的 Web 界面（非独立端口形态见官方 [Web](https://docs.openclaw.ai/web)） |
| **会话模型** | `main` 直连对话、群组隔离、激活模式、队列模式、reply-back 等（详见官方 [Session](https://docs.openclaw.ai/concepts/session)） |

**配置与工作区（README）**

- 主配置：`~/.openclaw/openclaw.json`
- 工作区：`~/.openclaw/workspace`（可由 `agents.defaults.workspace` 配置）
- 注入提示词文件：`AGENTS.md`、`SOUL.md`、`TOOLS.md`
- 工作区技能路径：`~/.openclaw/workspace/skills/<skill>/SKILL.md`

---

## 二、消息通道

### 2.1 README 枚举的通道（主清单）

以下与 [官方 README「Channels」小节](https://github.com/openclaw/openclaw/blob/main/README.md) 一致（**含 IRC**，与旧版「内置 / 插件」人工二分无关；实际上多数字段为 **bundled extensions + 配置**）：

| 通道 | 文档 / 实现备注 |
|------|-----------------|
| WhatsApp | Baileys |
| Telegram | grammY |
| Slack | Bolt |
| Discord | discord.js |
| Google Chat | Chat API |
| Signal | signal-cli |
| BlueBubbles | iMessage（推荐） |
| iMessage | legacy `imsg` |
| IRC | 官方 Channels 列表内 |
| Microsoft Teams | Bot Framework，`msteams` |
| Matrix | |
| Feishu（飞书） | |
| LINE | |
| Mattermost | |
| Nextcloud Talk | |
| Nostr | |
| Synology Chat | |
| Tlon | |
| Twitch | |
| Zalo | |
| Zalo Personal | 文档路径常为 zalouser |
| **WebChat** | Gateway WebSocket，无独立 WebChat 端口 |

### 2.2 微信（WeChat）

- **不在** 上述 README 单行枚举的写法里单独强调时，仍属官方支持通道：通过 **npm 插件** [`@tencent-weixin/openclaw-weixin`](https://www.npmjs.com/package/@tencent-weixin/openclaw-weixin)（iLink Bot API）。
- 安装：`openclaw plugins install "@tencent-weixin/openclaw-weixin"`，再 `openclaw channels login --channel openclaw-weixin` 扫码。
- 版本约束：插件 **v2.x** 需 OpenClaw **≥ 2026.3.22**（以 README 为准）。

### 2.3 `extensions/` 中有、README 单行未点名的通道类扩展

仓库 [`extensions/`](https://github.com/openclaw/openclaw/tree/main/extensions) 中存在 **`qqbot`**（QQ）等；**是否出现在发行版默认捆绑中** 以安装结果与 `openclaw plugins` 为准。维护时请在 `extensions/` 下检索 `channels` 类包名。

### 2.4 平台节点（勿与「消息通道」混淆）

README **Highlights** 中「multi-channel」旁列的 **macOS / iOS / Android** 指 **配套 App 与节点能力**（语音、Canvas、摄像头等），不是与 Slack 并列的 IM 协议名。

### 2.5 通道能力（README 级摘要）

- **群组**：提及门控、回复标签、分渠道分块与路由（[Group messages](https://docs.openclaw.ai/channels/group-messages)）。
- **DM 安全**：默认 **pairing**；`openclaw pairing approve …`；`openclaw doctor` 检查危险 DM 策略。
- **通道路由 / 重试 / 流式分块**：见官方 Concepts。

---

## 三、运行环境与安装

| 项 | 说明 |
|----|------|
| **Node** | README：**Node 24（推荐）或 Node 22.16+** |
| **engines** | `package.json` 当前多为 **`node >= 22.14.0`**；若与 README 冲突，以**较严**或**实际运行 CI** 为准 |
| **包管理** | `npm` / `pnpm` / `bun` 全局安装：`openclaw@latest` |
| **推荐入门** | `openclaw onboard --install-daemon`（安装 Gateway 守护进程） |
| **更新通道** | `stable`（npm `latest`）/ `beta` / `dev`；`openclaw update --channel stable|beta|dev` |

**源码构建（README）**

```bash
git clone https://github.com/openclaw/openclaw.git && cd openclaw
pnpm install && pnpm ui:build && pnpm build
# 开发：`pnpm gateway:watch`
```

**部署形态（官方文档为主）**

- **Docker**、**Nix** 见官方 Install 文档。
- **Tailscale Serve/Funnel**、**SSH 隧道**、远程 Gateway：见 [Remote](https://docs.openclaw.ai/gateway/remote)、[Tailscale](https://docs.openclaw.ai/gateway/tailscale)。
- **Windows**：README 强调 **WSL2 强烈推荐**；原生 Windows 是否覆盖部分能力以官方 [Windows](https://docs.openclaw.ai/platforms/windows) 为准。

> 旧文档中的 **Kubernetes / Ansible / Raspberry Pi** 等若未在 README 逐条承诺，**不写入本清单正文**；需要时只链到官方文档。

---

## 四、AI 模型与提供商

### 4.1 如何维护列表

- 官方 README **不维护**「35+ 厂商」固定表；**真实集合** = `extensions/` 下 **模型/推理相关包** + 已安装的 **npm 插件**。
- 下列按 **2026-04-04** 的 `extensions/` 子目录归纳（**非穷举保证**，同步时请重新 `ls extensions/`）。

### 4.2 `extensions/` 中的提供商与网关类包（示例分组）

| 分组 | 示例目录名 |
|------|------------|
| 海外闭源 / 综合 | `anthropic`, `openai`, `google`, `mistral`, `xai`, `perplexity`, `microsoft`, `amazon-bedrock`, `microsoft-foundry`, `anthropic-vertex` |
| 聚合 / 路由 | `openrouter`, `litellm`, `vercel-ai-gateway`, `cloudflare-ai-gateway`, `chutes`, `groq`, `together`, `nvidia`, `huggingface` |
| 国产与区域 | `moonshot`, `kimi-coding`, `deepseek`, `qianfan`, `volcengine`, `byteplus`, `stepfun`, `minimax`, `zai`, `xiaomi`, `modelstudio` |
| 开源本地 | `ollama`, `vllm`, `sglang` |
| 编码助手向 | `github-copilot`, `copilot-proxy`, `kilocode`, `opencode`, `opencode-go`, `synthetic`, `open-prose` |
| 其他 | `venice`, `lobster`, `llm-task`, `acpx`, `diagnostics-otel`, `shared` … |

### 4.3 模型能力（README / Concepts）

- **模型故障转移**：[Model failover](https://docs.openclaw.ai/concepts/model-failover)
- **会话修剪**：[Session pruning](https://docs.openclaw.ai/concepts/session-pruning)
- **用量追踪**：[Usage tracking](https://docs.openclaw.ai/concepts/usage-tracking)
- **会话级模型覆盖**、**思考级别** `off|minimal|low|medium|high|xhigh`：配置与 `sessions.patch`（README 提及与 `/think` 等）

> **更正（相对旧稿）**：「百川」与 Moonshot/Kimi 易混淆；上游扩展以 **`moonshot` / `kimi-coding`** 为准，勿写死未在仓库出现的厂商名。

---

## 五、工具系统

### 5.1 README「First-class tools」与运维相关

| 能力 | 说明 |
|------|------|
| **Browser** | 专用 openclaw Chrome/Chromium，CDP（快照、操作、上传、配置） |
| **Canvas** | A2UI push/reset、eval、snapshot（常依赖节点） |
| **Nodes** | 摄像头、录屏、`location.get`、通知等；macOS 另含 `system.run` / `system.notify` |
| **Cron + wakeups** | 定时与唤醒 |
| **Sessions** | `sessions_list` / `sessions_history` / `sessions_send` 等（跨会话协作） |
| **Discord / Slack actions** | README 单独点名的通道侧能力 |

### 5.2 搜索与其它工具扩展（`extensions/` 示例）

与搜索/爬取/媒体相关的扩展目录包括但不限于：`brave`, `duckduckgo`, `exa`, `firecrawl`, `searxng`, `tavily`, `browser`, `memory-core`, `memory-lancedb`, `image-generation-core`, `media-understanding-core`, `fal`, `deepgram`, `elevenlabs`, `speech-core`, `talk-voice`, `voice-call`, `phone-control`, `diffs`, `openshell` …

具体 **工具名、沙盒默认值、allow/deny 列表** 以官方 [Tools](https://docs.openclaw.ai/tools)、[Security](https://docs.openclaw.ai/gateway/security) 为准（含非 main 会话 Docker 沙盒与默认 deny 的工具集）。

### 5.3 工具配置概念

- 工具 profile、按提供商限制等：见 [Configuration](https://docs.openclaw.ai/gateway/configuration)。
- **`code_execution`** 等是否启用与形态：以当前版本文档与 Gateway 为准，本清单不硬编码。

---

## 六、自动化与外部触发

README **明确列出**：

| 能力 | 链接方向 |
|------|-----------|
| **Cron + wakeups** | [Cron jobs](https://docs.openclaw.ai/automation/cron-jobs) |
| **Webhooks** | [Webhook](https://docs.openclaw.ai/automation/webhook) |
| **Gmail Pub/Sub** | [Gmail Pub/Sub](https://docs.openclaw.ai/automation/gmail-pubsub) |

**以下旧稿中的名词**（Heartbeat、Standing Orders、Poll、Tasks、ClawFlow 等）**未在 README 总览中逐条对应**：若产品需要，请到官方文档与 CHANGELOG 检索后再写入本文件，避免与主线描述脱节。

---

## 七、语音与多媒体

| 能力 | 说明 |
|------|------|
| **Voice Wake** | macOS / iOS（官方文档） |
| **Talk Mode** | Android 连续语音等 |
| **TTS** | ElevenLabs + 系统 TTS 回退（README）；扩展见 `speech-core`, `elevenlabs`, `talk-voice` 等 |
| **语音通话** | 扩展目录 **`voice-call`**（以插件说明为准） |
| **媒体管道** | 图/音/视频、转录钩子、大小上限、临时文件（README **Media pipeline**） |

---

## 八、设备与节点

与 README **Apps + nodes** 一致：

- **macOS**：菜单栏、Voice Wake/PTT、Talk Mode、WebChat、调试、远程网关、TCC。
- **iOS**：配对、Canvas、Voice Wake、Talk Mode、摄像头、录屏、Bonjour。
- **Android**：配对、Connect/Chat/Voice、Canvas、摄像头/录屏、设备命令族（通知、位置、短信等）。
- **macOS node 模式**：`system.run` / `system.notify` 与 canvas/摄像头等经 Gateway 协议暴露。

**Gateway 协议（README）**：`node.list` / `node.describe` / `node.invoke`；**Elevated bash** 与 TCC 分离；`/elevated on|off` 与 **`sessions.patch`** 持久化字段（含 `thinkingLevel`, `verboseLevel`, `model`, `sendPolicy`, `groupActivation`）。

---

## 九、Canvas（A2UI）

| 能力 | 说明 |
|------|------|
| **A2UI** | Agent 驱动可视化工作区 |
| **Present / Eval / Snapshot / Navigate** | 见官方 [Canvas / A2UI](https://docs.openclaw.ai/platforms/mac/canvas) |

---

## 十、安全机制

| 能力 | 说明 |
|------|------|
| **DM 配对与 allowlist** | 见 README Security defaults |
| **沙盒** | `agents.defaults.sandbox.mode: "non-main"` 等，非 main 会话可进 Docker（详见官方 Security + Docker） |
| **工具 allow/deny** | 含默认沙盒白名单/黑名单（README Security model） |
| **网关鉴权** | Token / 密码；Tailscale 下 Funnel 需 password 等约束 |
| **网关锁 / 密钥** | [Gateway lock](https://docs.openclaw.ai/gateway/gateway-lock)、`secrets` CLI |
| **Exec 审批** | 人机确认执行（与 Gateway 事件配合） |

---

## 十一、Web 界面与发现

| 界面 | 说明 |
|------|------|
| **Control UI** | [Control UI](https://docs.openclaw.ai/web/control-ui) |
| **WebChat** | [WebChat](https://docs.openclaw.ai/web/webchat) |
| **Dashboard** | [Dashboard](https://docs.openclaw.ai/web/dashboard) |
| **TUI** | `openclaw tui` |

**发现与配对**：Bonjour/mDNS、Gateway pairing 等见 README [Advanced docs](https://github.com/openclaw/openclaw/blob/main/README.md)。

---

## 十二、技能与生态

- **Skills**：bundled / managed / workspace（[Skills](https://docs.openclaw.ai/tools/skills)）。
- **ClawHub**：[clawhub.com](https://clawhub.com)（README **Skills registry**）。
- **插件**：`openclaw plugins …`；插件可注册通道、模型、工具等；**WeChat** 为典型外部插件。

---

## 十三、Gateway WebSocket 与客户端开发（DidClaw 相关）

| 项 | 说明 |
|----|------|
| **RPC 实现位置** | [`src/gateway/server-methods/`](https://github.com/openclaw/openclaw/tree/main/src/gateway/server-methods) |
| **协议文档** | [Architecture / RPC](https://docs.openclaw.ai/concepts/architecture) |
| **本项目契约笔记** | 仓库内 `docs/gateway-client-protocol-notes.md` |

升级 OpenClaw 后应 **diff `server-methods/`** 与 DidClaw 的 `request("…")` 调用表。

---

## 十四、CLI 与聊天斜杠命令

### 14.1 CLI（常见）

`onboard`, `gateway`, `agent`, `message send`, `channels`, `config`, `doctor`, `update`, `plugins`, `skills`, `nodes`, `devices`, `pairing`, `cron`, `sessions`, `models`, `memory`, `browser`, `logs`, `secrets`, `sandbox`, `tui`, `completion` …（完整以 `openclaw --help` 与文档为准）

### 14.2 聊天内斜杠命令（README）

`/status`, `/new` | `/reset`, `/compact`, `/think …`, `/verbose on|off`, `/usage …`, `/restart`, `/activation …`（群组命令多为 owner-only）

---

## 十五、远程访问

- **Tailscale Serve / Funnel**（`gateway.tailscale.mode`：`off` | `serve` | `funnel`）
- **SSH 隧道**
- **Bonjour/mDNS**、**设备配对**（WebSocket）

约束：启用 Serve/Funnel 时常要求 **`gateway.bind` 为 loopback**；Funnel 需 `gateway.auth.mode: "password"` 等（README **Tailscale access**）。

---

## 十六、运维与可观测

README **Operations** 指向：

- [Health checks](https://docs.openclaw.ai/gateway/health)
- [Gateway lock](https://docs.openclaw.ai/gateway/gateway-lock)
- [Background process](https://docs.openclaw.ai/gateway/background-process)
- [Logging](https://docs.openclaw.ai/logging)
- [Browser troubleshooting (Linux)](https://docs.openclaw.ai/tools/browser-linux-troubleshooting)
- [Doctor](https://docs.openclaw.ai/gateway/doctor)

---

## 十七、其它运行时特性（Concepts）

- Presence、Typing indicators、Streaming/chunking、Retry、Queue、Agent loop、TypeBox schemas、RPC adapters 等：见官方 **Concepts / Deep dives** 索引。

---

## 十八、总结

OpenClaw 是 **本地优先的个人 AI 助手平台**：**统一 Gateway** 连接 **README 所列消息通道**（外加 **微信 npm 插件** 与 **`extensions/` 扩展**），通过 **Pi 运行时与工具** 驱动 **CLI / Web / 节点 App**，并配套 **Cron、Webhook、Gmail、Skills/ClawHub、安全与沙盒**。

**DidClaw 对齐建议**：以本文 **§2 通道**、**§5 工具**、**§13 Gateway RPC** 为检查入口；细节始终以 **当前安装的 `openclaw` 版本** 与 **`docs/gateway-client-protocol-notes.md`** 为准。

**客户端实现状态与路线图**：见 [`didclaw-openclaw-alignment.md`](./didclaw-openclaw-alignment.md)（按功能域标注 ✅/🟡/❌，用于排期）。

---

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-04-04 | 初版由 workspace 拷贝入 `docs/` |
| 2026-04-04 | 按 `openclaw/openclaw` **README** + **`extensions/`** 重写：修正 Node 表述、IRC/通道列表、微信插件与 QQ 扩展关系；删减 README 未背书项；增加维护步骤与 Gateway `server-methods` 索引 |
| 2026-04-04 | 总结节链到 [`didclaw-openclaw-alignment.md`](./didclaw-openclaw-alignment.md)（DidClaw 对齐与路线图） |
