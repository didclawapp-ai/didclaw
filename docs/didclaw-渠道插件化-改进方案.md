# DidClaw 渠道插件化改进方案

**背景**：渠道（Channel）是 DidClaw AI 接入外部世界的「感应器 + 执行器」。当前代码全部集中在 `ChannelSetupDialog.vue`（2100+ 行），随着 Gmail 等新平台的接入需求增加，需要重构为可扩展的插件化架构。

---

## 一、核心认知

### 插件 vs 技能的分工

| 维度 | 插件（Plugin / Channel） | 技能（Skill） |
|------|--------------------------|---------------|
| 本质 | 连接外部平台的桥梁 | 规范操作的说明书 |
| 解决什么 | "怎么连上 Gmail / 飞书？" | "怎么用这些工具完成任务？" |
| 用户感知 | 配置一次，之后透明运行 | 按需调用，可见的操作流程 |
| 类比 | 电插座 | 电器说明书 |

**推论**：`ChannelSetupDialog` 只管插件层（安装 → 认证 → 启用），不涉及 AI 用这个渠道做什么。

### 渠道的四种接入范式

| 范式 | 代表渠道 | 认证方式 |
|------|----------|----------|
| `qr` | WhatsApp、WeChat | 扫码（RPC 或 CLI） |
| `wizard` | Feishu | 流式安装向导 |
| `credential` | Discord、WeCom | 填写 Token / Secret |
| `oauth` | Gmail（未来） | OAuth 2.0 重定向 |

---

## 二、现状问题

### 代码层面

1. 2100+ 行单文件，所有渠道逻辑混在一起，新增渠道必须改同一个文件
2. Feishu 和 WeChat 的流式安装（CLI 事件流 + QR 提取）逻辑重复实现
3. `ChannelId` 是 hard-coded union type，注册新渠道需要同步修改多处
4. 所有渠道代码同步加载，对话框打开时资源浪费

### 扩展层面

1. 无法支持用户自定义安装插件渠道（如 `openclaw-gmail`）
2. 渠道 Tab 列表静态硬编码，无法动态增减
3. 无插件 Manifest 契约，前端无法自动渲染未知渠道的配置表单

---

## 三、目标架构

### 目录结构

```
src/features/settings/
  ChannelSetupDialog.vue          ← 对话框壳，仅约 120 行
  channels/
    types.ts                      ← 核心接口定义
    registry.ts                   ← 有序注册表，新增渠道只改此处
    base/
      useChannelContext.ts        ← provide/inject 共享上下文
      useGateway.ts               ← ensureGatewayConnected, restartGateway
      useStreamingInstall.ts      ← CLI 流式日志 + QR 提取（Feishu/WeChat 共用）
    whatsapp/
      def.ts                      ← 静态元信息（ChannelDef）
      WhatsAppPanel.vue           ← 专属安装面板
    feishu/
      def.ts
      FeishuPanel.vue
    wechat/
      def.ts
      WechatPanel.vue
    discord/
      def.ts
      DiscordPanel.vue
    wecom/
      def.ts
      WeComPanel.vue
    _generic/
      GenericPluginPanel.vue      ← 动态插件渠道的通用表单面板
```

**添加新渠道的完整工作量**：新建目录 + 在 `registry.ts` 加一行。`ChannelSetupDialog.vue` 不用改。

### 两层渠道模型

```
第一层：内置渠道（Built-in）
  WhatsApp / WeChat / Feishu / WeCom / Discord
  → registry.ts 静态注册
  → 有专属 Panel 组件（定制化向导 / QR / 表单）

第二层：插件渠道（Plugin Channel）
  openclaw-gmail / openclaw-slack / ...
  → Gateway RPC channels.installed 动态查询
  → 插件携带 Manifest（图标、字段 schema）
  → GenericPluginPanel.vue 按 schema 渲染表单
```

---

## 四、核心类型设计

### `channels/types.ts`

```typescript
export type SetupParadigm = 'qr' | 'wizard' | 'credential' | 'oauth'
export type ChannelSource = 'builtin' | 'plugin'

// 动态插件渠道的配置字段描述符
export interface ChannelConfigField {
  key: string
  label: string
  type: 'text' | 'password' | 'select' | 'multiselect' | 'oauth-button'
  required?: boolean
  placeholder?: string
  options?: { value: string; label: string }[]
}

// 渠道定义（静态元信息）
export interface ChannelDef {
  id: string
  source: ChannelSource
  icon: string
  nameKey: string                  // i18n key
  paradigm: SetupParadigm
  privacyLevel?: 'normal' | 'sensitive'
  supportsMultiAccount?: boolean

  // 内置渠道
  pluginPackageSpec?: string
  configPatch?: Record<string, unknown>
  docLinkKey?: string

  // 插件渠道（从 Manifest 读取）
  packageName?: string
  version?: string
  configSchema?: ChannelConfigField[]
}

// provide/inject 共享上下文（所有 Panel 通过 useChannelContext() 访问）
export interface ChannelContext {
  busy: Ref<boolean>
  showToast: (msg: string, error?: boolean) => void
  ensureGatewayConnected: (timeoutMs?: number) => Promise<boolean>
  restartGatewayAndReconnect: (toastMsg?: string) => Promise<boolean>
  ensureChannelReady: (id: string, opts: ChannelReadyOptions) => Promise<boolean>
  onSuccess: () => void            // 触发自动关闭计时
}

export interface ChannelReadyOptions {
  installPlugin?: boolean
  writeConfigPatch?: boolean
  restartGateway?: boolean
  restartToast?: string
  installFailureMessage?: string
  configFailureMessage?: string
}
```

### `channels/registry.ts`

```typescript
import { defineAsyncComponent } from 'vue'
import type { ChannelDef, Component } from './types'

// 内置渠道定义
import { whatsappDef } from './whatsapp/def'
import { wechatDef }   from './wechat/def'
import { feishuDef }   from './feishu/def'
import { wecomDef }    from './wecom/def'
import { discordDef }  from './discord/def'

export type ChannelEntry = ChannelDef & { panel: Component }

export const BUILTIN_CHANNELS: ChannelEntry[] = [
  { ...whatsappDef, panel: defineAsyncComponent(() => import('./whatsapp/WhatsAppPanel.vue')) },
  { ...wechatDef,   panel: defineAsyncComponent(() => import('./wechat/WechatPanel.vue')) },
  { ...feishuDef,   panel: defineAsyncComponent(() => import('./feishu/FeishuPanel.vue')) },
  { ...wecomDef,    panel: defineAsyncComponent(() => import('./wecom/WeComPanel.vue')) },
  { ...discordDef,  panel: defineAsyncComponent(() => import('./discord/DiscordPanel.vue')) },
  // 未来新增：
  // { ...gmailDef, panel: defineAsyncComponent(() => import('./gmail/GmailPanel.vue')) },
]

// 动态插件渠道由 ChannelSetupDialog 从 Gateway 查询后合并进 Tab 列表
```

### `channels/base/useChannelContext.ts`

```typescript
const CHANNEL_CTX: InjectionKey<ChannelContext> = Symbol('channelCtx')

// 由 ChannelSetupDialog 调用，创建并 provide 共享上下文
export function provideChannelContext(): ChannelContext {
  const gwStore = useGatewayStore()
  const busy = ref(false)
  // ...完整实现从现有代码迁移
  const ctx: ChannelContext = { busy, showToast, ensureGatewayConnected, ... }
  provide(CHANNEL_CTX, ctx)
  return ctx
}

// 由每个 Panel 调用，获取共享上下文
export function useChannelContext(): ChannelContext {
  return inject(CHANNEL_CTX)!
}
```

### `channels/base/useStreamingInstall.ts`（Feishu / WeChat 共用）

```typescript
export interface StreamingInstallOptions {
  channelId: string
  flowId: string
  extractQrUrl?: (line: string) => string | null   // 注入策略，各渠道不同
  onSuccess?: () => Promise<void>
}

export function useStreamingInstall() {
  const state = ref<'idle' | 'running' | 'success' | 'failed'>('idle')
  const lines = ref<string[]>([])
  const qrDataUrl = ref<string | null>(null)
  const summary = ref<string | null>(null)

  async function start(opts: StreamingInstallOptions): Promise<void> { ... }
  function cleanup(): void { ... }
  function reset(): void { ... }

  return { state, lines, qrDataUrl, summary, start, cleanup, reset }
}
```

---

## 五、插件 Manifest 契约（面向社区插件）

插件 `package.json` 中声明 `openclaw` 字段，Gateway 通过 `plugins.installed` RPC 返回给前端：

```jsonc
// node_modules/openclaw-gmail/package.json
{
  "name": "openclaw-gmail",
  "openclaw": {
    "channelId": "gmail",
    "displayName": "Gmail",
    "icon": "📧",
    "paradigm": "oauth",
    "privacyLevel": "sensitive",
    "supportsMultiAccount": true,
    "configSchema": [
      {
        "key": "clientId",
        "label": "OAuth Client ID",
        "type": "text",
        "required": true
      },
      {
        "key": "scopes",
        "label": "授权范围",
        "type": "multiselect",
        "options": [
          { "value": "gmail.readonly", "label": "读取邮件" },
          { "value": "gmail.send",     "label": "发送邮件" },
          { "value": "gmail.labels",   "label": "管理标签" }
        ]
      },
      {
        "key": "authorize",
        "label": "授权 Gmail 账号",
        "type": "oauth-button"
      }
    ],
    "docLink": "https://docs.didclaw.com/channels/gmail"
  }
}
```

`GenericPluginPanel.vue` 按 `configSchema` 自动渲染表单，无需前端预知该渠道的存在。

---

## 六、对话框 UI 变化

### Tab 栏

```
[ 💬 WhatsApp ][ 🟢 WeChat ][ 🪶 Feishu ][ 💼 WeCom ][ 📧 Gmail ][ + ]
  ↑ 内置渠道（registry.ts）                              ↑ 动态插件  ↑ 安装新渠道
```

Tab 列表由 `BUILTIN_CHANNELS + dynamicChannels`（Gateway 查询）合并生成，对话框无需感知渠道细节。

### 安装新渠道面板（`+` Tab）

```
手动安装插件渠道

包名：[ openclaw-gmail                    ] [安装]

推荐插件：
  📧 Gmail     openclaw-gmail     [安装]
  💬 Telegram  openclaw-telegram  [安装]
  📋 Notion    openclaw-notion    [安装]
```

安装流程复用 `useStreamingInstall`，完成后 refetch `channels.installed`，Tab 栏自动出现新渠道。

---

## 七、实施步骤

### 阶段一：建立目录骨架（不破坏现有代码）

- [ ] 创建 `channels/types.ts`（接口定义）
- [ ] 创建 `channels/base/useChannelContext.ts`（provide/inject 骨架，暂为空实现）
- [ ] 创建 `channels/base/useGateway.ts`（从现有代码迁移 `ensureGatewayConnected` 等）
- [ ] 创建 `channels/registry.ts`（注册表骨架，暂为空数组）
- [ ] `pnpm run typecheck` 验证

### 阶段二：迁移最简单的渠道（Discord）

- [ ] 创建 `channels/discord/def.ts`
- [ ] 创建 `channels/discord/DiscordPanel.vue`（纯表单，无异步逻辑）
- [ ] 在 `registry.ts` 注册 Discord
- [ ] `ChannelSetupDialog` 接入 `provideChannelContext()` + 注册表驱动 Tab 渲染
- [ ] 删除 `ChannelSetupDialog` 中旧的 Discord 逻辑
- [ ] `pnpm run typecheck` 验证

### 阶段三：迁移 WeCom

- [ ] 创建 `channels/wecom/def.ts` + `WeComPanel.vue`
- [ ] WeCom Panel 通过 `useChannelContext()` 获取 `showToast`、`busy`、`ensureChannelReady`
- [ ] 迁移完成，删除旧代码，验证

### 阶段四：提取 useStreamingInstall，迁移 Feishu

- [ ] 创建 `channels/base/useStreamingInstall.ts`
- [ ] 将 Feishu 流式安装逻辑迁移为 `useStreamingInstall` 调用
- [ ] 创建 `channels/feishu/def.ts` + `FeishuPanel.vue`
- [ ] 迁移完成，删除旧代码，验证

### 阶段五：迁移 WeChat（复用 useStreamingInstall）

- [ ] WeChat 与 Feishu 共用 `useStreamingInstall`，仅注入不同的 `extractQrUrl` 策略
- [ ] 创建 `channels/wechat/def.ts` + `WechatPanel.vue`
- [ ] 迁移完成，删除旧代码，验证

### 阶段六：迁移 WhatsApp（最复杂）

- [ ] 创建 `channels/whatsapp/def.ts` + `WhatsAppPanel.vue`
- [ ] 双路径（RPC + CLI 降级）逻辑迁入 `useWhatsApp.ts` composable
- [ ] 迁移完成，删除旧代码
- [ ] `ChannelSetupDialog.vue` 此时应已精简至约 120 行
- [ ] `pnpm run typecheck` + `pnpm run lint` 全量验证

### 阶段七：动态插件渠道支持（Gateway 配合）

- [ ] Gateway 侧：`plugins.installed` RPC 返回已安装插件的 Manifest 列表
- [ ] 前端：`ChannelSetupDialog` 启动时 fetch 动态渠道列表，合并到 Tab 栏
- [ ] 实现 `GenericPluginPanel.vue`（`configSchema` → 表单渲染）
- [ ] 实现 `+` 安装面板（手动输入包名 + 流式安装）

### 阶段八：OAuth 范式支持（Gmail 等）

- [ ] 创建 `channels/base/useOAuthFlow.ts`（系统浏览器授权 + 回调轮询）
- [ ] `ChannelConfigField` 支持 `oauth-button` 类型
- [ ] Token 安全存储走 Rust 侧（不落前端内存）
- [ ] Gmail Panel 或 GenericPluginPanel 接入 OAuth 流程

---

## 八、关键约束

1. **每个阶段完成后必须 `pnpm run typecheck`**，确保类型链路不断
2. **最小改动原则**：模板和样式在阶段六完成前保持不变，只迁移 script 逻辑
3. **安全**：OAuth token、API Secret 只经 Rust 侧存储，前端不持有明文凭据
4. **插件包名校验**：`+` 安装面板对包名格式做客户端校验（`/^[@a-z0-9][\w\-./]*$/i`），安装前弹确认提示
5. **隐私提示**：`privacyLevel: 'sensitive'` 的渠道（如 Gmail）在配置前展示额外说明

---

## 九、收益总结

| 关注点 | 现在 | 重构后 |
|--------|------|--------|
| 新增内置渠道 | 改 2100+ 行单文件 | 新建目录 + 注册表加一行 |
| 新增社区插件渠道 | 不支持 | 发布 npm 包 + 写 Manifest 即可 |
| 渠道间代码隔离 | 所有逻辑混在一处 | 每个目录独立，依赖单向 |
| 流式安装复用 | Feishu / WeChat 各写一套 | 共享 `useStreamingInstall` |
| 按需加载 | 打开对话框全量加载 | `defineAsyncComponent` 懒加载 |
| 类型安全 | `ChannelId` hard-coded union | 从注册表 derive，自动同步 |
