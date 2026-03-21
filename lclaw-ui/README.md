# LCLAW UI（OpenClaw 顶层客户端）

> 方案：`../docs/OpenClaw-顶层界面-开发方案.md`（v1.5）  
> 步骤：`../docs/lclaw-ui-开发步骤.md`  
> 协议笔记：`../docs/gateway-client-protocol-notes.md`  
> 内网部署与冒烟：`../docs/lclaw-ui-内网部署.md`  
> Electron 与本机预览：`../docs/lclaw-ui-electron-local-preview.md`

**Vue 3 + TypeScript + Vite + Pinia**。布局：**左侧实时聊天**（消息内 `http(s)` / `file://` 与 Markdown 链接渲染为可点击按钮）；**右侧文件预览**（点击后加载：PDF / 图片；**Markdown / `.txt` 等** 用 `markdown-it` + 净化后渲染或等宽纯文本；Office 在公网 HTTPS 时尝试 Office Online 嵌入）。**桌面版（`pnpm dev` + Electron）**下，本地 `file://` 由主进程读盘，Office 经 **LibreOffice** 转 PDF；纯浏览器打开时远程文本受 **CORS** 限制可能需本机文件。

## Electron 桌面壳（可选）

- `pnpm dev`：Vite 开发服务器 + **自动启动 Electron**（注入 `window.lclawElectron`）。
- `pnpm dev:web`：仅 Vite，用于浏览器调试（与以前一致）。
- `pnpm dist:win:portable`：**便携版**单个 exe（约百 MB，输出 `release/LCLAW UI 0.1.0.exe`，无需安装）。
- `pnpm dist:win:setup`：NSIS **安装包**（`release/` 下安装向导）。
- `pnpm dist:win`：与 `package.json` 里 `build.win.target` 一致（当前为 **NSIS + portable** 双产物；若只要其一可用下面带后缀脚本）。
- 本机 Office **内嵌**预览：需 **LibreOffice**（或 **`LIBREOFFICE_PATH`** 指向 `soffice.exe`）转 PDF。未检测到时右侧提供 **安装说明对话框 / 官网链接 / 重新检测并预览**；也可 **「用系统应用打开」**（Word / WPS 等）。详见 `../docs/lclaw-ui-electron-local-preview.md`。

## 常用命令

```bash
pnpm install
pnpm dev          # 桌面壳：Electron + Vite
pnpm dev:web      # 仅 Vite
pnpm build
pnpm dist:win:portable   # Windows 便携 exe
pnpm dist:win:setup      # Windows 安装包
pnpm typecheck
pnpm lint
```

## 环境变量

复制 `.env.example` 为 `.env.development`，填写：

- `VITE_GATEWAY_URL`：默认 `ws://127.0.0.1:18789`
- `VITE_GATEWAY_TOKEN` 或 `VITE_GATEWAY_PASSWORD`：与网关配置一致
- `VITE_LINK_ALLOWLIST`（可选）：Markdown 外链白名单，见 `.env.example`

**勿将含密钥的 `.env*` 提交仓库**（已写入 `.gitignore`）。

## 联调说明

1. 启动 OpenClaw Gateway（端口与 URL 一致）。
2. 浏览器打开 Vite 地址（如 `http://127.0.0.1:5173`），点击 **连接**。
3. 若提示配对：在网关主机执行 `openclaw devices list` / `openclaw devices approve <id>`。
4. 本客户端使用与官方 Control UI 相同的客户端标识（`openclaw-control-ui`）与 `connect` 协议；需 **HTTPS 或 localhost 安全上下文** 以使用 `crypto.subtle` 完成设备签名。若仅在 HTTP 局域网 IP 访问页面，可能连接失败，请用 `127.0.0.1` 或配置网关 `gateway.controlUi.allowInsecureAuth`（见官方文档）。
5. **Electron 安装包 / 便携版**：界面由本机 **`http://127.0.0.1:34127`**（默认，占用时顺延）加载，**不是** `file://`。若提示 **origin not allowed (1008)**，在网关 `gateway.controlUi.allowedOrigins` 中加入该地址（或你通过 `LCLAW_UI_STATIC_PORT` 指定的端口）。详见 `../docs/lclaw-ui-electron-local-preview.md` §1.1。
6. **网关 Token**：生产包默认**不含**开发环境的 `.env.development`。桌面版请在应用内点 **「网关本地设置」** 填写 Token/密码（写入本机 `gateway-local.json`），或使用 `.env.production` 后重新 `pnpm build` 再打 exe。见 `../docs/lclaw-ui-electron-local-preview.md` §1.2。

## 目录结构（持续演进）

```
src/
├── app/              # AppShell 布局
├── features/gateway/ # WebSocket 客户端
├── stores/           # Pinia：gateway / session / chat / preview / toolTimeline
├── lib/              # 工具、设备身份
├── components/
└── ...
```
