# Changelog

All notable changes to DidClaw are documented here. **Every commit must include a changelog entry** (see `.cursor/rules/didclaw-project.mdc`).

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). For versioning rules (SemVer, three-file sync, git tags) see `didclaw-project.mdc`.

> **Language note**: Entries from this point forward are written in English. Earlier entries (below) are in Chinese.

## [Unreleased]

### Added

- **Windows maintenance script**: `scripts/uninstall-openclaw-global.bat` runs `npm uninstall -g openclaw`, `npm cache clean --force`, and removes common npm shim leftovers under `%APPDATA%\npm` (does not delete `%USERPROFILE%\.openclaw`).

- **Company hub — five-step wizard**: The desktop company / agents dialog is now a guided flow (company name → flat vs pyramid structure → `agents.list` table → `tools.agentToAgent` topology → finish with roster skill, optional bootstrap messages, “save all”, and a collapsible technical section). Step dots allow jumping back to earlier steps.

- **Company hub — per-agent bootstrap chat**: After merging `agents.list` or syncing the company roster skill, an optional checkbox (default **on**) sends one **user** message per role to `agent:<id>:main` via `chat.send` when the Gateway is connected. Messages include a stable `[DidClaw company setup]` marker (sessions that already contain it are skipped), the role’s display name and workspace, pointers to the shared **`didclaw-company-roster`** skill, and a short peer directory; outcomes are appended to the existing post-save hint. Each send starts a normal model run like any user message.

- **Multi-agent (company / roles) MVP**: Desktop header opens a hub to merge `agents.list` into `openclaw.json` (with backup) via `read_open_claw_agents_list` / `write_open_claw_agents_list_merge`, open side **role chat** columns (default `agent:<id>:main`), share one Gateway WebSocket with per-`sessionKey` chat state in the chat store, a **bottom-right floating “Roles” panel**, and **per-column session binding** via a dropdown fed from `sessions.list` (`agent:<roleId>:*` keys only). When the Gateway WebSocket is connected, the hub **prefers** official **`config.get` / `config.patch`** for read/merge of `agents.list`, falling back to the Tauri file merge on failure or when offline.
- **Workspace memory in History dialog**: Desktop app lists OpenClaw `~/.openclaw/workspace/memory/*.md` (permanent / archived memory from OpenClaw 4.x) on a **Workspace memory** tab next to **Gateway sessions**, with preview via the existing local file pipeline (`list_openclaw_workspace_memory` IPC).

### Added

- **Sub-agent auth profiles**: After saving `agents.list` (Tauri merge), DidClaw copies **`agents/main/agent/auth-profiles.json`** into any **non-main** agent listed in `agents.list` whose `auth-profiles.json` is missing or has an **empty `profiles`** map (fixes sub-agent `HTTP 401` when keys exist only under `main`). New IPC: **`sync_openclaw_subagent_auth_profiles_from_main`** (also runs automatically after hub save via Gateway `config.patch`, when the desktop API is available).

### Fixed

- **Xiaomi MiMo (小米套餐) 401**: DidClaw’s catalog used the legacy **`/anthropic` + `anthropic-messages`** shape; OpenClaw’s [official Xiaomi provider](https://docs.openclaw.ai/providers/xiaomi) expects **`https://api.xiaomimimo.com/v1`** with **`openai-completions`**. The catalog, default model (`mimo-v2-flash`), and models list (`mimo-v2-omni` added) are aligned. Credentials stay in **`models.json` + `auth-profiles.json`** (like other providers); **no automatic `env.vars` entry**—unlike **Zhipu / GLM**, where DidClaw still syncs **`ZHIPU_API_KEY`** for image-gen and tooling that read that env name. **Existing installs**: open **AI 服务商** for Xiaomi and **应用** again, or hand-edit `~/.openclaw/agents/main/agent/models.json`.

- **First-run wizard / OpenClaw preflight**: `getOpenClawSetupStatus` no longer treats **only** `~/.openclaw` existing as “OpenClaw installed” (bundled workspace skills create that directory). New flag **`openclawSetupIndicated`** is true when **`openclaw.json` exists** or the **`openclaw` CLI** is resolved; **FirstRunWizard** and **channel auto-install** prechecks use it. **Deferred gateway auto-connect** and the **onboarding resume banner** still require **`openclaw.json`** (`openclawConfigState !== "missing"`), not merely the directory.
- **Multi-agent `agents.list` (Tauri)**: Merging agents from the hub now **deep-merges** each agent object instead of replacing the whole entry, preserving extra OpenClaw fields (e.g. `tools`) while updating `id` / `name` / `workspace` / `model`; omitted `name` / `workspace` / `model` keys remove those fields so defaults apply.
- **Multi-agent hub save**: When a non-`main` row has an empty model, DidClaw now fills **`model` from the current global primary** (`readOpenClawAiSnapshot`) before write, so sub-agents align with the working main model unless you explicitly choose another ref.
- **Role chat column**: The role panel composer now includes **`composer.send`** i18n, shows **per-session `lastError`** (e.g. gateway `HTTP 401: Invalid API Key`) above the send button, tooltips aligned with the main composer, **reloads history when the gateway reconnects** after being offline, and **`loadHistory`** sets a visible offline hint when the WebSocket is down (non-silent loads). A **401-specific hint** explains that role chats use `agents.list[].model`, not the session-bar primary.
- **Multi-agent hub**: After loading `agents.list` (Gateway `config.get` or desktop read), the **editable wizard table** now mirrors the same entries as the read-only JSON preview (open dialog / Refresh / successful save).
- **Multi-agent hub**: On desktop, the **Model** column uses a **dropdown** populated from `readOpenClawAiSnapshot` / `buildModelPickerRows` (same refs as the session bar), with an explicit “use global default” option, manual entry fallback when the list cannot load, and a hint when a row has an id but no model.

### Changed

- **Company hub / agents table**: Column headers and placeholders use company-oriented wording (role key, daily display name, files folder, model) while keeping `id` / `workspace` / `model` hints for OpenClaw alignment.
- **Company hub title**: Dialog and header tooltips use “公司与职务” / “Company & roles” instead of “多 Agent” for end-user clarity.

- **Company wizard — roles step**: Removed the openclaw.json-oriented blurb; added 3–7 headcount presets (with suggested role ids) plus RAM guidance (about four roles ≈ 64GB in testing).

- **Company wizard — final step**: Reduced to charter/workspace fields and a single **Save** button (same pipeline as before: roles → topology → roster skill); removed per-step actions, SKILL.md preview, checkboxes, and technical JSON panel from this step.

- **Company wizard — collaboration step**: Hid the read-only `agentToAgent` / `sessions.visibility` JSON block; users only pick the collaboration preset (and custom edges when applicable).

- **Company hub wizard draft**: Closing the dialog saves the in-progress wizard (step, company fields, roles table, topology choices, roster options) to `sessionStorage` and restores it on reopen so navigating back or closing mid-flow does not lose unsaved edits; cleared after a successful “save all”. Cancelling the full-mesh confirmation sets a visible error so “save all” does not treat it as success.

- **Company hub / collaboration topology**: Preset dropdown and related hints use plain “HQ ↔ roles” style copy instead of graph/allow-list jargon; section title and `main`-missing errors aligned with the new labels.

- **Multi-agent hub (Gateway config)**: Saving `agents.list` now surfaces **hash-mismatch** and **patch validation** errors with actionable copy (refresh before retry / read gateway message), and shows **different success hints** when the write went through the gateway versus local `openclaw.json` merge (including after gateway failure + desktop fallback).

- **Session history after /new or + New**: Refresh `sessions.list` when the user sends `/new` or `/reset`, when opening a transcript that contains OpenClaw’s session-bootstrap line, or after toolbar **+ New**; show a short notice pointing users to **History** / the session dropdown so prior transcripts stay discoverable (aligned with OpenClaw Gateway session keys + `chat.history`).

## [0.8.5] - 2026-04-03

### Added

- **Experimental features merged to main**: Live Patch panel (pick workspace + apply fenced unified diff) and Pheromone memory graph UI, with Tauri commands (`live_edit_*`, `pheromone::*`) and IPC permissions.
- **Gateway & AppShell maintainability**: Modular gateway store (`gateway-store-*`), 1012 service-restart backoff, dev-only swallowed-error logging, chat throttle helper + tests; AppShell split into composables plus `AppShellTopBanners` / `AppShellConversationColumn`.
- **Rust**: Centralized `didclaw_invoke_handlers!` in `command_registration.rs`; `live_edit_patch` and `pheromone` modules wired into the handler list.

### Added
- **Tools profile selector in General Settings**: users can now pick one of four `tools.profile` values (`full` / `coding` / `messaging` / `minimal`) directly from the DidClaw settings UI. The selection reads the current value from `openclaw.json` on open and writes only the `tools.profile` key on change, preserving all other configuration. A backup of `openclaw.json` is created before each write.

### Added

- **Bundled workspace skills**: The `didclaw-ui/skills` tree is shipped in the app bundle (`tauri.conf.json` resources) and, on startup, any packaged skill folder that is not yet present under `~/.openclaw/workspace/skills` is copied there (existing folders are left untouched).
- **Non-destructive OpenClaw writes (AI settings + gateway provider editor)**: Added `ai-provider-write-policy.ts` — **`env.vars`**: DidClaw only writes an env key when it is **empty** in `openclaw.json` (existing values from CLI or manual edits are left alone). **`providers.*.apiKey`**: patches include a new apiKey only when there was none, the stored key was masked, or the user entered a **different** real key; otherwise the merge updates models/baseUrl without overwriting credentials. Applies to main **AI settings** (including image-gen env sync and Zhipu `ZHIPU_API_KEY`) and **Gateway → Providers** save. `read_open_claw_ai_snapshot` continues to expose `envVars` for these checks.

- **Keyboard shortcut for the right preview pane**: `Ctrl+Alt+P` closes the file preview when it is open; on desktop, when the preview is closed it opens the same local-file picker as the message toolbar button. The local file button tooltip mentions this shortcut.
- **Keyboard shortcut for the left quick-actions sidebar**: `Ctrl+Alt+L` toggles the DidClaw tool sidebar open and closed (same as the left edge control).
- **Composer keyboard icon**: Next to the “?” hint button, a keyboard icon shows a hover popover listing global shortcuts (`Ctrl+Alt+L`, `Ctrl+Alt+P`, session `Ctrl+Tab`).

### Fixed

- **Pasted chat images: gateway could not resolve local files**: Attachments now include OpenClaw’s expected `path` field (in addition to `filePath`) when saving to `~/.openclaw/workspace/.attachments/`, and the user message text appends `[Attachment: <absolute path>]` lines so the model/tools can locate the file.

- **KV_KEY_NOT_ALLOWED when OpenClaw update check runs**: `OpenClawUpdatePrompt` persists a 7-day deferral under `didclaw.openclawUpdate.firstSeen`; that key was missing from the SQLite KV allowlist (`didclaw_db.rs` / `didclaw-kv.ts`), causing unhandled IPC rejections in the dev console.

- **Chat image attachments blocked by ACL**: Added `save_chat_attachment` to `permissions/didclaw.toml` so the desktop shell allows saving pasted/dropped images before send (fixes `Command save_chat_attachment not allowed by ACL`).

### Changed

- **`write_open_claw_env` targets `env.vars`**: Environment patches from DidClaw (image plugins, Zhipu key, etc.) now merge into `openclaw.json` → `env.vars`. Legacy flat string keys previously stored directly under `env` are migrated into `env.vars` on the next write.

- **Left quick-actions toolbar opens on click, not hover**: The slim edge strip no longer expands the sidebar after a hover delay (which fired when the cursor merely passed along the left edge). Users open it with an explicit click; the strip shows a light hover tint and supports keyboard focus.

- **Replace WeChat and WhatsApp icon buttons with text labels**: The circular SVG icon buttons in the composer toolbar are now pill-shaped text buttons ("微信" / "WhatsApp"), making the channel indicators immediately readable without needing to recognise brand icons.

### Changed

- **Simplify Manual Import tab to a two-row install UI**: Replaced the previous multi-section layout with two compact rows — "安装技能" (ZIP/folder, whole row is a drag-drop target) and "安装插件" (picks a package file and installs via CLI immediately, no separate "安装" button needed). Install directory, slug, and ClawHub credentials are collapsed into an "高级选项" `<details>` section so they don't clutter the main view. Added `onPickAndInstallPlugin` which combines file-picking and CLI install into a single action.
- **Hardcode skill install root to `~/.openclaw/workspace/skills`**: Removed all fallback logic; `default_install_root` unconditionally returns the workspace-scoped path and the directory is created on first install. On the frontend, `syncInstallRoot` now detects and discards any previously stored legacy path (`~/.openclaw/skills`) so old stored values no longer override the correct default.
- **Improve Manual Import tab UX in Skills Manager**: Reordered layout so the drag-drop zone, slug field, and install buttons are grouped together at the top as the primary action. ClawHub credentials are now collapsed by default in a `<details>` disclosure widget (labeled "ClawHub 凭据 · 可选") so they no longer interrupt the main install flow. Removed a duplicate "选择 ZIP 安装" button that previously appeared inside the drop zone. Field labels for slug and credential inputs now use a bolder weight for easier scanning.

## [0.8.4] - 2026-04-01

### Changed

- **Update delivery endpoints now align with the public release site**: The app update endpoint examples and website download buttons now point to `didclawapp.com/download`, keeping the in-app updater and public download entrypoints on the same release host.

## [0.8.3] - 2026-04-01

### Added

- **Product Hunt screenshots**: Added `didclaw-ui/producthunt/` with three PNGs (main interface, file preview, dashboard) for launch and marketing use.

- **Auto-generate update manifest on `pnpm dist:win`**: `scripts/post-dist-win.mjs` now runs automatically after the Windows build, writing `dist/didclaw-update.json` with the version, date, and `didclawapp.com/download` URLs for `.exe` and `.msi`.

### Changed

- **Docs**: `docs/gateway-client-protocol-notes.md` now records OpenClaw npm `latest` as **2026.3.31** (per [openclaw/openclaw releases](https://github.com/openclaw/openclaw/releases)); `exec.approval.requested` payload shape note kept in sync.

- **Website**: updated Windows download link to `didclawapp.com/download`, changed all GitHub links to `github.com/didclawapp-ai/didclaw`, replaced footer copyright badge with AGPL-3.0 link, and hid the not-yet-available macOS / Linux download buttons. Website source is now tracked in the repository.

### Fixed

- **Approval follow-up can now surface the blocked backend pairing upgrade**: DidClaw now checks for the pending `gateway-client` scope-upgrade request that causes "approval clicked but AI still does not continue", and exposes a one-click in-app approval repair instead of forcing users to inspect `~/.openclaw/devices` manually.

- **Exec approval dialog now mirrors more upstream context**: The popup now shows `Session`, `Security`, and `Ask` when the gateway includes them, making approval behavior easier to compare with the official OpenClaw UI and policy state.

- **Exec approvals now show gateway-confirmed status**: After `exec.approval.resolve` is sent, DidClaw now surfaces the later `exec.approval.resolved` confirmation from the gateway ("allow once", "always allow", or "deny") so users can distinguish submission from gateway acknowledgment.

- **Exec approval dialog now gives clearer in-flight feedback**: The popup shows an expiry countdown, a short “approval submitted” notice after clicks, and a warning when multiple similar approvals pile up due to retries, reducing the impression that a click was ignored.

- **Exec approval dialog now explains shell-wrapper behavior**: For `cmd.exe` / `powershell.exe` / `pwsh.exe` style approvals, the popup now clarifies that the current click still approves this run, while upstream `allow-always` may still re-prompt on later similar commands.

- **Exec approval dialog now shows host and resolved executable path when available**: This makes it easier to see whether a request is a direct binary run or a shell/cmdlet case where upstream `allow-always` may not persist an allowlist entry.

- **Exec approval dialog now shows the approval ID**: The popup displays the full gateway approval id so users can compare it directly with the short/full ids echoed by OpenClaw in chat when diagnosing approval flow issues.

- **Exec approval resolve returned “unknown or expired approval id”**: Normalized approval `id` (trim; fallback if ever nested), handle `exec.approval.resolved` to drop completed rows from the queue, and dismiss stale prompts when the gateway reports expired/unknown id (covers no-approval-route and timeouts). See `docs/gateway-client-protocol-notes.md` (exec approval ops note).

- **Exec approval dialog showed “unknown command”**: Gateway `exec.approval.requested` carries the run details under `request` (`command`, `cwd`, `systemRunPlan`, etc.). The UI previously read only top-level fields, so the command line was empty. Parsing now unwraps `request` and still accepts legacy flat payloads.

- **Pasted images not visible to AI**: On desktop, pasted/dropped images are now saved to `~/.openclaw/workspace/.attachments/` and sent to the gateway as a file path instead of inline base64. The gateway reads the file directly, which resolves the issue where the AI could not see the attached image.

### Changed

- **App icon updated**: Replaced all icon assets with the new DidClaw lobster-D logo (transparent corners, all sizes regenerated: ICO, PNG, Square logos).

- **Icon regeneration script**: Added `pnpm run icons` (`scripts/regen-icons.mjs`), which letterboxes `src-tauri/icons/didclaw-logo.png` onto a transparent 1024×1024 canvas (required by `tauri icon`) and regenerates `icon.icns`, `icon.ico`, PNGs, iOS, Android mipmaps, and Windows Appx tile PNGs. `pnpm run make-ico` now forwards to the same pipeline. The script verifies that ICO/ICNS/PNGs were actually rewritten and prints their mtimes (replace the logo, then run `pnpm run icons` again—Explorer times stay old until you do).

- **Icon repo cleanup**: Dropped legacy `source_clean.png` / `source_transparent.png` and the stray Gemini-generated PNG; committed `didclaw-logo.png` as the single canonical source for `pnpm run icons`.

### Fixed

- **`public/icon-32.png` white margin in Explorer / dist**: The file had transparent pixels outside the rounded logo; on a white background that reads as a white border. It now stays in sync with `src-tauri/icons/32x32.png` via `pnpm run icons` (full-bleed opaque edges, same as in-app assets).

- **Production build (`vite build`) failed on `/icon-128.png`**: Missing `public/` PNGs and Rolldown resolving root-absolute `<img src>` as a module. In-app logos now import `src/assets/app-icon-32.png` / `app-icon-128.png`; `pnpm run icons` copies the matching Tauri sizes into those paths.

- **Ctrl+V pasted screenshots not reaching the model**: Clipboard images from WebView2 / Windows often have an empty `File.type` or appear only on `clipboardData.files`. The composer now collects those cases, and `chat.send` builds image attachments using magic-byte sniffing so PNG/JPEG/GIF/WebP are still encoded with a correct `mimeType` for the gateway.

- **Local `file://` HTML preview**: Tauri `preview_open_local` no longer treats `.html` / `.htm` as plain text; the desktop API returns `displayKind: "html"` and the preview store maps legacy `text` + `.html` URLs to iframe render so the right pane shows the page instead of a TEXT source view.

### Added

- **HTML file preview (live render)**: `.html` / `.htm` files are now rendered in a sandboxed iframe instead of shown as syntax-highlighted source. ECharts, D3, and other script-driven pages generated by AI work out of the box.

---

## [0.8.2] - 2026-04-01

### Added

- **OpenClaw update 7-day hold period**: New OpenClaw versions are now silently recorded on first detection; the upgrade prompt is only shown after 7 days have elapsed, giving maintainers time to verify compatibility before users are notified. The prompt copy also confirms "verified for compatibility with DidClaw".
- **WeChat plugin security-block guidance (OpenClaw 3.31+)**: When the WeChat plugin install is blocked by OpenClaw's new dangerous-code scanner (false positive on `child_process`), the install log now shows a clear explanation and the exact command to bypass the check: `openclaw plugins install @tencent-weixin/openclaw-weixin --dangerously-force-unsafe-install`.

- **Disable devtools in production builds**: Set `"devtools": false` in `tauri.conf.json`; re-enabled via `tauri.dev.conf.json` overlay so local development (`pnpm dev:tauri`) is unaffected.
- **Fix CI lint failures**: Added Node.js globals (`Buffer`, `process`) to ESLint config for the `scripts/` directory; renamed unused `i` argument to `_i` in `make-ico.mjs`; removed extra blank line in `PreviewPane.vue` template.
- **CI/CD workflows**: Added `.github/workflows/release.yml` to build and publish Windows installers (NSIS `.exe` + `.msi`) automatically when a `v*` tag is pushed; also supports manual trigger (`workflow_dispatch`) for build verification without publishing. Added `.github/workflows/ci.yml` to run lint, typecheck, and unit tests on every push to `main` and on pull requests. Release workflow now includes a `check` gate job (lint · typecheck · test) that must pass before the Windows build starts.

- **README internationalization**: Rewrote `README.md` in English as the primary file for international contributors; preserved the full Chinese version as `README.zh-CN.md` with mutual language links at the top of each file.
- **Add main interface screenshot to README**: Added `screenshot-main.png` under `.github/assets/` and embedded it in both `README.md` and `README.zh-CN.md` for an immediate visual impression of the app.
- **Cursor rules and workspace skill added to version control**: Added `.cursor/rules/` (project conventions, client rules, security guidelines) and `.cursor/skills/didclaw-workspace/SKILL.md` so all collaborators share the same AI coding constraints. Updated `.gitignore` to exclude only personal Cursor settings (`mcp.json`, `settings.json`, `chat/`, `composer/`) rather than the entire `.cursor/` directory.
- **Clean up non-documentation files from docs/**: Removed `docs/SESSION-CONTEXT.md` (AI session memory containing local machine paths) and `docs/*.html` (development UI prototypes) from version control; updated `.gitignore` to permanently exclude them. Local files are preserved.

---

<!-- ============================================================ -->
<!-- 以下条目为历史记录，使用中文                                    -->
<!-- History entries below are in Chinese                         -->
<!-- ============================================================ -->

## [未发布 — 历史条目]

- **移除调试面板**：删除文件预览侧栏底部「TOOLS / EVENTS (NON-CHAT)」调试区块（`PreviewPane`），不应暴露给最终用户。

- **自动隐藏顶部标题栏**：关闭原生 Windows 装饰（`decorations: false`），`AppHeader` 改为 `position: fixed` 浮层；默认隐藏，鼠标移至窗口顶部 8 px 感应带时滑出，离开后 1.5 s 自动收起；有连接错误时强制常驻。顶栏右侧新增最小化 / 最大化（含还原图标）/ 关闭三个窗口控制按钮，关闭按钮悬停变红；整个标题行配置 `data-tauri-drag-region`，保留拖动窗口能力。

- **单元测试基础设施**：引入 Vitest（`pnpm test` / `test:watch` / `test:coverage`），所有测试放在 `didclaw-ui/test/` 目录。初始覆盖 6 个 `lib/` 纯函数模块（113 个用例）：`preview-kind`、`chat-history-sort`、`is-safe-preview-url`、`url-allowlist`、`extract-chat-links`、`zod-format`。
- **客户端目录重命名**：`lclaw-ui/` 已重命名为 `didclaw-ui/`；`.gitignore`、`README.md`、`docs/` 相关引用同步更新；`.VSCodeCounter/` 加入 `.gitignore`。
- **README 全面重写**：参考 ClawX 风格重新编写仓库介绍，增加架构图、功能特性、多渠道列表、多文件预览说明、开发命令表；许可证改为 AGPL-3.0，底部添加商务联系方式。

- **品牌图标（DidClaw Logo）**：由 AI 辅助生成龙虾拟态 D 字母图标，替换全套 Tauri 应用图标（`icon.png`、`icon.ico`、`icon.icns`、所有 Windows/iOS/Android 尺寸），ICO 文件采用 RGBA PNG-in-ICO 格式确保四角透明。
- **顶栏品牌图标**：`AppHeader` 中将旧的红色菱形占位图替换为新品牌 Logo（`/icon-32.png`）。
- **关于页面重设计**：重新布局 `AboutDialog`，使用实际 Logo 图片替换旧 favicon，新增「联系」卡片（网站 didclawapp.com、邮件 didclawapp@gmail.com），整合外链按钮（GitHub / 官网 / 文档）并附图标，视觉层次更清晰。
- **Logo 设计参考稿**：`docs/didclaw-logo-concepts.html` 包含 5 个 SVG 方案备查。

### 修复

- **MiniMax OAuth 轮询超时立即退出**：原来使用 `expired_in`（Unix 时间戳，秒）减去当前时间毫秒来计算剩余时长，导致 `saturating_sub` 归零，轮询循环在用户授权前就已超时退出。改为固定 10 分钟超时窗口。
- **MiniMax OAuth 轮询因 HTTP 4xx 中止**：`ureq` 对非 2xx 响应直接返回 `Err`，而 Device Flow 服务端通常以 HTTP 4xx 携带 `authorization_pending` 正文。改为同时读取 2xx 和 4xx 的响应体，并兼容 MiniMax 自定义 `status` 字段与标准 RFC 8628 `error` 字段两种格式。
- **MiniMax OAuth 配置写入不完整**：成功授权后写入 openclaw.json 的 provider key 错误（`minimax` → `minimax-portal`），缺少 `apiKeyEnv: "minimax-oauth"` 和 `authHeader: true`（Gateway 依赖这两个字段通过 OAuth 凭据鉴权），缺少 plugin 注册（`minimax-portal-auth`），且未使用 token 中的 per-account `resource_url`。现在通过新增 `patch_openclaw_json_for_minimax` 函数一次性原子写入所有必要字段，逻辑对齐 ClawX 的 `setOpenClawDefaultModelWithOverride`。
- **MiniMax OAuth 设备码与配置兼容性**：MiniMax 返回的轮询 `interval` 实际为毫秒，旧逻辑按秒再次乘以 1000，导致授权后长时间没有回调；同时 DidClaw 现在在向导中展示授权码与登录页入口，授权成功后写入兼容当前 OpenClaw 的 `apiKey + models[]` provider 结构，并清理旧的 `minimax-portal-auth` 插件残留，避免配置校验失败。
- **MiniMax Portal 切回主模型后无响应**：当用户从其他 provider 切回 MiniMax Portal 时，界面可能保留到不受当前套餐支持的 `MiniMax-M2.7-highspeed`。现在优先回落到 `MiniMax-M2.7`，避免切回后请求直接失败或表现为“没有反应”。
- **首次引导偶发静默跳过**：首次引导状态检测失败时，向导之前会被直接隐藏并落入主界面。现在改为保留错误态向导；若用户已经进入主界面但模型步骤仍未完成，也会显示“继续引导 / 稍后提醒”的兜底横幅，避免未完成引导却误以为可以直接使用。
- **首次 AI 引导入口收敛**：首次模型配置步骤移除了 `OpenAI OAuth` 与 `Ollama` 的快捷入口，只保留 `MiniMax 国际/国内 OAuth`、`API Key` 与 `稍后配置`，减少普通用户进入尚不稳定流程后踩坑的概率。
- **界面语言自动跟随系统环境**：在未手动选择语言时，应用现在会按系统语言自动切换，`zh-*`（含简体/繁体）统一使用中文，其它语言使用英文；同时桌面端原生托盘与对话框的默认语言也改为按系统 locale 判断，不再容易在 Windows 上误用中文默认值。
- **托盘右键菜单更适合普通用户**：系统托盘菜单从仅有“显示 / 退出”扩展为 `显示 DidClaw`、`新建对话`、`打开设置`、`检查更新`、`退出 DidClaw`，点击后会自动唤起主窗口并执行对应动作，减少必须先进主界面再操作的步骤。

### 新增

- **自实现 MiniMax / OpenAI Codex OAuth 流程**：彻底弃用 `openclaw onboard --auth-choice` 子进程调用（该命令为交互式终端工具，在无 TTY 的 Tauri 子进程中无法正常执行 OAuth 流程）。新实现在 Rust 后端完全自主处理：MiniMax 采用 RFC 8628 Device Authorization Grant（轮询 token，`open::that` 打开浏览器），OpenAI Codex 采用 PKCE + axum 本地回调服务器（端口 1455），OAuth token 直接写入 `~/.openclaw/agents/*/agent/auth-profiles.json`，并同步更新 `openclaw.json` provider 配置与默认模型。MiniMax 卡片拆分为「国际」和「国内（CN）」两张，分别对应 `api.minimax.io` 和 `api.minimaxi.com`。

### 修复

- **引导向导网关启动时机**：openclaw 安装完成后跳转到渠道/模型步骤时，现在立即调用 `scheduleDeferredGatewayConnect` 使网关后台连接；之前需等到向导完全结束才连接，导致 OAuth 步骤到来时网关尚未就绪。
- **OAuth 授权双重重连闪烁**：`startOAuthOnboard` 中 `ensureOpenClawGateway` 与 `scheduleDeferredGatewayConnect` 同时调用会造成两次 UI 重连动画；已移除多余的 `scheduleDeferredGatewayConnect` 调用，并将网关启动后等待时间从 1.5 s 延长至 2.5 s，确保 `openclaw onboard --auth-choice` 在网关就绪后再执行（修复浏览器授权窗口未弹出的问题）。

- **OAuth ACL 权限缺失**：`run_openclaw_onboard` 命令未加入 `permissions/didclaw.toml` 的 ACL 白名单，导致点击 OAuth 卡片报 `not allowed by ACL` 错误；已补充。向导进入 OAuth 流程前，若网关尚未连接会自动先启动网关（调用 `ensureOpenClawGateway` + 等待 1.5 s），再执行授权命令。

### 新增

- **引导向导 OAuth 支持**：在首次运行向导的「配置模型」步骤中，新增三个一键浏览器授权卡片（MiniMax · OpenAI Codex · Google Gemini），调用 `openclaw onboard --auth-choice` 完成 OAuth 授权后自动写入配置、跳过手动填写 API Key 的门槛。同时新增 Rust Tauri 命令 `run_openclaw_onboard`、前端 `runOpenclawOnboard` API 及授权等待/成功/失败状态 UI。

### 修复

- **AI 配置弹窗缩放问题**：移除之前基于 `transform: scale()` 的整体缩放方案，该方案在默认 570px 窗口下导致弹窗内所有文字缩小至约 58%。改为弹窗自身固定合理尺寸（普通面板 `min(540px, 100vw-24px)`，AI 宽面板 `min(720px, 100vw-24px)`），卡片网格使用 `repeat(auto-fill, minmax(120px, 1fr))` 自适应列数（宽度足够时展示 4 列，默认窗口展示 3 列），文字大小始终正常。

### 新增

- **AI 配置面板二次修正**：修复 provider 卡片网格实际渲染为 2 列的问题（将 `repeat(3, 1fr)` 改为 `repeat(3, minmax(0, 1fr))` 并给卡片加 `min-width: 0; overflow: hidden`，防止内容撑开隐式最小宽）；卡片补充 `min-height: 100px`；Primary banner 右侧补充"切换 ›"文字；备用模型行的添加按钮改为文字链样式，与 Demo 一致。

- **AI 配置面板重设计（AiProviderSetup）**：整体风格向技能/渠道面板对齐。改为固定 480px 高度的自容器布局；顶部展示主力模型 banner 与可折叠备用模型编辑行；搜索框 + 六个横向滚动标签（全部/已配置/推荐/国内/海外/本地）快速过滤；三列 provider 卡片展示 icon、名称、描述、模型数与 baseUrl；图片生成独立子区块；配置面板改为 `position:absolute` 底部滑出 overlay（含 API Key、baseUrl、节点切换、模型 chips 及保存/设为主力按钮），与技能面板动画方式一致。补充 `aiProvider.searchPlaceholder / tagAll / tagConfigured / tagRecommended / tagCN / tagIntl / tagLocal / noMatch` 中英文文案。

- **技能管理对话框改为卡片式布局**：`SkillsManagerDialog` 与渠道面板一致采用固定高度对话框、左侧四个 Tab（技能市场 / 已安装 / 本地技能库 / 手动导入）、市场页三列卡片网格与底部滑出详情；搜索框内嵌图标并防抖实时查询，标签单行横向滚动；手动导入 Tab 集中展示安装目录与 ZIP 拖拽区；关闭对话框时重置详情状态。补充 `skills.*` 中英文文案。
- **"关于"对话框视觉重设计**：顶部 hero 区加渐变背景与大 logo（附 drop-shadow），居中品牌名与副标题；版本行整合进圆角卡片；技术栈芯片改为可点击外链（带 hover 高亮）；新增 GitHub / openclaw.ai / 文档三个外链按钮区；关闭按钮移至右上角绝对定位；入场动画改用弹性回弹曲线。
- **进一步对齐 HTML Demo 视觉细节**：底部详情面板改为 `position:absolute` overlay（`translateY` 动画）不再占用 flex 高度；市场卡片移除内联安装按钮，点击卡片弹出面板、面板内统一处理安装/卸载并附带版本/作者/类型/来源 meta 行与旋转 spinner；标签增加 active 高亮追踪；"已安装"Tab 技能与插件列表改为 demo 同款紧凑行（icon + 名称 + 来源/状态 + 状态圆点），操作全归到底部面板。

- **新增 Slack、LINE、Microsoft Teams、Google Chat 渠道卡片**：这四个渠道均为 openclaw 内置 extension（无需安装插件），现在在渠道面板以卡片形式展示。点击卡片可填写凭据：Slack 需要 Bot Token (xoxb-) + App Token (xapp-)，LINE 需要 Channel Access Token + Channel Secret，Teams 需要 App ID + App Password，Google Chat 需要 Service Account JSON 文件路径。保存后自动重启 Gateway 并刷新连接状态，流程与企业微信一致。

- **修复企业微信保存后无反应的问题**：`WeComPanel` 写入配置后既未重启 Gateway（导致 WeCom WebSocket 不启动），也未调用 `onSuccess()`（导致卡片状态不刷新、对话框不关闭）。现在保存成功后先调 `restartGatewayAndReconnect` 再调 `onSuccess()`，整个流程与 WhatsApp/微信 一致。

- **移除向导预安装列表中的 Gmail**：`@openclaw/gmail` 不存在，Gmail 与 OpenClaw 的集成需要 Google Cloud Pub/Sub + OAuth + 公网 webhook，无法做成一键安装插件，移出向导避免安装失败。默认勾选改为 WhatsApp + 微信。

- **修复插件安装后 Gateway 重启导致持续断开的问题**：企业微信等插件安装后 Gateway 会自重启，WebSocket 以 1012 "service restart" 关闭，UI 之前将其当作永久错误显示"已断开"。现在识别 1012 代码，进入 `connecting` 状态并在 3 秒后自动重连，等待 Gateway 重启完成后恢复连接。

- **修复企业微信插件重复安装报错**：向导已安装的插件再次点击卡片会触发 `openclaw plugins install`，因目录已存在导致非零退出码，UI 显示"安装失败"。在 Rust 层识别 `"plugin already exists"` 输出，改为返回 `ok: true + alreadyInstalled: true`，让 UI 继续进入配置流程。同时将 `check_channel_plugin_installed` 改为检查扩展目录是否存在（非空）而非仅检查 `package.json`，兼容不同安装方式的目录结构。

- **修复微信卡片显示"未安装"的问题（第二次）**：通过阅读微信插件源码（`openclaw-weixin/src/channel.ts`）发现，`buildChannelSummary` 只暴露 `configured` 字段，不含其他渠道常用的 `connected`/`linked`/`running`。扩展 `refreshChannelStatuses()` 的判断逻辑，将 `connected | linked | configured | running` 任意为 `true` 均视为已连接，覆盖所有已知插件的状态字段命名约定。
- **修复微信卡片显示"未安装"的问题（第一次）**：微信插件在 Gateway 中注册的渠道 key 是 `openclaw-weixin`，而非 UI 的 `wechat`。在 `ChannelDef` 增加可选字段 `gatewayChannelId`，`wechatDef` 设置为 `"openclaw-weixin"`。`refreshChannelStatuses()` 改为用 `gatewayChannelId ?? id` 作为查找 key。

- **渠道面板全新卡片式 UI**：`ChannelSetupDialog` 重写为固定尺寸（480px 高）+ 4 列卡片网格 + 底部滑出详情面板。卡片右下角绿点表示已连接，旋转圆环表示操作中；面板区域可随渠道增多自动滚动，整体对话框尺寸不变。底部面板动画滑出（230px），展示对应渠道的 QR / 凭证 / OAuth 操作 UI。所有现有 Panel 组件（WhatsApp、WeChat、飞书、企业微信、Discord）无需改动，通过 `:deep()` 样式适配新布局。
- **渠道连接状态实时同步**：对话框打开时调用 `channels.status` RPC 初始化卡片连接状态；Panel 报告成功后自动刷新；动态插件渠道每 8 秒轮询一次，用户在外部安装的插件自动出现在卡片列表中。



- **安装向导渠道预安装新增 Gmail**：将 Gmail（`@openclaw/gmail`）加入 `ONBOARDING_CHANNELS`，默认勾选（与 WhatsApp、WeChat 一起），覆盖国内外高频渠道；同步补充中英文 i18n。
- **安装向导新增渠道插件预安装步骤**：调整向导步骤顺序为「安装 OpenClaw → 选择渠道插件 → 配置 AI 模型」（原为渠道在最后）。渠道选择步骤默认勾选 WhatsApp 和 WeChat，可选 WeCom，逐一调用 `openclawPluginsInstall` 静默安装，完成后继续进入模型配置步骤；可跳过。AI 模型配置放到最后作为更复杂的收尾步骤，避免之前因 model 步骤退出路径直接关闭向导导致渠道步骤无法出现的问题。

### 修复

- **Gateway 连接握手失败（client.id 校验错误）**：`GATEWAY_CLIENT_ID` 从 `"didclaw"` 改为 `"openclaw-control-ui"`，与 Gateway `GATEWAY_CLIENT_IDS` 枚举对齐。此前值不在 Gateway schema 白名单中，导致连接握手被拒、首次安装后 AI 引导无法出现。

### 重构

- **渠道插件化架构完成（阶段七 + 八）**：在模块化基础上完成动态插件渠道支持与 OAuth 范式。新增 `base/useInstalledPlugins.ts`（调用 Gateway `plugins.installed` RPC，优雅降级），`base/useOAuthFlow.ts`（系统浏览器授权 + 轮询 `oauth.status`），`_generic/GenericPluginPanel.vue`（按 `configSchema` 动态渲染表单，支持 text/password/select/multiselect/oauth-button 字段），`_install/InstallChannelPanel.vue`（`+` Tab，含推荐插件列表与自定义包名安装）。`ChannelSetupDialog.vue` 改为完全数据驱动：Tab 栏由 `BUILTIN_CHANNELS + dynamicChannels + 安装 Tab` 合并生成，面板渲染通过 `<component :is>` 统一分发；新增渠道只需在 `registry.ts` 加一行。

- **渠道设置模块化重构（阶段一至六）**：将 `ChannelSetupDialog.vue`（原 2114 行）拆分为独立渠道面板组件架构。新增 `channels/` 目录，包含 `types.ts`（接口定义）、`registry.ts`（渠道注册表）、`base/useChannelContext.ts`（共享上下文）、`base/useStreamingInstall.ts`（CLI 流式安装复用组件），以及 Discord、WeCom、Feishu、WeChat、WhatsApp 各自的 `def.ts` + `Panel.vue`。对话框主文件精简至约 80 行，各渠道逻辑完全自治，支持 `defineAsyncComponent` 懒加载。

## [0.8.1] - 2026-03-30

### 优化

- **Tauri 与界面语言同步及 IPC 错误 i18n**：Rust 侧 `app_locale` 与 `didclaw_set_app_locale`，托盘菜单、部分文件对话框与 Shell 提示随应用语言切换；外链打开、Base64 另存、邮件准备、KV 校验等返回稳定 `errorKey`；前端新增 `lib/tauri-i18n.ts` 与 `tauriErr.*` 文案，在 `i18n` 就绪后同步调用 Tauri 设置语言；`vite-env.d.ts` 补充 `openExternalUrl` / `saveBase64FileAs` 可选 `errorKey`。
- **i18n 补全（filePreview / gateway store）**：文件预览 store 中内嵌图标签、另存/全文标题、桌面预览与文本加载错误、LibreOffice 提示等接入 `preview.*`；网关 store 的 hello 文案、断开连接说明与配对提示接入 `gatewayConn.*`；相关注释改为英文（gateway 仅覆盖已改动段落）。
- **i18n 补全（openclaw-model-guards / session-display）**：主模型 glm-image 不兼容说明改为 `openClawModel.glmImagePrimaryIncompatible`；会话展示「新对话」「已结束」后缀与「无活跃时间」、历史时间 `toLocaleString` 随应用语言切换；导出 `sessionEndedSuffix` / `stripSessionEndedSuffix` / `labelHasEndedSuffix`，`session` store 关闭会话时的 ghost 行标签与上述后缀一致并兼容旧版中文后缀。
- **i18n 补全（open-external / openclaw-config-hint / openclaw-ai-config）**：桌面端打开外链失败默认文案、保存模型配置后的提示（`getOpenClawAfterWriteHint` 替代常量）、读取 AI 快照失败及模型选择器/Provider 视图兜底文案（别名、当前默认、检测说明、Base URL 标签）均接入 vue-i18n，新增 `openExternal.*`、`openClawConfig.*`、`openClawAi.*`；`chat` store 的 `flashOpenClawConfigHint` 无参时使用当前语言提示。
- **i18n 补全（markdown-render）**：`echarts-json` 代码围栏的错误提示与图表容器 `aria-label` 改为 `i18n.global.t()`，新增 `markdownRender.*` 中英文 key；相关 JSDoc/注释改为英文。
- **i18n 补全（gateway-errors）**：常见 JSON-RPC 错误码说明与「提示 + 原始 detail」拼接改为 vue-i18n，新增 `gatewayErr.*`（含 `withDetail` 与各码文案）；`describeGatewayError` 随当前语言切换。
- **i18n 补全（clawhub-api）**：ClawHub HTTP 客户端中用户可见错误（无效 slug/包名、请求超时、HTTP 状态、请求/下载失败）改为 `i18n.global.t()`，新增 `clawhubApi.*` 中英文 key；文件内 JSDoc 与块注释改为英文。

### 修复

- **ESLint 警告全部清零**：修复 8 个文件共 377+ 条 ESLint 警告：`AboutDialog`、`ChatRunStatusBar`、`ExecApprovalDialog`、`DoctorDialog`、`BackupRestoreDialog` 中的 button 内联文本换行；`SlashCommandPicker` 中的多余空格；`OpenClawUpdatePrompt` 中的未使用参数 `auto → _auto`；`SkillsManagerDialog`（ClawHub 区块，约 300 条）与 `ChannelSetupDialog`（约 30 条）中的缩进与自闭合格式。
- **ESLint 警告清零（GeneralSettingsDialog / UsageStatsDialog）**：修复两个文件共 6 条 ESLint 警告：`GeneralSettingsDialog` 中的 `<input/>` 自闭合及两处多余空行；`UsageStatsDialog` 中的 `props` 未使用变量及两处多余空行。
- **ESLint 警告清零（CronJobsDialog）**：修复模板区 85 条 ESLint 警告，含多行元素属性换行与缩进格式、`<input>` 禁止自闭合、`<textarea>` 正确使用自闭合，以及两处多余空行。

### 优化

- **i18n 补全（chat-attachment-encode / chat-line / chat-message-format）**：三个 lib 工具文件接入 vue-i18n，附件上传错误提示（`chatAttach.*`）、消息列表预览文案（`chatMsgFmt.*`）、字段提示与无正文标签（`chatLineLib.*`）均新增中英文 key；内部哨兵字符串改为 locale 无关的 ASCII 常量（`ASSISTANT_META_PREFIX` / `SYSTEM_NO_TEXT_PREFIX`），对应检测逻辑同步更新；文件内中文注释全部改为英文。

### 优化

- **i18n 补全（GatewayLocalDialog）**：补全 3 处硬编码中文备份路径错误提示（`onDeleteProvider`、`onSaveModel`、`onRestoreModel`），新增 `settings.errBackupNote` key（中英文）；修正 `formatProviderSaveToast` 中的中文标点拼接（`。`→尾号已并入 key）；更新 `settings.providerBackupNote` 加入句尾标点；8 处中文注释（脚本 + 模板）改为英文。
- **i18n 补全（AiProviderSetup）**：AI Provider 配置面板全面接入 vue-i18n，新增 63 个 `aiProvider.*` key（中英文），涵盖主力/备用模型栏、卡片徽章、图片生成面板、编辑面板所有标签与按钮、错误/成功反馈及确认对话框；同步修复 18 条 ESLint 警告（4 处 `<input/>` 自闭合、14 处 button 内联文本需换行）；脚本注释改为英文。
- **i18n 补全（PreviewPane）**：文件预览面板全面接入 vue-i18n，新增 22 个 `preview.*` key（中英文），涵盖工具栏按钮、提示段落、加载状态、LibreOffice 错误面板、Office 不支持嵌入提示、时间线标题与空状态；中文文案按「语句尽量简短」原则压缩。
- **英文化（OpenClawUpdatePrompt）**：将 `OpenClawUpdatePrompt.vue` 中所有中文硬编码字符串（脚本与模板）改为英文；文档链接同步切换为英文页面。

- **i18n 补全（FirstRunWizard）**：首次引导向导全面接入 vue-i18n，新增约 50 个 `wizard.*` key（中英文），涵盖标题、说明文案、安装进度步骤标签、所有阶段 detail 字符串、安装日志输出文本、Node.js 手动安装面板、模型选择卡片及 confirm 对话框；`wizard.*` 命名空间已有旧值与模板不一致的 key 同步更新（`title`、`installBtn`、`nodeManualTitle/Desc/DownloadBtn`）。

- **i18n 补全（WeChatIndicator / WhatsAppIndicator）**：渠道指示器弹窗的状态标题、扫码流程进度、插件安装/启用、Gateway 重启及错误全部接入 vue-i18n；新增 `channel.gwDisconnected` / `gwRestarting` / `retry` / `channelSetup` 等共享 key，以及 `channel.wechat.*` / `channel.whatsapp.*` 品牌专属 key（含参数插值）。
- **i18n 补全（ChatLineBody / ChatRunStatusBar / ComposerAttachments）**：链接右键菜单（另存为、系统打开、邮件、分享、复制链接）、图片说明、剪贴板错误提示、后台子代理状态栏、附件面板（待发附件标题、类型徽标、随信发送、仅预览、移除按钮）均已接入 vue-i18n；中文注释改为英文。
- **i18n 补全（SessionHistoryDialog）**：历史会话弹窗的标题、副标题、关闭按钮、搜索框占位符、条数统计、「当前」/「已结束」徽标及空状态文案均已接入 vue-i18n。
- **i18n 补全（AppShell）**：主界面 `AppShell.vue` 全部硬编码中文已替换为 `t()` 调用，涵盖延迟配置提示横幅、会话加载状态、消息面板标题、跟随最新/诊断过滤开关、本地文件按钮、Token 用量标签、历史加载、空状态提示、过滤提示及文件预览面板；同步将文件内所有中文注释改为英文，并修复 `displayLines` 中本地变量 `t` 遮蔽 `useI18n` 的问题。
- **i18n 补全**：`ToolSidebar`（功能/系统分组标签、退出、检查更新状态）、`DidClawUpdatePrompt`（更新弹窗全部文案及错误信息）、`SessionControlBar`（会话栏全部文案）均已接入 vue-i18n，英文界面下不再出现中文硬编码。
- **侧边栏触发延迟**：鼠标悬停到左侧触发区后延迟 1 秒才展开侧边栏，避免鼠标经过时意外弹出；展开后若 10 秒内无鼠标活动则自动收起，鼠标在面板内移动可持续重置计时。

## [0.8.0] - 2026-03-30

### 新增

- **全局快捷键唤起**：通用设置新增「全局快捷键」输入框，默认 `Ctrl+Shift+D`，在任意窗口下可召唤 DidClaw 主界面；支持自定义修改并即时生效（基于 `tauri-plugin-global-shortcut`，Rust 侧注册，无需前端权限）。
- **用量统计对话框**：侧边栏「功能」组新增「用量统计」入口（柱状图图标），展示当前 Gateway 活跃会话的 token 累计用量；顶部汇总卡片显示活跃会话数、累计输入/输出/合计 token 数，下方明细表格按最后活跃时间排序，支持一键刷新。
- **开机自启**：通用设置新增「开机自动启动」开关，启用后 DidClaw 随系统登录自动在后台就绪（Windows 注册表 / macOS LaunchAgent，基于 `tauri-plugin-autostart`）。
- **防休眠**：通用设置新增「防止电脑休眠」开关，启用后阻止系统因无操作进入休眠，适合 AI 长任务运行期间使用（Windows `SetThreadExecutionState`，macOS 预留）。
- **通用设置对话框**：侧边栏新增「通用设置」入口（齿轮图标），统一管理开机自启、防休眠与全局快捷键三项系统级设置。

### 修复

- **Gateway 消息元数据客户端名称**：将 `GATEWAY_CLIENT_ID` 从 `"openclaw-control-ui"` 改为 `"didclaw"`，修复消息元数据显示为「OpenClaw 的 Web 控制界面」的问题。

### 文档

- **路线图更新**：0.8.0 完成用户体验四件套（开机自启、防休眠、全局快捷键、用量统计）；内置 Skills 捆绑跳过（用户可从 ClawHub 自行安装）；0.9.0 进入功能冻结阶段，仅做 Bug 修复与轻量打磨，之后直接 1.0 发布。

## [0.6.1] - 2026-03-30

### 修复

- **任务栏常驻**：修复托盘图标 `menu_on_left_click` 废弃 API 警告，改用 `show_menu_on_left_click`。
- **在线升级**：修复 `desktop-api.ts` 漏注册 `checkDidClawUpdate` / `installDidClawUpdate` 导致检测静默失败；修复 ToolSidebar「检查更新」按钮无论有无更新都显示「已是最新版」的逻辑错误。

## [0.6.0] - 2026-03-30

### 新增

- **DidClaw 客户端在线升级**：侧边栏「关于」区新增「检查更新」按钮，启动 30 秒后也会自动静默检查一次；发现新版本时弹出对话框，显示当前版本、最新版本与更新说明，点击「下载并安装」自动下载安装包并启动安装程序；已检查过的版本可点「稍后提醒」跳过，不再重复弹出。更新清单地址由构建变量 `VITE_DIDCLAW_UPDATE_ENDPOINT` 配置（未配置时静默跳过）；清单为标准 JSON 格式，支持 Windows / macOS / Linux 独立下载链接。
- **`gen-update-manifest.js` 发布脚本**：打包后一键生成 `didclaw-update.json`，自动读取 `package.json` 版本号，支持 `--windows/macos/linux` 平台链接、`--notes/--notes-file` 更新说明、`--output` 输出路径。

### 修复

- **MiniMax 无流式输出**：MiniMax 配置使用 `/anthropic` 兼容端点（`api: "anthropic-messages"`），该端点不支持 SSE 流式，导致响应一次性输出。改为使用原生 `/v1` 端点（`api: "openai-completions"`），流式输出恢复正常。
- **API Key 明文泄露风险**：`readOpenClawProviders` 返回给前端的数据包含完整 API Key，AI Agent 读取 providers 数据时可能将 Key 输出到对话中。修复方案：在 Rust 层 `read_open_claw_providers` 返回前调用 `mask_providers_api_keys`，将所有 provider 的 `apiKey` 脱敏为前4位 + `****`；前端 `applyProvider` 和 `applyImageGen` 写回时检测 `****` 后缀，过滤掉脱敏占位值，避免将假值写入配置。
- **`write_open_claw_env` 命令未加入 ACL 白名单**：`permissions/didclaw.toml` 的 `invoke-all` 列表缺少该命令，导致前端调用时报 "Command not allowed by ACL" 错误，图片生成 env var 无法写入。已补充注册。
- **首次配置图片生成时 provider 字段不完整**：用户若跳过对话配置直接使用图片生成卡片，`applyImageGen` 写入的 provider patch 缺少 `baseUrl`、`api`、`authHeader` 等必要字段，导致对话模型随后也无法使用。修复方案：在 `applyImageGen` 中，构建 provider patch 时优先以目录默认值（`provEntry.baseUrl` + `provEntry.extras`）兜底，再以现有配置叠加，确保即使用户首次配置图片生成也会写入完整 provider 配置；成功 toast 同步提示用户重启网关后生效。
- **新用户配置图片生成时 env var 未写入**：OpenClaw 内置图片生成插件需要 `MINIMAX_API_KEY` / `GEMINI_API_KEY` 等环境变量，而之前 `applyImageGen` 只写了 `imageGenerationModel` 路径，未写入 `openclaw.json` 的 `env` 段，导致新用户开启图片生成后必然失败。修复方案：新增 Rust `write_open_claw_env` 命令；`IMAGE_GEN_CATALOG` 新增 `envKey` 字段；`applyImageGen` 现在同步写入对应 env var；`applyProvider` 保存有图片能力的 provider 时也顺带写 env var；`removeProvider` 时清理对应 env var。
- **图片生成配置写入位置错误导致 config 损坏**：`imageGenerationModel` 应写入 `agents.defaults.imageGenerationModel`（与 `model` 平级），但代码误将其 merge 进 `agents.defaults.model`，导致 OpenClaw 3.28 schema 校验报 "Invalid input"。修复方案：在 Rust `write_open_claw_model_config` 命令中增加 `imageGenerationModel` 独立 payload 参数，直接写到 `agents.defaults` 顶层；同步更新前端 `vite-env.d.ts` 类型与 `applyImageGen` / `removeImageGen` 调用方式。
- **Kimi 推荐模型列表过时**：目录中 `kimi-k1.5` 已废弃，同步为 OpenClaw 3.28 文档中的最新 K2 系列（kimi-k2.5、kimi-k2-turbo-preview、kimi-k2-thinking、kimi-k2-thinking-turbo）。
- **MiniMax 模型 ID 误写**：目录中 `MiniMax-M2.5-highspeed` 更正为 OpenClaw 文档的正式名称 `MiniMax-M2.7-highspeed`；同步移除已废弃的 `MiniMax-M2.5`。

### 优化

- **图片生成独立配置区块**：AI 配置页新增专属「图片生成」区块，MiniMax（image-01）与 Google Gemini（gemini-3-pro-image-preview）各有独立卡片；用户点击卡片展开后输入 API Key（已配置对话模型者自动预填）再点「开启图片生成」即可；当前已开启的图片生成模型在标题栏实时显示，并可随时一键关闭；移除了原先嵌入 MiniMax 对话卡片内的「🎨 图片生成」子选项，入口更清晰。
- **Google Gemini 推荐卡片**：`provider-catalog` 补充 Google 服务商条目（Gemini 3.1 Pro / Flash / Flash-Lite，OpenAI 兼容接口），AI 配置页推荐服务现在共展示 13 张服务商卡片。
- **MiniMax 图片生成支持**：AI 配置页 MiniMax 卡片新增「🎨 图片生成」开关区块，勾选后点「应用」即自动将 `minimax/image-01` 写入图片生成配置；聊天消息中 AI 返回的图片 URL（`data:image/`、`.png/.jpg/.webp/.gif` 等）现在直接内联显示图片，不再只显示链接胶囊，点击图片可放大预览，加载失败时降级为原来的链接样式；`provider-catalog.ts` 新增 `imageModels`/`defaultImageModel` 字段供后续其他服务商扩展。
- **会话消息卡片间距加大**：`margin-bottom` 从 6 px 调整为 12 px，容器内边距从 `8px 10px` 调整为 `10px 14px`，卡片之间不再紧挨，阅读更轻松。
- **侧边栏 UI 视觉美化**：用带圆角背景的 SVG 图标盒取代原有 Emoji 字符，各菜单分组新增「功能」/「系统」分区标签；hover 时显示左侧高亮竖条动效；「重启 AI 服务」图标盒采用红色警示调色，「已复制」状态切换为绿色；底部「关于」区域以细分隔线隔开并降低视觉权重；侧边栏标题区增加 DidClaw 品牌 gem 徽标；同步将「重启网关」/「网关诊断」标签改为「重启 AI 服务」/「AI 诊断」，与渠道对话框保持一致。
- **渠道接入界面面向普通用户优化**：将所有面向用户可见的"Gateway"/"网关"术语统一改为"AI 服务"，对应按钮标签也调整为"重启 AI 服务"；飞书、微信、企业微信安装卡片中的 npm 命令行代码块替换为用户友好的描述文字；`saveOk` 消息去掉 openclaw.json 路径引用，改为"配置已保存"；WhatsApp 切换账号提示去掉 CLI 命令引用；错误消息去除技术术语，飞书安装成功/失败摘要改为引导性说明。
- **顶栏主题/语言切换图标视觉优化**：主题按钮从易渲染失真的 Unicode 字符（☀/☾）改为清晰的内联 SVG 太阳/月亮图标，并为当前模式加上对应色调（深色模式下显示琥珀黄太阳，浅色模式下显示靛紫月亮）；语言切换按钮从抽象地球仪 SVG 改为直接显示"中"/"En"文字标签，即时传达当前语言状态。
- **技能管理界面文案面向普通用户优化**：Tab 标签由技术名称（ClawHub / OpenClaw / 共享目录 / 本机安装）改为用户易懂的表述（技能市场 / 已安装 / 本地技能库 / 手动导入）；顶部说明文字去除 CLI 命令、workspace 等技术术语，改为一句面向用户价值的简洁描述；搜索空白状态提示由技术说明改为引导性文字；快捷搜索标签去掉双语混排，仅保留中文。

### 新增

- **桌面端技能/插件市场改走 OpenClaw CLI**：技能搜索、安装、更新改为通过本机 `openclaw skills search/install/update` 执行，插件安装继续通过 `openclaw plugins install`；技能管理面板补齐 OpenClaw 官方风格的 Ready / Needs Setup 建议、插件 update / uninstall、以及更完整的 inspect 信息展示，减少对前端直连 ClawHub API 的依赖并与上游行为保持一致。
- **ClawHub 凭据改为用户级本机存储**：新增本机 `ClawHub Token / Registry` 保存入口，凭据写入 DidClaw 本地 SQLite KV，供桌面端匿名 HTTP 请求和 `openclaw skills/plugins` CLI 共同复用；正式构建不再依赖作者个人 `VITE_CLAWHUB_TOKEN`，为后续远程用户登录验证接入预留统一落点。
- **AI 配置页改为与 OpenClaw 真源同步的混合模式**：桌面端新增统一的 AI 快照读取接口，把 provider、主模型、fallback 与 model refs 聚合成一份状态；推荐卡片页现在优先显示 OpenClaw 实际配置，并补充“检测到的其他配置”区域，旧高级 providers/model 面板与聊天模型选择器也改为复用同一份快照，减少固定预设与真实配置漂移。

- **会话栏切换体验收敛**：会话栏从叠加式按钮列表改为单个下拉选择，减少多渠道 / 多子会话时的顶部占用；新增 `Ctrl + Tab` / `Ctrl + Shift + Tab` 快捷键用于前后切换会话，并对常见会话 key 做显示过滤（如 `WhatsApp +手机号`、`WeChat`、`agent:main`），降低长 session key 的视觉噪音。
- **会话支持本地关闭隐藏**：会话栏新增「关闭」按钮，可将当前非主会话仅从本地列表中隐藏，方便用户暂时收起微信 / WhatsApp 等会话；该操作不会删除后端真实会话，若后续该会话又收到新消息、`lastActiveAt` 更新后会自动重新出现。
- **会话栏新增历史会话入口**：当前会话下拉框缩短后，在「关闭」右侧新增「历史」按钮，可打开历史会话弹窗；弹窗支持按最近活跃排序、关键字搜索，并可直接切换到目标会话查看历史内容，方便在多渠道子会话之间回看旧对话。
- **定时任务创建表单支持从当前会话自动预填投递目标**：打开新建任务面板时，若当前停留在 `WhatsApp` 或 `Feishu` 子会话，表单会自动带入对应投递渠道与目标标识，减少重复填写；仍可手动改成别的渠道或收件人。
- **顶栏高频按钮改为紧凑图标并统一间距**：主题切换与语言切换从文字按钮收敛为图标按钮，DidClaw Logo 调整到最左侧，连接灯、连接开关与右侧快捷按钮之间使用统一间距，顶部视觉更紧凑协调。

### 修复

- **技能管理进一步对齐 OpenClaw 官方心智**：OpenClaw 技能详情现在补齐了通过 `openclaw skills uninstall` 的卸载入口，技能页同时更明确地区分“当前 workspace 技能”和“共享 skills 目录”两条路径，避免把手动导入目录误当成全部已安装技能；相关实施文档也已同步更新到侧边栏入口与现行安装模型。
- **技能搜索结果支持继续加载更多**：ClawHub 搜索结果不再固定停留在首批条目；同一关键词下点击「加载更多」会继续扩大 OpenClaw / ClawHub 搜索范围，并把新增结果追加到当前列表底部，避免看起来始终只有第一次搜索结果。
- **OpenClaw 升级后的桌面反馈与重连补齐**：Windows 一键升级现在会先停止当前 Gateway，避免 `npm install -g openclaw@latest` 被运行中的进程锁文件；升级完成后会自动重启 Gateway、等待桌面端恢复连接，并在弹窗中向用户显示升级/重启/重连阶段状态与失败日志摘要，不再只停留在「已断开」。
- **桌面端技能市场不再因前端直连 ClawHub 而被 CORS 卡死**：技能搜索、技能详情、插件目录搜索/详情以及技能 ZIP 下载在桌面端改为通过 Tauri/Rust 本地代理访问 ClawHub；即使远端插件目录临时不可用，本机 `openclaw skills search` 的结果也会继续显示，保留手动导入 ZIP/文件夹作为兜底安装路径。
- **企业微信接入流程改为单步保存并自动补装插件**：企业微信渠道页不再要求用户先手动点一次“安装插件”再保存配置，而是收敛为填写 `Bot ID` / `Secret` 后点击一次主按钮即可；DidClaw 会先检测企业微信官方插件是否已安装，未安装时自动补装，已安装时直接保存启用，并在界面上显示当前插件状态，减少误操作与重复安装。
- **定时任务投递渠道与已接入渠道对齐**：定时任务创建表单中的投递渠道不再停留在旧的通用枚举，而是收敛为 DidClaw 当前已接入且可配置的 `WhatsApp`、`Feishu`、`WeCom`，并为不同渠道补充更贴近实际的目标占位提示。个人微信渠道因上游 `contextToken` 限制暂不提供 cron 主动投递入口，避免创建后运行失败。
- **飞书等渠道当前会话的静默同步不再被流式状态饿死**：当手机端来消息后，Gateway 可能只连续推送 `agent` 事件来提示当前会话需要补拉 `chat.history`；旧逻辑在本机 `sending=true` 或存在流式 `runId` 时会直接跳过这次静默同步，导致手机端消息只能等很晚才补齐。现在改为先记录一次待补同步请求，待当前轮次结束后自动补做 `loadHistory(silent)`，避免移动端与桌面端长时间不同步。
- **飞书渠道安装配置体验补齐**：飞书安装向导现在会先检查 OpenClaw 环境是否已初始化，未安装时直接给出明确提示；安装成功后自动补写 `channels.feishu.enabled=true`，并在弹窗中提示后续的 `重启 Gateway`、`/feishu start` 与 `/feishu auth` 验证步骤。手动配置路径新增 `Feishu / Lark` 区域选择，同时过滤安装日志里与飞书无关的重复 WhatsApp 插件警告，避免误导用户。
- **飞书安装失败时支持一键清理残留**：新增桌面端飞书残留清理能力；当安装日志出现 `plugin already exists` / `openclaw-lark` 残留特征时，渠道弹窗会直接提示并提供「清理飞书残留」按钮，自动清掉 `channels.feishu`、`plugins.entries/install` 中的飞书残项以及 `~/.openclaw/extensions/openclaw-lark` 目录，方便用户立即重试安装。
- **飞书插件已安装时跳过重装，直接进入扫码配置**：桌面端现在会先检查 `~/.openclaw/extensions/openclaw-lark` 是否已完整安装（含 `package.json` 与 `node_modules`）。若已存在，则不再重复执行 `@larksuite/openclaw-lark install` 的安装/更新链路，而是直接调用飞书注册接口生成二维码并轮询返回的机器人凭据，写回官方插件所需的 `channels.feishu.appId/appSecret/domain` 与 `plugins.entries.openclaw-lark` 配置，显著减少重复安装导致的失败与日志噪音。
- **清理两处历史 lint error**：`InlineToolTimeline.vue` 中恒为 `false && ...` 的占位表达式改为直接 `false`，去掉 `no-constant-binary-expression`；`AboutView.vue` 空模板改为最小合法根节点，去掉 `vue/valid-template-root`。以上调整不改变现有功能行为。
- **中心坐标系图形通过选择框拉伸后不再跳位**：弧形、圆环、楔形、正多边形、星形、圆形等中心坐标系元素，之前通过选择框缩放时会在松开鼠标后出现位置跳动。现改为在 `ControlLayer` 中按图形类型动态设置 Konva `Transformer.centeredScaling`，对 `Circle`、`RegularPolygon`、`Star`、`Ring`、`Arc`、`Wedge` 等启用以中心点为基准的原生缩放，避免复杂坐标换算带来的抖动。
- **新建标签后不再残留上个标签的图层元素**：创建新标签时，除了重置 store 中的元素数据外，现在还会同步清空图层 store、渲染引擎画布与图层管理器中的形状，并强制重绘，避免图层面板和画布继续显示上一标签的残留内容。
- **网格设置与对齐线设置入口恢复可用**：原先工具栏使用 `el-popover` 但缺少稳定的 reference 目标，导致点击设置按钮没有实际反应。现在相关设置改为使用 `el-dialog` 打开，同时简化外部点击处理逻辑，保证网格设置和对齐线设置都能稳定弹出。
- **网格吸附功能正式接入拖拽流程**：原有网格吸附虽然已有 `GuideLayer.snapToGrid`、配置项与工具栏开关，但拖拽过程中并未真正调用。现在在拖拽处理器的 `dragmove` 阶段优先执行网格吸附，再与元素对齐能力协同工作，并补齐 `GuideLayer` 与 Konva 节点上的相关 TypeScript 类型定义，修复吸附不生效及类型报错问题。
- **技能搜索“加载更多”后会自动定位到新增结果**：桌面端技能市场原本会把新增搜索结果追加到内部滚动区域底部，但视口仍停留在顶部，用户看起来像是“加载更多后还是第一次搜索结果”。现在点击“加载更多”后会自动滚动到第一条新增结果，卡片视图和列表视图都能立即看到新增内容。
- **OpenClaw 技能页补齐启用 / 禁用开关**：官方支持通过 `skills.entries.<skillKey>.enabled` 控制内置和已安装技能的开关状态，DidClaw 之前只展示 `disabled` 状态但没有操作入口。现在技能列表和详情区都可以直接启用或禁用技能，写入后会在下一次 agent 轮次按新配置生效。

## [0.5.0] - 2026-03-28

### 新增

- **WhatsApp 绑定状态真实验证**：扫码/CLI 完成后不再仅凭 `web.login.wait` 的 `connected` 或进程退出码判断「绑定成功」，而是额外调用网关 `channels.status` RPC（`probe:true`）验证 `channels.whatsapp.linked === true`（与官方 Control UI 完全一致）。若 linked 为 false 则明确报错提示重试，防止「界面显示成功但实际未关联」；CLI 降级路径增加软重连后再做验证。
- **个人微信绑定后 Gateway 重连策略彻底重写**：原策略（12s 软连超时 → kill 进程硬重启）会打断 Gateway 自行加载微信插件的过程，导致必然失败。新策略：CLI 退出后先等 5s 沉淀，再纯轮询等待 Gateway 自行恢复（最多 35s），不主动 kill 进程；35s 后若仍未连接则显示「绑定已完成，点「重启 Gateway」使配置生效」（`pending-restart` 状态）而非标记为失败，避免误导用户重试。
- **个人微信扫码绑定可靠性修复**：①为每次绑定流程生成唯一 `flowId`，Tauri 事件（`channel:line/qr/done`）均携带该 ID，前端只处理 ID 匹配的事件，彻底解决重试或并发时事件串台导致的假成功/假失败问题；②扫码成功后显式调用 `writeChannelConfig("openclaw-weixin", { enabled: true })` 写入 `openclaw.json`，确保网关加载该渠道（修复「扫码成功但数据没写入」的根本问题）；③允许二维码 URL 刷新更新（去掉「只取第一个 QR URL」的限制）；④stderr 同步做 QR URL 检测（部分 CLI 版本将 URL 输出到 stderr）；⑤插件检测由目录存在改为检查 `package.json` 存在，避免空目录误判为已安装；⑥`channel:done` 失败时在日志中显示退出码与错误信息，方便排查。
- **后台子代理状态栏增加可点击跳转**：「后台子代理运行中」状态栏的提示文字改为可点击的「切换会话查看进度 →」按钮，点击后直接切换到后台代理所在会话，解决原有提示有文字无操作路径的问题。
- **连接后 20 秒后台静默数据同步**：Gateway 每次成功连接后约 20 秒，自动执行一次 `session.refresh()` + `loadHistory(silent)`，确保 OpenClaw 与桌面端会话/历史数据完全对齐（覆盖连接建立时渠道尚未就绪等边缘情况）。
- **WhatsApp 状态指示器 + 渠道健康轮询**：在聊天输入栏底部新增 WhatsApp 图标按钮（绿色=已连接，橙色=已绑定但未运行/连接，红色=未关联，灰色=Gateway 未连接）。点击图标弹出轻量级弹窗：未关联时直接显示 QR 码供扫码绑定，绑定但未运行时提供「重新连接」/「重启 Gateway」操作，已连接时显示确认状态。后台每 30 秒轮询 `channels.status` RPC 保持图标颜色与实际状态同步；检测到 `linked=true, running=false` 时自动尝试一次 `web.login.start` 恢复连接。
- **微信状态指示器**：在聊天输入栏底部新增微信图标按钮（绿色=已连接，橙色=已绑定但未运行，红色=未关联，灰色=Gateway 未连接）。点击图标弹出轻量级弹窗：未关联时触发 CLI 扫码流程（`startChannelQrFlow("wechat", ...)`），扫码前自动检测并安装微信插件（`checkChannelPluginInstalled` → `openclawPluginsInstall`，含已安装判断兜底），二维码实时渲染显示，扫码成功后自动写入渠道配置并等待渠道启动；已绑定未运行时提供「重启 Gateway」和「重新关联」操作；`useChannelHealth` 轮询同步更新微信/WhatsApp 双渠道状态。
- **UI 布局重构 — 左侧自动隐藏工具栏**：将顶栏中的功能按钮（定时任务、渠道管理、技能、主题切换、语言切换、重启 Gateway、Doctor 诊断、备份恢复、重做引导、复制诊断、关于）全部迁移到左侧 overlay 侧边栏（`ToolSidebar.vue`）。侧边栏默认隐藏，鼠标悬停窗口左边缘时滑出，离开后 300ms 自动收起，不影响主内容区宽度。顶栏简化为仅保留 DidClaw Logo 和连接状态 LED/开关，高度从 52px 降至 42px，为消息区腾出更多空间。

### 修复

- **微信渠道配置写入 key 错误**：`writeChannelConfig("wechat", ...)` 写入的是 OpenClaw 不认识的 channel id `wechat`，导致 `openclaw doctor` 报 `unknown channel id: wechat`。正确 channel key 为插件注册名 `openclaw-weixin`。修复 `ChannelSetupDialog.vue` 和 `WeChatIndicator.vue` 两处调用，并清理已污染的 `~/.openclaw/openclaw.json` 中的 `channels.wechat` 字段。
- **微信图标状态兜底修复**：腾讯微信插件在 `channels.status` 中虽然返回了 `openclaw-weixin` 条目，但 `linked/running/connected` 字段对前端不可可靠消费，导致实际已能收发消息时底部图标仍显示红色未关联，并且重复点击会再次拉起二维码。修复：微信图标除读取 `channels.status` 外，额外检测会话列表中是否已存在 `agent:main:openclaw-weixin:*` 会话；一旦存在即直接视为已在线并显示绿色，保证图标状态与真实通信能力一致。
- **OpenClaw 卸载后 FirstRunWizard 不弹出**：用户此前完成过初始化向导后，`isFirstRunModelStepComplete()` 标记留在 KV 中。如果之后卸载了 OpenClaw（`~/.openclaw` 目录不存在），向导仍被跳过。修复：在 `refreshStatus` 中优先检查 `openclawDirExists`，若为 false 则无论 KV 标记如何均显示环境安装步骤。同时在 WhatsApp 指示器的自动安装流程中增加 OpenClaw 环境预检，未安装时提示用户先完成初始化。
- **WhatsApp 扫码绑定成功后渠道未运行**：扫码绑定成功（`linked=true`）但渠道进程未启动（`running=false`），点击"重新连接"仅发一次 `web.login.start` 无后续验证。修复：① 扫码成功后等待 3 秒验证渠道 `running` 状态，若仍未启动则自动重启 Gateway 并等待渠道就绪；② "重新连接"按钮改为渐进式策略：先尝试 `web.login.start` + 等待验证，失败后自动升级为 Gateway 重启，并在弹窗中实时显示进度文字；③ 后台自动恢复（`tryAutoRecovery`）同样增加 Gateway 重启兜底，覆盖 `linked=true, running=false` 长期停滞的场景。
- **WhatsApp「已绑定」状态与官方 UI 不一致**：当 WhatsApp 会话 `linked=true` 但渠道实际未运行（`running=false`）或未连接（`connected=false`）时，DidClaw 仍显示绿色「已有绑定会话，无需重新扫码」。修复：在检测到无需扫码后额外调用 `channels.status` 获取完整渠道健康状态（`running`、`connected`、`lastError`），若渠道未正常运行则以警告色显示具体原因（含网关返回的 `lastError`），并提示用户「重新连接」或「重启 Gateway」；此状态下不再自动关闭对话框。
- **微信渠道绑定后误报「绑定失败」及 Gateway 重连超时**：插件安装后网关自行重启（WS close 1012 "service restart"），但 `startWechatInstall` 未等待网关恢复即启动 `channels login` CLI；登录成功后的 `restartGatewayAndReconnect` 又尝试重启网关进程，与已自行重启的进程端口冲突，导致连接超时 → 「绑定失败，请重试」。修复：① 插件安装后若网关断开，先通过软重连（`reloadConnection`，不杀进程）等待网关恢复，再启动扫码登录；② `channel:done` 成功后优先软重连，仅在软重连失败时才走完整重启路径，避免与自启进程冲突。

- **首次启动 Gateway 后会话/渠道状态不完整**：`ensureOpenClawGateway` 返回 `{started: true}` 时（即本次刚拉起新进程），`onHello` 触发后额外等待 4 秒再做一次静默 `session.refresh()` + `loadHistory()`，等待插件（WhatsApp / 微信等）完成初始化后补全状态。已在运行的 Gateway 重连时不触发额外刷新。
- **渠道绑定后自动关闭窗口并重连**：WhatsApp（RPC 路径）和微信扫码成功后，对话框在 1.8 秒后自动关闭，无需用户手动点击；关闭时若 Gateway 未连接则自动触发重连（兜底用户手动关闭场景）。WhatsApp CLI 降级路径因仍需手动重启 Gateway，不触发自动关闭。
- **微信渠道绑定优化**：① 新增桌面端 `check_channel_plugin_installed` Tauri 命令，按需检测本地插件，已安装则跳过重复下载，直接进入 `openclaw channels login --channel openclaw-weixin`；② 登录流程结束后自动从输出中提取扫码 URL，用 `qrcode` 库渲染为可直接扫描的图片二维码；③ 将大块滚动终端输出替换为单行黑底滚动状态条，交互界面更简洁；④ 降级路径补全：命令未注册或插件已存在时均不再中断流程。
- **TypeScript 构建报错修复**：全项目将 `ReturnType<typeof setTimeout>` / `ReturnType<typeof setInterval>` 类型声明统一改为 `number`，与 `window.setTimeout` 的浏览器返回值一致，消除 11 处 TS2322 / TS2345 编译错误。

### 新增

- **个人微信（WeChat）渠道接入**：通过腾讯官方 ClawBot 插件接入个人微信，零封号风险。渠道设置新增「微信」标签页，包含前置步骤说明（在微信中开启 ClawBot 插件）、流式安装向导（`npx -y @tencent-weixin/openclaw-weixin-cli@latest install`）、自动检测输出中的扫码 URL 并以高亮链接展示（方便在浏览器中扫码）、ASCII 二维码终端输出、成功后重启 Gateway 按钮。当前仅支持 iPhone 微信 8.0.70+，Android 版即将推出。

- **WhatsApp 渠道对话框新增「重新连接」按钮**：当检测到已有绑定会话时（无需重新扫码），在操作区展示「重新连接」主按钮，点击后触发 `web.login.start` 唤醒因 Gateway 重启而进入 stopped/disconnected 状态的插件，无需重新扫码也无需重启 Gateway；「重启 Gateway」退为次选操作。注意：「开始扫码登录」仍需手动点击触发，不再自动调用（自动探测会中断已有的活跃 WhatsApp 连接）。

- **deviceToken 持久化与有界重试**：Gateway 在 `hello` 响应中颁发的 `deviceToken` 现已自动保存到设备身份存储（桌面端使用 Tauri KV，浏览器端使用 `localStorage`）。重连时若无用户配置的 `token`/`password`，自动携带已保存的 `deviceToken`，避免重复配对审批。若用户凭证触发 `AUTH_TOKEN_MISMATCH`，按协议规范尝试一次以 `deviceToken` 为凭证的有界重试；认证错误时自动清除失效的 `deviceToken` 缓存。

### 修复

- **渠道设置插件安装后重启 Gateway，立即扫码报"invalid handshake: first request must be connect"**：`restartGatewayAndReconnect` 和 `tryStartWhatsAppRpc` 原先使用 `client.connected`（仅检查 WebSocket `readyState === OPEN`）判断 Gateway 是否就绪，但此时 `connect` 握手可能还未完成。修复后改为检查 `gwStore.status === "connected"`（仅在 `onHello` 回调后设置），并在握手完成后额外等待 800ms，确保 Gateway 插件完成初始化后再发送 RPC。

- **WhatsApp 等渠道收到消息后仅显示"后台子代理运行中"、未自动切换到会话窗口**：WhatsApp 等渠道消息处理时 Gateway 只发 `agent` 事件（走 announce 投递），不发 `chat.delta`，导致原先依赖 `chat.delta` 的 shouldFollow 自动切换逻辑从未触发。修复后：当某个后台会话首次出现 `agent` 事件（`flashingSessionKeys` 尚未包含该会话，即 5 秒内未曾高亮过）且 composer 空闲时，自动切换到该会话，与 `chat.delta` 的行为对齐；此后同一会话的后续 `agent` 事件不会重复触发切换。

- **定时任务投递频道选了 WhatsApp 但消息未发送到手机**：官方文档明确指出，当 `delivery.to` 为空时，无论 `delivery.channel` 设置了什么，网关均回退到"最后活跃路由"而忽略指定的频道。修复内容：① 选了具体频道（非"自动"）时，收件人/目标字段标注为必填并展示该频道对应的格式示例（WhatsApp → 手机号如 `+8613XXXXXXXXX`；Telegram → 群 ID 或 `:topic:` 格式；Slack → `channel:CXXXXX` 等）；② `submitCreate` 增加校验，频道已选但 `to` 为空时阻止提交并提示；③ 选"自动（最后使用的渠道）"时仍保持可选行为不变。

## [0.4.0] - 2026-03-26

### 新增

- **后台会话收到消息时，会话按钮高亮闪动提示**：当 WhatsApp 等渠道在后台收到消息并触发 agent 活动时，左侧会话列表中对应的会话按钮会短暂亮起青色边框与背景（约 5 秒），帮助用户快速感知有新消息待处理，点击即可切换。
- **切换到正在处理中的后台会话时显示 AI 运行计时器**：用户手动切换到仍在运行的后台会话后，首个到达的 `chat.delta` 事件会自动启动计时器，状态栏与以往主窗口保持一致（阶段标签 + 秒数 + 超时提示），不再因 `loadHistory` 清空 `runStartedAtMs` 而导致计时无法显示。

### 修复

- **`--unonboard` 安装后首次接入渠道缺少插件的问题**：渠道向导现在会在用户点击接入时按需补齐常见渠道的最小启用配置；WhatsApp 检测到 Gateway 缺少 provider 时，会先自动安装 `@openclaw/whatsapp`、写入 `channels.whatsapp.enabled=true`、重启并重连 Gateway，然后重试 `web.login.start`，不再直接卡在交互式插件安装提示。
- **WhatsApp CLI 降级误把插件安装提示当成登录成功**：命令行回退路径现在会识别 `Install WhatsApp plugin?` / `Use local plugin path` / `Skip for now` 等交互提示，避免把“尚未真正开始登录”的退出结果错误显示成“登录成功”；同时将 RPC 成功与 CLI 成功的后续操作区分开来，只有 CLI/已有会话场景才强调重启 Gateway 生效。
- **WhatsApp 向导 CLI 降级提示命令名错误**：警告横幅和注销提示中写的是 `openclaw channel ...`（单数），已更正为与 Rust 实际执行一致的 `openclaw channels login --channel whatsapp` 和 `openclaw channels logout --channel whatsapp`。
- **WhatsApp 登录成功后的操作引导更准确**：CLI 降级路径或“已有绑定会话”场景会明确展示「🔄 重启 Gateway 立即生效」；直接走 Gateway RPC 扫码成功时则只保留刷新，避免误导用户做不必要的重启。
- **WhatsApp 向导点「开始扫码登录」误报「请先连接 Gateway」**：Pinia store 对 `shallowRef` 自动解包，`gwStore.client` 已是 `GatewayClient | null`，代码中多写了一层 `.value` 导致连接检测永远为 false。移除多余的 `.value` 后恢复正常。
- **WhatsApp 接入改为双路径**：① 优先尝试 Gateway RPC `web.login.start`（插件可用时直接返回 `qrDataUrl` 图片显示）；② provider 仍不可用时再回退到 `openclaw channels login --channel whatsapp` 的命令行登录。终端框在 CLI 路径下扩大至 400px 高度，字号缩小以完整展示 ASCII art 二维码供手机扫描。
- **`SlashCommandPicker` Vue warn `update:activeIndex` 未声明**：鼠标悬停时通过 `$emit('update:activeIndex', i)` 更新高亮索引，但该事件未在 `defineEmits` 中声明。已补充 `"update:activeIndex": [index: number]` 声明，消除控制台警告。

- **WhatsApp 渠道向导无法显示二维码**：原实现通过运行 `openclaw channels login --channel whatsapp` CLI 并从 stdout 提取 URL 的方式获取 QR 码，但 WhatsApp 插件不走该路径输出 QR URL。正确方式是通过 **Gateway WebSocket RPC** 调用 `web.login.start`（直接返回 `qrDataUrl` base64 图片）→ 显示 QR 图片 → 调 `web.login.wait` 等待扫码确认。新增「插件未加载」友好错误提示（当上游 `@openclaw/whatsapp` 插件不可用时）。`channel:line` / `channel:qr` Tauri 事件监听不再用于 WhatsApp，相关冗余代码已清除。Rust 侧同步保留了 `strip_ansi()` 辅助函数以备其他渠道扩展使用。

### 新增

- **消息渠道接入向导（P1-3）**：顶栏新增「渠道」按钮（与「定时任务」「技能」并列），点击打开四渠道向导：
  - **WhatsApp**：流式运行 `openclaw channels login --channel whatsapp`，自动接受插件选择提示（3 次 Enter/1.5s 间隔），已有本地 session 时提示「无需重新扫码，重启 Gateway 即可使用」并提供快捷重启按钮。
  - **飞书 / Lark**：主路径为运行官方插件安装向导 `npx -y @larksuite/openclaw-lark install`（流式输出，自动创建机器人并写入配置）；备用路径可折叠展开，手动填写 App ID / App Secret。
  - **Discord**：Bot Token 表单，直接写入 `openclaw.json` 的 `channels.discord`。
  - **企业微信（WeCom）**：Bot ID + Secret 表单 + 一键安装插件按钮（`@wecom/wecom-openclaw-plugin`），写入 `channels.wecom`。
  - Rust 新增 `write_channel_config` / `start_channel_qr_flow` / `resolve_npx_executable` 命令；个人微信列为后续迭代。

- **Exec 审批 UI（P1-2）**：AI 执行终端命令前，DidClaw 桌面端通过 Gateway `exec.approval.requested` 事件弹出审批对话框，显示待执行命令、工作目录和所属 Agent；用户可选择「仅此次允许」「总是允许」或「拒绝」，响应通过 `exec.approval.resolve` RPC 发回网关（参数字段为 `id`，已通过真实 gateway 响应校验）。支持多请求排队，队列不为空时弹窗持续展示。

- **模型故障切换配置（P1-5）**：AI 配置面板新增「备用模型（故障切换）」区块。用户可从已配置服务商的模型列表中选择备用模型，也可手动输入 `provider/model` 格式添加。保存后写入 `agents.defaults.model.fallbacks`，主力模型不可用时 OpenClaw 自动按顺序切换。

- **Slash 命令提示面板（P1-4）**：消息输入框输入 `/` 时自动弹出命令选择浮层，预置 `/new`、`/remember`、`/forget`、`/status`、`/usage`、`/model` 六条命令；支持键盘 ↑↓ 导航、Enter/Tab 选中、Esc 关闭；选中后自动填入草稿，有参数的命令末尾留空格供继续输入。

- **配置备份与恢复（P0-5）**：顶栏「···」菜单新增「备份与恢复」入口（仅桌面端可见）。点击后可将 `~/.openclaw/` 打包为 zip 文件保存到任意位置，或从备份 zip 还原配置。备份自动跳过 `logs/`、`completions/`、`agents/*/sessions/` 等大体积目录，同时估算并展示备份体积。

- **会话 Token 用量展示**：消息面板标题栏右侧新增 Token 用量指示器，显示本次会话累计输入（↑）与输出（↓）数量（来自 Gateway `sessions.list`，每次刷新会话列表后更新）。无数据时自动隐藏。

- **修复 AI配置模型列表编辑后保存丢失**：点「完成」退出编辑模式后再点「应用」，之前 `editedModels` 会读旧 snap 数据，导致用户的修改被丢弃。现改为只要 `modelEditText` 有内容就以它为准，点「完成」仅切换显示形态，实际数据不回滚。

- **兼容 OpenClaw CLI 老用户的 API Key 读取**：老用户通过 `openclaw configure` 设置的密钥仅存于 `auth-profiles.json`，不存于 `models.json`。现读取 provider 时自动从 `auth-profiles.json` 补充缺失的 `apiKey`，老用户打开 AI配置界面可正确显示"已配置"和现有密钥，无需重新输入。

- **修复 AI配置 Tab 重新打开后 API Key 显示为空**：`AiProviderSetup` 组件通过 `v-if` 懒渲染，每次切换 tab 均为全新挂载；watch 缺少 `immediate: true` 导致挂载时 `loadAll()` 未被调用，已修复。

- **修复「No new output for a while」误报**：卡住检测现在同时考虑文本 delta 和工具时间线事件；纯工具调用阶段（无文字输出）不再误触发卡住提示。

- **后台子代理运行感知**：当后台子代理（运行在非当前选中会话的 agent）活跃时，消息面板运行状态栏会显示「后台子代理运行中…」蓝色脉冲指示，提示用户有任务在进行中，避免误认为程序已停止。120 秒内无新事件时自动消失；用户切换至对应会话后指示器隐藏。

### 修复

- **Windows 重启 Gateway 报 `ERR_UNKNOWN_SIGNAL: SIGUSR1`**：`openclaw gateway restart` 内部对运行中的进程发送 SIGUSR1 信号（Unix 专有）；Windows 不存在此信号导致 `TypeError`。修复：Windows 下改为直接 kill 托管子进程 + spawn 全新进程（等待 2s 启动），完全绕开信号问题；非 Windows 仍走原 `openclaw gateway restart` 服务路径。

- **Windows 重启 Gateway PowerShell `MethodArgumentConversionInvalidCastArgument`**（早期更早的路径）：PowerShell 脚本中 `$q=[char]34` 与 `$q+$q`（结果为 `[string]`）类型不一致，`String.Replace(char, string)` 重载不存在。已改为 `$q=[string][char]34`，两参数统一为 `string`。

- **「网关诊断」弹窗背景透明**：对话框使用了未在主题中定义的 CSS 变量 `--lc-bg`，导致 `background` 无效、底层界面透出。已改为与「关于」弹窗相同的 `var(--lc-surface)` 及阴影 token。

- **网关诊断结果难读**：结果改为「错误 / 警告 / 建议」三块摘要，不再逐行堆砌终端原文；「自动修复」仅在存在 doctor 标出的严重项（✓/⚠/✗ 中的 ✗ 及 `[error]`/`[fail]`）时显示。完整 CLI 输出仍在「原始输出」中折叠查看。

- **网关诊断进行中无反馈**：诊断 / 自动修复为单次 IPC，无法显示真实百分比；在按钮下方增加不确定（往返滑动）进度条，并尊重 `prefers-reduced-motion`。

- **网关诊断列表出现灰色方块**：`openclaw doctor` 终端输出里的 Unicode 进度条/块字符在无衬线界面字体中常显示为「豆腐块」。解析结果列表现仅保留含字母数字或中文的可读行；装饰性纯符号行不再列入卡片，完整原文仍在「原始输出」中查看。

### 变更

- **「① 连助手」Tab UI 精简**：去掉顶部冗余说明文段；口令/Token Placeholder 缩短；两个 checkbox 合并进一个带浅底的分组框；「openclaw 可执行文件」移入可折叠「高级选项」，默认收起，普通用户不会看到；autoStart 说明缩短为一句。

- **「网关诊断」入口上移至顶栏「···」菜单**：原先隐藏在「本机设置 → ① 连助手」Tab 最底部折叠区的 Doctor 面板，改为从顶栏「···」菜单直接打开独立对话框（Tauri 桌面端可见）。移除了设置对话框内的折叠入口。

- **「关于」改为弹窗**：点击顶栏「···」菜单中「关于」改为弹出小对话框，不再跳转整页。对话框展示：DidClaw 版本号、OpenClaw 网关版本号（已连接时）、软件简介、主要开源技术栈（Tauri 2、Vue 3、TypeScript、OpenClaw、Vite）和版权信息。原 `/about` 路由保留但自动重定向到首页。

### 修复

- **顶栏「···」菜单点击无效**：`#app` 有 `position:relative; z-index:1` 建立了层叠上下文，Teleport 到 body 的 scrim（z-index 50）位于 `#app`（z-index 1）之上，导致整个菜单被 scrim 遮盖，所有点击都被拦截。彻底修复：移除 Teleport scrim，改用 `document.addEventListener('click', ...)` 监听区域外点击来关闭菜单，不再依赖 z-index。

- **生产构建 CSP 错误**：`dist/index.html` 注入的 CSP 缺少三项必要指令，导致 Tauri IPC 全部失败、主题初始化脚本被拦截、界面空白。修复：`script-src` 补加 `'unsafe-inline'`（内联主题脚本）和 `'unsafe-eval'`（vue-i18n v9 运行时消息编译），`connect-src` 补加 `http://ipc.localhost`（Tauri 2 IPC 协议）。

### 新增

- **Doctor 图形化诊断**：「本机设置 → 连助手」Tab 底部新增可折叠的「网关诊断」面板。点击「运行诊断」调用 `openclaw doctor --non-interactive`，前端解析 ✓/⚠/✗ 前缀输出行并以颜色卡片展示；发现错误时出现「自动修复」按钮执行 `--repair`；支持展开原始输出。Tauri 侧新增 `run_openclaw_doctor` 命令（自动查找 `openclaw` 可执行文件，可传自定义路径）。

- **国际化（i18n）支持**：接入 `vue-i18n v9`，界面支持中文 / 英文双语。在「本机设置」对话框标题栏增加"中 / EN"语言切换按钮，选择结果持久化到 `localStorage` 并跟随系统语言自动检测。涉及 `AppHeader`、`MessageComposer`、`AboutView`、`GatewayLocalDialog`、`CronJobsDialog` 等核心组件的全量汉字字符串均已提取至 `src/i18n/zh.ts` 与 `src/i18n/en.ts`。

- **卡片式 AI 配置界面**：新增"② AI 配置"Tab，用卡片替代原有的"② AI 账号 + ③ 选模型"两步流程。用户在对应服务商卡片填入 API Key 后点"应用并设为主力"，即可自动完成 Provider 写入 + 主力模型设置，无需手动填写接口地址或模型列表。预置 11 家主流服务商（智谱/DeepSeek/MiniMax/Kimi/Qwen/小米/Anthropic/OpenAI/OpenRouter/xAI/Mistral/Ollama），含国内/国际节点切换。原高级 Tab 保留供需要精细控制的用户使用。

### 修复

- **OpenClaw 升级按钮实际上不执行升级的 Bug**：原脚本在 openclaw 已安装时进入 "already installed" 分支直接跳过 `npm install`，再命中 `-SkipOnboard` 立刻退出，导致点击"升级"后什么都没发生。修复：在 `ensure-openclaw-windows.ps1` 中新增 `-Upgrade` 开关，当该开关启用时，强制执行 `npm install -g openclaw@latest`，再自动运行 `openclaw doctor`（配置迁移），与 OpenClaw 官方推荐更新流程对齐。
- **升级后缺少网关重启步骤**：升级完成后现在展示"升级完成"面板，提供"立即重启网关"按钮，点击后自动重启网关并重新连接，无需手动操作。

- **定时任务触发后消息在会话中出现后消失**：根因是 `cron` WS 事件在 delivery/announce 落库前就触发 `loadHistory`，导致以旧快照覆盖了界面上已流式显示的投递消息。修复：移除 `cron` 事件 → `loadHistory` 的直接触发，让后续 `agent` 事件（携带 `sessionKey`，在 delivery 完成后发出）来负责同步；同时将防抖延迟从 750ms 提高到 1500ms，给落库留足余量。

### 改进

- **新建会话后不再显示 UUID**：会话选择区将无标签的 UUID 格式会话 key 显示为"新对话"，会话切换列表同步处理；chip 字体改为正文字体，中文标签显示更自然。

- **定时任务界面小幅优化**：执行历史默认折叠；任务卡片改为固定三列网格，尺寸更紧凑，窗口最大化时可同时展示两行六张卡片。

- **定时任务「已有任务」列表重新设计**：
  - 表格改为颜色卡片列表：执行中→绿色左边框，已运行→黄色左边框，未运行→红色左边框，已暂停→灰色半透明。
  - 每张卡片显示任务名、调度频率（人类语言）、下次执行相对时间，操作按钮紧凑排列。
  - 空状态改为居中图标 + 标题 + 一键「新建任务」按钮。
  - 状态栏重排为等宽三格（调度器、任务数、下次唤醒），下次唤醒改显示相对时间。
  - 工具栏精简为一行（刷新 + 排序字段 + 顺序），移除冗余标签。
  - 「执行历史」提取为独立可折叠区块，筛选栏紧凑化，运行记录条目加颜色左边框（绿/红/蓝）。

- **定时任务「新建」表单全面去技术化**：
  - 调度类型下拉框改为「每天 / 每周 / 每月 / 只运行一次 / 自定义」丸形选择按钮，选择后只显示与该频率相关的时间选项（星期几、几号、时间），彻底隐藏 Cron 表达式。
  - 「会话模式（sessionTarget）」和「唤醒模式（wakeMode）」默认隐藏，系统自动选择最优值（隔离会话 + 下次心跳），移入「高级设置」折叠区。
  - 「投递」章节替换为一个「任务完成后，将结果发送到聊天窗口」勾选框；频道/收件人等细节折叠在高级设置中。
  - 「助手任务提示」改为「告诉 AI 要做什么」，附带示例 placeholder，降低填写门槛。
  - 整体从 4 个 fieldset（~15 字段可见）简化为 3 张卡片（3 字段 + 1 勾选框可见）。
- **任务列表更人性化**：
  - `formatScheduleSummary` 将 Cron 表达式解析为「每天 09:00」「每周一 09:30」「每月 15 日 09:00」等自然语言，一次性任务显示本地化日期。
  - 每行调度列新增「下次：3 小时后」相对时间，使用 `formatRelativeTime` 输出人类可读时差，同时保留精确时间作为 hover tooltip。

### 修复

- **定时任务窗口**：
  - `createOk`（任务创建成功提示）不再永久停留，8 秒后自动消失；关闭对话框时立即清除计时器，`onUnmounted` 也做兜底清理。
  - 创建任务成功后自动重置整个表单（名称、调度、执行、投递字段），方便连续创建多个任务。
  - `refreshOverview` 原先串行执行 `cron.status`、`cron.list`、`cron.runs` 三个请求；改为 `Promise.all` 并行发起，页面刷新速度提升约 2–3×。
  - `onJobsSortChange` 不再重新加载运行记录，任务排序变更仅刷新任务列表本身（`cron.runs` 与任务排序无关）。

- **技能窗口功能缺陷**：
  - 详情面板「安装到本机」绕过 `isSuspicious` 检查，直接安装可疑技能。现在 `installHubSkill` 统一执行恶意/可疑检查，调用方已知道 moderation 结果时可传 `skipSuspiciousCheck: true` 避免重复请求。
  - `onDeleteInstalled` 未设置 `installBusy`，删除操作与安装操作可并发导致 `loadInstalled` 竞争。现在删除前检查并锁定 `installBusy`，finally 中释放。

### 改进

- **定时任务窗口 UI**：
  - 关闭按钮改为 ✕ 圆形图标，hover 显示红底，与技能窗口风格一致；支持 ESC 键关闭。
  - 顶部说明段落从 5 句技术文档式长文缩短为 1 句 + 文档链接。
  - 任务列表"启用"列从纯文字改为颜色徽章（启用→绿色，暂停→灰色）。
  - 任务列表"运行态"加颜色：运行中→蓝色加粗，已运行/未运行→灰色。
  - 操作列"删除"按钮加红色危险样式（hover 红底），与技能窗口一致。
  - 运行记录 `status` 字段加颜色识别：success/done→绿色，error/fail/timeout→红色，running/pending→蓝色。
  - 成功提示 `createOk` 使用 CSS 变量 `--lc-success`（绿色），不再沿用 accent 青色。

- **技能窗口 UI**：
  - 消息条新增三种语义样式：成功（绿色左边框）、失败（红色）、信息（青色）；成功/信息消息 8s 后自动消失，失败消息保留直到下次操作；消息条右侧加 ✕ 关闭按钮。
  - 头部说明文从 3 句技术性长段缩短为 1 句用户友好描述。
  - 关闭按钮改为 ✕ 图标按钮，hover 显示红底。
  - 「删除」按钮文字改为红色，hover 显示红底边框。
  - 搜索结果卡片添加 `cursor: pointer` 与 hover 边框高亮。
  - 搜索输入框添加 `font-family: inherit; font-size: 13px`，消除字体渲染差异。
  - 本机安装成功/失败消息使用对应颜色（绿色/红色）而非统一灰色。
  - 清除 7 个从未被使用的死 CSS 类（`.hit-btn`、`.hit-slug`、`.hit-name`、`.explore-bar`、`.explore-sort`、`.skills-select`、`.skills-hit-list`）。

- **Header 菜单细化**：移除重复的「⚙ 设置」按钮（与会话区「更多设置」功能重复）；「定时任务」缩短为「定时」节省空间；「···」溢出菜单将背景遮罩通过 `<Teleport to="body">` 挂到 body 最外层，修复 `backdrop-filter` 创建层叠上下文导致点击空白处无法关闭菜单的问题。
- **暗色模式对话框边框**：`--lc-border` dark 值从 `rgba(255,255,255,0.08)` 提升至 `0.13`；`.cron-panel`/`.skills-panel` 在暗色下追加专属 `border-color: rgba(255,255,255,0.18)` 和多层 `box-shadow`，对话框轮廓清晰可见；遮罩层背景加深至 `rgba(0,0,0,0.6)`。

### 新增

- **夜间模式（Dark Mode）**：
  - `AppHeader.vue` 右侧新增 🌙/☀ 图标按钮（圆形，支持 hover 旋转动效），一键切换日间/夜间模式。
  - `stores/theme.ts`：新增 `useThemeStore`（Pinia），持久化到 `localStorage("didclaw_theme")`，优先读取用户偏好，回退到系统 `prefers-color-scheme`；切换主题时同步调用 `getCurrentWindow().setTheme()` 修改 **Tauri 原生标题栏**深/浅色，非桌面环境静默忽略。
  - `capabilities/default.json` 与 `dev.json` 补充 `core:window:allow-set-theme` 权限，修复标题栏颜色实际不变的问题。
  - `index.html` 注入微型内联脚本，在 Vue 加载前立即应用主题，消除闪白（FOUC）。
  - `style.css` 追加 `[data-theme="dark"]` 覆盖块（约 30 个 CSS token）；body 背景渐变、网格装饰色、代码块（github-dark 配色）、所有组件颜色均随主题切换；`body` 加 `transition: background-color 0.25s ease` 平滑过渡。
  - 修复 `ChatRunStatusBar` stall 警告色从硬编码 `#b45309` 改为 `--lc-warning-text` token；会话芯片颜色改用 `--lc-accent` token。

### 改进

- **UI Phase 1 — Header 精简 + 气泡分层**：
  - `AppHeader.vue` 重构为单行布局（节省 ~40px 高度）；「诊断」「引导」「重启网关」「关于」收入右侧「···」溢出菜单，普通用户不再面对技术按钮。`window.alert` 替换为 Header 底部内联错误条（含 6s 自动消失）。
  - `AppShell.vue` 在会话区顶部新增「＋ 新建对话」按钮，直接开启一个新会话。
  - `ChatMessageList.vue` 消息气泡视觉分层：用户消息右对齐 + 淡紫底色，助手消息左对齐 + 淡青底色，system/tool 消息缩小并置灰，聊天层次感更强。
  - `MessageComposer.vue` 删除占用垂直空间的长提示段落，改为输入行内「?」圆形 tooltip 图标按钮，悬停可查看所有快捷键说明。
  - `ChatRunStatusBar.vue` 状态文字改为英文（Sending / Generating / Done），消除遗留中文。
  - `style.css` 补全 `--lc-radius-md`、`--lc-surface`、`--lc-spacing-{xs,sm,md,lg,xl}` 五组 token；新增 `.lc-btn-primary` 类（加强 `box-shadow` 与最小宽度），使主操作按钮在视觉上更突出。

### 修复

- **安装向导 Node.js 缺失处理**：无 winget 的旧系统（企业镜像等）安装会直接失败。现在当 npm 不可用时，先尝试 winget 安装 Node.js LTS，再回退到从 nodejs.org 下载 MSI（per-user 安装，无需 UAC）；若两种方式均失败，脚本以退出码 6 退出并在 UI 展示「需要手动安装 Node.js」面板，含「打开 nodejs.org 下载页」按钮。
- **安装向导退出码 1 根因修复**：
  - `ensure-openclaw-windows.ps1` 改以 **UTF-8 with BOM** 保存，修复 Windows PowerShell 5.1 因编码误读中文字符串导致的 ParserError；所有输出语句改为英文，彻底消除乱码。
  - 安装逻辑重构：若本机已有 `npm`（Node 已安装），直接执行 `npm install -g openclaw@latest` 跳过下载 `https://openclaw.ai/install.ps1`，避免依赖服务器可用性；仅当 npm 不可用时才下载官方安装脚本（含自动装 Node）。
  - `openclaw_ensure_install.rs`：将 `BufReader::lines()`（遇非 UTF-8 字节直接 break）替换为自实现的容错逐行读取（`from_utf8_lossy`），乱码环境下仍可将错误输出回传前端。
  - `FirstRunWizard.vue`：安装脚本退出非零且日志为空时，展示具体可能原因与操作建议，不再只显示裸"退出码 1"。

## [0.3.2] - 2026-03-25

### 安全与加固

- **Capabilities 拆分**：将 `src-tauri/capabilities/default.json` 的开发 Vite 端口（5173）移至独立的 `capabilities/dev.json`；生产构建通过 `tauri.build.conf.json` 仅加载 `default`，`tauri dev` 通过 `tauri.dev.conf.json` 同时加载二者，消除生产包内开发端口可信来源。
- **Gateway 帧 Zod 验证**：`gateway-client.ts` 的 `handleMessage` 对所有 `event` / `res` 帧在使用前经 `gatewayEventFrameSchema` / `gatewayResponseFrameSchema` 做 safeParse，不再依赖裸 `as` 断言。
- **异步错误可见性**：`chat.ts` 的 async IIFE 及 `gateway.ts` 所有 `void import().then()` 均补充 `.catch(e => console.error(...))` ，消除静默吞错。
- **输入大小前置检查**：`dialog_save_base64_file` 在 base64 过滤前限制 68MB 输入；`install_zip_base64` 在解码前限制 110MB 输入，均早于内存分配。
- **openclawExecutable 路径校验**：写入前校验长度上限与 shell 元字符，拒绝 `|`、`;`、`` ` `` 等注入字符。
- **mXSS 防护**：将 `applyExternalLinkTargets` 中的 `innerHTML` 二次解析改为 DOMPurify `afterSanitizeAttributes` hook 直接操作 DOM 节点，消除净化后二次解析的 mutation XSS 向量。
- **CSP 收紧**：`vite.config.ts` 中移除 `img-src http:`；`connect-src` 的 WebSocket 限收到 `ws://127.0.0.1:*` 与 `wss://127.0.0.1:*`；`frame-src` 移除 `data:`。

### 改进

- **static_server.rs**：移除 `sleep(200ms)` 的脆弱时机假设；`TcpListener::bind` 成功后端口已在 OS 层处于 LISTEN 状态，无需等待 axum accept 循环预热。
- **Mutex 毒化显式化**：`openclaw_gateway.rs` 三处 `MANAGED_CHILD` 锁操作从 `unwrap_or_else(|e| e.into_inner())` 改为 `expect("MANAGED_CHILD mutex poisoned")`，使异常状态可见而非静默恢复。
- **skills.rs zip 安装**：`install_zip_path` 不再将文件内容 base64 编码后再解码，直接将文件字节传入公用函数 `extract_zip_bytes_to_dest`，消除约 2.33x 的内存峰值。

### 修复

- **一次性定时任务**等结束后，网关从 `sessions.list` 移除对应会话时，不再把当前选中强行改回 `sessions[0]`（主会话），避免聊天区**刚切到定时会话又立刻消失**；对已从列表消失的当前键在本地挂一条 **「…（已结束）」** 占位行，切走其它会话后下次刷新即与网关列表对齐。
- **`sessions.changed`**：先 **`await` 会话 `refresh()`** 再按需 **`loadHistory(silent)`**（与 `onHello` 一致），避免静默历史抢先拉主会话与刷新竞态。
- **Windows 初始化 / 拉起 OpenClaw**：从桌面启动时若系统 **PATH 缺少 `System32`**，仅写 `powershell.exe` 会报 **「无法启动 PowerShell：program not found」**。现对 `powershell` 使用 **`%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`**（存在时），并对子进程 **`PATH` 前置 System32、PowerShell、Wbem**（与 `windows_enhanced_path` 一致）。

### 变更

- 首次向导「安装并初始化」：用 **分步状态列表**（环境检测 → Node.js → OpenClaw CLI → onboard → 完成）替代仅无限进度条；阶段来自 `ensure-openclaw-windows.ps1` 的 `ui=…` 标记与 Tauri 的 `didclaw-ensure-install-phase`（spawn 前 `precheck_ok`）。下方日志区仍可展开查看细节。
- 定时任务列表「运行态」列改为 **运行中 / 已运行 / 未运行**（依据网关 `state.runningAtMs`、`lastRunAtMs` 与 `lastStatus`/`lastRunStatus`）；原「最近 / 下次 / 上次」细项保留为单元格悬停提示。

## [0.3.1] - 2026-03-24

### 修复

- 网关下行 **`cron`** / 与当前选中会话同 **`sessionKey` 的 `agent`**：在**本机未发送且无本地 `runId`** 时 **750ms 防抖** 拉 **`chat.history`（silent）**。实测部分版本定时任务期间仅有 `cron`/`agent`、**无 `chat`**，仅靠原逻辑主时间线不刷新，与重连后拉历史不对齐。
- 网关下行 **`sessions.changed`**（与官方 Control UI `app-gateway.ts` 一致）：收到后刷新会话列表并对当前会话静默 **`chat.history`**，避免定时任务等写入主时间线后界面不更新、仅重连才对齐。
- **`chat` 事件**若因载荷与 Zod 校验不完全匹配而被丢弃，对**当前选中会话**增加节流的 **`loadHistory` 兜底**，降低主会话 systemEvent / 网关新状态枚举导致「无实时刷新」的概率。
- 定时任务「已有任务」：`cron.list` 响应解析增加 `rows` / `records` / `values`、`payload` 与 `cron` 嵌套等兼容，并在结构化字段不匹配时用**浅层启发式**识别任务数组，降低网关返回形态升级后出现空列表的概率。
- 网关 `connect` 的 `caps` 改为默认空数组（不再仅声明 `tool-events`），以接收 **`chat` 下行事件**；避免定时任务等在 `cron:` 等会话运行时界面不刷新、需重连才出现历史（参见 [OpenClaw Session 文档](https://docs.openclaw.ai/concepts/session) 中 cron 会话键说明）。

### 新增

- **网关推送诊断日志**：`src/lib/gateway-debug-log.ts`。开发环境默认在控制台输出 `[didclaw][gateway-push]`（`chat` / `sessions.changed` / `loadHistory` 等关键路径）；生产或 Tauri 可 `localStorage.setItem("didclaw_debug_gateway","1")` 后刷新开启，设为 `"0"` 可在开发构建下关闭。
- 定时任务弹窗：对接 **`cron.status`**（顶部调度摘要）、**`cron.runs`**（运行记录列表、范围/排序、分页加载、带 `sessionKey` 时「打开会话」）；**`cron.list`** 请求参数与官方 Control UI 对齐（`includeDisabled`、`offset`、`sortBy`、`sortDir` 等，失败时回退简化参数）。**`cron.update` / `cron.remove` / `cron.run`** 改用与官方一致的 **`id`** 字段。辅助解析见 `src/lib/cron-gateway.ts`。
- `public/logo-didclaw-variants.html`：DidClaw Logo 字体与样式对比静态页，便于选型与评审。

### 变更

- 网关 **`agent`** 下行：仅在 **`stream` 非 `tool`**（lifecycle / compaction 等）或 **`tool` 且 `phase === "result"`** 时参与防抖静默拉 **`chat.history`**，跳过高频 **`tool` start/update**，减轻请求与 `incomingCount` 抖动；**`cron`** 仍按原逻辑触发。
- 定时任务创建表单：「会话」选项与说明对齐 [OpenClaw Cron](https://docs.openclaw.ai/automation/cron-jobs) / [Session](https://docs.openclaw.ai/concepts/session) 主会话与隔离行为，便于理解主聊天窗与 `cron:` 会话的差异。
- 顶栏品牌区：DidClaw 标题分色（D / idCl / aw）、Righteous 字体与菱形标配色调整；`index.html` 补充加载 Righteous 字重。
- 聊天：网关 `chat` 事件若针对**非当前选中会话**（如定时任务在隔离会话跑），在输入区空闲时**自动切换到该会话**并展示流式/结果；若本地仍在发送或生成中则仅节流刷新会话列表，避免打断当前轮次。

## [0.3.0] - 2026-03-24

### 新增

- **桌面端 DidClaw 本地存储**：在应用数据目录使用 SQLite（`didclaw.db`）存放网关本机合并配置及白名单 KV（设备身份、首次引导、Skills 安装根、OpenClaw 更新提示等）；纯浏览器仍使用 `localStorage`。未发版阶段**不**做自旧 `gateway-local.json` 或 `localStorage` 的自动迁移。OpenClaw 的 `~/.openclaw` 文件逻辑未改。

### 变更

- DidClaw 本地 SQLite：**移除**自 `gateway-local.json` 与自 WebView `localStorage` 的自动迁移逻辑（未发版阶段不维护老数据恢复路径）。
- Tauri：`permissions/didclaw.toml` 的 `invoke-all` 白名单补充 `didclaw_kv_get` / `didclaw_kv_set` / `didclaw_kv_remove`（及遗漏的 `dialog_save_base64_file`），避免 ACL 拒绝 IPC。

### 文档

- 新增 `docs/didclaw-sqlite-storage-migration.md`：DidClaw 自有数据统一 SQLite 的方案与实施说明（OpenClaw `~/.openclaw` 不在此范围）。
