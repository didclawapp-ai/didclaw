# LCLAW UI（OpenClaw 顶层客户端）

> 方案：`../docs/OpenClaw-顶层界面-开发方案.md`（v1.5）  
> 步骤：`../docs/lclaw-ui-开发步骤.md`  
> 协议笔记：`../docs/gateway-client-protocol-notes.md`

**Vue 3 + TypeScript + Vite + Pinia**。已实现：**阶段 A～D**（右栏 **Markdown + DOMPurify + highlight.js**；围栏 **`echarts-json`** + Zod + ECharts 按需引入；**外链白名单** `VITE_LINK_ALLOWLIST`；**工具/事件时间线** + 节流合并）。下一阶段见 `../docs/lclaw-ui-开发步骤.md` **阶段 E**。

## 常用命令

```bash
pnpm install
pnpm dev
pnpm build
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
