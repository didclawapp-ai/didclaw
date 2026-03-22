# LCLAW UI：Electron → Tauri 迁移计划

本文档面向 `lclaw-ui` 子项目，在已备份仓库的前提下，将桌面壳从 **Electron** 迁到 **Tauri 2**，以显著减小安装包体积（Windows 主要依赖系统 WebView2）。

---

## 1. 目的与范围

| 项目 | 说明 |
|------|------|
| **主要目标** | 用 Tauri 替代 Electron 打包桌面端；保留现有 Vue 前端与业务行为（网关、OpenClaw 配置、本地预览等）。 |
| **范围内** | `lclaw-ui` 内构建链、Rust 后端命令、前端 `invoke` 封装、Windows 优先验证。 |
| **范围外（首期可不做）** | macOS/Linux 安装包签名与公证；CI 全矩阵；文档站同步改版（除非单独要求）。 |

---

## 2. 现状盘点（基于当前仓库）

### 2.1 Electron 侧代码体量

| 文件 | 约行数 | 职责摘要 |
|------|--------|----------|
| `electron/main.ts` | ~557 | 窗口生命周期、全部 `ipcMain.handle`、预览读文件/Base64、剪贴板、对话框、与配置/网关模块衔接 |
| `electron/openclaw-config.ts` | ~888 | `~/.openclaw` 下 JSON 读写、备份命名、模型/Provider 合并逻辑、敏感字段处理 |
| `electron/openclaw-gateway-process.ts` | ~212 | 解析 `ws://` 本机端口、`where openclaw` / 可执行路径、TCP 探测、`spawn` 子进程、退出清理 |
| `electron/static-server.ts` | ~107 | 生产环境在 `127.0.0.1` 起静态 HTTP 服务（默认端口 34127，环境变量 `LCLAW_UI_STATIC_PORT`），避免 `file://` 导致 Gateway **Origin 校验失败（1008）** |
| `electron/preload.ts` | ~104 | `contextBridge` 暴露 `window.lclawElectron` |

**合计**：主进程相关 TypeScript 约 **1900 行**，逻辑密度高，不是「薄壳」。

### 2.2 已注册的 IPC 通道（与 Tauri Command 一一对应）

以下名称建议迁移时保留为 **命令名或内部路由**，便于前端对照与排错：

| 通道 | 职责 |
|------|------|
| `preview:openLocal` | 本地 `file:` 预览（图片/PDF/文本/Markdown/Office→LibreOffice 等） |
| `preview:libreOfficeStatus` | 检测本机 LibreOffice / `soffice` |
| `preview:openLibreOfficeDownloadPage` | 打开官网下载页 |
| `preview:showLibreOfficeInstallDialog` | 原生提示框 + 可选打开下载页 |
| `shell:openFileUrl` | 系统默认应用打开本地文件 |
| `file:saveCopyAs` | 另存为复制 |
| `shell:prepareEmailWithLocalFile` | 资源管理器定位 + 剪贴板路径 |
| `shell:copyLocalFileForShare` | 剪贴板多行分享文本 |
| `dialog:openFile` | 选择本地文件 → 返回 `file:` URL |
| `gateway:readLocalConfig` | 读 `userData/gateway-local.json` |
| `gateway:writeLocalConfig` | 写合并后的网关本地配置 |
| `gateway:ensureOpenClawGateway` | 按配置自动拉起/确认 OpenClaw 网关进程 |
| `openclaw:readModelConfig` | 读模型相关配置 |
| `openclaw:writeModelConfig` | 写模型配置（含备份） |
| `openclaw:restoreLatestBackup` | 从最近备份恢复 |
| `openclaw:readProviders` | 读 providers |
| `openclaw:writeProvidersPatch` | 合并写入 providers patch |

### 2.3 前端依赖 `lclawElectron` / `isLclawElectron` 的位置

| 路径 | 用途 |
|------|------|
| `src/lib/electron-bridge.ts` | `isLclawElectron()` |
| `src/vite-env.d.ts` | `LclawElectronApi` 类型 |
| `src/app/AppShell.vue` | 桌面专属 UI、OpenClaw 模型工具条 |
| `src/app/AppHeader.vue` | 网关本地配置入口 |
| `src/stores/gateway.ts` | 启动时读本地网关配置、`ensureOpenClawGateway` |
| `src/stores/chat.ts` | OpenClaw 模型配置读写 |
| `src/stores/filePreview.ts` | 本地文件预览与 LibreOffice 流程 |
| `src/features/preview/PreviewPane.vue` | 预览工具栏、选文件 |
| `src/features/chat/ChatLineBody.vue` | 附件本地打开/分享等 |
| `src/features/settings/GatewayLocalDialog.vue` | 网关与 OpenClaw 本地设置（调用最集中） |

构建相关：`vite.config.ts` 使用 `vite-plugin-electron`；`package.json` 使用 `electron-builder`。

---

## 3. 目标架构（迁移后）

```
┌─────────────────────────────────────────┐
│  WebView2（系统）                         │
│  Vue SPA（dist，同源策略需与 Gateway 一致） │
└─────────────────┬───────────────────────┘
                  │ invoke / events
┌─────────────────▼───────────────────────┐
│  Tauri Core（Rust）                      │
│  · 静态资源加载策略（见 §6.1）             │
│  · Commands：原 ipcMain 能力              │
│  · 子进程：OpenClaw 网关                   │
│  · 路径：~/.openclaw、app data            │
└─────────────────────────────────────────┘
```

---

## 4. 前置条件

1. **Rust**：`rustup`，stable；Windows 需 **Visual Studio Build Tools**（MSVC）与 WebView2（Win10/11 通常已有）。
2. **Node/pnpm**：与现有 `lclaw-ui` 一致。
3. **Git 分支**：在 `main`/`develop` 外建长期分支 `feat/tauri-desktop`（名称自定），便于对比与回滚。
4. **备份**：你已另有文件夹备份；建议同时 **推送远程分支**，避免单点丢失。

---

## 5. 分阶段实施计划

### 阶段 0：基线与文档冻结（0.5～1 天）

- [ ] 记录当前 Electron 版：版本号、`dist:win` 产物大小、关键用户路径（`gateway-local.json` 位置）。
- [ ] 固定一组 **手工回归用例**（见 §9），迁移后逐条打勾。
- [ ] **优先（勿拖到阶段 2）**：在 **OpenClaw Gateway 侧**弄清 Origin 策略，再决定阶段 2 是否值得尝试「自定义协议」方案。

#### 阶段 0 必查：Gateway Origin 与本仓库线索

本仓库 `openclaw-src` 中逻辑如下（便于直接搜代码、对照配置）：

| 内容 | 位置 |
|------|------|
| 握手失败 `1008`、错误文案中的 `allowedOrigins` 提示 | `openclaw-src/src/gateway/server/ws-connection/message-handler.ts`（`checkBrowserOrigin`） |
| Origin 判定（allowlist、Host 回退、本机 loopback） | `openclaw-src/src/gateway/origin-check.ts` |
| 配置项说明 | `openclaw-src/docs/gateway/configuration-reference.md`（`controlUi.allowedOrigins`、`controlUi.dangerouslyAllowHostHeaderOriginFallback`）；中文版 `openclaw-src/docs/zh-CN/gateway/...` |

**阶段 0 要得到的结论**（写进决策记录 §6）：

1. 生产/用户环境下，Gateway 是否已配置 `gateway.controlUi.allowedOrigins`？能否 **追加** Tauri 页面真实的 `Origin` 字符串（需在 WebView 里用开发者工具或日志抓一次）？
2. 若 **不能改 Gateway 配置**（例如远端他人网关、或策略禁止改白名单）：阶段 2 **直接采用方案 B**（`127.0.0.1` 静态 HTTP，与现 Electron 一致），**跳过方案 A 试错**，可节省约 **1～2 天**。
3. 若允许改配置：再评估方案 A（自定义协议）是否仍比方案 B 更简单；有时「改网关一行配置」比「折腾 WebView Origin」更省事。

**产出**：本阶段检查表 + **§6 Origin 决策预填**（方案 A/B 是否尝试）；可无代码变更或仅加 README 片段。

---

### 阶段 1：Tauri 脚手架 + 空白窗体能加载前端（1～2 天）

- [ ] 在 `lclaw-ui` 下 `pnpm create tauri-app` 或与官方「add to existing」流程对齐，得到 `src-tauri/`。
- [ ] `tauri.conf`：`build.frontendDistDir` 指向 Vite 的 `dist`；开发态 `beforeDevCommand` / `devUrl` 与现有 `vite` 端口一致。
- [ ] **先不删 Electron**：并行存在，脚本区分 `dev` / `dev:tauri` / `build` / `build:tauri`。
- [ ] 验证：开发模式 Tauri 窗口能打开 HMR；生产 `vite build` + `tauri build` 能出包。

**验收**：安装包能启动并显示 UI；不要求 IPC 已通。

---

### 阶段 2：生产态「页面 Origin」与 Gateway 连通（关键路径，1～3 天）

**背景**：现有 Electron 用 `http://127.0.0.1:<port>/` 提供静态资源，专门规避 Gateway 对 `file://` 的拒绝。

**推荐顺序**（与 **阶段 0 结论**挂钩）：

1. **方案 A（仅当阶段 0 确认「可配置白名单且值得试」时再做）**：Tauri 2 自定义协议 / `asset` 协议；实测 WebView 发出的 **Origin** 字符串，并写入 `gateway.controlUi.allowedOrigins`（或依赖 `origin-check.ts` 中本机 loopback 分支，以实测为准）。若阶段 0 已判定无法改网关，**跳过本方案**。
2. **方案 B（默认兜底，与现行为一致）**：在 Rust 内实现与 `static-server.ts` 等价的 **127.0.0.1 静态 HTTP 服务**（端口策略保留 `LCLAW_UI_STATIC_PORT` 或改为 Tauri 配置项），窗口 `load_url` 指向该 origin。

- [ ] 实现选定方案并连接真实 Gateway，验证 WebSocket **不再出现 1008（Origin）**。
- [ ] SPA 路由刷新（直接打开子路径）行为与现版一致（需 `index.html` 回退）。

**验收**：连本地 Gateway 完整聊天一轮；网络面板可见正确的 `Origin`。

---

### 阶段 3：Rust Commands — 低风险能力先行（1～2 天）

按依赖少→多排序，便于前端逐步改调用：

| 顺序 | 命令组 | 说明 |
|------|--------|------|
| 1 | `dialog:openFile`、`shell:openFileUrl` | `rfd` / `opener` 或 Tauri 插件 |
| 2 | 剪贴板、`openLibreOfficeDownloadPage`（打开外链） | `arboard`、`open` |
| 3 | `file:saveCopyAs`、`shell:prepareEmailWithLocalFile`、`shell:copyLocalFileForShare` | 文件系统 + 对话框 + 剪贴板 |
| 4 | `gateway:readLocalConfig`、`gateway:writeLocalConfig` | `tauri::path::BaseDirectory::AppData` 或等价路径，与 Electron `userData` 对齐（需查 Tauri 默认 app data 目录，必要时固定子目录名 `LCLAW UI` 与现版一致） |

- [ ] 前端：新增 `src/lib/desktop-bridge.ts`（或扩展原文件），内部 `invoke`，对外保持与现 API 形状接近，减少 Vue  diff。
- [ ] 将 `isLclawElectron()` 改为 **`isLclawDesktop()`**（或保留别名），检测 `__TAURI_INTERNALS__` / 官方推荐方式。

**验收**：不涉及预览与网关进程时，设置页与文件打开已可用。

---

### 阶段 4：LibreOffice 与 `preview:openLocal`（2～4 天）

- [ ] 移植 `findSofficeExecutable`、Windows 下调用外部进程逻辑；超时与错误信息对齐。
- [ ] **Windows 注意**：Rust `std::process::Command` 与 Node `child_process.execFile` 在参数传递、**控制台编码**、工作目录上的行为并不完全一致；**中文路径**、含中文的**临时目录**更容易暴露问题（乱码、找不到文件、`soffice` 启动失败）。实现上优先使用 **无歧义的 UTF-16 宽路径 API**（或 Tauri/生态里已处理好的封装），并在验收中强制覆盖下文用例。
- [ ] 文件读入、MIME、大小上限（如 `MAX_TEXT_PREVIEW_BYTES`）、Base64 返回结构与前端的 `OpenOk` 类型一致。
- [ ] 边界：非法 `file:`、路径穿越防护（与现 `resolveExistingFilePath` 行为一致）。

**验收**：与 Electron 版相同文件类型的预览结果一致；大文件与失败提示合理；**至少用一份路径含中文的 Office 文件**（如 `测试\演示.pptx`）在 Windows 上跑通 LibreOffice 转换链路。

---

### 阶段 5：网关子进程 `gateway:ensureOpenClawGateway`（1～3 天）

- [ ] 移植 `parseGatewayWsTcpTarget`、`waitForTcpPortOpen`（Rust `tokio::net::TcpStream` 或同步轮询）。
- [ ] Windows：`where openclaw` 等价（`Command::new("where").arg("openclaw")` 或 `cmd /c`）。
- [ ] `spawn` 子进程、`before-quit` / Tauri `RunEvent::Exit` 中调用与 `disposeManagedOpenClawGateway` 等价的清理。
- [ ] 与 `gateway-local.json` 中 `autoStartOpenClaw`、`openclawExecutable` 行为一致。

**验收**：自动拉起、已运行则跳过、退出时可选停止托管进程（与现配置项一致）。

---

### 阶段 6：`openclaw-config` 全量移植（建议拆分子阶段）

`openclaw-config.ts`（约 888 行）包含备份命名、深层路径（`agents/<id>/agent/models.json`、`auth-profiles.json`）、patch 合并、敏感字段过滤等 **业务规则**；用 `serde_json::Value` 在 Rust 里 **逐行为对齐 TypeScript**，工作量往往大于初看行数。**原「3～6 天」偏乐观**，更稳妥是按子阶段交付，并拉长总区间（见 §10）。

#### 阶段 6a：模型配置读写 + 备份 + 恢复（优先合入、可发试用版）

- [ ] `openclaw:readModelConfig` / `openclaw:writeModelConfig` / `openclaw:restoreLatestBackup` 及依赖的磁盘路径、备份文件命名、与 `openclaw.json` / `models.json` 的交互。
- [ ] 黄金样例测试：**先做 6a 覆盖范围**（fixtures 脱敏；可用 Node 脚本导出期望快照供 Rust assert）。

**验收**：`GatewayLocalDialog` / `AppShell` / `chat` store 中与 **模型** 相关的桌面端能力无回归；可在此子阶段结束后 **发一版 Tauri 给用户试用**（Provider 相关可仍走占位或暂时不调 Rust，视产品接受度而定）。

#### 阶段 6b：Providers 读写与 patch 合并

- [ ] `openclaw:readProviders` / `openclaw:writeProvidersPatch` 及与 6a 可能共享的工具函数。
- [ ] 扩展黄金测试覆盖 patch 合并边界（空 patch、部分键删除、与 TS 输出逐字段 diff）。

**验收**：`GatewayLocalDialog` 中 **Provider**  Tab 全链路可用，与 Electron 版行为一致。

---

**共通要求**（6a / 6b 均需遵守）：

- [ ] 逐函数对照 `openclaw-config.ts`；**必须**保留与 TS 相同的字段过滤与「非真实密钥」标记逻辑（`OPENCLAW_NON_SECRET_API_KEY_MARKERS` 等）。
- [ ] JSON 层优先 `serde_json::Value` 以利对齐；稳定后再逐步类型化（见 §12）。

---

### 阶段 7：移除 Electron、统一脚本与发布（1～2 天）

- [ ] 删除 `electron/`、`vite-plugin-electron`、`electron`、`electron-builder` 及相关 `dist-electron` 构建步骤。
- [ ] `package.json` scripts：`dist:win` 改为 `tauri build`（或 nsis/msi 配置在 `tauri.conf`）。
- [ ] 更新 `eslint.config.js` 忽略项、`docs` 中与 Electron 矛盾的描述。
- [ ] 对比 **安装包体积** 与 **冷启动时间**，记录到发布说明。

**验收**：CI/本地一键出包；无残留 `electron` 依赖。

---

## 6. 关键技术决策记录（Origin 在阶段 0 预填，其余在阶段 2 末定稿）

| 议题 | 选项 | 建议 |
|------|------|------|
| 静态资源 Origin | 自定义协议 vs 127.0.0.1 HTTP | **阶段 0 先定**：能否配置 `gateway.controlUi.allowedOrigins`；不能则默认方案 B，跳过方案 A |
| `userData` 路径 | Tauri 默认 vs 自定义与 Electron 一致 | 若已有用户配置，优先路径兼容或迁移拷贝说明 |
| 错误字符串 | 中文与现版一致 | 前端依赖 `error` 文案时注意 i18n（若有） |
| 日志 | Rust `tracing` + 文件 | 便于用户报告桌面端问题 |

---

## 7. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Gateway 拒绝 Tauri 的 Origin | 无法连接 | 阶段 2 尽早验证；兜底 127.0.0.1 HTTP |
| WebView2 未安装（老 Win） | 无法启动 | 安装引导或文档说明；可选引导下载 Evergreen |
| LibreOffice 路径/权限差异 | 预览失败 | 保留环境变量 `LIBREOFFICE_PATH` 与现逻辑一致 |
| Windows 下 Rust `Command` 与 Node `execFile` 差异 | 中文路径/临时目录转换失败 | 宽字符路径、显式编码与工作目录；阶段 4 验收含中文路径用例 |
| openclaw-config 行为偏差 | 配置损坏 | 阶段 6 黄金测试 + 写前备份机制不变 |
| Rust 子进程僵尸 | 资源泄漏 | 使用 `Child` 结构体 + 退出钩子；Windows 上测重复启停 |

---

## 8. 回滚策略

1. **分支**：全程在 `feat/tauri-desktop`；合并前不删 Electron 分支历史。
2. **恢复**：你本地已有完整备份文件夹；Git 亦可 `git checkout` 到迁移前 tag/commit。
3. **部分回滚**：若仅前端 bridge 可保留双模式开关（`VITE_SHELL=electron|tauri`），但维护成本高，**仅建议在过渡期短期使用**。

---

## 9. 回归测试清单（迁移完成后必测）

- [ ] 首次安装启动、二次启动。
- [ ] 连接远程/本地 Gateway，收发消息，无 1008。
- [ ] `gateway-local.json`：读写、自动启动开关、可执行路径自定义。
- [ ] `ensureOpenClawGateway`：未启动→拉起；已监听→不重复。
- [ ] 退出应用：托管网关是否按 `stopManagedGatewayOnQuit` 行为停止。
- [ ] 本地附件：图片/PDF/文本/Markdown/Office（有/无 LibreOffice）；**Office 至少含一条「路径含中文」的样本**。
- [ ] 「用系统应用打开」「另存为」「邮件准备」「复制分享」。
- [ ] OpenClaw：读模型、写模型、Provider patch、从备份恢复。
- [ ] 安装包体积与杀毒误报（抽样）。

---

## 10. 工时粗估（单人熟练、含联调）

| 阶段 | 工作日（约） | 说明 |
|------|----------------|------|
| 0 | 0.5～1 | 含 Gateway 配置与 Origin 策略结论；可显著缩短阶段 2 试错 |
| 1 | 1～2 | |
| 2 | 1～3 | 阶段 0 已否决方案 A 时偏下限 |
| 3 | 1～2 | |
| 4 | 2～4 | 含 Windows 中文路径与编码相关调试 |
| 5 | 1～3 | |
| 6a | 3～5 | 模型配置 + 备份 + 恢复；可在此打试用包 |
| 6b | 3～6 | Providers patch；与 6a 合计 **6～11 天** 较贴近高风险估计 |
| 7 | 1～2 | |
| **合计** | **约 16～30** | 原 10～22 未充分计入 6a/6b 拆分与 openclaw-config 对齐成本 |

若阶段 0 明确「仅方案 B」且 6a/6b 黄金测试齐全，可落在区间下半；若 Origin 与 Gateway 需多轮协调或 patch 语义复杂，偏向上半。

---

## 11. 里程碑检查表（管理层视角）

| 里程碑 | 标志 |
|--------|------|
| M1 | Tauri 窗体 + 生产加载 UI |
| M2 | Gateway WebSocket 与现版一致连通 |
| M3 | 全部桌面专属按钮/设置可用（含 6a：模型侧可试用） |
| M3.5 | 6b 完成，Provider 与 Electron 行为一致 |
| M4 | 删除 Electron，发布 Tauri 安装包 |

---

## 12. 后续可选优化

- macOS 公证、自动更新（`tauri-plugin-updater`）。
- 体积再压缩：strip、UPX（谨慎）、按需 feature。
- 将 Rust 与 OpenClaw 的 JSON 结构类型化，减少 `serde_json::Value` 的维护风险。

---

*文档版本：1.1*（纳入 Gateway 阶段 0 核查、阶段 6a/6b 拆分、LibreOffice/Windows 编码与工时修订）  
*对应仓库路径：`lclaw-ui`（Electron 源码位于 `lclaw-ui/electron/`）；Gateway 行为参考同仓 `openclaw-src/`*
