# DidClaw：技能（Skills）功能实施方案

## 1. 目标与范围

在 **顶栏品牌行右侧** 提供 **「技能」** 入口，点击后弹出 **技能管理窗口**，支持：

| 能力 | 说明 |
|------|------|
| ClawHub 搜索 | 调用已实现的 `clawhubSearch`（`GET /api/v1/search`） |
| ClawHub 列表 | 调用 `clawhubListSkills`（与官方 CLI `explore` 一致；若线上返回空列表，UI 以搜索为主） |
| ClawHub 详情 | 调用 `clawhubSkillDetail`，展示摘要、版本、moderation 提示 |
| ClawHub 下载安装 | 调用 `clawhubDownloadSkillZip`，在 **Tauri 主进程** 解压并写入目标 `skills` 目录 |
| 本地上传 | 用户选择 zip 或文件夹，校验含 `SKILL.md` 后写入同一 `skills` 根目录 |
| 删除 | 删除本地技能目录（及可选清理 `openclaw.json` 中 `skills.entries` 对应项，见阶段划分） |
| 更新 | ClawHub 来源：重新下载同 slug 最新版覆盖；本地来源：提示重新上传或仅覆盖安装 |

**本期不做**：ClawHub 登录、`whoami`、发布、星标、同步（`sync`）等需 Token 的写操作——与此前「只要搜索 / 详情 / 列表 / 下载」一致。

**参考**：OpenClaw [Skills](https://docs.openclaw.ai/tools/skills)、ClawHub 仓库 [CLI 文档](https://github.com/openclaw/clawhub/blob/main/docs/cli.md)、本仓库 `didclaw/src/lib/clawhub-api.ts`。

---

## 2. 界面与交互

### 2.1 顶栏改动（`AppHeader.vue`）

- **移除** `.brand-tagline` 文案：`Gateway 会话 · 预览 · 诊断`（整块不再展示）。
- **保留** 右侧 **「关于」** `RouterLink`，样式与现有一致。
- 在「关于」**左侧**（原标语位置）新增 **横向工具栏容器**，例如：

  ```html
  <div class="header-toolbar" role="toolbar" aria-label="快捷功能">
    <button type="button" class="lc-btn lc-btn-ghost lc-btn-sm">技能</button>
    <!-- 后续功能按键追加于此 -->
    <RouterLink ...>关于</RouterLink>
  </div>
  ```

- **样式**：`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`，与 `.brand-actions` 对齐方式保持协调，保证窄屏时可换行。
- **可访问性**：技能按钮 `aria-haspopup="dialog"`，打开弹窗后焦点落入弹窗并支持 Esc 关闭（与现有 `GatewayLocalDialog` 模式一致即可）。

### 2.2 技能弹窗（新建组件）

建议路径：`didclaw/src/features/skills/SkillsManagerDialog.vue`（或 `SkillHubDialog.vue`）。

- **打开方式**：`v-model` 布尔值，由 `AppHeader` 内 `ref` 控制；仅在需要时挂载或使用 `Teleport` 至 `body`（按项目惯例）。
- **布局（建议分栏或 Tab）**：
  1. **ClawHub**：搜索框 + 结果列表；可选「浏览列表」子区（排序：最新 / 下载量等，映射 `clawhubListSkills` 的 `sort`）。
  2. **本机已安装**：扫描 `skills` 根下子目录（含 `SKILL.md` 的文件夹），展示名称、来源（clawhub / 本地）、版本（若有 `.clawhub/origin.json` 或仅目录名）。
  3. **从本机安装**：按钮「选择 ZIP」/「选择文件夹」（桌面端 Tauri；纯 Web 可降级为仅提示或使用 file input）。
- **详情**：点击某条 ClawHub 结果或已安装项，侧栏或下方展示 `clawhubSkillDetail` 或本地 `SKILL.md` 摘要；**安装 / 更新 / 删除** 操作放在详情区或行内按钮。
- **错误与限流**：捕获 `ClawhubHttpError`，对 **429** 提示稍后重试；列表加载中加 skeleton 或 loading 文案。

### 2.3 安装目标目录（产品需二选一或做下拉）

与 OpenClaw 约定一致，建议在弹窗内 **固定选项**（可记忆上次选择，存 `localStorage`）：

- **全局**：`~/.openclaw/skills`（Windows：`%USERPROFILE%\.openclaw\skills`）
- **工作区**（若后续能解析当前会话 workspace）：`{workspace}/skills`

首版可 **仅实现全局目录**，降低与 Gateway 会话路径耦合的复杂度；文档中保留「工作区 skills」为第二阶段。

---

## 3. 前端与公共库

| 项 | 说明 |
|----|------|
| Registry 客户端 | 已存在 `src/lib/clawhub-api.ts`，弹窗内直接调用，不写重复 fetch |
| 配置 | 可选 `VITE_CLAWHUB_REGISTRY` 覆盖默认 `https://clawhub.ai` |
| 状态 | 可用小型 `useSkillsDialogOpen()` 或仅在 `AppHeader` 用 `ref`，无需全局 Pinia（除非多入口打开） |

---

## 4. Tauri（桌面端）职责

以下操作涉及路径与解压，宜放在 **Rust 命令**中，前端 `invoke`：

| 命令（建议命名） | 作用 |
|------------------|------|
| `skills_list_installed` | 列出指定根目录下含 `SKILL.md` 的一级子目录，返回 slug、路径、可选读 `origin.json` |
| `skills_install_from_zip` | 接收 zip 字节（base64 或临时文件路径）+ 目标根目录 + 目标文件夹名（slug），解压并校验存在 `SKILL.md` |
| `skills_install_from_dir` | 复制用户选中的目录到 `skills/<name>/` |
| `skills_delete` | 递归删除 `skills/<slug>/` |
| `skills_pick_zip` / `skills_pick_folder` | 封装 `rfd` 或现有 dialog 模式 |

**安全**：解析 zip 时拒绝 `..` 路径穿越；目标路径必须落在配置的 skills 根目录的规范路径下（与 OpenClaw 文档中路径约束思想一致）。

**权限**：在 `capabilities/default.json` 中为上述命令声明所需 scope（若使用 `fs` 插件或自定义 allowlist）。

---

## 5. 纯 Web（`pnpm dev:web`）降级

- ClawHub 浏览、搜索、详情、下载 zip 仍可走浏览器 `fetch`（注意 CORS：若 ClawHub 未对浏览器域开放，可能需在开发环境代理或仅桌面端启用完整功能）。
- **写入本地 skills 目录**：无 Tauri 时仅提示「请在桌面版使用安装功能」或提供「仅下载 zip 到下载文件夹」的弱替代（可选）。

---

## 6. 实施阶段建议

### 阶段 A — UI 骨架与顶栏（约 0.5～1 天）

- 修改 `AppHeader.vue`：删除标语，增加 `header-toolbar` + **技能** 按钮 + 保留 **关于**。
- 新建 `SkillsManagerDialog.vue`：空壳 + 标题 + 关闭 + `v-model`。

### 阶段 B — ClawHub 只读（约 1～2 天）

- 搜索、列表、详情 UI 与 `clawhub-api` 串联。
- 下载：先在前端拿到 `ArrayBuffer`，再交给 Tauri 解压安装（阶段 C）；或阶段 B 末仅「下载到文件」作临时能力。

### 阶段 C — Tauri 安装 / 本地上传 / 删除（约 2～3 天）

- 实现 Rust 命令与前端调用链路。
- 本机 zip / 文件夹安装与已安装列表、删除；ClawHub 安装走「下载 + 解压到 `skills/<slug>`」，并可选写入 `.clawhub/origin.json`（与官方 CLI 行为对齐，便于后续「更新」）。

### 阶段 D — 更新与配置联动（约 1～2 天）

- **更新**：对已记录为 ClawHub 来源的技能调用 `clawhubSkillDetail` + `clawhubDownloadSkillZip` 覆盖。
- **可选**：读取/补丁 `openclaw.json` 的 `skills.entries`（删除或禁用时同步），需评估与现有 `read_gateway_local_config` 等配置的边界，避免误改用户文件——建议先做 **仅删目录**，配置同步作为增强项。

---

## 7. 验收标准

- 顶栏 **无** 「Gateway 会话 · 预览 · 诊断」文案；**关于** 仍可进入 About 页。
- **技能** 与 **关于** 同一行、同一工具栏内，后续可在中间插入新按钮而不改结构。
- 桌面版：可从 ClawHub 搜索并安装到 `~/.openclaw/skills`（或选定根目录），本机 zip 安装成功，删除后目录消失。
- 无效 zip（无 `SKILL.md`）应拒绝并提示原因。
- 文档中已知风险：列表 API 可能返回空、下载可能 429，UI 有明确提示而非白屏。

---

## 8. 文档与后续

- 功能上线后，在 `docs/didclaw-已实现功能说明.md` 中增加一节「技能管理」并链到本文。
- 若增加「工作区 skills」或 ClawHub 登录，应更新本文阶段与验收项。

---

*文档版本：与当前仓库讨论一致；实现时以代码与 OpenClaw/ClawHub 最新文档为准。*
