<script setup lang="ts">
import {
  clawhubDefaultRegistry,
  clawhubDownloadSkillZip,
  getStoredClawhubClientOptions,
  clawhubPackageDetail,
  clawhubPackagesSearch,
  clawhubSkillDetail,
  setStoredClawhubClientOptions,
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
  openclawPluginsInspect,
  openclawPluginsList,
  openclawPluginsSetEnabled,
  openclawPluginsUninstall,
  openclawSkillsInstall,
  openclawSkillsSearch,
  openclawPluginsUpdate,
  openclawSkillsCheck,
  openclawSkillsList,
  openclawSkillsUpdate,
  type InstalledSkillRow,
  type OpenClawPluginInspectResult,
  type OpenClawPluginItem,
  type OpenClawSkillItem,
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

type SubTab = "browse" | "openclaw" | "installed" | "local";
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
const openclawSkillActionBusyName = ref<string | null>(null);
const installMessage = ref<string | null>(null);
type MessageKind = "success" | "error" | "info";
const installMessageKind = ref<MessageKind>("info");

let msgTimer: number | null = null;
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

const openclawLoading = ref(false);
const openclawLoadedOnce = ref(false);
const openclawError = ref<string | null>(null);
const openclawFilter = ref("");
const openclawWorkspaceDir = ref<string | null>(null);
const openclawManagedSkillsDir = ref<string | null>(null);
const openclawSkills = ref<OpenClawSkillItem[]>([]);
const openclawPlugins = ref<OpenClawPluginItem[]>([]);
type OpenClawCatalogFilter = "all" | "ready" | "needsSetup" | "disabled" | "plugins";
const openclawCatalogFilter = ref<OpenClawCatalogFilter>("all");
const selectedOpenclawSkillName = ref<string | null>(null);
const selectedOpenclawPluginId = ref<string | null>(null);
const openclawPluginInspectLoading = ref(false);
const openclawPluginInspectError = ref<string | null>(null);
const openclawPluginInspect = ref<OpenClawPluginInspectResult | null>(null);
const openclawPluginToggleBusyId = ref<string | null>(null);
const openclawPluginActionBusyId = ref<string | null>(null);
const openclawSkillMissingMap = ref<
  Record<
    string,
    {
      missing?: {
        bins?: string[];
        anyBins?: string[];
        env?: string[];
        config?: string[];
        os?: string[];
      };
      install?: Array<{ id?: string; kind?: string; label?: string; bins?: string[] }>;
    }
  >
>({});
const openclawSummary = ref<{
  total: number;
  eligible: number;
  disabled: number;
  blocked: number;
  missingRequirements: number;
} | null>(null);

const localSlug = ref("");
const localBusy = ref(false);
const localMessage = ref<string | null>(null);
const localMessageKind = ref<MessageKind>("info");
const localPluginSpec = ref("");
const localPluginBusy = ref(false);
const clawhubToken = ref("");
const clawhubRegistry = ref("");
const showClawhubToken = ref(false);

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

function normText(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

function sortSkills(rows: OpenClawSkillItem[]): OpenClawSkillItem[] {
  return [...rows].sort((a, b) => {
    if (a.eligible !== b.eligible) {
      return a.eligible ? -1 : 1;
    }
    if ((a.bundled ?? false) !== (b.bundled ?? false)) {
      return a.bundled ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

function sortPlugins(rows: OpenClawPluginItem[]): OpenClawPluginItem[] {
  return [...rows].sort((a, b) => {
    if ((a.enabled ?? false) !== (b.enabled ?? false)) {
      return a.enabled ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
  });
}

function skillSourceLabel(skill: OpenClawSkillItem): string {
  if (skill.bundled) {
    return "内置";
  }
  const source = skill.source?.trim();
  if (source === "openclaw-extra") {
    return "扩展";
  }
  if (source === "workspace") {
    return "工作区";
  }
  if (source === "managed") {
    return "本机目录";
  }
  return source || "外部";
}

function pluginOriginLabel(plugin: OpenClawPluginItem): string {
  const origin = plugin.origin?.trim();
  if (origin === "bundled") {
    return "内置";
  }
  if (origin === "workspace") {
    return "工作区";
  }
  if (origin === "global") {
    return "全局";
  }
  if (origin === "linked") {
    return "链接";
  }
  return origin || "外部";
}

function skillStatusLabel(skill: OpenClawSkillItem): string {
  if (skill.disabled) {
    return "已禁用";
  }
  if (skill.blockedByAllowlist) {
    return "被拦截";
  }
  return skill.eligible ? "可用" : "需配置";
}

function pluginStatusLabel(plugin: OpenClawPluginItem): string {
  return plugin.status?.trim() || (plugin.enabled ? "enabled" : "disabled");
}

function formatMissingRequirements(
  missing:
    | {
        bins?: string[];
        anyBins?: string[];
        env?: string[];
        config?: string[];
        os?: string[];
      }
    | null
    | undefined,
): string {
  if (!missing) {
    return "";
  }
  const parts: string[] = [];
  if (missing.bins?.length) {
    parts.push(`缺少命令: ${missing.bins.join(", ")}`);
  }
  if (missing.anyBins?.length) {
    parts.push(`缺少其一: ${missing.anyBins.join(" / ")}`);
  }
  if (missing.env?.length) {
    parts.push(`缺少环境变量: ${missing.env.join(", ")}`);
  }
  if (missing.config?.length) {
    parts.push(`缺少配置: ${missing.config.join(", ")}`);
  }
  if (missing.os?.length) {
    parts.push(`系统限制: ${missing.os.join(", ")}`);
  }
  return parts.join(" | ");
}

function pluginCapabilities(plugin: OpenClawPluginItem): string[] {
  const caps: string[] = [];
  if (plugin.channelIds?.length) {
    caps.push(`渠道 ${plugin.channelIds.length}`);
  }
  if (plugin.providerIds?.length) {
    caps.push(`模型 ${plugin.providerIds.length}`);
  }
  if (plugin.toolNames?.length) {
    caps.push(`工具 ${plugin.toolNames.length}`);
  }
  if (plugin.commands?.length) {
    caps.push(`命令 ${plugin.commands.length}`);
  }
  if (plugin.format?.trim()) {
    caps.push(plugin.format.trim());
  }
  return caps;
}

function pluginDiagnosticsCount(detail: OpenClawPluginInspectResult | null): number {
  return Array.isArray(detail?.diagnostics) ? detail!.diagnostics!.length : 0;
}

function pluginInspectCount(arr: Array<Record<string, unknown>> | undefined | null): number {
  return Array.isArray(arr) ? arr.length : 0;
}

function skillInstallSuggestions(skill: OpenClawSkillItem): Array<{ id?: string; kind?: string; label?: string }> {
  return openclawSkillMissingMap.value[skill.name]?.install ?? [];
}

function skillSetupHint(skill: OpenClawSkillItem): string {
  const suggestions = skillInstallSuggestions(skill);
  if (suggestions.length > 0) {
    return suggestions
      .map((item) => item.label?.trim())
      .filter((v): v is string => Boolean(v))
      .join(" | ");
  }
  return formatMissingRequirements(openclawSkillMissingMap.value[skill.name]?.missing ?? skill.missing);
}

function currentClawhubAuth(): { token?: string; registry?: string } {
  const stored = getStoredClawhubClientOptions();
  const token = clawhubToken.value.trim() || stored.token;
  const registry = clawhubRegistry.value.trim() || stored.registry;
  return {
    token: token || undefined,
    registry: registry || undefined,
  };
}

function loadStoredClawhubAuth(): void {
  const stored = getStoredClawhubClientOptions();
  clawhubToken.value = stored.token?.trim() || "";
  clawhubRegistry.value = stored.registry?.trim() || "";
}

function saveClawhubAuth(): void {
  setStoredClawhubClientOptions({
    token: clawhubToken.value.trim() || undefined,
    registry: clawhubRegistry.value.trim() || undefined,
  });
  localMessage.value = "已保存 ClawHub 凭据。本机搜索、详情和安装会优先使用它。";
  localMessageKind.value = "success";
}

function clearClawhubAuth(): void {
  clawhubToken.value = "";
  clawhubRegistry.value = "";
  setStoredClawhubClientOptions({});
  localMessage.value = "已清除本机 ClawHub 凭据，将回退到匿名访问。";
  localMessageKind.value = "info";
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

async function loadOpenClawCatalog(force = false): Promise<void> {
  if (!isTauri()) {
    openclawSkills.value = [];
    openclawPlugins.value = [];
    return;
  }
  if (openclawLoading.value) {
    return;
  }
  if (openclawLoadedOnce.value && !force) {
    return;
  }
  openclawLoading.value = true;
  openclawError.value = null;
  try {
    const [skillsList, skillsCheck, pluginsList] = await Promise.all([
      openclawSkillsList(),
      openclawSkillsCheck(),
      openclawPluginsList(),
    ]);
    openclawWorkspaceDir.value = skillsList.workspaceDir ?? pluginsList.workspaceDir ?? null;
    openclawManagedSkillsDir.value = skillsList.managedSkillsDir ?? null;
    openclawSkills.value = sortSkills(skillsList.skills ?? []);
    openclawPlugins.value = sortPlugins(pluginsList.plugins ?? []);
    openclawSkillMissingMap.value = Object.fromEntries(
      (skillsCheck.missingRequirements ?? []).map((item) => [
        item.name,
        {
          missing: item.missing,
          install: item.install ?? [],
        },
      ]),
    );
    openclawSummary.value = {
      total: skillsCheck.summary?.total ?? skillsList.skills.length,
      eligible: skillsCheck.summary?.eligible ?? skillsList.skills.filter((s) => s.eligible).length,
      disabled: skillsCheck.summary?.disabled ?? skillsList.skills.filter((s) => s.disabled).length,
      blocked: skillsCheck.summary?.blocked ?? skillsList.skills.filter((s) => s.blockedByAllowlist).length,
      missingRequirements:
        skillsCheck.summary?.missingRequirements ??
        skillsList.skills.filter((s) => !s.eligible && !s.disabled).length,
    };
    if (!selectedOpenclawSkillName.value && openclawSkills.value.length) {
      selectedOpenclawSkillName.value = openclawSkills.value[0].name;
    }
    if (!selectedOpenclawPluginId.value && openclawPlugins.value.length) {
      selectedOpenclawPluginId.value = openclawPlugins.value[0].id;
    }
    openclawLoadedOnce.value = true;
  } catch (e) {
    openclawError.value = e instanceof Error ? e.message : String(e);
  } finally {
    openclawLoading.value = false;
  }
}

async function inspectOpenClawPlugin(pluginId: string): Promise<void> {
  const id = pluginId.trim();
  if (!id) {
    return;
  }
  selectedOpenclawPluginId.value = id;
  openclawPluginInspectLoading.value = true;
  openclawPluginInspectError.value = null;
  try {
    openclawPluginInspect.value = await openclawPluginsInspect(id);
  } catch (e) {
    openclawPluginInspect.value = null;
    openclawPluginInspectError.value = e instanceof Error ? e.message : String(e);
  } finally {
    openclawPluginInspectLoading.value = false;
  }
}

async function toggleOpenClawPlugin(plugin: OpenClawPluginItem): Promise<void> {
  const id = plugin.id.trim();
  if (!id) {
    return;
  }
  const enable = !plugin.enabled;
  openclawPluginToggleBusyId.value = id;
  try {
    await openclawPluginsSetEnabled(id, enable);
    setInstallMessage(
      enable
        ? `已启用插件「${id}」。通常需要重启 Gateway 才会生效。`
        : `已禁用插件「${id}」。通常需要重启 Gateway 才会生效。`,
      "success",
    );
    await loadOpenClawCatalog(true);
    await inspectOpenClawPlugin(id);
  } catch (e) {
    setInstallMessage(e instanceof Error ? e.message : String(e), "error");
  } finally {
    openclawPluginToggleBusyId.value = null;
  }
}

async function updateOpenClawPlugin(plugin: OpenClawPluginItem): Promise<void> {
  const id = plugin.id.trim();
  if (!id) {
    return;
  }
  openclawPluginActionBusyId.value = id;
  try {
    const result = await openclawPluginsUpdate(id);
    setInstallMessage(result.stdout?.trim() || `已执行插件「${id}」更新检查。`, "success");
    await loadOpenClawCatalog(true);
    await inspectOpenClawPlugin(id);
  } catch (e) {
    setInstallMessage(e instanceof Error ? e.message : String(e), "error");
  } finally {
    openclawPluginActionBusyId.value = null;
  }
}

async function uninstallOpenClawPlugin(plugin: OpenClawPluginItem): Promise<void> {
  const id = plugin.id.trim();
  if (!id) {
    return;
  }
  if (!window.confirm(`确定卸载插件「${id}」？这会移除插件并可能保留或清理相关配置。`)) {
    return;
  }
  openclawPluginActionBusyId.value = id;
  try {
    const result = await openclawPluginsUninstall(id);
    setInstallMessage(result.stdout?.trim() || `已卸载插件「${id}」。`, "success");
    openclawPluginInspect.value = null;
    openclawPluginInspectError.value = null;
    selectedOpenclawPluginId.value = null;
    await loadOpenClawCatalog(true);
  } catch (e) {
    setInstallMessage(e instanceof Error ? e.message : String(e), "error");
  } finally {
    openclawPluginActionBusyId.value = null;
  }
}

async function jumpToClawHubSearch(query: string): Promise<void> {
  const q = query.trim();
  if (!q) {
    return;
  }
  subTab.value = "browse";
  searchQuery.value = q;
  await onSearch();
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
    const auth = currentClawhubAuth();
    if (!isTauri()) {
      const r = await clawhubPackagesSearch(q, { limit: 30, ...auth });
      searchHits.value = r.results ?? [];
      return;
    }
    const [skillsSettled, packagesSettled] = await Promise.allSettled([
      openclawSkillsSearch(q, { limit: 20, ...auth }),
      clawhubPackagesSearch(q, { limit: 30, ...auth }),
    ]);
    if (skillsSettled.status !== "fulfilled" && packagesSettled.status !== "fulfilled") {
      throw skillsSettled.reason ?? packagesSettled.reason;
    }
    const skillsResult = skillsSettled.status === "fulfilled" ? skillsSettled.value : { results: [] };
    const packagesResult =
      packagesSettled.status === "fulfilled" ? packagesSettled.value : { results: [] as ClawhubCatalogHit[] };
    const skillHits: ClawhubCatalogHit[] = (skillsResult.results ?? []).map((item) => ({
      score: item.score ?? 0,
      slug: item.slug,
      displayName: item.displayName,
      summary: item.summary,
      version: item.version,
      updatedAt: item.updatedAt ?? null,
      family: "skill",
    }));
    const pluginHits = (packagesResult.results ?? []).filter(
      (item) => item.family === "code-plugin" || item.family === "bundle-plugin",
    );
    searchHits.value = sortCatalogHits([...skillHits, ...pluginHits]);
    if (!skillHits.length && packagesSettled.status !== "fulfilled") {
      searchError.value = "ClawHub 插件目录暂不可用，当前仅支持本机 OpenClaw 技能搜索。";
    }
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
    const auth = currentClawhubAuth();
    if (isPlugin) {
      hubPkgDetail.value = await clawhubPackageDetail(slug, auth);
    } else {
      hubDetail.value = await clawhubSkillDetail(slug, auth);
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

function sortCatalogHits(rows: ClawhubCatalogHit[]): ClawhubCatalogHit[] {
  return [...rows].sort((a, b) => {
    const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    const updatedDiff = (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    if (updatedDiff !== 0) {
      return updatedDiff;
    }
    return (a.displayName ?? a.slug).localeCompare(b.displayName ?? b.slug);
  });
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
    const auth = currentClawhubAuth();
    const r = await api.openclawPluginsInstall({
      packageSpec: pluginPackageSpec(s),
      clawhubToken: auth.token,
      clawhubRegistry: auth.registry,
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

/** 从搜索结果安装：skill → openclaw skills install；plugin → openclaw plugins install */
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
    setInstallMessage("通过 OpenClaw 安装技能需要桌面版。", "info");
    return;
  }
  await installOpenClawSkill(slug);
}

async function installOpenClawSkill(
  slug: string,
  version?: string,
  options?: { manageBusy?: boolean },
): Promise<void> {
  const manageBusy = options?.manageBusy !== false;
  if (!isTauri()) {
    setInstallMessage("通过 OpenClaw 安装技能需要桌面版。", "info");
    return;
  }
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
    const result = await openclawSkillsInstall(slug, version, currentClawhubAuth());
    setInstallMessage(
      truncateInstallFeedback(
        result.stdout?.trim() || `已将「${slug}」安装到 OpenClaw 当前 workspace。新会话通常会加载技能。`,
      ),
      "success",
    );
    await loadOpenClawCatalog(true);
  } catch (e) {
    setInstallMessage(e instanceof Error ? e.message : String(e), "error");
  } finally {
    if (manageBusy) {
      installBusy.value = false;
      installingSlug.value = null;
    }
  }
}

async function installClawhubSkillToLocalRoot(
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
    if (!skipSuspiciousCheck) {
      let meta: Awaited<ReturnType<typeof clawhubSkillDetail>> | null = null;
      try {
        meta = await clawhubSkillDetail(slug, currentClawhubAuth());
      } catch {
        /* ignore */
      }
      if (meta?.moderation?.isMalwareBlocked) {
        setInstallMessage(`「${slug}」已被标记为恶意，无法安装。`, "error");
        return;
      }
      if (meta?.moderation?.isSuspicious) {
        const ok = window.confirm(`「${slug}」被标记为可疑技能，可能包含风险模式。确定仍要安装吗？`);
        if (!ok) {
          setInstallMessage("已取消安装。", "info");
          return;
        }
      }
    }
    const buf = await clawhubDownloadSkillZip(slug, { version, ...currentClawhubAuth() });
    const b64 = arrayBufferToBase64(buf);
    const auth = currentClawhubAuth();
    const origin = {
      version: 1,
      registry: auth.registry || clawhubDefaultRegistry(),
      slug,
      installedVersion: version,
      installedAt: Date.now(),
    };
    const r = await skillsInstallZipBase64(root, slug, b64, origin);
    if (!r.ok) {
      setInstallMessage("安装失败。", "error");
      return;
    }
    setInstallMessage(`已安装「${slug}」@${version} 到本机 skills 目录。`, "success");
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

async function updateOpenClawSkill(skillName: string): Promise<void> {
  const name = skillName.trim();
  if (!name) {
    return;
  }
  if (installBusy.value) {
    setInstallMessage("正在处理其他技能操作，请稍后再试。", "info");
    return;
  }
  installBusy.value = true;
  openclawSkillActionBusyName.value = name;
  installingSlug.value = name;
  installMessage.value = null;
  try {
    const result = await openclawSkillsUpdate(name, currentClawhubAuth());
    setInstallMessage(
      truncateInstallFeedback(result.stdout?.trim() || `已检查并更新技能「${name}」。`),
      "success",
    );
    await loadOpenClawCatalog(true);
  } catch (e) {
    setInstallMessage(e instanceof Error ? e.message : String(e), "error");
  } finally {
    installBusy.value = false;
    openclawSkillActionBusyName.value = null;
    installingSlug.value = null;
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
  const meta = await clawhubSkillDetail(row.slug, currentClawhubAuth()).catch(() => null);
  const ver = meta?.latestVersion?.version;
  if (!ver) {
    setInstallMessage("无法获取远端最新版本。", "error");
    return;
  }
  if (row.installedVersion && row.installedVersion === ver) {
    setInstallMessage(`「${row.slug}」已是最新版本 ${ver}。`, "info");
    return;
  }
  await installClawhubSkillToLocalRoot(row.slug, ver);
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

async function onPickPluginFolder(): Promise<void> {
  localMessage.value = null;
  const picked = await skillsPickFolder();
  if (!picked) {
    return;
  }
  localPluginSpec.value = picked;
}

async function onPickPluginPackage(): Promise<void> {
  localMessage.value = null;
  if (!isDidClawDesktop()) {
    localMessage.value = "请使用桌面版选择本机插件包。";
    localMessageKind.value = "info";
    return;
  }
  const api = getDidClawDesktopApi();
  const picked = await api?.openclawPluginsPickPackageFile?.();
  if (!picked) {
    return;
  }
  localPluginSpec.value = picked;
}

async function onInstallLocalPlugin(): Promise<void> {
  localMessage.value = null;
  const spec = localPluginSpec.value.trim();
  if (!spec) {
    localMessage.value = "请先填写或选择插件目录/归档路径。";
    localMessageKind.value = "error";
    return;
  }
  if (!isDidClawDesktop()) {
    localMessage.value = "安装本机插件需要桌面版。";
    localMessageKind.value = "info";
    return;
  }
  const api = getDidClawDesktopApi();
  if (!api?.openclawPluginsInstall) {
    localMessage.value = `当前桌面壳不支持插件安装，请在终端执行：openclaw plugins install ${spec}`;
    localMessageKind.value = "info";
    return;
  }
  localPluginBusy.value = true;
  try {
    const auth = currentClawhubAuth();
    const r = await api.openclawPluginsInstall({
      packageSpec: spec,
      clawhubToken: auth.token,
      clawhubRegistry: auth.registry,
    });
    if (r && typeof r === "object" && "ok" in r && r.ok === true) {
      localMessage.value = "本机插件安装完成。若 Gateway 已在运行，通常需要重启后才会加载新插件。";
      localMessageKind.value = "success";
      return;
    }
    localMessage.value =
      r && typeof r === "object" && "error" in r && typeof r.error === "string"
        ? truncateInstallFeedback(r.error)
        : "插件安装失败。";
    localMessageKind.value = "error";
  } catch (e) {
    localMessage.value = formatClawhubErr(e);
    localMessageKind.value = "error";
  } finally {
    localPluginBusy.value = false;
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
      loadStoredClawhubAuth();
      await syncInstallRoot();
      void loadInstalled();
      void loadOpenClawCatalog();
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
  if (t === "openclaw" && props.modelValue) {
    void loadOpenClawCatalog();
  }
});

watch(openclawCatalogFilter, (filter) => {
  if (filter === "plugins" && selectedOpenclawPluginId.value && !openclawPluginInspect.value) {
    void inspectOpenClawPlugin(selectedOpenclawPluginId.value);
  }
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  if (msgTimer !== null) clearTimeout(msgTimer);
});

const canInstallDetail = computed(() => {
  if (hubDetailKind.value !== "skill" || !isTauri()) {
    return false;
  }
  return hubDetail.value?.moderation?.isMalwareBlocked !== true;
});

const canOneClickPluginInstall = computed(() => {
  if (!isDidClawDesktop()) {
    return false;
  }
  const api = getDidClawDesktopApi();
  return typeof api?.openclawPluginsInstall === "function";
});

const canInstallPluginDetail = computed(() => {
  if (hubDetailKind.value !== "package") {
    return false;
  }
  const slug = hubSlug.value?.trim();
  if (!slug) {
    return false;
  }
  const f = normalizePkgFamily(hubPkgDetail.value?.package?.family ?? selectedSearchHit.value?.family);
  if (f !== "code-plugin" && f !== "bundle-plugin") {
    return false;
  }
  return canOneClickPluginInstall.value;
});

const normalizedOpenclawFilter = computed(() => normText(openclawFilter.value));

const searchedOpenclawSkills = computed(() => {
  const q = normalizedOpenclawFilter.value;
  if (!q) {
    return openclawSkills.value;
  }
  return openclawSkills.value.filter((skill) => {
    return [
      normText(skill.name),
      normText(skill.description ?? ""),
      normText(skill.source ?? ""),
      normText(skillSourceLabel(skill)),
      normText(skillStatusLabel(skill)),
    ].some((v) => v.includes(q));
  });
});

const searchedOpenclawPlugins = computed(() => {
  const q = normalizedOpenclawFilter.value;
  if (!q) {
    return openclawPlugins.value;
  }
  return openclawPlugins.value.filter((plugin) => {
    return [
      normText(plugin.id),
      normText(plugin.name ?? ""),
      normText(plugin.description ?? ""),
      normText(plugin.origin ?? ""),
      normText(plugin.status ?? ""),
    ].some((v) => v.includes(q));
  });
});

const readyOpenclawSkillCount = computed(
  () => searchedOpenclawSkills.value.filter((skill) => skill.eligible && !skill.disabled).length,
);

const needsSetupOpenclawSkillCount = computed(
  () =>
    searchedOpenclawSkills.value.filter(
      (skill) => !skill.eligible && !skill.disabled && !skill.blockedByAllowlist,
    ).length,
);

const disabledOpenclawSkillCount = computed(
  () => searchedOpenclawSkills.value.filter((skill) => skill.disabled).length,
);

const displayedOpenclawSkills = computed(() => {
  switch (openclawCatalogFilter.value) {
    case "ready":
      return searchedOpenclawSkills.value.filter((skill) => skill.eligible && !skill.disabled);
    case "needsSetup":
      return searchedOpenclawSkills.value.filter(
        (skill) => !skill.eligible && !skill.disabled && !skill.blockedByAllowlist,
      );
    case "disabled":
      return searchedOpenclawSkills.value.filter((skill) => skill.disabled);
    case "plugins":
      return [];
    default:
      return searchedOpenclawSkills.value;
  }
});

const bundledOpenclawSkills = computed(() =>
  displayedOpenclawSkills.value.filter((skill) => skill.bundled),
);

const extraOpenclawSkills = computed(() =>
  displayedOpenclawSkills.value.filter((skill) => !skill.bundled),
);

const showPluginsCatalog = computed(() => openclawCatalogFilter.value === "plugins");

const selectedSearchHit = computed(() => {
  const slug = hubSlug.value;
  if (!slug) {
    return null;
  }
  return searchHits.value.find((item) => item.slug === slug) ?? null;
});

const selectedOpenclawSkill = computed(() => {
  const name = selectedOpenclawSkillName.value;
  if (!name) {
    return null;
  }
  return openclawSkills.value.find((skill) => skill.name === name) ?? null;
});

const selectedOpenclawPlugin = computed(() => {
  const id = selectedOpenclawPluginId.value;
  if (!id) {
    return null;
  }
  return openclawPlugins.value.find((plugin) => plugin.id === id) ?? null;
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
            在 <strong>ClawHub</strong> 搜索并安装技能或插件；市场技能与插件都通过 OpenClaw CLI 处理，本机 ZIP/文件夹导入仍写入下方自定义 <code>skills</code> 目录。
          </p>

          <div v-if="isTauri()" class="skills-root-row">
            <label class="skills-root-label">本机导入 Skills 目录</label>
            <input
              v-model="installRoot"
              type="text"
              class="skills-root-input"
              spellcheck="false"
              @blur="onInstallRootBlur"
            >
          </div>
          <p v-if="isTauri()" class="muted small skills-root-note">
            这里仅用于“本机安装”页的 ZIP/文件夹导入。OpenClaw 2026.03.24 起，市场技能建议通过 <code>openclaw skills install</code> 安装到活动 workspace；共享 skills 目录仍推荐使用 <code>~/.openclaw/skills</code>。插件则由 OpenClaw CLI 安装到扩展目录或你配置的 <code>plugins.load.paths</code>。
          </p>
          <p v-else class="muted small skills-web-hint">
            当前为网页模式：可搜索 ClawHub；写入本机 skills 或安装插件需使用桌面版。
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
              :class="{ active: subTab === 'openclaw' }"
              :aria-selected="subTab === 'openclaw'"
              @click="subTab = 'openclaw'"
            >
              OpenClaw
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
              输入关键词或点击「快捷搜索」；桌面版会用 OpenClaw CLI 搜索技能，并补充显示匿名 ClawHub 插件结果。技能安装到当前 OpenClaw workspace，插件走 OpenClaw CLI。
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
            <template v-else-if="hubDetailKind === 'skill'">
              <p v-if="detailError" class="muted small">{{ detailError }}</p>
              <p class="detail-summary">{{ hubDetail?.skill?.summary ?? selectedSearchHit?.summary ?? "—" }}</p>
              <p v-if="hubDetail?.latestVersion" class="small muted">
                最新版本：{{ hubDetail.latestVersion.version }}
              </p>
              <p v-if="hubDetail?.moderation?.isMalwareBlocked" class="err small">该技能已被标记为恶意，无法安装。</p>
              <p v-else-if="hubDetail?.moderation?.isSuspicious" class="err small">
                该技能被标记为可疑，请自行审阅后再安装。
              </p>
              <button
                v-if="canInstallDetail"
                type="button"
                class="lc-btn lc-btn-sm skills-install-btn"
                :disabled="installBusy"
                @click="installOpenClawSkill(hubSlug, hubDetail?.latestVersion?.version)"
              >
                {{ installBusy && installingSlug === hubSlug ? "安装中…" : "安装到 OpenClaw" }}
              </button>
            </template>
            <template v-else-if="hubDetailKind === 'package'">
              <p v-if="detailError" class="muted small">{{ detailError }}</p>
              <p v-if="hubPkgDetail?.package?.family || selectedSearchHit?.family" class="small muted">
                类型：{{ familyLabel(normalizePkgFamily(hubPkgDetail?.package?.family ?? selectedSearchHit?.family)) }}
              </p>
              <p class="detail-summary">{{ hubPkgDetail?.package?.summary ?? selectedSearchHit?.summary ?? "—" }}</p>
              <p v-if="hubPkgDetail?.package?.latestVersion" class="small muted">
                最新版本：{{ hubPkgDetail.package.latestVersion }}
              </p>
              <p v-if="hubPkgDetail?.package?.channel" class="small muted">通道：{{ hubPkgDetail.package.channel }}</p>
              <p v-if="hubPkgDetail?.package?.ownerHandle" class="small muted">发布者：@{{ hubPkgDetail.package.ownerHandle }}</p>
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
            <p v-else-if="detailError" class="err small">{{ detailError }}</p>
          </div>
            </div>

            <!-- OpenClaw -->
            <div v-show="subTab === 'openclaw'" class="skills-body" role="tabpanel">
              <p v-if="!isTauri()" class="muted small">桌面版才可读取本机 OpenClaw 的 skills / plugins 发现结果。</p>
              <template v-else>
                <div class="row-actions openclaw-toolbar">
                  <input
                    v-model="openclawFilter"
                    type="search"
                    class="skills-search"
                    placeholder="筛选内置技能和插件…"
                  >
                  <button
                    type="button"
                    class="lc-btn lc-btn-ghost lc-btn-sm"
                    :disabled="openclawLoading"
                    @click="loadOpenClawCatalog(true)"
                  >
                    {{ openclawLoading ? "扫描中…" : "刷新" }}
                  </button>
                </div>
                <div class="openclaw-filter-bar" role="group" aria-label="OpenClaw 筛选">
                  <button
                    type="button"
                    class="openclaw-filter-chip"
                    :class="{ active: openclawCatalogFilter === 'all' }"
                    @click="openclawCatalogFilter = 'all'"
                  >
                    全部 {{ searchedOpenclawSkills.length }}
                  </button>
                  <button
                    type="button"
                    class="openclaw-filter-chip"
                    :class="{ active: openclawCatalogFilter === 'ready' }"
                    @click="openclawCatalogFilter = 'ready'"
                  >
                    可用 {{ readyOpenclawSkillCount }}
                  </button>
                  <button
                    type="button"
                    class="openclaw-filter-chip"
                    :class="{ active: openclawCatalogFilter === 'needsSetup' }"
                    @click="openclawCatalogFilter = 'needsSetup'"
                  >
                    需配置 {{ needsSetupOpenclawSkillCount }}
                  </button>
                  <button
                    type="button"
                    class="openclaw-filter-chip"
                    :class="{ active: openclawCatalogFilter === 'disabled' }"
                    @click="openclawCatalogFilter = 'disabled'"
                  >
                    已禁用 {{ disabledOpenclawSkillCount }}
                  </button>
                  <button
                    type="button"
                    class="openclaw-filter-chip"
                    :class="{ active: openclawCatalogFilter === 'plugins' }"
                    @click="openclawCatalogFilter = 'plugins'"
                  >
                    插件 {{ searchedOpenclawPlugins.length }}
                  </button>
                </div>
                <p v-if="openclawWorkspaceDir || openclawManagedSkillsDir" class="muted small openclaw-paths">
                  <span v-if="openclawWorkspaceDir">workspace：<code>{{ openclawWorkspaceDir }}</code></span>
                  <span v-if="openclawManagedSkillsDir">managed skills：<code>{{ openclawManagedSkillsDir }}</code></span>
                </p>
                <p v-if="openclawError" class="err small">{{ openclawError }}</p>
                <p v-else-if="openclawLoading" class="muted small">正在从本机 OpenClaw 扫描 skills / plugins，这一步可能需要几十秒。</p>
                <template v-else>
                  <section v-if="!showPluginsCatalog" class="openclaw-section">
                    <div class="openclaw-section-head">
                      <h3>Skills</h3>
                      <span class="muted small">{{ displayedOpenclawSkills.length }}</span>
                    </div>
                    <p v-if="!displayedOpenclawSkills.length" class="muted small">没有匹配当前筛选条件的技能。</p>
                    <div v-if="bundledOpenclawSkills.length" class="openclaw-subsection">
                      <p class="openclaw-subtitle">内置 Skills</p>
                      <div class="openclaw-item-list">
                        <article v-for="skill in bundledOpenclawSkills" :key="`skill:${skill.name}`" class="openclaw-item">
                          <button
                            type="button"
                            class="openclaw-item-hitbox"
                            @click="selectedOpenclawSkillName = skill.name"
                          />
                          <div class="openclaw-item-head">
                            <div class="openclaw-item-title-row">
                              <span class="openclaw-item-title">{{ skill.emoji ? `${skill.emoji} ${skill.name}` : skill.name }}</span>
                              <span class="openclaw-pill">{{ skillStatusLabel(skill) }}</span>
                              <span class="openclaw-pill openclaw-pill--muted">{{ skillSourceLabel(skill) }}</span>
                            </div>
                            <a
                              v-if="skill.homepage"
                              :href="skill.homepage"
                              target="_blank"
                              rel="noopener noreferrer"
                              class="openclaw-link"
                            >主页</a>
                          </div>
                          <p class="openclaw-item-desc">{{ truncateSummary(skill.description, 260) }}</p>
                          <p v-if="!skill.eligible && skillSetupHint(skill)" class="muted small openclaw-setup-hint">
                            {{ skillSetupHint(skill) }}
                          </p>
                          <div
                            v-if="!skill.eligible && (skillInstallSuggestions(skill).length || skill.homepage)"
                            class="openclaw-inline-actions"
                          >
                            <button
                              v-if="skillInstallSuggestions(skill).length"
                              type="button"
                              class="lc-btn lc-btn-ghost lc-btn-xs"
                              @click.stop="selectedOpenclawSkillName = skill.name"
                            >
                              查看安装建议
                            </button>
                            <button
                              type="button"
                              class="lc-btn lc-btn-ghost lc-btn-xs"
                              @click.stop="jumpToClawHubSearch(skill.name)"
                            >
                              去 ClawHub 搜索
                            </button>
                          </div>
                        </article>
                      </div>
                    </div>
                    <div v-if="extraOpenclawSkills.length" class="openclaw-subsection">
                      <p class="openclaw-subtitle">扩展 / 工作区 Skills</p>
                      <div class="openclaw-item-list">
                        <article v-for="skill in extraOpenclawSkills" :key="`skill:${skill.name}`" class="openclaw-item">
                          <button
                            type="button"
                            class="openclaw-item-hitbox"
                            @click="selectedOpenclawSkillName = skill.name"
                          />
                          <div class="openclaw-item-head">
                            <div class="openclaw-item-title-row">
                              <span class="openclaw-item-title">{{ skill.emoji ? `${skill.emoji} ${skill.name}` : skill.name }}</span>
                              <span class="openclaw-pill">{{ skillStatusLabel(skill) }}</span>
                              <span class="openclaw-pill openclaw-pill--muted">{{ skillSourceLabel(skill) }}</span>
                            </div>
                            <a
                              v-if="skill.homepage"
                              :href="skill.homepage"
                              target="_blank"
                              rel="noopener noreferrer"
                              class="openclaw-link"
                            >主页</a>
                          </div>
                          <p class="openclaw-item-desc">{{ truncateSummary(skill.description, 260) }}</p>
                          <p v-if="!skill.eligible && skillSetupHint(skill)" class="muted small openclaw-setup-hint">
                            {{ skillSetupHint(skill) }}
                          </p>
                          <div
                            v-if="!skill.eligible && (skillInstallSuggestions(skill).length || skill.homepage)"
                            class="openclaw-inline-actions"
                          >
                            <button
                              v-if="skillInstallSuggestions(skill).length"
                              type="button"
                              class="lc-btn lc-btn-ghost lc-btn-xs"
                              @click.stop="selectedOpenclawSkillName = skill.name"
                            >
                              查看安装建议
                            </button>
                            <button
                              type="button"
                              class="lc-btn lc-btn-ghost lc-btn-xs"
                              @click.stop="jumpToClawHubSearch(skill.name)"
                            >
                              去 ClawHub 搜索
                            </button>
                          </div>
                        </article>
                      </div>
                    </div>
                  </section>

                  <section v-else class="openclaw-section">
                    <div class="openclaw-section-head">
                      <h3>Plugins</h3>
                      <span class="muted small">{{ searchedOpenclawPlugins.length }}</span>
                    </div>
                    <p v-if="!searchedOpenclawPlugins.length" class="muted small">没有匹配当前筛选条件的插件。</p>
                    <div class="openclaw-item-list">
                      <article v-for="plugin in searchedOpenclawPlugins" :key="`plugin:${plugin.id}`" class="openclaw-item">
                        <button
                          type="button"
                          class="openclaw-item-hitbox"
                          @click="inspectOpenClawPlugin(plugin.id)"
                        />
                        <div class="openclaw-item-head">
                          <div class="openclaw-item-title-row">
                            <span class="openclaw-item-title">{{ plugin.name?.trim() || plugin.id }}</span>
                            <span class="openclaw-pill">{{ pluginStatusLabel(plugin) }}</span>
                            <span class="openclaw-pill openclaw-pill--muted">{{ pluginOriginLabel(plugin) }}</span>
                          </div>
                          <div class="openclaw-item-actions">
                            <code class="hub-card-slug">{{ plugin.id }}</code>
                            <button
                              type="button"
                              class="lc-btn lc-btn-ghost lc-btn-xs"
                              :disabled="openclawPluginToggleBusyId === plugin.id || openclawPluginActionBusyId === plugin.id"
                              @click.stop="inspectOpenClawPlugin(plugin.id)"
                            >
                              查看
                            </button>
                            <button
                              type="button"
                              class="lc-btn lc-btn-ghost lc-btn-xs"
                              :disabled="openclawPluginToggleBusyId === plugin.id || openclawPluginActionBusyId === plugin.id"
                              @click.stop="toggleOpenClawPlugin(plugin)"
                            >
                              {{ openclawPluginToggleBusyId === plugin.id ? "处理中…" : plugin.enabled ? "禁用" : "启用" }}
                            </button>
                            <button
                              type="button"
                              class="lc-btn lc-btn-ghost lc-btn-xs"
                              :disabled="openclawPluginToggleBusyId === plugin.id || openclawPluginActionBusyId === plugin.id"
                              @click.stop="updateOpenClawPlugin(plugin)"
                            >
                              {{ openclawPluginActionBusyId === plugin.id ? "处理中…" : "更新" }}
                            </button>
                            <button
                              type="button"
                              class="lc-btn lc-btn-ghost lc-btn-xs btn-danger"
                              :disabled="openclawPluginToggleBusyId === plugin.id || openclawPluginActionBusyId === plugin.id"
                              @click.stop="uninstallOpenClawPlugin(plugin)"
                            >
                              {{ openclawPluginActionBusyId === plugin.id ? "处理中…" : "卸载" }}
                            </button>
                          </div>
                        </div>
                        <p class="openclaw-item-desc">{{ truncateSummary(plugin.description, 260) }}</p>
                        <div v-if="pluginCapabilities(plugin).length" class="openclaw-cap-list">
                          <span v-for="cap in pluginCapabilities(plugin)" :key="`${plugin.id}:${cap}`" class="openclaw-cap-chip">
                            {{ cap }}
                          </span>
                        </div>
                        <p v-if="plugin.error" class="muted small">{{ plugin.error }}</p>
                      </article>
                    </div>
                  </section>

                  <section v-if="!showPluginsCatalog && selectedOpenclawSkill" class="openclaw-section">
                    <div class="openclaw-section-head">
                      <h3>技能详情</h3>
                    </div>
                    <div class="detail-card">
                      <div class="openclaw-item-title-row">
                        <span class="openclaw-item-title">
                          {{ selectedOpenclawSkill.emoji ? `${selectedOpenclawSkill.emoji} ${selectedOpenclawSkill.name}` : selectedOpenclawSkill.name }}
                        </span>
                        <span class="openclaw-pill">{{ skillStatusLabel(selectedOpenclawSkill) }}</span>
                        <span class="openclaw-pill openclaw-pill--muted">{{ skillSourceLabel(selectedOpenclawSkill) }}</span>
                      </div>
                      <p class="detail-summary">{{ selectedOpenclawSkill.description ?? "—" }}</p>
                      <p v-if="skillSetupHint(selectedOpenclawSkill)" class="muted small">
                        {{ skillSetupHint(selectedOpenclawSkill) }}
                      </p>
                      <div v-if="skillInstallSuggestions(selectedOpenclawSkill).length" class="openclaw-suggestion-list">
                        <div
                          v-for="item in skillInstallSuggestions(selectedOpenclawSkill)"
                          :key="`${selectedOpenclawSkill.name}:${item.id ?? item.label ?? item.kind}`"
                          class="openclaw-suggestion-item"
                        >
                          <span class="openclaw-cap-chip">{{ item.kind || "install" }}</span>
                          <span>{{ item.label || item.id || "查看技能安装要求" }}</span>
                        </div>
                      </div>
                      <div class="openclaw-detail-actions">
                        <button
                          v-if="!selectedOpenclawSkill.bundled"
                          type="button"
                          class="lc-btn lc-btn-ghost lc-btn-sm"
                          :disabled="installBusy"
                          @click="updateOpenClawSkill(selectedOpenclawSkill.name)"
                        >
                          {{ openclawSkillActionBusyName === selectedOpenclawSkill.name ? "处理中…" : "通过 OpenClaw 更新" }}
                        </button>
                        <button
                          type="button"
                          class="lc-btn lc-btn-ghost lc-btn-sm"
                          @click="jumpToClawHubSearch(selectedOpenclawSkill.name)"
                        >
                          去 ClawHub 搜索
                        </button>
                        <a
                          v-if="selectedOpenclawSkill.homepage"
                          :href="selectedOpenclawSkill.homepage"
                          target="_blank"
                          rel="noopener noreferrer"
                          class="lc-btn lc-btn-ghost lc-btn-sm openclaw-detail-link"
                        >
                          查看主页
                        </a>
                      </div>
                    </div>
                  </section>

                  <section v-if="showPluginsCatalog" class="openclaw-section">
                    <div class="openclaw-section-head">
                      <h3>插件详情</h3>
                    </div>
                    <div class="detail-card">
                      <p v-if="openclawPluginInspectLoading" class="muted small">加载中…</p>
                      <p v-else-if="openclawPluginInspectError" class="err small">{{ openclawPluginInspectError }}</p>
                      <template v-else-if="selectedOpenclawPlugin">
                        <div class="openclaw-item-title-row">
                          <span class="openclaw-item-title">{{ selectedOpenclawPlugin.name?.trim() || selectedOpenclawPlugin.id }}</span>
                          <span class="openclaw-pill">{{ pluginStatusLabel(selectedOpenclawPlugin) }}</span>
                          <span class="openclaw-pill openclaw-pill--muted">{{ pluginOriginLabel(selectedOpenclawPlugin) }}</span>
                        </div>
                        <p class="detail-summary">{{ selectedOpenclawPlugin.description ?? "—" }}</p>
                        <p class="muted small">ID：<code>{{ selectedOpenclawPlugin.id }}</code></p>
                        <p v-if="openclawPluginInspect?.plugin?.rootDir" class="muted small">
                          目录：<code>{{ openclawPluginInspect.plugin.rootDir }}</code>
                        </p>
                        <div v-if="pluginCapabilities(selectedOpenclawPlugin).length" class="openclaw-cap-list">
                          <span
                            v-for="cap in pluginCapabilities(selectedOpenclawPlugin)"
                            :key="`${selectedOpenclawPlugin.id}:detail:${cap}`"
                            class="openclaw-cap-chip"
                          >
                            {{ cap }}
                          </span>
                        </div>
                        <p class="muted small">
                          capability mode：{{ openclawPluginInspect?.capabilityMode ?? "—" }}，
                          capability count：{{ openclawPluginInspect?.capabilityCount ?? 0 }}，
                          diagnostics：{{ pluginDiagnosticsCount(openclawPluginInspect) }}
                        </p>
                        <div class="openclaw-suggestion-list">
                          <div v-if="pluginInspectCount(openclawPluginInspect?.tools)" class="openclaw-suggestion-item">
                            <span class="openclaw-cap-chip">tools</span>
                            <span>{{ pluginInspectCount(openclawPluginInspect?.tools) }} 个</span>
                          </div>
                          <div v-if="pluginInspectCount(openclawPluginInspect?.commands)" class="openclaw-suggestion-item">
                            <span class="openclaw-cap-chip">commands</span>
                            <span>{{ pluginInspectCount(openclawPluginInspect?.commands) }} 个</span>
                          </div>
                          <div v-if="pluginInspectCount(openclawPluginInspect?.services)" class="openclaw-suggestion-item">
                            <span class="openclaw-cap-chip">services</span>
                            <span>{{ pluginInspectCount(openclawPluginInspect?.services) }} 个</span>
                          </div>
                          <div v-if="pluginInspectCount(openclawPluginInspect?.gatewayMethods)" class="openclaw-suggestion-item">
                            <span class="openclaw-cap-chip">gateway</span>
                            <span>{{ pluginInspectCount(openclawPluginInspect?.gatewayMethods) }} 个方法</span>
                          </div>
                          <div v-if="pluginInspectCount(openclawPluginInspect?.mcpServers)" class="openclaw-suggestion-item">
                            <span class="openclaw-cap-chip">mcp</span>
                            <span>{{ pluginInspectCount(openclawPluginInspect?.mcpServers) }} 个 server</span>
                          </div>
                          <div v-if="pluginInspectCount(openclawPluginInspect?.compatibility)" class="openclaw-suggestion-item">
                            <span class="openclaw-cap-chip">compat</span>
                            <span>{{ pluginInspectCount(openclawPluginInspect?.compatibility) }} 项兼容性说明</span>
                          </div>
                        </div>
                        <div
                          v-if="openclawPluginInspect?.plugin?.configUiHints && Object.keys(openclawPluginInspect.plugin.configUiHints).length"
                          class="openclaw-inspect-block"
                        >
                          <p class="openclaw-subtitle">配置项提示</p>
                          <div class="openclaw-suggestion-list">
                            <div
                              v-for="(hint, key) in openclawPluginInspect.plugin.configUiHints"
                              :key="`hint:${key}`"
                              class="openclaw-suggestion-item"
                            >
                              <span class="openclaw-cap-chip">{{ key }}</span>
                              <span>{{ hint.label || hint.help || (hint.advanced ? "高级配置项" : "配置项") }}</span>
                            </div>
                          </div>
                        </div>
                        <div
                          v-if="openclawPluginInspect?.diagnostics?.length"
                          class="openclaw-inspect-block"
                        >
                          <p class="openclaw-subtitle">诊断信息</p>
                          <div class="openclaw-suggestion-list">
                            <div
                              v-for="(diagnostic, index) in openclawPluginInspect.diagnostics"
                              :key="`diag:${index}`"
                              class="openclaw-suggestion-item"
                            >
                              <span class="openclaw-cap-chip">{{ String(diagnostic.level ?? diagnostic.severity ?? "info") }}</span>
                              <span>{{ String(diagnostic.message ?? diagnostic.code ?? "无详细说明") }}</span>
                            </div>
                          </div>
                        </div>
                        <div class="openclaw-detail-actions">
                          <button
                            type="button"
                            class="lc-btn lc-btn-ghost lc-btn-sm"
                            :disabled="openclawPluginToggleBusyId === selectedOpenclawPlugin.id || openclawPluginActionBusyId === selectedOpenclawPlugin.id"
                            @click="toggleOpenClawPlugin(selectedOpenclawPlugin)"
                          >
                            {{ openclawPluginToggleBusyId === selectedOpenclawPlugin.id ? "处理中…" : selectedOpenclawPlugin.enabled ? "禁用插件" : "启用插件" }}
                          </button>
                          <button
                            type="button"
                            class="lc-btn lc-btn-ghost lc-btn-sm"
                            :disabled="openclawPluginToggleBusyId === selectedOpenclawPlugin.id || openclawPluginActionBusyId === selectedOpenclawPlugin.id"
                            @click="updateOpenClawPlugin(selectedOpenclawPlugin)"
                          >
                            {{ openclawPluginActionBusyId === selectedOpenclawPlugin.id ? "处理中…" : "更新插件" }}
                          </button>
                          <button
                            type="button"
                            class="lc-btn lc-btn-ghost lc-btn-sm btn-danger"
                            :disabled="openclawPluginToggleBusyId === selectedOpenclawPlugin.id || openclawPluginActionBusyId === selectedOpenclawPlugin.id"
                            @click="uninstallOpenClawPlugin(selectedOpenclawPlugin)"
                          >
                            {{ openclawPluginActionBusyId === selectedOpenclawPlugin.id ? "处理中…" : "卸载插件" }}
                          </button>
                        </div>
                      </template>
                      <p v-else class="muted small">选择一个插件查看详细信息。</p>
                    </div>
                  </section>
                </template>
              </template>
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
            <div class="local-plugin-card">
              <p class="muted small local-plugin-title">ClawHub 凭据（可选）</p>
              <label class="local-slug">
                <span class="muted small">Token（可留空；留空时走匿名访问或本机 `clawhub login`）</span>
                <div class="local-secret-row">
                  <input
                    v-model="clawhubToken"
                    :type="showClawhubToken ? 'text' : 'password'"
                    class="skills-root-input"
                    spellcheck="false"
                    autocomplete="off"
                    placeholder="clh_..."
                  >
                  <button type="button" class="lc-btn lc-btn-ghost lc-btn-sm" @click="showClawhubToken = !showClawhubToken">
                    {{ showClawhubToken ? "隐藏" : "显示" }}
                  </button>
                </div>
              </label>
              <label class="local-slug">
                <span class="muted small">Registry（可选）</span>
                <input
                  v-model="clawhubRegistry"
                  type="text"
                  class="skills-root-input"
                  spellcheck="false"
                  placeholder="https://clawhub.ai"
                >
              </label>
              <div class="local-actions">
                <button type="button" class="lc-btn lc-btn-sm" @click="saveClawhubAuth">
                  保存凭据
                </button>
                <button type="button" class="lc-btn lc-btn-ghost lc-btn-sm" @click="clearClawhubAuth">
                  清除凭据
                </button>
              </div>
              <p class="muted small">
                会保存在本机 DidClaw SQLite 中，供桌面端匿名 HTTP 请求和 `openclaw skills/plugins` CLI 调用复用。
              </p>
            </div>
            <label class="local-slug">
              <span class="muted small">目录名（slug，可选；不填则用文件名/文件夹名）</span>
              <input v-model="localSlug" type="text" class="skills-root-input" spellcheck="false">
            </label>
            <div class="local-actions">
              <button
                type="button"
                class="lc-btn lc-btn-ghost lc-btn-sm"
                :disabled="localBusy || localPluginBusy"
                @click="onPickZipInstall"
              >
                {{ localBusy ? "处理中…" : "选择 ZIP 安装" }}
              </button>
              <button
                type="button"
                class="lc-btn lc-btn-ghost lc-btn-sm"
                :disabled="localBusy || localPluginBusy"
                @click="onPickFolderInstall"
              >
                {{ localBusy ? "处理中…" : "选择文件夹安装" }}
              </button>
            </div>
            <div class="local-plugin-card">
              <p class="muted small local-plugin-title">本机插件安装（OpenClaw CLI）</p>
              <label class="local-slug">
                <span class="muted small">插件目录/归档路径（支持文件夹、`.tgz`、`.zip` 等）</span>
                <input
                  v-model="localPluginSpec"
                  type="text"
                  class="skills-root-input"
                  spellcheck="false"
                  placeholder="C:\path\to\my-plugin 或 C:\path\to\my-plugin.tgz"
                >
              </label>
              <div class="local-actions">
                <button
                  type="button"
                  class="lc-btn lc-btn-ghost lc-btn-sm"
                  :disabled="localBusy || localPluginBusy"
                  @click="onPickPluginFolder"
                >
                  {{ localPluginBusy ? "处理中…" : "选择插件目录" }}
                </button>
                <button
                  type="button"
                  class="lc-btn lc-btn-ghost lc-btn-sm"
                  :disabled="localBusy || localPluginBusy"
                  @click="onPickPluginPackage"
                >
                  {{ localPluginBusy ? "处理中…" : "选择插件包" }}
                </button>
                <button
                  type="button"
                  class="lc-btn lc-btn-sm"
                  :disabled="localBusy || localPluginBusy"
                  @click="onInstallLocalPlugin"
                >
                  {{ localPluginBusy ? "安装中…" : "安装本机插件" }}
                </button>
              </div>
              <p class="muted small">
                会调用 <code>openclaw plugins install &lt;path&gt;</code>；安装完成后通常需要重启 Gateway 才会加载。
              </p>
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
.skills-root-note {
  margin: 0 0 12px;
  line-height: 1.5;
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
.openclaw-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.openclaw-filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.openclaw-filter-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid var(--lc-border);
  border-radius: 999px;
  background: var(--lc-bg-raised);
  font-size: 12px;
  color: var(--lc-text-muted);
  cursor: pointer;
  font-family: inherit;
}
.openclaw-filter-chip:hover {
  color: var(--lc-text);
  border-color: var(--lc-border-strong);
  background: var(--lc-bg-elevated);
}
.openclaw-filter-chip.active {
  color: var(--lc-accent);
  border-color: var(--lc-accent);
  background: var(--lc-accent-soft);
}
.openclaw-paths {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0 0 12px;
}
.openclaw-section + .openclaw-section {
  margin-top: 18px;
}
.openclaw-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.openclaw-section-head h3 {
  margin: 0;
  font-size: 14px;
}
.openclaw-subsection + .openclaw-subsection {
  margin-top: 14px;
}
.openclaw-subtitle {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--lc-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.openclaw-item-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.openclaw-item {
  position: relative;
  padding: 12px;
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  background: var(--lc-bg-raised);
}
.openclaw-item-hitbox {
  position: absolute;
  inset: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: inherit;
}
.openclaw-item-hitbox:hover {
  background: color-mix(in srgb, var(--lc-accent-soft) 45%, transparent);
}
.openclaw-item-head {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.openclaw-item-title-row {
  position: relative;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.openclaw-item-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--lc-text);
}
.openclaw-item-desc {
  position: relative;
  z-index: 1;
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--lc-text-muted);
}
.openclaw-setup-hint {
  position: relative;
  z-index: 1;
  margin: 8px 0 0;
  line-height: 1.5;
}
.openclaw-item-actions {
  position: relative;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}
.openclaw-inline-actions {
  position: relative;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.openclaw-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  border: 1px solid var(--lc-border);
  background: var(--lc-accent-soft);
  color: var(--lc-text);
}
.openclaw-pill--muted {
  background: var(--lc-bg-elevated);
  color: var(--lc-text-muted);
}
.openclaw-link {
  font-size: 12px;
}
.openclaw-cap-list {
  position: relative;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.openclaw-cap-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border-radius: 999px;
  font-size: 11px;
  color: var(--lc-text-muted);
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-elevated);
}
.openclaw-detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.openclaw-detail-link {
  text-decoration: none;
}
.openclaw-suggestion-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}
.openclaw-suggestion-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--lc-text-muted);
}
.openclaw-inspect-block {
  margin-top: 12px;
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
.local-secret-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.local-secret-row .skills-root-input {
  flex: 1 1 auto;
}
.local-plugin-card {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--lc-border);
}
.local-plugin-title {
  margin: 0 0 10px;
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
