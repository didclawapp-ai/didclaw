# DidClaw 桌面端（Electron）专属 — 实现方案

> **状态**：已拍板，按本文实施。  
> **结论前置**：产品 **仅交付 Electron**；设置 **全部收拢顶栏「本机」对话框**（连接已有，模型后续同入口）；**不做独立 `/settings` 路由**。

---

## 1. 背景与目标

### 1.1 产品决策（已定）

- **不考虑浏览器**：不保留 Web 专用连接设置与路由。
- **网关侧默认模型**：以本机 **`~/.openclaw/openclaw.json`** 为准（与 OpenClaw 文档一致）；由 **Electron 主进程 IPC** 做 **白名单字段** 的读/写（见阶段 B）。
- **模型切换**：`chat.send` **仍不带根级 `model`**。会话栏 **下拉切换 `agents.defaults.model.primary`**（写回 `openclaw.json`，写前备份），选项来自 **`agents.defaults.models`**（及当前 primary）；**「管理模型」** 负责完整编辑与恢复备份。

### 1.2 文档表述（实施时注意）

- 默认端口上的 HTTP 页面是 **webchat 等**，勿称「独立 Control UI 配置后台」。
- 对外链 **官方 Configuration / configuration-reference**；**具体字段名实施前对照文档核对**。下文 **1.3** 已与 **本机实测 `openclaw.json`** 对齐，实施时若上游 schema 有变再小调。

### 1.3 本机 `openclaw.json` 中与模型相关的三层结构（实测）

模型相关**不只是** `agents.defaults.model.primary`，实际至少分三层；**阶段 B 只碰前两层**，第三层明确不碰。

| 层级 | 路径（概念） | 作用 | 阶段 B |
|------|----------------|------|:------:|
| **① 默认主模型** | `agents.defaults.model`（如 `primary`，及文档中同级的 `fallbacks` 等） | 网关默认使用的主模型（及备选链） | ✅ 读写（白名单字段） |
| **② 别名注册表** | `agents.defaults.models` | `provider/model-id` → `{ "alias": "展示名" }` 或 `{}`；供 `/model`、展示名等；**本会话下拉选项的 key 列表应来源于此** | ✅ 读写（合并整表或约定子集，禁止改 key 以外结构为随意 JSON） |
| **③ Provider 定义** | `models.providers`（根级 `models` 下的 `providers`，与官方结构一致即可） | 各 provider 的 `baseUrl`、`api`、`models[]` 等——**增删「真实模型」必须改这里** | ❌ **不做**；用户用 **CLI 或手改** |

**产品含义**：

- 阶段 B 若**只写 ① 不写 ②**，会出现「加了别名但下拉/注册表不一致」或「别名指向的 ref 在 provider 里不存在」→ **`chat.send` 仍可能报错**。因此 **IPC 读写的白名单必须同时覆盖 ① + ②**（在「本应用承诺写入」的范围内做深度合并）。
- **③ 不写入**：避免在 UI 里误配 API、能力字段导致网关起不来；**新增 provider / 新型号**仍走 CLI 或手工编辑 `openclaw.json`。
- **第一阶段能力闭环**：从**已注册**的模型里选默认（①）、维护**别名**（②）；**不**在应用内增删 provider 条目（③）。

---

## 2. 当前代码与差距（基线）

| 区域 | 现状 | 目标 |
|------|------|------|
| 连接 | `gateway-local.json` + 「本机」对话框 | 保持 |
| `/settings`、`SettingsView`、`gateway-web-storage` | Web 与双端分支 | **删除**（不标废弃） |
| 顶栏 | Web 才有「连接设置」链到 `/settings` | **仅「本机」**；无独立设置页 |
| 模型 UI / `chat.send` | 曾尝试根级 `model` | **不随 `chat.send` 发 `model`**；会话栏 **下拉写 `primary`** + **「管理模型」** 编辑表；网关按配置/会话解析 |
| 默认模型 + 别名 | 未接 `openclaw.json` | **阶段 B**：「本机」对话框 + IPC 读写 **① + ②**（见 §1.3） |

---

## 3. 架构原则（精简）

1. 本机文件读写：**仅 main**；preload 白名单；渲染进程 **`window.didClawElectron`**。
2. 连接配置：仍以 **`gateway-local.json`** 为准（现有逻辑）。
3. **`openclaw.json`**：**固定路径** `path.join(homedir(), '.openclaw', 'openclaw.json')`（Windows 即用户目录下等价路径）。**不解析 `OPENCLAW_CONFIG_PATH`**。
4. 不写 Gateway 源码。

---

## 4. 实施顺序与内容

**顺序：A → C → B**（先收干净环境与产品表述，再锁定下拉文案，最后做模型文件读写）。**预估整体 2～3 个工作日**；其中 **阶段 A 应在一日内收尾**。

---

### 阶段 A — 形态收敛（同意，别拖）

| 项 | 做法 |
|----|------|
| **路由** | **删除 `/settings`** 及 `SettingsView.vue`；`router` 中移除对应 route。 |
| **存储** | **删除** `gateway-web-storage` 及所有引用；`gateway.ts` 中非 Electron 分支按团队是否保留「无壳 Vite 联调」二选一：**要么删光只留 Electron**，要么保留最简「仅 env URL」仅供开发（拍板：若无人无壳调试，可删光）。 |
| **顶栏 / 关于** | 去掉指向 `/settings` 的链接；关于页改为 **仅桌面** 说明；任何「连接设置」引导指向 **「本机」**。 |
| **文档** | 轻量更新 [`didclaw-功能补全清单.md`](./didclaw-功能补全清单.md)：正式形态 Electron；删掉或改写「Web 端连接设置页」等条目；误导性「Control UI」用语改为 webchat + 文档链。**不必大改全书**。 |
| **README** | 以 **exe / 打包** 为主；浏览器部署标为 **不支持** 或不写。 |

**验收**：安装包内只靠「本机」完成网关连接配置；无 `/settings`、无 localStorage 网关覆盖逻辑。

---

### 阶段 C — 模型与 `chat.send`（随上游 schema 调整）

- **不向 `chat.send` 附加根级 `model`**（与 OpenClaw `validateChatSendParams` 一致，否则报 `unexpected property 'model'`）。
- **会话栏**：下拉切换 **`primary`**（IPC 写回 **①**，写前备份）；选项来自 **②** 的 key + 当前 primary。**「管理模型」** 编辑完整 **①②** 与恢复备份。

---

### 阶段 B — `openclaw.json` 模型白名单（核心价值，方案从简）

#### 不做（明确砍掉）

- ❌ **JSON5 库**：**标准 JSON** 读写；非法 JSON → 报错。
- ❌ **`OPENCLAW_CONFIG_PATH`**：路径写死 **`~/.openclaw/openclaw.json`**。
- ❌ **「打开文件夹」产品功能**：失败 → **报错** + 文案可带 **备份文件路径**。
- ✅ **`models.providers`（第 ③ 层）**：**应用内「供应商」Tab + IPC** 做**按 provider 键合并写入**（`baseUrl`/`baseURL`、`apiKey`、`models` 等）；**不**整文件覆盖。复杂结构仍可 CLI / 手改 JSON。

#### 必须保留

- ✅ **写前必备份（硬约束）**：在**覆盖写入** `openclaw.json` 之前，必须先把**当前磁盘上该文件的完整内容**复制为备份（建议同目录、带时间戳的文件名，便于保留多份历史）。**若备份步骤失败，必须中止本次写入**并提示用户，避免「无备份的覆盖」。
- ✅ **可操作的恢复方法（硬约束）**：用户必须能**在误改后把配置救回来**，不能只依赖「自己找备份文件」：
  - **一期**：「本机」提供 **「恢复上次备份」** 一类入口，对应 IPC **`restoreOpenClawConfigToLatestBackup()`**（见下表）。主进程**内部**可自行枚举同目录备份并取**最新一份**，**不把列表 API 暴露给渲染进程**。
  - **列表里挑历史版本**：不作为一期范围；若以后要做，再迭代加 API/UI。
  - **兜底**：在 UI 或 README 中写明**备份文件所在目录、命名规则**，用户可手动复制回 `openclaw.json`；**不能**只有兜底而没有应用内一键恢复。
  - **恢复时再次备份**：执行「恢复」覆盖当前 `openclaw.json` 之前，对**当前**文件**再备一份**，避免恢复操作本身造成不可回退。
- ✅ **白名单合并写入（两层）**：
  - **`agents.defaults.model`**（至少 `primary`；若有 `fallbacks` 等与官方一致字段可按同一策略合并）；
  - **`agents.defaults.models`**（别名注册表：整对象深度合并或按产品约定的「增删改别名」规则，**禁止**变成任意 JSON 编辑器）。
- ❌ 不修改根级及其它与模型无关的大段配置（合并时只动上述路径下的对象）。

#### IPC（openclaw.json）

| API | 行为 |
|-----|------|
| `readOpenClawModelConfig()` | 返回 **`agents.defaults.model`** + **`agents.defaults.models`**。 |
| `writeOpenClawModelConfig(payload)` | 合并写入 ①②；**写前完整备份**。 |
| `readOpenClawProviders()` | 返回 **`models.providers`** 对象（浅拷贝各 provider）。 |
| `writeOpenClawProvidersPatch({ patch })` | 按 provider id **合并**写入 ③；`patch[id]=null` 删除该供应商；**写前完整备份**。 |
| `restoreOpenClawConfigToLatestBackup()` | 用最新 `openclaw.json.didclaw-backup-*`（或历史 `*.lclaw-backup-*`）覆盖当前配置；**覆盖前再备份当前文件**。 |

**渲染进程不暴露** `listOpenClawConfigBackups()`；枚举与排序仅在 main 内为 `restore…` 服务。

**别名约束**：`agents.defaults.models` 中的 ref 须在 **`models.providers`** 中存在对应 provider 与模型 id；可在「供应商」Tab 配置 ③ 后再维护 ②。

#### UI（「本机」对话框）

- **网关连接** + **模型（agents）**：① `primary`、② 别名表。
- **供应商**：③ `models.providers`（列表选 provider、编辑 API 地址 / Key / 模型 id 列表；Key 用密码框，备份文件仍为**明文全量**勿外发）。
- 保存成功：提示 **网关监视 / 热加载**（以官方为准）。

**验收**：合法 JSON 下可改 ①②③（合并写、写前备份）；可 **一键恢复最新备份**；无备份可恢复时有明确错误。

---

## 5. 风险与约束（同步瘦身）

| 风险 | 缓解 |
|------|------|
| 上游 schema 字段变更 | 白名单键名与文档同步；后续可小步调整 |
| 用户文件含 JSON5/注释 | 标准 JSON 解析失败则报错；用户改用合法 JSON 或 CLI |
| 仅写 ② 中 ref 但 ③ 无该模型 | **chat.send** 仍可能失败；UI 文案说明；不在一期做跨层校验 |
| 并发编辑 | 写入前再读合并；**备份**兜底 |
| 权限/只读 | 报错 + 备份路径（若已生成备份） |
| 误改配置 | **写前备份 + 应用内恢复**；恢复前再备份，避免恢复链不可回退 |

---

## 6. 已拍板摘要（原「待拍板」收口）

| 原问题 | 结论 |
|--------|------|
| `/settings` | **删**；设置进「本机」对话框 |
| `gateway-web-storage` / `SettingsView` | **删** |
| JSON5 / 环境变量路径 / 打开文件夹降级 | **不做** |
| 下拉 + `model` | **不发** `chat.send.model`；下拉 **只写 `primary`**；完整编辑仍用 **「管理模型」** |
| 模型三层 | **①② 应用内读写**；**③ 仅 CLI/手改** |
| `openclaw.json` 写入 | **写前完整备份**；失败则中止写入 |
| 配置恢复 | **应用内** `restoreOpenClawConfigToLatestBackup()`（+ 文档兜底）；**不暴露**列表类 IPC；恢复前再备份 |
| 实施顺序 | **A → C → B** |
| 无壳 Vite | 若团队不需要联调，**与 A 一并删**；需要则保留最小 env 只读 URL（团队自定） |

---

## 7. 参考链接

- [OpenClaw Configuration](https://docs.openclaw.ai/gateway/configuration)  
- [Configuration reference](https://docs.openclaw.ai/gateway/configuration-reference)  
- 仓库内 [`gateway-client-protocol-notes.md`](./gateway-client-protocol-notes.md)

---

## 8. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-03-21 | 初稿 |
| 2026-03-21 | 拍板修订：删设置路由与 web 存储；B 瘦身（仅 JSON、固定路径、双 IPC）；C 明确保留下拉；顺序 A→C→B；工期 2～3 天 |
| 2026-03-21 | 补充本机实测三层结构：`agents.defaults.model` + `agents.defaults.models` 为 B 期读写范围；`models.providers` 不写入；下拉选项改由 ② 驱动；IPC 返回/合并范围同步更新 |
| 2026-03-21 | 强制：写前必备份且备份失败则中止写入；应用内恢复入口；恢复前再备份 |
| 2026-03-21 | 一期 IPC 收敛为 3 个：去掉暴露给渲染进程的 list API；恢复统一为 `restoreOpenClawConfigToLatestBackup()` |
