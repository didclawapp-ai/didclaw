# LCLAW UI：Electron 壳 + 本地文件右侧预览方案

> 目标：在**不推翻现有 Vue 3 + Vite 工程**的前提下，增加一层 Electron 桌面壳，使**本机 `file://` 链接**在点击后能在**右侧预览区**内展示（图片 / PDF / Office 经 LibreOffice 转 PDF）。

## 1. 架构

```
┌─────────────────────────────────────────────────────────────┐
│  Electron Main（Node）                                       │
│  - 窗口、可选系统托盘（后续）                                 │
│  - IPC：校验 file: URL → 本地路径；读文件；调用 LibreOffice   │
├─────────────────────────────────────────────────────────────┤
│  Preload（CJS，contextBridge）                               │
│  - 仅暴露固定 API：openLocalPreview、pickLocalFile            │
├─────────────────────────────────────────────────────────────┤
│  Renderer = 现有 lclaw-ui（Vue 3 + Pinia + WebSocket）        │
│  - 左侧聊天链接点击 → filePreview.openUrl                     │
│  - 若运行在 Electron 且为 file: → IPC 取回 base64 → Blob URL  │
│  - 右侧 PreviewPane：iframe/img 与浏览器版一致                │
└─────────────────────────────────────────────────────────────┘
```

- **Gateway WebSocket**：仍由渲染进程直连（与纯浏览器版一致）；主进程不参与转发（后续若需统一代理再演进）。
- **与纯 Web 共存**：未注入 `window.lclawElectron` 时，行为与当前网页版一致（Office 本地仍提示说明卡片）。

### 1.1 生产包与 Gateway「origin not allowed」（1008）

打包后若用 `loadFile` 打开 `dist/index.html`，页面源为 **`file://`**，OpenClaw Gateway 会在 WebSocket 握手时校验 **`Origin`**，常见报错：`1008 origin not allowed`。

**当前实现**：生产态由主进程在 **`127.0.0.1`** 上启动仅本机可访问的静态 HTTP 服务（默认端口 **`34127`**，环境变量 **`LCLAW_UI_STATIC_PORT`** 可改），再 `loadURL(http://127.0.0.1:34127/index.html)`，使 `Origin` 与浏览器访问 `http://127.0.0.1` 一致。

若网关仍拒绝，请在 Gateway 配置里为 Control UI 增加允许的源，例如（以你实际端口为准）：

```yaml
gateway:
  controlUi:
    allowedOrigins:
      - "http://127.0.0.1:34127"
      - "http://localhost:5173"
```

端口被占用时，应用会自动尝试 `34128、34129…`；若你固定了白名单端口，请同时设置 **`LCLAW_UI_STATIC_PORT`** 与网关列表一致。

### 1.2 网关 Token / 密码（打包后 `tokenConfigured: false`）

`VITE_GATEWAY_*` 在 **`pnpm build` 时**由 Vite 写入前端；**`.env.development` 不会参与生产构建**。便携 exe 若未使用 `.env.production` 打包，会出现 **`gateway token missing`**。

**推荐（桌面版）**：在界面顶部点 **「网关本地设置」**，将 WebSocket URL、Token 或密码保存到用户数据目录下的 **`gateway-local.json`**（明文），保存后会自动重连。

**备选**：在项目根配置 `.env.production`（可参考 `.env.production.example`）后重新执行 `pnpm build` 再打 exe。

## 2. 依赖与脚本

| 依赖 | 作用 |
|------|------|
| `electron` | 桌面运行时 |
| `vite-plugin-electron`（simple） | 开发期同时编译 main/preload 并拉起 Electron |
| `electron-builder` | 打 Windows 安装包（可选） |

| 脚本 | 说明 |
|------|------|
| `pnpm dev` | Vite + **自动启动 Electron**（加载 `VITE_DEV_SERVER_URL`） |
| `pnpm dev:web` | 仅 Vite，浏览器调试 UI |
| `pnpm build` | `vue-tsc` + Vite（含 `dist` 与 `dist-electron`） |
| `pnpm dist:win` | `build` + `electron-builder --win` |

**注意（pnpm）**：`lclaw-ui/package.json` 已配置 `pnpm.onlyBuiltDependencies`（含 `electron`、`electron-winstaller`），安装时会执行 postinstall 并下载 Electron 二进制。若仍报错 `Electron failed to install correctly`，在项目根执行 `pnpm install`；或执行 `pnpm approve-builds` 后删除 `node_modules` 再装。

## 3. 目录与入口

| 路径 | 说明 |
|------|------|
| `electron/main.ts` | BrowserWindow、`ipcMain`、LibreOffice 调用、临时目录 |
| `electron/preload.ts` | `contextBridge.exposeInMainWorld('lclawElectron', …)` |
| `package.json` 的 `main` | `dist-electron/main.js`（由 vite-plugin-electron 产出） |

开发态预加载脚本名：`dist-electron/preload.mjs`（与 `main.js` 同目录）。

## 4. 预览数据流（本地）

1. 用户点击消息内 `file:///...` 链接（或工具栏「选择本地文件」）。
2. 渲染进程调用 `lclawElectron.openLocalPreview(fileUrl)`。
3. 主进程：`fileURLToPath` → `fs.realpath` / `stat` 校验为普通文件。
4. **图片 / PDF**：读入 Buffer → base64 → 渲染进程转 **Blob URL** → `target.kind` 为 `image` | `pdf`。
5. **Office（doc/xls/ppt 等）**：复制到临时目录（避免同名冲突）→ 调用 **LibreOffice headless** 转 PDF → 读 PDF → base64 → 渲染进程以 **pdf** 展示。
6. `filePreview.clear()` / 切换预览时 **revoke** 旧 Blob URL，避免内存泄漏。

### 4.1 大文件与后续优化

当前 MVP 使用 **base64 经 IPC**，实现简单；超大 PDF 可改为：主进程写临时文件 + 自定义 `app://` 协议或 `file://` 白名单，由 `<iframe>` 直接加载（需单独安全评审）。

### 4.2 PDF 在 iframe 中的兼容性

若个别环境对 Blob URL + PDF 支持不佳，可再改为临时文件 + 自定义协议（同 4.1）。

## 5. LibreOffice

- **Windows**：安装后常见路径 `C:\Program Files\LibreOffice\program\soffice.exe`；也可将目录加入 `PATH`，或设置环境变量 **`LIBREOFFICE_PATH`** 指向 `soffice.exe`（或 `soffice`）。
- **macOS / Linux**：`brew` / 包管理器安装后，通常可用 `soffice` 或 `libreoffice`。
- 主进程按顺序探测：`LIBREOFFICE_PATH` → Windows 常见路径 → `soffice` / `libreoffice`（`execFile`）。

未安装或转换失败时，IPC 返回错误文案，右侧展示失败原因（可提示安装 LibreOffice）。

## 6. 安全（主进程）

- 仅接受 **`file:`** 协议 URL，并用 Node `fileURLToPath` 解析。
- 解析后 `path.resolve` + `fs.realpath` + `stat`，拒绝目录与非文件。
- 聊天内容可能含恶意路径：后续可加「仅允许某盘符/用户目录」等策略；MVP 以「用户点击即表示打开该路径」为前提。

## 7. electron-builder 产物

- 输出目录：`lclaw-ui/release/`（可在 `package.json` 的 `build.directories.output` 调整）。
- 打包内容：`dist/**`、`dist-electron/**`、`package.json`。

## 8. 与仓库其它文档的关系

- 网关协议、内网部署仍以 `gateway-client-protocol-notes.md`、`lclaw-ui-内网部署.md` 为准。
- 本方案仅扩展**桌面端本地预览**；不改变聊天协议与 Gateway 行为。
