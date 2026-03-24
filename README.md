# DidClaw

基于 [OpenClaw](https://github.com/openclaw/openclaw) Gateway 的顶层客户端与文档。

| 目录 | 说明 |
|------|------|
| `docs/` | 开发方案、步骤、Gateway 协议笔记 |
| `didclaw/`（若本地仍为 `lclaw-ui/`，可停 dev 后重命名对齐） | Vue 3 客户端（连接网关、聊天、预览） |
| `openclaw-src/` | 本地 OpenClaw 源码（默认 **不纳入 Git**，见根目录 `.gitignore`） |

## 客户端

```bash
cd didclaw
pnpm install
pnpm dev
```

详见 `didclaw/README.md`。
