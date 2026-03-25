<script setup lang="ts">
import {
  clawhubDefaultRegistry,
  clawhubDownloadSkillZip,
  clawhubPackageDetail,
  clawhubOpenclawCliEnvFromVite,
  clawhubPackagesSearch,
  clawhubSkillDetail,
  ClawhubHttpError,
  type ClawhubCatalogHit,
  type ClawhubPackageDetail,
  type ClawhubPackageFamily,
  type ClawhubSkillDetail,
} from "@/lib/clawhub-api";
import { getDidClawDesktopApi, isDidClawDesktop } from "@/lib/desktop-api";
import {
  arrayBufferToBase64,
  getStoredSkillsInstallRoot,
  type InstalledSkillRow,
  setStoredSkillsInstallRoot,
  skillsDefaultInstallRoot,
  skillsDelete,
  skillsInstallFromFolder,
  skillsInstallZipBase64,
  skillsInstallZipPath,
  skillsListInstalled,
  skillsPickFolder,
  skillsPickZipFile,
  skillsResolveInstallRoot,
} from "@/lib/skills-invoke";
import { isTauri } from "@tauri-apps/api/core";
import { computed, onUnmounted, ref, watch } from "vue";

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [v: boolean];
}>();

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit("update:modelValue", v),
});

type SubTab = "browse" | "installed" | "local";
const subTab = ref<SubTab>("browse");

const installRoot = ref("");
const searchQuery = ref("");
const searchLoading = ref(false);
const searchHits = ref<ClawhubCatalogHit[]>([]);
const searchError = ref<string | null>(null);

/** ClawHub 主区域：卡片（默认）或列表 */
const hubResultsView = ref<"cards" | "list">("cards");

const hubSlug = ref<string | null>(null);
/** 详情区：技能走 skills API，插件走 packages API */
const hubDetailKind = ref<"skill" | "package" | null>(null);
const detailLoading = ref(false);
const hubDetail = ref<ClawhubSkillDetail | null>(null);
const hubPkgDetail = ref<ClawhubPackageDetail | null>(null);
const detailError = ref<string | null>(null);

const installBusy = ref(false);
/** 当前正在安装的技能 slug；仅该卡片/对应项显示「安装中…」，避免全局误判 */
const installingSlug = ref<string | null>(null);
const installMessage = ref<string | null>(null);
type MessageKind = "success" | "error" | "info";
const installMessageKind = ref<MessageKind>("info");

let msgTimer: ReturnType<typeof setTimeout> | null = null;
function setInstallMessage(msg: string, kind: MessageKind = "info"): void {
  installMessage.value = msg;
  installMessageKind.value = kind;
  if (msgTimer !== null) clearTimeout(msgTimer);
  /* 成功消息 8s 后自动消失，错误保留直到下次操作 */
  if (kind !== "error") {
    msgTimer = window.setTimeout(() => {
      installMessage.value = null;
      msgTimer = null;
    }, 8000);
  }
}

const installedLoading = ref(false);
const installedRows = ref<InstalledSkillRow[]>([]);
const installedError = ref<string | null>(null);

const localSlug = ref("");
const localBusy = ref(false);
const localMessage = ref<string | null>(null);
const localMessageKind = ref<MessageKind>("info");

function formatClawhubErr(e: unknown): string {
  if (e instanceof ClawhubHttpError) {
    if (e.status === 429) {
      return "ClawHub 限流（429）：请求过频。请等待约 1 分钟后再试；若刚连续搜索/安装，请先停几秒。客户端已自动重试仍失败时，稍后再点「安装」。";
    }
    return e.message + (e.bodySnippet ? ` ${e.bodySnippet}` : "");
  }
  return e instanceof Error ? e.message : String(e);
}

function slugFromFileName(name: string): string {
  const base = name.replace(/\.zip$/i, "").trim() || "skill";
  return base.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "skill";
}

function truncateSummary(text: string | null | undefined, maxLen: number): string {
  const s = text?.trim() ?? "";
  if (!s) {
    return "暂无简介";
  }
  if (s.length <= maxLen) {
    return s;
  }
  return `${s.slice(0, maxLen).trimEnd()}…`;
}

async function syncInstallRoot(): Promise<void> {
  if (!isTauri()) {
    installRoot.value = "";
    return;
  }
  const stored = getStoredSkillsInstallRoot()?.trim();
  if (stored) {
    installRoot.value = stored;
    return;
  }
  try {
    installRoot.value = await skillsDefaultInstallRoot();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setInstallMessage(
      `无法连接桌面接口：${msg}。开发模式下请确认已把 Vite 地址写入 capabilities/default.json 的 remote.urls，并重新运行 pnpm dev:tauri。`,
      "error",
    );
    installRoot.value = "";
  }
}

async function loadInstalled(): Promise<void> {
  if (!isTauri() || !installRoot.value.trim()) {
    installedRows.value = [];
    return;
  }
  installedLoading.value = true;
  installedError.value = null;
  try {
    installedRows.value = await skillsListInstalled(installRoot.value.trim());
  } catch (e) {
    installedError.value = e instanceof Error ? e.message : String(e);
    installedRows.value = [];
  } finally {
    installedLoading.value = false;
  }
}

/** 快捷搜索：中英合并 query，适配 ClawHub 以英文技能为主的索引；按钮展示双语标签 */
const CLAWHUB_QUICK_SEARCH_ITEMS: ReadonlyArray<{ label: string; query: string }> = [
  { label: "搜索 · search", query: "search 搜索" },
  { label: "代理 · proxy", query: "proxy 代理 VPN" },
  { label: "代码 · code", query: "code programming 代码" },
  { label: "免费 · free", query: "free open source 免费" },
  { label: "文档 · docs", query: "documentation docs 文档" },
  { label: "邮件 · email", query: "email mail 邮件" },
  { label: "日历 · calendar", query: "calendar schedule 日历" },
  { label: "数据库 · database", query: "database sql 数据库" },
  { label: "自动化 · automation", query: "automation workflow 自动化" },
  { label: "API · 接口", query: "API REST HTTP 接口" },
  { label: "插件 · plugin", query: "plugin" },
];

async function onSearch(): Promise<void> {
  const q = searchQuery.value.trim();
  if (!q) {
    searchHits.value = [];
    hubSlug.value = null;
    hubDetailKind.value = null;
    hubDetail.value = null;
    hubPkgDetail.value = null;
    detailError.value = null;
    return;
  }
  searchLoading.value = true;
  searchError.value = null;
  hubSlug.value = null;
  hubDetailKind.value = null;
  hubDetail.value = null;
  hubPkgDetail.value = null;
  detailError.value = null;
  try {
    const r = await clawhubPackagesSearch(q, { limit: 30 });
    searchHits.value = r.results ?? [];
  } catch (e) {
    searchError.value = formatClawhubErr(e);
    searchHits.value = [];
  } finally {
    searchLoading.value = false;
  }
}

async function onQuickSearch(keyword: string): Promise<void> {
  const k = keyword.trim();
  if (!k) {
    return;
  }
  searchQuery.value = k;
  await onSearch();
}

async function selectHubSlug(slug: string, family: ClawhubPackageFamily): Promise<void> {
  hubSlug.value = slug;
  hubDetail.value = null;
  hubPkgDetail.value = null;
  detailError.value = null;
  detailLoading.value = true;
  const isPlugin = family === "code-plugin" || family === "bundle-plugin";
  hubDetailKind.value = isPlugin ? "package" : "skill";
  try {
    if (isPlugin) {
      hubPkgDetail.value = await clawhubPackageDetail(slug);
    } else {
      hubDetail.value = await clawhubSkillDetail(slug);
    }
  } catch (e) {
    detailError.value = formatClawhubErr(e);
  } finally {
    detailLoading.value = false;
  }
}

function familyLabel(f: ClawhubPackageFamily): string {
  if (f === "code-plugin") {
    return "插件";
  }
  if (f === "bundle-plugin") {
    return "捆绑包";
  }
  return "技能";
}

function normalizePkgFamily(f: string | undefined | null): ClawhubPackageFamily {
  if (f === "code-plugin" || f === "bundle-plugin" || f === "skill") {
    return f;
  }
  return "skill";
}

function pluginPackageSpec(slug: string): string {
  const s = slug.trim();
  if (!s) {
    return s;
  }
  if (s.toLowerCase().startsWith("clawhub:")) {
    return s;
  }
  return `clawhub:${s}`;
}

function truncateInstallFeedback(msg: string, maxLen = 720): string {
  const t = msg.trim();
  if (t.length <= maxLen) {
    return t;
  }
  return `${t.slice(0, maxLen)}…`;
}

/** 桌面端：调用本机 `openclaw plugins install`（ClawHub 规格 `clawhub:包名`） */
async function installClawhubPluginFromSlug(slug: string | null | undefined): Promise<void> {
  const s = slug?.trim();
  if (!s) {
    return;
  }
  if (!isDidClawDesktop()) {
    setInstallMessage("安装插件需要桌面版。", "info");
    return;
  }
  const api = getDidClawDesktopApi();
  if (!api?.openclawPluginsInstall) {
    setInstallMessage(
      "当前桌面壳不支持插件一键安装，请在终端执行：openclaw plugins install " + pluginPackageSpec(s),
      "info",
    );
    return;
  }
  if (installBusy.value) {
    setInstallMessage("正在安装其他项，请等待完成后再试。", "info");
    return;
  }
  installBusy.value = true;
  installingSlug.value = s;
  installMessage.value = null;
  try {
    const ch = clawhubOpenclawCliEnvFromVite();
    const r = await api.openclawPluginsInstall({
      packageSpec: pluginPackageSpec(s),
      clawhubToken: ch.token,
      clawhubRegistry: ch.registry,
    });
    if (r && typeof r === "object" && "ok" in r && r.ok === true) {
      setInstallMessage(
        truncateInstallFeedback(`「${s}」已通过 OpenClaw CLI 安装。若网关已在运行，请重启网关后加载插件。`),
        "success",
      );
      return;
    }
    const err =
      r && typeof r === "object" && "error" in r && typeof (r as { error?: string }).error === "string"
        ? (r as { error: string }).error
        : "安装失败。";
    setInstallMessage(truncateInstallFeedback(err), "error");
  } catch (e) {
    setInstallMessage(truncateInstallFeedback(formatClawhubErr(e)), "error");
  } finally {
    installBusy.value = false;
    installingSlug.value = null;
  }
}

function installButtonDisabledForHit(h: ClawhubCatalogHit): boolean {
  if (installBusy.value) {
    return true;
  }
  if (h.family === "code-plugin" || h.family === "bundle-plugin") {
    return !canOneClickPluginInstall.value;
  }
  return !isTauri();
}

/** 从搜索结果安装：skill → skills ZIP；插件 → 本机 openclaw CLI */
async function installFromSearchHit(hit: ClawhubCatalogHit): Promise<void> {
  const slug = hit.slug?.trim();
  if (!slug) {
    return;
  }
  if (hit.family === "code-plugin" || hit.family === "bundle-plugin") {
    await installClawhubPluginFromSlug(slug);
    return;
  }
  if (!isTauri()) {
    setInstallMessage("安装到本机目录需要桌面版（Tauri）。", "info");
    return;
  }
  if (installBusy.value) {
    setInstallMessage("正在安装其他技能，请等待完成后再试。", "info");
    return;
  }
  installBusy.value = true;
  installingSlug.value = slug;
  installMessage.value = null;
  try {
    const meta = await clawhubSkillDetail(slug);
    if (meta.moderation?.isMalwareBlocked) {
      setInstallMessage(`「${slug}」已被标记为恶意，无法安装。`, "error");
      return;
    }
    if (meta.moderation?.isSuspicious) {
      const ok = window.confirm(
        `「${slug}」被标记为可疑技能，可能包含风险模式。确定仍要安装吗？`,
      );
      if (!ok) {
        setInstallMessage("已取消安装。", "info");
        return;
      }
    }
    const version = meta.latestVersion?.version;
    if (!version) {
      setInstallMessage(`无法解析「${slug}」的最新版本。`, "error");
      return;
    }
    /* 略隔开「详情」与「下载」请求，降低连续命中 429 的概率 */
    await new Promise((r) => setTimeout(r, 400));
    await installHubSkill(slug, version, { manageBusy: false, skipSuspiciousCheck: true });
  } catch (e) {
    setInstallMessage(formatClawhubErr(e), "error");
  } finally {
    installBusy.value = false;
    installingSlug.value = null;
  }
}

async function installHubSkill(
  slug: string,
  version: string,
  options?: { manageBusy?: boolean; skipSuspiciousCheck?: boolean },
): Promise<void> {
  const manageBusy = options?.manageBusy !== false;
  const skipSuspiciousCheck = options?.skipSuspiciousCheck === true;
  if (!isTauri()) {
    setInstallMessage("安装到本机目录需要桌面版（Tauri）。", "info");
    return;
  }
  const root = await skillsResolveInstallRoot(installRoot.value.trim() || undefined);
  if (manageBusy) {
    if (installBusy.value) {
      setInstallMessage("正在安装其他技能，请等待完成后再试。", "info");
      return;
    }
    installBusy.value = true;
    installingSlug.value = slug;
    installMessage.value = null;
  }
  try {
    /* 若调用方未获取详情，这里补查 isSuspicious */
    if (!skipSuspiciousCheck) {
      let meta: Awaited<ReturnType<typeof clawhubSkillDetail>> | null = null;
      try {
        meta = await clawhubSkillDetail(slug);
      } catch { /* 网络故障时跳过检查 */ }
      if (meta?.moderation?.isMalwareBlocked) {
        setInstallMessage(`「${slug}」已被标记为恶意，无法安装。`, "error");
        return;
      }
      if (meta?.moderation?.isSuspicious) {
        const ok = window.confirm(
          `「${slug}」被标记为可疑技能，可能包含风险模式。确定仍要安装吗？`,
        );
        if (!ok) {
          setInstallMessage("已取消安装。", "info");
          return;
        }
      }
    }
    const buf = await clawhubDownloadSkillZip(slug, { version });
    const b64 = arrayBufferToBase64(buf);
    const reg = clawhubDefaultRegistry();
    const origin = {
      version: 1,
      registry: reg,
      slug,
      installedVersion: version,
      installedAt: Date.now(),
    };
    const r = await skillsInstallZipBase64(root, slug, b64, origin);
    if (!r.ok) {
      setInstallMessage("安装失败。", "error");
      return;
    }
    setInstallMessage(`已安装「${slug}」@${version}。新会话通常会加载技能。`, "success");
    setStoredSkillsInstallRoot(root);
    installRoot.value = root;
    await loadInstalled();
  } catch (e) {
    setInstallMessage(formatClawhubErr(e), "error");
  } finally {
    if (manageBusy) {
      installBusy.value = false;
      installingSlug.value = null;
    }
  }
}

async function onDeleteInstalled(row: InstalledSkillRow): Promise<void> {
  if (installBusy.value) {
    setInstallMessage("正在安装其他技能，请等待完成后再删除。", "info");
    return;
  }
  if (!window.confirm(`确定删除本机技能「${row.slug}」？将删除整个目录。`)) {
    return;
  }
  installBusy.value = true;
  const root = await skillsResolveInstallRoot(installRoot.value.trim() || undefined);
  try {
    await skillsDelete(root, row.slug);
    await loadInstalled();
    if (hubSlug.value === row.slug) {
      hubSlug.value = null;
      hubDetail.value = null;
    }
    setInstallMessage(`已删除「${row.slug}」。`, "success");
  } catch (e) {
    setInstallMessage(e instanceof Error ? e.message : String(e), "error");
  } finally {
    installBusy.value = false;
  }
}

async function onUpdateInstalled(row: InstalledSkillRow): Promise<void> {
  if (row.source !== "clawhub") {
    setInstallMessage("非 ClawHub 来源的技能请重新上传 ZIP 或文件夹覆盖安装。", "info");
    return;
  }
  const meta = await clawhubSkillDetail(row.slug).catch(() => null);
  const ver = meta?.latestVersion?.version;
  if (!ver) {
    setInstallMessage("无法获取远端最新版本。", "error");
    return;
  }
  if (row.installedVersion && row.installedVersion === ver) {
    setInstallMessage(`「${row.slug}」已是最新版本 ${ver}。`, "info");
    return;
  }
  await installHubSkill(row.slug, ver);
}

async function onPickZipInstall(): Promise<void> {
  localMessage.value = null;
  const picked = await skillsPickZipFile();
  if (!picked) {
    return;
  }
  const parts = picked.replace(/\\/g, "/").split("/");
  const name = parts[parts.length - 1] ?? "skill.zip";
  const slug = localSlug.value.trim() || slugFromFileName(name);
  if (!slug) {
    localMessage.value = "请填写或确认技能目录名（slug）。";
    return;
  }
  const root = await skillsResolveInstallRoot(installRoot.value.trim() || undefined);
  localBusy.value = true;
  try {
    const r = await skillsInstallZipPath(root, slug, picked);
    if (!r.ok) {
      localMessage.value = "ZIP 安装失败。";
      localMessageKind.value = "error";
      return;
    }
    setStoredSkillsInstallRoot(root);
    installRoot.value = root;
    localMessage.value = `已从 ZIP 安装到「${slug}」。`;
    localMessageKind.value = "success";
    await loadInstalled();
  } catch (e) {
    localMessage.value = e instanceof Error ? e.message : String(e);
    localMessageKind.value = "error";
  } finally {
    localBusy.value = false;
  }
}

async function onPickFolderInstall(): Promise<void> {
  localMessage.value = null;
  const picked = await skillsPickFolder();
  if (!picked) {
    return;
  }
  const parts = picked.replace(/\\/g, "/").split("/").filter(Boolean);
  const folderName = parts[parts.length - 1] ?? "skill";
  const slug = localSlug.value.trim() || slugFromFileName(folderName);
  const root = await skillsResolveInstallRoot(installRoot.value.trim() || undefined);
  localBusy.value = true;
  try {
    const r = await skillsInstallFromFolder(root, slug, picked);
    if (!r.ok) {
      localMessage.value = "文件夹安装失败。";
      localMessageKind.value = "error";
      return;
    }
    setStoredSkillsInstallRoot(root);
    installRoot.value = root;
    localMessage.value = `已从文件夹安装到「${slug}」。`;
    localMessageKind.value = "success";
    await loadInstalled();
  } catch (e) {
    localMessage.value = e instanceof Error ? e.message : String(e);
    localMessageKind.value = "error";
  } finally {
    localBusy.value = false;
  }
}

function onInstallRootBlur(): void {
  const t = installRoot.value.trim();
  if (t) {
    setStoredSkillsInstallRoot(t);
  }
}

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === "Escape" && open.value) {
    open.value = false;
  }
}

watch(
  () => props.modelValue,
  async (v) => {
    if (v) {
      subTab.value = "browse";
      await syncInstallRoot();
      void loadInstalled();
      window.addEventListener("keydown", onKeydown);
    } else {
      window.removeEventListener("keydown", onKeydown);
    }
  },
);

watch(subTab, (t) => {
  if (t === "installed" && props.modelValue) {
    void loadInstalled();
  }
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  if (msgTimer !== null) clearTimeout(msgTimer);
});

const canInstallDetail = computed(() => {
  if (hubDetailKind.value !== "skill") {
    return false;
  }
  const d = hubDetail.value;
  if (!d?.moderation?.isMalwareBlocked && d?.latestVersion?.version) {
    return true;
  }
  return false;
});

const canOneClickPluginInstall = computed(() => {
  if (!isDidClawDesktop()) {
    return false;
  }
  const api = getDidClawDesktopApi();
  return typeof api?.openclawPluginsInstall === "function";
});

const canInstallPluginDetail = computed(() => {
  if (hubDetailKind.value !== "package" || !hubPkgDetail.value?.package) {
    return false;
  }
  const slug = hubSlug.value?.trim();
  if (!slug) {
    return false;
  }
  const f = normalizePkgFamily(hubPkgDetail.value.package.family);
  if (f !== "code-plugin" && f !== "bundle-plugin") {
    return false;
  }
  return canOneClickPluginInstall.value;
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="skills-backdrop" @click.self="open = false">
      <div
        class="skills-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="skills-dialog-title"
        tabindex="-1"
      >
        <div class="skills-head">
          <h2 id="skills-dialog-title">技能管理</h2>
          <button
            type="button"
            class="skills-close-btn"
            aria-label="关闭"
            @click="open = false"
          >
            ✕
          </button>
        </div>

        <div class="skills-panel-top">
          <p class="skills-lead muted small">
            在 <strong>ClawHub</strong> 搜索并一键安装技能（ZIP）或插件（CLI）；也可在「本机安装」页上传本地 ZIP / 文件夹。
          </p>

          <div v-if="isTauri()" class="skills-root-row">
            <label class="skills-root-label">安装根目录</label>
            <input
              v-model="installRoot"
              type="text"
              class="skills-root-input"
              spellcheck="false"
              @blur="onInstallRootBlur"
            >
          </div>
          <p v-else class="muted small skills-web-hint">
            当前为网页模式：可搜索 ClawHub；安装到本机需使用桌面版。
          </p>
        </div>

        <div class="skills-panel-body">
          <nav class="skills-sidebar" role="tablist" aria-label="技能管理">
            <button
              type="button"
              role="tab"
              class="skills-side-tab"
              :class="{ active: subTab === 'browse' }"
              :aria-selected="subTab === 'browse'"
              @click="subTab = 'browse'"
            >
              ClawHub
            </button>
            <button
              type="button"
              role="tab"
              class="skills-side-tab"
              :class="{ active: subTab === 'installed' }"
              :aria-selected="subTab === 'installed'"
              @click="subTab = 'installed'"
            >
              已安装
            </button>
            <button
              type="button"
              role="tab"
              class="skills-side-tab"
              :class="{ active: subTab === 'local' }"
              :aria-selected="subTab === 'local'"
              @click="subTab = 'local'"
            >
              本机安装
            </button>
          </nav>

          <div class="skills-main">
            <div
              v-if="installMessage"
              class="skills-toast"
              :class="`skills-toast--${installMessageKind}`"
              role="status"
            >
              <span>{{ installMessage }}</span>
              <button
                type="button"
                class="skills-toast-close"
                aria-label="关闭提示"
                @click="installMessage = null"
              >✕</button>
            </div>

            <!-- ClawHub -->
            <div v-show="subTab === 'browse'" class="skills-body" role="tabpanel">
          <div class="hub-toolbar">
            <input
              v-model="searchQuery"
              type="search"
              class="skills-search"
              placeholder="搜索技能或插件…"
              @keydown.enter="onSearch"
            >
            <button type="button" class="lc-btn lc-btn-ghost lc-btn-sm" :disabled="searchLoading" @click="onSearch">
              {{ searchLoading ? "搜索中…" : "搜索" }}
            </button>
          </div>
          <div class="hub-quick-search" aria-label="ClawHub 快捷搜索">
            <span class="hub-quick-label muted small">快捷搜索</span>
            <div class="hub-quick-tags">
              <button
                v-for="item in CLAWHUB_QUICK_SEARCH_ITEMS"
                :key="item.query"
                type="button"
                class="lc-btn lc-btn-ghost lc-btn-sm hub-quick-tag"
                :disabled="searchLoading"
                :title="`搜索：${item.query}`"
                @click="onQuickSearch(item.query)"
              >
                {{ item.label }}
              </button>
            </div>
          </div>
          <p v-if="searchError" class="err small">{{ searchError }}</p>

          <div class="hub-results-toolbar">
            <span class="hub-results-title muted small">搜索结果</span>
            <div class="hub-view-toggle" role="group" aria-label="展示方式">
              <button
                type="button"
                class="hub-toggle-btn"
                :class="{ active: hubResultsView === 'cards' }"
                @click="hubResultsView = 'cards'"
              >
                卡片
              </button>
              <button
                type="button"
                class="hub-toggle-btn"
                :class="{ active: hubResultsView === 'list' }"
                @click="hubResultsView = 'list'"
              >
                列表
              </button>
            </div>
          </div>

          <div class="hub-results-region" aria-live="polite">
            <p v-if="searchLoading" class="muted small hub-results-status">搜索中…</p>
            <p v-else-if="!searchHits.length" class="muted small hub-results-empty">
              输入关键词或点击「快捷搜索」；结果含技能与插件（标签区分）。技能走 ZIP 安装目录；插件在桌面版且已配置 openclaw 时可一键 CLI 安装。
            </p>
            <template v-else>
              <div v-if="hubResultsView === 'cards'" class="hub-card-grid">
                <article v-for="h in searchHits" :key="`${h.family}:${h.slug}`" class="hub-result-card">
                  <header class="hub-card-head">
                    <h3 class="hub-card-title">{{ h.displayName?.trim() || h.slug }}</h3>
                    <span class="hub-card-family">{{ familyLabel(h.family) }}</span>
                    <code class="hub-card-slug">{{ h.slug }}</code>
                  </header>
                  <p class="hub-card-summary">{{ truncateSummary(h.summary, 200) }}</p>
                  <footer class="hub-card-actions">
                    <button
                      type="button"
                      class="lc-btn lc-btn-sm"
                      :disabled="installButtonDisabledForHit(h)"
                      @click="installFromSearchHit(h)"
                    >
                      {{ installBusy && installingSlug === h.slug ? "安装中…" : "安装" }}
                    </button>
                    <button
                      type="button"
                      class="lc-btn lc-btn-ghost lc-btn-sm"
                      @click="() => void selectHubSlug(h.slug, h.family)"
                    >
                      详情
                    </button>
                  </footer>
                </article>
              </div>
              <ul v-else class="hub-result-list" role="list">
                <li v-for="h in searchHits" :key="`${h.family}:${h.slug}`" class="hub-list-row">
                  <div class="hub-list-text">
                    <div class="hub-list-title-row">
                      <span class="hub-list-name">{{ h.displayName?.trim() || h.slug }}</span>
                      <span class="hub-list-family">{{ familyLabel(h.family) }}</span>
                      <code class="hub-list-slug">{{ h.slug }}</code>
                    </div>
                    <p class="hub-list-summary">{{ truncateSummary(h.summary, 280) }}</p>
                  </div>
                  <div class="hub-list-actions">
                    <button
                      type="button"
                      class="lc-btn lc-btn-sm lc-btn-ghost"
                      :disabled="installButtonDisabledForHit(h)"
                      @click="installFromSearchHit(h)"
                    >
                      {{ installBusy && installingSlug === h.slug ? "安装中…" : "安装" }}
                    </button>
                    <button
                      type="button"
                      class="lc-btn lc-btn-ghost lc-btn-sm"
                      @click="() => void selectHubSlug(h.slug, h.family)"
                    >
                      详情
                    </button>
                  </div>
                </li>
              </ul>
            </template>
          </div>

          <div v-if="hubSlug" class="detail-card hub-detail-panel">
            <h3 class="detail-title">详情：{{ hubSlug }}</h3>
            <p v-if="detailLoading" class="muted">加载中…</p>
            <p v-else-if="detailError" class="err small">{{ detailError }}</p>
            <template v-else-if="hubDetailKind === 'skill' && hubDetail">
              <p class="detail-summary">{{ hubDetail.skill?.summary ?? "—" }}</p>
              <p v-if="hubDetail.latestVersion" class="small muted">
                最新版本：{{ hubDetail.latestVersion.version }}
              </p>
              <p v-if="hubDetail.moderation?.isMalwareBlocked" class="err small">该技能已被标记为恶意，无法安装。</p>
              <p v-else-if="hubDetail.moderation?.isSuspicious" class="err small">
                该技能被标记为可疑，请自行审阅后再安装。
              </p>
              <button
                v-if="isTauri() && canInstallDetail && hubDetail.latestVersion"
                type="button"
                class="lc-btn lc-btn-sm skills-install-btn"
                :disabled="installBusy"
                @click="installHubSkill(hubSlug, hubDetail.latestVersion.version)"
              >
                {{ installBusy && installingSlug === hubSlug ? "安装中…" : "安装到本机" }}
              </button>
            </template>
            <template v-else-if="hubDetailKind === 'package' && hubPkgDetail?.package">
              <p v-if="hubPkgDetail.package.family" class="small muted">
                类型：{{ familyLabel(normalizePkgFamily(hubPkgDetail.package.family)) }}
              </p>
              <p class="detail-summary">{{ hubPkgDetail.package.summary ?? "—" }}</p>
              <p v-if="hubPkgDetail.package.latestVersion" class="small muted">
                最新版本：{{ hubPkgDetail.package.latestVersion }}
              </p>
              <p v-if="hubPkgDetail.package.channel" class="small muted">通道：{{ hubPkgDetail.package.channel }}</p>
              <p v-if="hubPkgDetail.package.ownerHandle" class="small muted">发布者：@{{ hubPkgDetail.package.ownerHandle }}</p>
              <button
                v-if="canInstallPluginDetail && hubSlug"
                type="button"
                class="lc-btn lc-btn-sm skills-install-btn"
                :disabled="installBusy"
                @click="installClawhubPluginFromSlug(hubSlug)"
              >
                {{ installBusy && installingSlug === hubSlug ? "安装中…" : "安装插件（OpenClaw CLI）" }}
              </button>
              <p class="muted small">
                说明与配置见
                <a href="https://docs.openclaw.ai/tools/plugin" target="_blank" rel="noopener noreferrer">官方插件文档</a>
                。
              </p>
            </template>
          </div>
            </div>

            <!-- 已安装 -->
            <div v-show="subTab === 'installed'" class="skills-body" role="tabpanel">
          <div class="row-actions">
            <button
              type="button"
              class="lc-btn lc-btn-ghost lc-btn-sm"
              :disabled="installedLoading || !isTauri()"
              @click="loadInstalled"
            >
              {{ installedLoading ? "刷新中…" : "刷新" }}
            </button>
          </div>
          <p v-if="installedError" class="err small">{{ installedError }}</p>
          <p v-if="!isTauri()" class="muted small">桌面版才可管理本机已安装技能。</p>
          <table v-else-if="installedRows.length" class="skills-table">
            <thead>
              <tr>
                <th>技能</th>
                <th>来源</th>
                <th>版本</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in installedRows" :key="row.slug">
                <td>
                  <code>{{ row.slug }}</code>
                </td>
                <td>{{ row.source }}</td>
                <td>{{ row.installedVersion ?? "—" }}</td>
                <td class="td-actions">
                  <button
                    type="button"
                    class="lc-btn lc-btn-ghost lc-btn-xs"
                    :disabled="installBusy"
                    @click="onUpdateInstalled(row)"
                  >
                    更新
                  </button>
                  <button
                    type="button"
                    class="lc-btn lc-btn-ghost lc-btn-xs btn-danger"
                    :disabled="installBusy"
                    @click="onDeleteInstalled(row)"
                  >
                    删除
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else-if="!installedLoading" class="muted small">暂无已安装技能。</p>
            </div>

            <!-- 本机安装 -->
            <div v-show="subTab === 'local'" class="skills-body" role="tabpanel">
          <p v-if="!isTauri()" class="muted small">请使用桌面版选择 ZIP 或文件夹。</p>
          <template v-else>
            <label class="local-slug">
              <span class="muted small">目录名（slug，可选；不填则用文件名/文件夹名）</span>
              <input v-model="localSlug" type="text" class="skills-root-input" spellcheck="false">
            </label>
            <div class="local-actions">
              <button type="button" class="lc-btn lc-btn-ghost lc-btn-sm" :disabled="localBusy" @click="onPickZipInstall">
                {{ localBusy ? "处理中…" : "选择 ZIP 安装" }}
              </button>
              <button
                type="button"
                class="lc-btn lc-btn-ghost lc-btn-sm"
                :disabled="localBusy"
                @click="onPickFolderInstall"
              >
                {{ localBusy ? "处理中…" : "选择文件夹安装" }}
              </button>
            </div>
            <p v-if="localMessage" class="small" :class="localMessageKind === 'error' ? 'err' : localMessageKind === 'success' ? 'ok' : 'muted'">{{ localMessage }}</p>
            </template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.skills-backdrop {
  position: fixed;
  inset: 0;
  z-index: 12000;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  box-sizing: border-box;
}
.skills-panel {
  display: flex;
  flex-direction: column;
  width: min(960px, 100%);
  max-height: min(88vh, 900px);
  overflow: hidden;
  background: var(--lc-surface-panel);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  box-shadow: var(--lc-shadow-sm);
  padding: 18px 20px 22px;
  box-sizing: border-box;
}
.skills-panel-top {
  flex-shrink: 0;
}
.skills-panel-body {
  display: flex;
  flex: 1;
  min-height: 0;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--lc-border);
}
.skills-sidebar {
  flex: 0 0 152px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-right: 14px;
  border-right: 1px solid var(--lc-border);
  align-self: stretch;
}
.skills-side-tab {
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid transparent;
  background: transparent;
  font-size: 13px;
  cursor: pointer;
  color: var(--lc-text-muted);
  font-family: inherit;
}
.skills-side-tab:hover {
  color: var(--lc-text);
  background: var(--lc-bg-elevated);
}
.skills-side-tab.active {
  border-color: var(--lc-border-strong);
  color: var(--lc-text);
  background: var(--lc-bg-raised);
  font-weight: 600;
}
.skills-main {
  flex: 1;
  min-width: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding-left: 16px;
  padding-bottom: 2px;
}
.skills-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.skills-head h2 {
  margin: 0;
  font-size: 1.1rem;
}
.skills-close-btn {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--lc-text-muted);
  font-size: 14px;
  cursor: pointer;
  border-radius: var(--lc-radius-sm);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s ease, color 0.12s ease;
}
.skills-close-btn:hover {
  background: var(--lc-error-bg);
  color: var(--lc-error);
}
.skills-lead {
  margin: 0 0 12px;
  line-height: 1.45;
}
.skills-lead code {
  font-size: 11px;
}
.skills-root-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.skills-root-label {
  font-size: 12px;
  color: var(--lc-text-muted);
}
.skills-root-input {
  flex: 1 1 240px;
  min-width: 0;
  font-size: 13px;
  padding: 6px 10px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-raised);
  color: var(--lc-text);
  font-family: var(--lc-mono);
}
.skills-web-hint {
  margin: 0 0 12px;
}
.skills-toast {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  line-height: 1.45;
  margin-bottom: 10px;
  padding: 8px 12px;
  border-radius: var(--lc-radius-sm);
  border-left: 3px solid currentColor;
}
.skills-toast--success {
  color: var(--lc-success);
  background: var(--lc-success-bg);
}
.skills-toast--error {
  color: var(--lc-error);
  background: var(--lc-error-bg);
}
.skills-toast--info {
  color: var(--lc-accent);
  background: var(--lc-accent-soft);
}
.skills-toast-close {
  flex-shrink: 0;
  border: none;
  background: transparent;
  font-size: 11px;
  cursor: pointer;
  color: inherit;
  opacity: 0.6;
  padding: 0 2px;
  line-height: 1;
}
.skills-toast-close:hover { opacity: 1; }
.skills-body {
  min-height: 120px;
}
@media (max-width: 560px) {
  .skills-panel-body {
    flex-direction: column;
  }
  .skills-sidebar {
    flex: 0 0 auto;
    flex-direction: row;
    flex-wrap: wrap;
    border-right: none;
    border-bottom: 1px solid var(--lc-border);
    padding-right: 0;
    padding-bottom: 10px;
    gap: 6px;
  }
  .skills-side-tab {
    flex: 1 1 auto;
    min-width: 5.5rem;
    text-align: center;
    padding: 8px 10px;
  }
  .skills-main {
    padding-left: 0;
    padding-top: 12px;
  }
}
.hub-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.hub-quick-search {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  margin-bottom: 10px;
}
.hub-quick-label {
  flex: 0 0 auto;
}
.hub-quick-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex: 1 1 200px;
  min-width: 0;
}
.hub-quick-tag {
  flex: 0 0 auto;
}
.hub-results-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
}
.hub-results-title {
  font-weight: 600;
  color: var(--lc-text);
}
.hub-view-toggle {
  display: inline-flex;
  gap: 4px;
}
.hub-toggle-btn {
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-raised);
  padding: 5px 12px;
  border-radius: var(--lc-radius-sm);
  font-size: 12px;
  cursor: pointer;
  color: var(--lc-text-muted);
  font-family: inherit;
}
.hub-toggle-btn:hover {
  color: var(--lc-text);
  background: var(--lc-bg-elevated);
}
.hub-toggle-btn.active {
  border-color: var(--lc-border-strong);
  color: var(--lc-text);
  background: var(--lc-bg-elevated);
  font-weight: 600;
}
.hub-results-region {
  margin-top: 10px;
  min-height: 120px;
  max-height: min(420px, 52vh);
  overflow: auto;
  padding: 12px;
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  background: var(--lc-bg-raised);
}
.hub-results-empty,
.hub-results-status {
  margin: 0;
}
.hub-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(236px, 1fr));
  gap: 12px;
}
.hub-result-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  background: var(--lc-surface-panel);
  box-sizing: border-box;
}
.hub-card-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.hub-card-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--lc-text);
}
.hub-card-slug {
  font-size: 11px;
  color: var(--lc-accent);
  font-family: var(--lc-mono);
}
.hub-card-family,
.hub-list-family {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--lc-text-dim);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-raised);
}
.hub-card-summary {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--lc-text-muted);
  flex: 1;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.hub-card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}
.hub-result-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.hub-list-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 0;
  border-bottom: 1px solid var(--lc-border);
}
.hub-list-row:last-child {
  border-bottom: none;
}
.hub-list-text {
  flex: 1 1 200px;
  min-width: 0;
}
.hub-list-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}
.hub-list-name {
  font-weight: 600;
  font-size: 14px;
}
.hub-list-slug {
  font-size: 11px;
  color: var(--lc-accent);
  font-family: var(--lc-mono);
}
.hub-list-summary {
  margin: 0;
  font-size: 12px;
  color: var(--lc-text-muted);
  line-height: 1.45;
}
.hub-list-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex: 0 0 auto;
}
.hub-detail-panel {
  margin-top: 14px;
}
.skills-search {
  flex: 1 1 200px;
  min-width: 0;
  padding: 6px 10px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-raised);
  color: var(--lc-text);
  font-family: inherit;
  font-size: 13px;
}
.detail-card {
  margin-top: 14px;
  padding: 12px 14px;
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  background: var(--lc-bg-elevated);
}
.detail-title {
  margin: 0 0 8px;
  font-size: 14px;
}
.detail-summary {
  margin: 0 0 10px;
  line-height: 1.5;
  font-size: 13px;
}
.skills-install-btn {
  margin-top: 4px;
}
.row-actions {
  margin-bottom: 10px;
}
.skills-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.skills-table th,
.skills-table td {
  border: 1px solid var(--lc-border);
  padding: 8px 10px;
  text-align: left;
}
.skills-table th {
  background: var(--lc-bg-elevated);
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--lc-text-muted);
}
.td-actions {
  white-space: nowrap;
}
.local-slug {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}
.local-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.btn-danger {
  color: var(--lc-error) !important;
}
.btn-danger:hover:not(:disabled) {
  border-color: var(--lc-error) !important;
  background: var(--lc-error-bg) !important;
}
.hub-result-card {
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.hub-result-card:hover {
  border-color: var(--lc-border-strong);
  box-shadow: var(--lc-shadow-sm);
}
.err {
  color: var(--lc-error);
}
.ok {
  color: var(--lc-success);
}
.muted {
  color: var(--lc-text-muted);
}
.small {
  font-size: 12px;
}
</style>
