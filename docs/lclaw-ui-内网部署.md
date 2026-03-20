# lclaw-ui 内网部署与联调冒烟

> 对应主方案 §5.2、阶段 E。构建产物为 **纯静态 SPA**（`lclaw-ui/dist`），由 Web 服务器托管；业务 API 为浏览器直连 **Gateway WebSocket**（非本站点同源）。

## 前置条件

| 项 | 说明 |
|----|------|
| OpenClaw Gateway | 已启动，端口与前端环境变量 `VITE_GATEWAY_URL` 一致（构建时写入，见下文）。 |
| 浏览器 | 推荐使用 Chromium / Edge / Firefox 最新稳定版；设备签名需 **HTTPS 或 localhost** 下的 Web Crypto（与官方 Control UI 一致）。 |
| Node | 建议 **Node 22 LTS**，与 `lclaw-ui/package.json` 工具链一致。 |

## 环境变量（构建期注入）

Vite 将 `VITE_*` 在 **`pnpm build` 时** 打入静态包，部署后改 `.env` 不会生效，需 **重新 build** 或改用运维注入脚本。

| 变量 | 说明 |
|------|------|
| `VITE_GATEWAY_URL` | 网关 WebSocket 地址，如 `wss://gw.internal.example.com:18789`。注意浏览器 **混合内容**：HTTPS 页面不可连 `ws://`，需 `wss://` 或同页为 HTTP。 |
| `VITE_GATEWAY_TOKEN` / `VITE_GATEWAY_PASSWORD` | 与网关配置一致，**勿**把含真实密钥的构建产物提交到公开仓库。 |
| `VITE_LINK_ALLOWLIST` | 可选，Markdown 外链白名单，见 `lclaw-ui/.env.example`。 |

本地开发可复制 `lclaw-ui/.env.example` 为 `.env.development`。

## 构建

```bash
cd lclaw-ui
pnpm install
pnpm run typecheck
pnpm run build
```

产物目录：`lclaw-ui/dist/`。

## SPA History fallback（必选）

本应用为单页，路由若使用 history 模式（未来扩展设置页等），服务器需将所有 **无前缀文件请求** 回退到 `index.html`。

### Nginx 示例

```nginx
server {
    listen 443 ssl;
    server_name lclaw-ui.internal.example.com;
    root /var/www/lclaw-ui/dist;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### Caddy 示例

```caddy
lclaw-ui.internal.example.com {
    root * /var/www/lclaw-ui/dist
    file_server
    try_files {path} /index.html
}
```

### IIS（URL Rewrite）

安装 **URL Rewrite**，站点根目录 `web.config` 示例：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="SPA" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll">
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
          </conditions>
          <action type="Rewrite" url="/index.html" />
        </rule>
      </rules>
    </rewrite>
  </system.webServer>
</configuration>
```

> **说明**：当前默认路由为单页根路径，即使暂未配置 fallback，仅访问 `/` 仍可工作；上线前仍建议按上表配置，避免后续加路由时出现 404。

## 联调冒烟清单（升级 Gateway 小版本后建议重跑）

1. 打开部署 URL，点击 **连接**，顶栏状态为 `connected`，可见 Gateway 版本摘要（若有）。
2. 左侧出现会话列表；选中会话后加载历史无红色错误文案。
3. 发送一条消息，助手回复可达（含流式占位）。
4. 若设备未配对：断开提示中含 `devices approve` 指引。
5. 点击 **复制诊断信息**，粘贴为 JSON，确认 **无** token/password 明文，仅 `tokenConfigured` 等布尔值。

协议与版本对照：`gateway-client-protocol-notes.md`。

---

*文档结束。*
