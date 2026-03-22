# LCLAW UI（OpenClaw 顶层客户端）

> 方案：`../docs/OpenClaw-顶层界面-开发方案.md`（v1.5）  
> 步骤：`../docs/lclaw-ui-开发步骤.md`  
> 协议笔记：`../docs/gateway-client-protocol-notes.md`  
> 内网部署与冒烟：`../docs/lclaw-ui-内网部署.md`  
> 桌面壳迁移与回归：`../docs/lclaw-ui-electron-to-tauri-迁移计划.md`  
> 历史 Electron 与本地预览说明（仅供参考）：`../docs/lclaw-ui-electron-local-preview.md`

**Vue 3 + TypeScript + Vite + Pinia**。布局：**左侧实时聊天**；**右侧文件预览**（PDF / 图片 / Markdown / 文本；Office 在桌面端经 **LibreOffice** 转 PDF）。**桌面版（Tauri 2 + WebView2）** 下本地 `file://` 由 Rust 侧读盘；纯浏览器打开时远程文本受 **CORS** 限制。

## 桌面壳（Tauri）

- `pnpm dev:tauri`：启动 Vite + Tauri 窗口（`invoke` 桌面 API）。
- `pnpm dev` / `pnpm dev:web`：仅 Vite，浏览器联调。
- `pnpm dist:win`：`vite build` + **`tauri build`**，安装包在 `src-tauri/target/release/bundle/`（具体格式见 `src-tauri/tauri.conf.json`）。
- 生产态界面由本机 **`http://127.0.0.1`** 静态服务加载（默认端口见 `static_server.rs` / 环境变量 `LCLAW_UI_STATIC_PORT`），避免 Gateway **origin 1008**。详见迁移计划 §2。

## 常用命令

```bash
pnpm install
pnpm dev:web       # 仅 Vite
pnpm dev:tauri     # Tauri + Vite
pnpm build
pnpm dist:win      # Windows 安装包（Tauri bundle）
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
4. 本客户端使用与官方 Control UI 相同的客户端标识与 `connect` 协议；需 **HTTPS 或 localhost 安全上下文** 以使用 `crypto.subtle`。若仅在 HTTP 局域网 IP 访问页面，可能连接失败，请用 `127.0.0.1` 或按官方文档配置网关。
5. **网关与模型**：生产包默认**不含**开发环境的 `.env.development`。桌面版请在顶栏 **「本机设置」** 配置网关与 OpenClaw；或使用 `.env.production` 后重新 `pnpm build` 再打安装包。

## 目录结构（持续演进）

```
src/
├── app/              # AppShell 布局
├── features/gateway/ # WebSocket 客户端
├── stores/           # Pinia：gateway / session / chat / preview / toolTimeline
├── lib/              # 工具、设备身份、desktop-api（Tauri invoke）
├── components/
└── ...
src-tauri/            # Tauri / Rust：IPC、静态服务、OpenClaw 与网关子进程
```
