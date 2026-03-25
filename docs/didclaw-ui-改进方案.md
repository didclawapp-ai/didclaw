# DidClaw UI 改进方案

**背景**：DidClaw 面向普通用户，需要做到「简洁易操作 + 现代科技感」。本文档整理代码审查中发现的问题，并按优先级制定实施路线。

---

## 一、问题清单

### P0 — 代码缺陷（立即修复）

| # | 文件 | 问题 | 影响 |
|---|------|------|------|
| 1 | `style.css` | `.lc-btn-primary` 未定义，多处使用的主操作按钮和 ghost 按钮外观无区别 | 主操作按钮不突出 |
| 2 | `style.css` | `--lc-radius-md`、`--lc-surface` 未定义，相关组件使用硬编码回退值 | token 体系不完整 |
| 3 | `style.css` | 无 `--lc-spacing-*` 变量，各组件 padding/gap 全是魔数 | 日后维护困难 |

### P1 — 对普通用户影响最大

| # | 组件 | 问题 | 影响 |
|---|------|------|------|
| 4 | `AppHeader.vue` | 「诊断」「引导」「重启网关」暴露在主界面，对普通用户无意义 | 信息过载，界面显得技术性 |
| 5 | `AppHeader.vue` | `window.alert` / `window.confirm` 触发系统原生弹窗 | 观感粗糙，打破设计一致性 |
| 6 | `AppShell.vue` | 无「新建对话」入口；普通用户找不到如何开始新对话 | 核心操作缺失 |
| 7 | `MessageComposer.vue` | 输入提示文字永久可见，占用垂直空间 | 输入区显得拥挤 |

### P2 — 视觉一致性

| # | 组件 | 问题 | 影响 |
|---|------|------|------|
| 8 | `ChatMessageList.vue` | 用户消息与助手消息只靠文字标签区分，无视觉层次 | 聊天感弱，现代感不足 |
| 9 | `FirstRunWizard.vue` | 大量深色硬编码色（`#0d1117`、`#58a6ff`），与全局浅色 token 割裂 | 同一产品像两个 App |
| 10 | `AppShell.vue` | 会话列表项 `<select>` 用系统原生样式 | 视觉不统一 |

### P3 — 后续优化

| # | 内容 |
|---|------|
| 11 | 暗色模式（`color-scheme: dark` 分支） |
| 12 | 空状态欢迎页（示例提示词 + 快捷引导） |
| 13 | 设置对话框（`GatewayLocalDialog`）布局优化 |

---

## 二、实施路线

### Phase 1 — 设计基础修复（本次实施）

**目标**：补全 token、修复主按钮、Header 精简、新建对话按钮

1. `style.css`：补 `.lc-btn-primary`、`--lc-radius-md`、`--lc-surface`、`--lc-spacing-*`
2. `AppHeader.vue`：
   - 技术工具（诊断、引导、重启网关）收入「···」溢出菜单（`MoreMenu`）
   - Header 改为单行布局：`Logo ··· [定时任务] [技能] [⚙设置] [···]` + 连接状态行
   - 用内联错误状态替换 `window.alert`
3. `AppShell.vue`：在会话区顶部加「＋ 新建对话」按钮
4. `MessageComposer.vue`：输入提示文字折叠为 `?` 图标 tooltip
5. `ChatMessageList.vue`：用户消息气泡与助手消息气泡视觉分层

### Phase 2 — 视觉统一（后续）

1. `FirstRunWizard.vue`：将硬编码深色值替换为 `--lc-*` token
2. 空状态欢迎页
3. 原生 `<select>` 改为自定义下拉

### Phase 3 — 功能扩展（后续）

1. 暗色模式
2. 设置页重构

---

## 三、设计 Token 补充规范

```css
/* 新增 token（追加到 :root） */
--lc-radius-md: 10px;          /* 中等圆角，用于卡片、面板 */
--lc-surface: #ffffff;         /* 最高层表面（弹窗、抽屉等） */
--lc-spacing-xs: 4px;
--lc-spacing-sm: 8px;
--lc-spacing-md: 14px;
--lc-spacing-lg: 20px;
--lc-spacing-xl: 28px;
```

`.lc-btn-primary` 定义：与 `.lc-btn` 相同渐变，额外增强 `box-shadow` 和最小宽度，使其在按钮组中视觉更突出。

---

## 四、Header 精简方案

### 现状
```
第一行: [Logo]          [定时任务][技能][关于]
第二行: [LED][开关] [诊断][引导][设置][重启网关]  版本
```

### 目标
```
第一行: [●LED][开关][Logo]    [定时任务][技能][⚙设置]  [···]
```
- 单行，节省约 40px 高度
- `[···]` 菜单：诊断、引导（仅桌面版）、重启网关（仅桌面版）、关于
- 错误/版本信息以内联方式显示在 Header 底部

### 新建对话
在会话区顶部固定位置放置「＋ 新建对话」按钮（调用现有的会话创建逻辑或清空当前对话）。

---

## 五、消息气泡分层方案

| 角色 | 对齐 | 背景 | 标签色 |
|------|------|------|--------|
| `user` | 靠右（`margin-left: auto`） | `--lc-violet-soft`（淡紫） | `--lc-violet` |
| `assistant` | 靠左 | `--lc-accent-soft`（淡青） | `--lc-accent` |
| `system`/`tool` | 靠左，宽度缩小 | `--lc-bg-elevated`（灰） | `--lc-text-dim` |

气泡宽度：`user` 最大 80%，`assistant`/`system` 最大 92%。
