# DidClaw 桌面端打包说明（本地）

本文档为本地备忘，**不入库**（见根目录 `.gitignore`）。以 Windows / PowerShell 为例。

## 前提

- 已安装 Node、pnpm、Rust（Tauri 构建所需）
- 仓库根目录：`LCLAW`，客户端目录：`didclaw-ui`

## 打包命令（在 `didclaw-ui` 下执行）

| 命令 | 说明 |
|------|------|
| `pnpm run dist:win` | 推荐：前端 build + Tauri 打包 + Windows 后处理脚本 |
| `pnpm run build:tauri` | 仅：`vue build` + `tauri build`（无 `post-dist-win`） |
| `pnpm run dev:tauri` | 开发调试，非安装包 |

产物通常在 `didclaw-ui/src-tauri/target/release/bundle/`（具体以 `tauri.build.conf.json` 与脚本为准）。

## 用 `main` 打包（正式发版、不含实验功能）

```powershell
cd F:\LCLAW
git checkout main
git pull   # 可选

cd F:\LCLAW\didclaw-ui
pnpm install   # 依赖有变时
pnpm run dist:win
```

当前工作区在 `main` 且未合并实验分支时，**不会**包含信息素/认知地图等实验代码。

## 用实验分支打包（含实验功能）

例如分支名：`experiment/pheromone-memory`

```powershell
cd F:\LCLAW
git checkout experiment/pheromone-memory
git pull   # 可选

cd F:\LCLAW\didclaw-ui
pnpm install
pnpm run dist:win
```

**规则**：安装包里包含的是**当前检出分支上的代码**，与分支名无关；要发哪种版本就先 `git checkout` 到对应分支再打包。

## 版本号（若需要对外发版）

正式发布时应在**同一提交**内同步：

- `didclaw-ui/package.json` → `version`
- `didclaw-ui/src-tauri/tauri.conf.json` → `version`
- `didclaw-ui/src-tauri/Cargo.toml` → `[package].version`

详见 `.cursor/rules/didclaw-project.mdc` 中「版本号与发版」。
