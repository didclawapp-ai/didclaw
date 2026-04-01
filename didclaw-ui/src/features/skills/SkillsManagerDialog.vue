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
import { openExternalUrl } from "@/lib/open-external";
import {
  arrayBufferToBase64,
  getStoredSkillsInstallRoot,
  openclawSkillsInfo,
  openclawPluginsInspect,
  openclawPluginsList,
  openclawPluginsSetEnabled,
  openclawPluginsUninstall,
  openclawSkillsInstall,
  openclawSkillsSearch,
  writeOpenClawSkillEnabled,
  openclawPluginsUpdate,
  openclawSkillsCheck,
  openclawSkillsList,
  openclawSkillsUninstall,
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
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

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

/** Currently active quick-search tag label (for active styling) */
const activeQuickTag = ref<string>("all");

/** Local library (shared install root) row selected for bottom sheet */
const selectedLocalRowSlug = ref<string | null>(null);
let marketSearchDebounceTimer: number | null = null;
const importDropActive = ref(false);

const installRoot = ref("");
const searchQuery = ref("");
const searchLoading = ref(false);
const searchHits = ref<ClawhubCatalogHit[]>([]);
const searchError = ref<string | null>(null);
const hubResultsRegionEl = ref<HTMLElement | null>(null);
const INITIAL_SEARCH_LIMITS = {
  skills: 20,
  packages: 30,
} as const;
const SEARCH_LIMIT_STEPS = {
  skills: 20,
  packages: 30,
} as const;
const skillSearchLimit = ref(INITIAL_SEARCH_LIMITS.skills);
const packageSearchLimit = ref(INITIAL_SEARCH_LIMITS.packages);
const lastSearchQuery = ref("");
const lastSkillResultCount = ref(0);
const lastPackageResultCount = ref(0);

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
const openclawSkillToggleBusyName = ref<string | null>(null);
const installMessage = ref<string | null>(null);
const installMessageAction = ref<{ label: string; url: string } | null>(null);
type MessageKind = "success" | "error" | "info";
const installMessageKind = ref<MessageKind>("info");

let msgTimer: number | null = null;
function setInstallMessage(
  msg: string,
  kind: MessageKind = "info",
  action?: { label: string; url: string } | null,
): void {
  installMessage.value = msg;
  installMessageAction.value = action ?? null;
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

function buildClawhubSkillPageUrl(slug: string, ownerHandle?: string | null): string {
  const base = (clawhubRegistry.value || clawhubDefaultRegistry()).trim().replace(/\/+$/, "");
  const cleanSlug = slug.trim().replace(/^\/+/, "");
  const cleanOwner = ownerHandle?.trim().replace(/^\/+|\/+$/g, "") || "";
  if (cleanOwner) {
    return `${base}/${cleanOwner}/${cleanSlug}`;
  }
  return `${base}/skills/${cleanSlug}`;
}

function isClawhubRateLimitMessage(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes("429")
    || lower.includes("rate limit")
    || lower.includes("download failed")
    || lower.includes("secondary rate limit");
}

async function openInstallMessageAction(): Promise<void> {
  const action = installMessageAction.value;
  if (!action?.url) {
    return;
  }
  await openExternalUrl(action.url);
}

async function resolveClawhubSkillPageUrl(slug: string): Promise<string> {
  const detailOwner =
    hubSlug.value === slug ? hubDetail.value?.owner?.handle?.trim() || null : null;
  if (detailOwner) {
    return buildClawhubSkillPageUrl(slug, detailOwner);
  }
  try {
    const detail = await clawhubSkillDetail(slug, currentClawhubAuth());
    return buildClawhubSkillPageUrl(slug, detail.owner?.handle);
  } catch {
    return buildClawhubSkillPageUrl(slug);
  }
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

async function toggleOpenClawSkill(skill: OpenClawSkillItem): Promise<void> {
  const name = skill.name.trim();
  if (!name) {
    return;
  }
  const enable = skill.disabled;
  openclawSkillToggleBusyName.value = name;
  try {
    const info = await openclawSkillsInfo(name);
    const skillKey = info.skillKey?.trim() || name;
    await writeOpenClawSkillEnabled(skillKey, enable);
    setInstallMessage(
      enable
        ? `已启用技能「${name}」。配置会在下次 agent 轮次生效。`
        : `已禁用技能「${name}」。配置会在下次 agent 轮次生效。`,
      "success",
    );
    await loadOpenClawCatalog(true);
  } catch (e) {
    setInstallMessage(e instanceof Error ? e.message : String(e), "error");
  } finally {
    openclawSkillToggleBusyName.value = null;
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
  await onSearch(true);
}

/** 快捷搜索：中英合并 query，适配 ClawHub 以英文技能为主的索引；按钮展示双语标签 */
const CLAWHUB_QUICK_SEARCH_ITEMS: ReadonlyArray<{ label: string; query: string }> = [
  { label: "搜索", query: "search 搜索" },
  { label: "代理", query: "proxy 代理 VPN" },
  { label: "代码", query: "code programming 代码" },
  { label: "免费", query: "free open source 免费" },
  { label: "文档", query: "documentation docs 文档" },
  { label: "邮件", query: "email mail 邮件" },
  { label: "日历", query: "calendar schedule 日历" },
  { label: "数据库", query: "database sql 数据库" },
  { label: "自动化", query: "automation workflow 自动化" },
  { label: "API 接口", query: "API REST HTTP 接口" },
  { label: "插件", query: "plugin" },
];

function resetSearchLimits(): void {
  skillSearchLimit.value = INITIAL_SEARCH_LIMITS.skills;
  packageSearchLimit.value = INITIAL_SEARCH_LIMITS.packages;
}

async function onSearch(resetLimits = false): Promise<void> {
  const q = searchQuery.value.trim();
  if (!q) {
    searchHits.value = [];
    hubSlug.value = null;
    hubDetailKind.value = null;
    hubDetail.value = null;
    hubPkgDetail.value = null;
    detailError.value = null;
    lastSearchQuery.value = "";
    lastSkillResultCount.value = 0;
    lastPackageResultCount.value = 0;
    resetSearchLimits();
    return;
  }
  if (resetLimits || q !== lastSearchQuery.value) {
    resetSearchLimits();
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
      const r = await clawhubPackagesSearch(q, { limit: packageSearchLimit.value, ...auth });
      const nextHits = r.results ?? [];
      searchHits.value = resetLimits || q !== lastSearchQuery.value
        ? nextHits
        : appendCatalogHits(searchHits.value, nextHits);
      lastPackageResultCount.value = nextHits.length;
      lastSkillResultCount.value = 0;
      lastSearchQuery.value = q;
      return;
    }
    const [skillsSettled, packagesSettled] = await Promise.allSettled([
      openclawSkillsSearch(q, { limit: skillSearchLimit.value, ...auth }),
      clawhubPackagesSearch(q, { limit: packageSearchLimit.value, ...auth }),
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
    const nextHits = sortCatalogHits([...skillHits, ...pluginHits]);
    searchHits.value = resetLimits || q !== lastSearchQuery.value
      ? nextHits
      : appendCatalogHits(searchHits.value, nextHits);
    lastSkillResultCount.value = skillHits.length;
    lastPackageResultCount.value = pluginHits.length;
    lastSearchQuery.value = q;
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

async function onQuickSearch(keyword: string, tagLabel?: string): Promise<void> {
  const k = keyword.trim();
  if (!k) {
    return;
  }
  if (marketSearchDebounceTimer !== null) {
    clearTimeout(marketSearchDebounceTimer);
    marketSearchDebounceTimer = null;
  }
  activeQuickTag.value = tagLabel ?? k;
  searchQuery.value = k;
  await onSearch(true);
}

async function onClearMarketSearch(): Promise<void> {
  if (marketSearchDebounceTimer !== null) {
    clearTimeout(marketSearchDebounceTimer);
    marketSearchDebounceTimer = null;
  }
  activeQuickTag.value = "all";
  searchQuery.value = "";
  await onSearch(true);
}

function onSearchSubmit(): void {
  void onSearch(true);
}

function onMarketSearchInput(): void {
  if (marketSearchDebounceTimer !== null) {
    clearTimeout(marketSearchDebounceTimer);
  }
  marketSearchDebounceTimer = window.setTimeout(() => {
    marketSearchDebounceTimer = null;
    void onSearch(true);
  }, 320);
}

function closeSkillsDetailPanel(): void {
  hubSlug.value = null;
  hubDetail.value = null;
  hubPkgDetail.value = null;
  hubDetailKind.value = null;
  detailError.value = null;
  selectedOpenclawSkillName.value = null;
  selectedOpenclawPluginId.value = null;
  openclawPluginInspect.value = null;
  openclawPluginInspectError.value = null;
  selectedLocalRowSlug.value = null;
}

const selectedLocalRow = computed(() => {
  const s = selectedLocalRowSlug.value?.trim();
  if (!s) {
    return null;
  }
  return installedRows.value.find((r) => r.slug === s) ?? null;
});

async function installZipFromFile(file: File): Promise<void> {
  if (!isTauri()) {
    return;
  }
  const name = file.name?.trim() ?? "";
  if (!name.toLowerCase().endsWith(".zip")) {
    localMessage.value = t("skills.dropZipOnly");
    localMessageKind.value = "error";
    return;
  }
  localMessage.value = null;
  const slug = localSlug.value.trim() || slugFromFileName(name);
  if (!slug) {
    localMessage.value = t("skills.slugRequired");
    localMessageKind.value = "error";
    return;
  }
  const root = await skillsResolveInstallRoot(installRoot.value.trim() || undefined);
  localBusy.value = true;
  try {
    const buf = await file.arrayBuffer();
    const b64 = arrayBufferToBase64(buf);
    const r = await skillsInstallZipBase64(root, slug, b64, {
      version: 1,
      registry: currentClawhubAuth().registry || clawhubDefaultRegistry(),
      slug,
      installedAt: Date.now(),
      source: "drop",
    });
    if (!r.ok) {
      localMessage.value = t("skills.installFailed");
      localMessageKind.value = "error";
      return;
    }
    setStoredSkillsInstallRoot(root);
    installRoot.value = root;
    localMessage.value = t("skills.zipInstalled", { slug });
    localMessageKind.value = "success";
    await loadInstalled();
  } catch (e) {
    localMessage.value = e instanceof Error ? e.message : String(e);
    localMessageKind.value = "error";
  } finally {
    localBusy.value = false;
  }
}

function onImportDragOver(ev: DragEvent): void {
  if (!isTauri() || subTab.value !== "local") {
    return;
  }
  ev.preventDefault();
  importDropActive.value = true;
}

function onImportDragLeave(): void {
  importDropActive.value = false;
}

function onImportDrop(ev: DragEvent): void {
  if (!isTauri() || subTab.value !== "local") {
    return;
  }
  ev.preventDefault();
  importDropActive.value = false;
  const f = ev.dataTransfer?.files?.[0];
  if (f) {
    void installZipFromFile(f);
  }
}

async function onMarketCardClick(h: ClawhubCatalogHit): Promise<void> {
  const isPluginHit = h.family === "code-plugin" || h.family === "bundle-plugin";
  const expectedKind = isPluginHit ? "package" : "skill";
  if (hubSlug.value === h.slug && hubDetailKind.value === expectedKind) {
    closeSkillsDetailPanel();
    return;
  }
  await selectHubSlug(h.slug, h.family);
}

function toggleOpenclawSkillSelection(name: string): void {
  const n = name.trim();
  if (selectedOpenclawSkillName.value === n) {
    selectedOpenclawSkillName.value = null;
    return;
  }
  selectedOpenclawSkillName.value = n;
}

async function toggleOpenclawPluginSelection(id: string): Promise<void> {
  const pid = id.trim();
  if (selectedOpenclawPluginId.value === pid) {
    selectedOpenclawPluginId.value = null;
    openclawPluginInspect.value = null;
    return;
  }
  await inspectOpenClawPlugin(pid);
}

function toggleLocalRowSelection(slug: string): void {
  const s = slug.trim();
  if (selectedLocalRowSlug.value === s) {
    selectedLocalRowSlug.value = null;
    return;
  }
  selectedLocalRowSlug.value = s;
}

const canLoadMoreSearchHits = computed(() => {
  if (searchLoading.value || !searchQuery.value.trim() || searchHits.value.length === 0) {
    return false;
  }
  if (!isTauri()) {
    return lastPackageResultCount.value >= packageSearchLimit.value;
  }
  return lastSkillResultCount.value >= skillSearchLimit.value
    || lastPackageResultCount.value >= packageSearchLimit.value;
});

async function loadMoreSearchHits(): Promise<void> {
  if (!canLoadMoreSearchHits.value) {
    return;
  }
  const seenKeys = new Set(searchHits.value.map(catalogHitKey));
  if (isTauri()) {
    skillSearchLimit.value += SEARCH_LIMIT_STEPS.skills;
  }
  packageSearchLimit.value += SEARCH_LIMIT_STEPS.packages;
  await onSearch(false);
  const firstNewHit = searchHits.value.find((item) => !seenKeys.has(catalogHitKey(item)));
  if (firstNewHit) {
    await scrollToCatalogHit(catalogHitKey(firstNewHit));
  }
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

function appendCatalogHits(
  existing: ClawhubCatalogHit[],
  incoming: ClawhubCatalogHit[],
): ClawhubCatalogHit[] {
  const seen = new Set(existing.map((item) => `${item.family}:${item.slug}`));
  const appended = incoming.filter((item) => {
    const key = `${item.family}:${item.slug}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  return appended.length ? [...existing, ...appended] : existing;
}

function catalogHitKey(hit: ClawhubCatalogHit): string {
  return `${hit.family}:${hit.slug}`;
}

async function scrollToCatalogHit(key: string): Promise<void> {
  await nextTick();
  const container = hubResultsRegionEl.value;
  if (!container) {
    return;
  }
  const escaped = key.replace(/["\\]/g, "\\$&");
  const target = container.querySelector<HTMLElement>(`[data-catalog-hit-key="${escaped}"]`);
  target?.scrollIntoView({ block: "start", behavior: "smooth" });
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
    const message = e instanceof Error ? e.message : String(e);
    if (isClawhubRateLimitMessage(message)) {
      const manualUrl = await resolveClawhubSkillPageUrl(slug);
      setInstallMessage(
        "ClawHub 当前下载链路已触发限流（429），通常与匿名 Git/GitHub 托管额度有关。请前往 ClawHub 页面手动下载 ZIP，随后可在“本机安装”页导入到共享 skills 目录。",
        "error",
        { label: "去 ClawHub 下载", url: manualUrl },
      );
      return;
    }
    setInstallMessage(message, "error");
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

async function uninstallOpenClawSkill(skillName: string): Promise<void> {
  const name = skillName.trim();
  if (!name) {
    return;
  }
  if (!window.confirm(`确定通过 OpenClaw 卸载技能「${name}」？这会把它从当前 OpenClaw 安装位置移除。`)) {
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
    const result = await openclawSkillsUninstall(name);
    setInstallMessage(
      truncateInstallFeedback(result.stdout?.trim() || `已通过 OpenClaw 卸载技能「${name}」。`),
      "success",
    );
    if (selectedOpenclawSkillName.value === name) {
      selectedOpenclawSkillName.value = null;
    }
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

/** Pick a plugin package file and immediately install it via CLI (silent). */
async function onPickAndInstallPlugin(): Promise<void> {
  localMessage.value = null;
  if (!isDidClawDesktop()) {
    localMessage.value = "安装本机插件需要桌面版。";
    localMessageKind.value = "info";
    return;
  }
  const api = getDidClawDesktopApi();
  const picked = await api?.openclawPluginsPickPackageFile?.();
  if (!picked) {
    return;
  }
  if (!api?.openclawPluginsInstall) {
    localMessage.value = `当前桌面壳不支持插件安装，请在终端执行：openclaw plugins install ${picked}`;
    localMessageKind.value = "info";
    return;
  }
  localPluginBusy.value = true;
  try {
    const auth = currentClawhubAuth();
    const r = await api.openclawPluginsInstall({
      packageSpec: picked,
      clawhubToken: auth.token,
      clawhubRegistry: auth.registry,
    });
    if (r && typeof r === "object" && "ok" in r && r.ok === true) {
      localMessage.value = "插件安装完成。若 Gateway 已在运行，通常需要重启后才会加载新插件。";
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
      closeSkillsDetailPanel();
      window.removeEventListener("keydown", onKeydown);
    }
  },
);

watch(subTab, (t) => {
  closeSkillsDetailPanel();
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
  if (marketSearchDebounceTimer !== null) clearTimeout(marketSearchDebounceTimer);
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


const showPluginsCatalog = computed(() => openclawCatalogFilter.value === "plugins");

const skillsDetailSheetOpen = computed(() => {
  if (subTab.value === "browse") {
    return Boolean(hubSlug.value?.trim());
  }
  if (subTab.value === "openclaw") {
    if (showPluginsCatalog.value) {
      return Boolean(selectedOpenclawPluginId.value?.trim());
    }
    return Boolean(selectedOpenclawSkillName.value?.trim());
  }
  if (subTab.value === "installed") {
    return Boolean(selectedLocalRowSlug.value?.trim());
  }
  return false;
});

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
        class="skills-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="skills-dialog-title"
        tabindex="-1"
      >
        <div class="skills-head">
          <div class="skills-head-text">
            <h2 id="skills-dialog-title">{{ t("skills.dialogTitle") }}</h2>
            <p class="skills-desc muted small">{{ t("skills.lead") }}</p>
          </div>
          <button
            type="button"
            class="skills-close-btn"
            :aria-label="t('common.close')"
            @click="open = false"
          >
            ✕
          </button>
        </div>

        <p v-if="!isTauri()" class="skills-web-banner muted small">{{ t("skills.webModeHint") }}</p>

        <div class="skills-panel-body">
          <nav class="skills-sidebar" role="tablist" :aria-label="t('skills.dialogTitle')">
            <button
              type="button"
              role="tab"
              class="skills-side-tab"
              :class="{ active: subTab === 'browse' }"
              :aria-selected="subTab === 'browse'"
              @click="subTab = 'browse'"
            >
              {{ t("skills.tabMarket") }}
            </button>
            <button
              type="button"
              role="tab"
              class="skills-side-tab"
              :class="{ active: subTab === 'openclaw' }"
              :aria-selected="subTab === 'openclaw'"
              @click="subTab = 'openclaw'"
            >
              {{ t("skills.tabInstalledOpenclaw") }}
              <span v-if="openclawSummary" class="skills-side-count">{{ openclawSummary.total }}</span>
            </button>
            <div class="skills-side-divider" role="presentation" />
            <button
              type="button"
              role="tab"
              class="skills-side-tab"
              :class="{ active: subTab === 'installed' }"
              :aria-selected="subTab === 'installed'"
              @click="subTab = 'installed'"
            >
              {{ t("skills.tabLocalLibrary") }}
            </button>
            <button
              type="button"
              role="tab"
              class="skills-side-tab"
              :class="{ active: subTab === 'local' }"
              :aria-selected="subTab === 'local'"
              @click="subTab = 'local'"
            >
              {{ t("skills.tabManualImport") }}
            </button>
          </nav>

          <div class="skills-main-column">
            <div
              v-if="installMessage"
              class="skills-toast"
              :class="`skills-toast--${installMessageKind}`"
              role="status"
            >
              <span>{{ installMessage }}</span>
              <button
                v-if="installMessageAction"
                type="button"
                class="lc-btn lc-btn-ghost lc-btn-xs skills-toast-action"
                @click="openInstallMessageAction"
              >
                {{ installMessageAction.label }}
              </button>
              <button
                type="button"
                class="skills-toast-close"
                :aria-label="t('skills.dismissToast')"
                @click="() => { installMessage = null; installMessageAction = null; }"
              >
                ✕
              </button>
            </div>

            <div class="skills-main-scroll">
              <!-- ClawHub -->
              <div v-show="subTab === 'browse'" class="skills-body skills-body--market" role="tabpanel">
                <div class="skills-search-row">
                  <div class="skills-search-wrap">
                    <span class="skills-search-icon" aria-hidden="true">🔍</span>
                    <input
                      v-model="searchQuery"
                      type="search"
                      class="skills-search-input"
                      :placeholder="t('skills.searchMarketPlaceholder')"
                      @input="onMarketSearchInput"
                      @keydown.enter="onSearchSubmit"
                    >
                  </div>
                  <div class="skills-view-toggle" role="group" :aria-label="t('skills.resultLayout')">
                    <button
                      type="button"
                      class="skills-view-btn"
                      :class="{ active: hubResultsView === 'cards' }"
                      :title="t('skills.viewCards')"
                      @click="hubResultsView = 'cards'"
                    >
                      ⊞
                    </button>
                    <button
                      type="button"
                      class="skills-view-btn"
                      :class="{ active: hubResultsView === 'list' }"
                      :title="t('skills.viewList')"
                      @click="hubResultsView = 'list'"
                    >
                      ☰
                    </button>
                  </div>
                </div>
                <div class="skills-tags-row" :aria-label="t('skills.quickTagsAria')">
                  <button
                    type="button"
                    class="skills-tag-pill"
                    :class="{ 'skills-tag-pill--active': activeQuickTag === 'all' }"
                    :disabled="searchLoading"
                    @click="onClearMarketSearch"
                  >
                    {{ t("skills.tagAll") }}
                  </button>
                  <button
                    v-for="item in CLAWHUB_QUICK_SEARCH_ITEMS"
                    :key="item.query"
                    type="button"
                    class="skills-tag-pill"
                    :class="{ 'skills-tag-pill--active': activeQuickTag === item.label }"
                    :disabled="searchLoading"
                    @click="onQuickSearch(item.query, item.label)"
                  >
                    {{ item.label }}
                  </button>
                </div>
                <p v-if="searchError" class="err small">{{ searchError }}</p>

                <div ref="hubResultsRegionEl" class="skills-market-results" aria-live="polite">
                  <p v-if="searchLoading" class="muted small skills-market-status">{{ t("skills.searching") }}</p>
                  <p v-else-if="!searchHits.length" class="muted small skills-market-empty">
                    {{ t("skills.marketEmptyHint") }}
                  </p>
                  <template v-else>
                    <div v-if="hubResultsView === 'cards'" class="skills-card-grid">
                      <article
                        v-for="h in searchHits"
                        :key="`${h.family}:${h.slug}`"
                        class="skills-market-card"
                        :class="{
                          'skills-market-card--active':
                            hubSlug === h.slug &&
                            hubDetailKind === (h.family === 'code-plugin' || h.family === 'bundle-plugin' ? 'package' : 'skill'),
                        }"
                        :data-catalog-hit-key="catalogHitKey(h)"
                        role="button"
                        tabindex="0"
                        @click="() => void onMarketCardClick(h)"
                        @keydown.enter.prevent="() => void onMarketCardClick(h)"
                      >
                        <div class="skills-market-card-top">
                          <div class="skills-market-card-icon" aria-hidden="true">
                            {{ h.family === "code-plugin" || h.family === "bundle-plugin" ? "📦" : "🔧" }}
                          </div>
                          <span
                            class="skills-market-badge"
                            :class="{
                              'skills-market-badge--plugin': h.family === 'code-plugin' || h.family === 'bundle-plugin',
                            }"
                          >{{ familyLabel(h.family) }}</span>
                        </div>
                        <div class="skills-market-card-name">{{ h.displayName?.trim() || h.slug }}</div>
                        <p class="skills-market-card-desc">{{ truncateSummary(h.summary, 120) }}</p>
                        <div class="skills-market-card-meta">
                          <code class="skills-market-card-slug">{{ h.slug }}</code>
                          <span v-if="h.version" class="dot" aria-hidden="true" />
                          <span v-if="h.version">{{ h.version }}</span>
                        </div>
                      </article>
                    </div>
                    <ul v-else class="hub-result-list" role="list">
                      <li
                        v-for="h in searchHits"
                        :key="`${h.family}:${h.slug}`"
                        class="hub-list-row"
                        :data-catalog-hit-key="catalogHitKey(h)"
                      >
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
                            {{ installBusy && installingSlug === h.slug ? t("skills.installing") : t("skills.install") }}
                          </button>
                          <button
                            type="button"
                            class="lc-btn lc-btn-ghost lc-btn-sm"
                            @click="() => void onMarketCardClick(h)"
                          >
                            {{ t("skills.detail") }}
                          </button>
                        </div>
                      </li>
                    </ul>
                    <div v-if="canLoadMoreSearchHits" class="hub-load-more">
                      <button
                        type="button"
                        class="lc-btn lc-btn-ghost lc-btn-sm"
                        :disabled="searchLoading"
                        @click="loadMoreSearchHits"
                      >
                        {{ searchLoading ? t("common.loading") : t("skills.loadMore") }}
                      </button>
                    </div>
                  </template>
                </div>
              </div>

              <!-- OpenClaw -->
              <div v-show="subTab === 'openclaw'" class="skills-body" role="tabpanel">
                <p v-if="!isTauri()" class="muted small">桌面版才可读取本机 OpenClaw 的 skills / plugins 发现结果。</p>
                <template v-else>
                  <div class="skills-search-row openclaw-toolbar">
                    <div class="skills-search-wrap">
                      <span class="skills-search-icon" aria-hidden="true">🔍</span>
                      <input
                        v-model="openclawFilter"
                        type="search"
                        class="skills-search-input"
                        :placeholder="t('skills.filterOpenclawPlaceholder')"
                      >
                    </div>
                    <button
                      type="button"
                      class="lc-btn lc-btn-ghost lc-btn-sm"
                      :disabled="openclawLoading"
                      @click="loadOpenClawCatalog(true)"
                    >
                      {{ openclawLoading ? t("skills.scanning") : t("common.refresh") }}
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
                      <p v-if="!displayedOpenclawSkills.length" class="muted small">没有匹配当前筛选条件的技能。</p>
                      <div class="skills-installed-list">
                        <button
                          v-for="skill in displayedOpenclawSkills"
                          :key="`skill:${skill.name}`"
                          type="button"
                          class="skills-installed-item"
                          :class="{ 'skills-installed-item--active': selectedOpenclawSkill?.name === skill.name }"
                          @click="toggleOpenclawSkillSelection(skill.name)"
                        >
                          <span class="skills-installed-icon" aria-hidden="true">{{ skill.emoji || "🔧" }}</span>
                          <div class="skills-installed-info">
                            <div class="skills-installed-name">{{ skill.name }}</div>
                            <div class="skills-installed-sub">{{ skillSourceLabel(skill) }} · {{ skillStatusLabel(skill) }}</div>
                          </div>
                          <span
                            class="skills-installed-dot"
                            :class="{
                              'skills-installed-dot--green': !skill.disabled && skill.eligible,
                              'skills-installed-dot--yellow': !skill.disabled && !skill.eligible,
                            }"
                          />
                        </button>
                      </div>
                    </section>

                    <section v-else class="openclaw-section">
                      <p v-if="!searchedOpenclawPlugins.length" class="muted small">没有匹配当前筛选条件的插件。</p>
                      <div class="skills-installed-list">
                        <button
                          v-for="plugin in searchedOpenclawPlugins"
                          :key="`plugin:${plugin.id}`"
                          type="button"
                          class="skills-installed-item"
                          :class="{ 'skills-installed-item--active': selectedOpenclawPlugin?.id === plugin.id }"
                          @click="() => void toggleOpenclawPluginSelection(plugin.id)"
                        >
                          <span class="skills-installed-icon" aria-hidden="true">📦</span>
                          <div class="skills-installed-info">
                            <div class="skills-installed-name">{{ plugin.name?.trim() || plugin.id }}</div>
                            <div class="skills-installed-sub">{{ pluginOriginLabel(plugin) }} · {{ pluginStatusLabel(plugin) }}</div>
                          </div>
                          <span
                            class="skills-installed-dot"
                            :class="{ 'skills-installed-dot--green': plugin.enabled }"
                          />
                        </button>
                      </div>
                    </section>
                  </template>
                </template>
              </div>

              <!-- 共享目录 -->
              <div v-show="subTab === 'installed'" class="skills-body skills-body--local-lib" role="tabpanel">
                <div class="row-actions">
                  <button
                    type="button"
                    class="lc-btn lc-btn-ghost lc-btn-sm"
                    :disabled="installedLoading || !isTauri()"
                    @click="loadInstalled"
                  >
                    {{ installedLoading ? t("skills.refreshingInstalled") : t("common.refresh") }}
                  </button>
                </div>
                <p v-if="installedError" class="err small">{{ installedError }}</p>
                <p v-if="!isTauri()" class="muted small">{{ t("skills.desktopOnlySharedDir") }}</p>
                <template v-else>
                  <p class="muted small">{{ t("skills.localLibraryHint") }}</p>
                  <div v-if="installedRows.length" class="skills-card-grid skills-card-grid--local">
                    <button
                      v-for="row in installedRows"
                      :key="row.slug"
                      type="button"
                      class="skills-local-card"
                      :class="{ 'skills-local-card--active': selectedLocalRowSlug === row.slug }"
                      @click="toggleLocalRowSelection(row.slug)"
                    >
                      <span class="skills-local-card-icon" aria-hidden="true">📂</span>
                      <span class="skills-local-card-name"><code>{{ row.slug }}</code></span>
                      <span class="skills-local-card-meta">{{ row.source }} · {{ row.installedVersion ?? "—" }}</span>
                    </button>
                  </div>
                  <div v-else-if="!installedLoading" class="skills-empty-local">
                    <span class="skills-empty-local-icon" aria-hidden="true">📂</span>
                    <p class="muted">{{ t("skills.sharedDirEmpty") }}</p>
                    <p v-if="openclawManagedSkillsDir" class="muted small">{{ t("skills.hintDropSkillsDir", { path: openclawManagedSkillsDir }) }}</p>
                  </div>
                </template>
              </div>

              <!-- 本机安装 -->
              <div v-show="subTab === 'local'" class="skills-body skills-body--import" role="tabpanel">
                <p v-if="!isTauri()" class="muted small">{{ t("skills.desktopZipFolder") }}</p>
                <template v-else>
                  <!-- Two-row install UI -->
                  <div class="local-install-rows">
                    <!-- Skill install row (whole row is drop target) -->
                    <div
                      class="local-install-row"
                      :class="{ 'local-install-row--drop': importDropActive }"
                      @dragover="onImportDragOver"
                      @dragleave="onImportDragLeave"
                      @drop="onImportDrop"
                    >
                      <div class="local-install-row-info">
                        <span class="local-install-row-title">安装技能</span>
                        <span class="muted small">ZIP 文件或文件夹，可直接拖入此区域</span>
                      </div>
                      <div class="local-install-row-actions">
                        <button
                          type="button"
                          class="lc-btn lc-btn-sm"
                          :disabled="localBusy || localPluginBusy"
                          @click="onPickZipInstall"
                        >
                          {{ localBusy ? "处理中…" : "选择文件" }}
                        </button>
                        <button
                          type="button"
                          class="lc-btn lc-btn-ghost lc-btn-sm local-install-folder-btn"
                          :disabled="localBusy || localPluginBusy"
                          :title="localBusy ? '处理中…' : '选择文件夹安装'"
                          @click="onPickFolderInstall"
                        >
                          📁
                        </button>
                      </div>
                    </div>
                    <!-- Plugin install row -->
                    <div class="local-install-row">
                      <div class="local-install-row-info">
                        <span class="local-install-row-title">安装插件</span>
                        <span class="muted small">.tgz / .zip，通过 CLI 静默安装</span>
                      </div>
                      <div class="local-install-row-actions">
                        <button
                          type="button"
                          class="lc-btn lc-btn-sm"
                          :disabled="localBusy || localPluginBusy"
                          @click="onPickAndInstallPlugin"
                        >
                          {{ localPluginBusy ? "安装中…" : "选择文件" }}
                        </button>
                      </div>
                    </div>
                  </div>

                  <!-- Status message -->
                  <p
                    v-if="localMessage"
                    class="small local-install-msg"
                    :class="localMessageKind === 'error' ? 'err' : localMessageKind === 'success' ? 'ok' : 'muted'"
                  >
                    {{ localMessage }}
                  </p>

                  <!-- Advanced options (collapsible) -->
                  <details class="local-plugin-card local-credentials-details">
                    <summary class="local-credentials-summary">
                      <span>高级选项</span>
                      <span class="muted small">安装目录 · 技能名 · ClawHub 凭据</span>
                    </summary>
                    <div class="local-credentials-body">
                      <div class="skills-import-root-block">
                        <label class="local-slug-label" style="display:block;margin-bottom:6px">{{ t("skills.importTargetDir") }}</label>
                        <input
                          v-model="installRoot"
                          type="text"
                          class="skills-root-input"
                          spellcheck="false"
                          @blur="onInstallRootBlur"
                        >
                        <p class="muted small skills-import-root-note">{{ t("skills.importRootNote") }}</p>
                      </div>
                      <label class="local-slug">
                        <span class="local-slug-label">目录名（slug）<span class="muted" style="font-weight:400;margin-left:6px">可选；不填则用文件名</span></span>
                        <input v-model="localSlug" type="text" class="skills-root-input" spellcheck="false" placeholder="my-skill-name">
                      </label>
                      <label class="local-slug">
                        <span class="local-slug-label">ClawHub Token<span class="muted" style="font-weight:400;margin-left:6px">可选</span></span>
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
                        <span class="local-slug-label">Registry<span class="muted" style="font-weight:400;margin-left:6px">可选</span></span>
                        <input
                          v-model="clawhubRegistry"
                          type="text"
                          class="skills-root-input"
                          spellcheck="false"
                          placeholder="https://clawhub.ai"
                        >
                      </label>
                      <div class="local-actions">
                        <button type="button" class="lc-btn lc-btn-sm" @click="saveClawhubAuth">保存凭据</button>
                        <button type="button" class="lc-btn lc-btn-ghost lc-btn-sm" @click="clearClawhubAuth">清除凭据</button>
                      </div>
                      <p class="muted small" style="margin-top:8px">
                        凭据保存在本机 DidClaw SQLite 中，供匿名 HTTP 请求和 <code>openclaw</code> CLI 复用。
                      </p>
                    </div>
                  </details>
                </template>
              </div>
            </div>
          </div>
        </div>

        <div
          class="skills-bottom"
          :class="{ 'skills-bottom--open': skillsDetailSheetOpen }"
          :aria-hidden="skillsDetailSheetOpen ? undefined : 'true'"
        >
          <div class="skills-bottom-inner">
            <!-- Market / ClawHub detail -->
            <template v-if="subTab === 'browse' && hubSlug">
              <div class="skills-sheet-row">
                <span class="skills-sheet-icon" aria-hidden="true">{{
                  hubDetailKind === "package" ? "📦" : "🔧"
                }}</span>
                <div class="skills-sheet-info">
                  <div class="skills-sheet-title">
                    {{ (hubDetailKind === 'skill' ? (hubDetail?.skill?.displayName ?? selectedSearchHit?.displayName) : (hubPkgDetail?.package?.name ?? selectedSearchHit?.displayName)) || hubSlug }}
                  </div>
                  <p v-if="detailLoading" class="skills-sheet-desc muted">{{ t("common.loading") }}</p>
                  <template v-else-if="hubDetailKind === 'skill'">
                    <p v-if="detailError" class="muted small">{{ detailError }}</p>
                    <p class="skills-sheet-desc">{{ hubDetail?.skill?.summary ?? selectedSearchHit?.summary ?? "—" }}</p>
                    <p v-if="hubDetail?.moderation?.isMalwareBlocked" class="err small">{{ t("skills.malwareBlocked") }}</p>
                    <p v-else-if="hubDetail?.moderation?.isSuspicious" class="err small">{{ t("skills.suspiciousSkill") }}</p>
                  </template>
                  <template v-else-if="hubDetailKind === 'package'">
                    <p v-if="detailError" class="muted small">{{ detailError }}</p>
                    <p class="skills-sheet-desc">{{ hubPkgDetail?.package?.summary ?? selectedSearchHit?.summary ?? "—" }}</p>
                  </template>
                  <p v-else-if="detailError" class="err small">{{ detailError }}</p>
                </div>
                <div class="skills-sheet-actions">
                  <template v-if="installBusy && installingSlug === hubSlug">
                    <button type="button" class="lc-btn lc-btn-sm" disabled>
                      <span class="skills-spinner" aria-hidden="true" />{{ t("skills.installing") }}
                    </button>
                  </template>
                  <template v-else>
                    <button
                      v-if="hubDetailKind === 'skill' && canInstallDetail && hubSlug"
                      type="button"
                      class="lc-btn lc-btn-sm"
                      :disabled="installBusy"
                      @click="installOpenClawSkill(hubSlug, hubDetail?.latestVersion?.version)"
                    >
                      {{ t("skills.install") }}
                    </button>
                    <button
                      v-if="hubDetailKind === 'package' && canInstallPluginDetail && hubSlug"
                      type="button"
                      class="lc-btn lc-btn-sm"
                      :disabled="installBusy"
                      @click="installClawhubPluginFromSlug(hubSlug)"
                    >
                      {{ t("skills.install") }}
                    </button>
                  </template>
                  <button
                    type="button"
                    class="skills-sheet-close"
                    :aria-label="t('skills.closeDetail')"
                    @click="closeSkillsDetailPanel"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div class="skills-sheet-meta">
                <div v-if="hubSlug" class="skills-meta-item">
                  <span class="skills-meta-label">{{ t("skills.metaSlug") }}</span>
                  <span class="skills-meta-value"><code>{{ hubSlug }}</code></span>
                </div>
                <div class="skills-meta-item">
                  <span class="skills-meta-label">{{ t("skills.metaType") }}</span>
                  <span class="skills-meta-value">{{ familyLabel(normalizePkgFamily(hubPkgDetail?.package?.family ?? selectedSearchHit?.family)) }}</span>
                </div>
                <div
                  v-if="hubDetail?.latestVersion?.version || hubPkgDetail?.package?.latestVersion || selectedSearchHit?.version"
                  class="skills-meta-item"
                >
                  <span class="skills-meta-label">{{ t("skills.metaVersion") }}</span>
                  <span class="skills-meta-value">v{{ hubDetail?.latestVersion?.version ?? hubPkgDetail?.package?.latestVersion ?? selectedSearchHit?.version }}</span>
                </div>
                <div
                  v-if="hubDetail?.owner?.handle || hubPkgDetail?.package?.ownerHandle"
                  class="skills-meta-item"
                >
                  <span class="skills-meta-label">{{ t("skills.metaAuthor") }}</span>
                  <span class="skills-meta-value">@{{ hubDetail?.owner?.handle ?? hubPkgDetail?.package?.ownerHandle }}</span>
                </div>
                <div v-if="hubDetailKind === 'package'" class="skills-meta-item">
                  <span class="skills-meta-label">{{ t("skills.metaDocs") }}</span>
                  <span class="skills-meta-value">
                    <a href="https://docs.openclaw.ai/tools/plugin" target="_blank" rel="noopener noreferrer">{{ t("skills.pluginDocsLink") }}</a>
                  </span>
                </div>
              </div>
            </template>

            <!-- OpenClaw skill detail -->
            <template v-else-if="subTab === 'openclaw' && !showPluginsCatalog && selectedOpenclawSkill">
              <div class="skills-sheet-row">
                <span class="skills-sheet-icon" aria-hidden="true">{{ selectedOpenclawSkill.emoji || "🔧" }}</span>
                <div class="skills-sheet-info">
                  <div class="skills-sheet-title">
                    {{ selectedOpenclawSkill.emoji ? `${selectedOpenclawSkill.emoji} ${selectedOpenclawSkill.name}` : selectedOpenclawSkill.name }}
                  </div>
                  <p class="skills-sheet-desc">{{ selectedOpenclawSkill.description ?? "—" }}</p>
                  <p v-if="skillSetupHint(selectedOpenclawSkill)" class="muted small">
                    {{ skillSetupHint(selectedOpenclawSkill) }}
                  </p>
                </div>
                <div class="skills-sheet-actions">
                  <button
                    type="button"
                    class="lc-btn lc-btn-ghost lc-btn-sm"
                    :disabled="openclawSkillToggleBusyName === selectedOpenclawSkill.name || installBusy"
                    @click="toggleOpenClawSkill(selectedOpenclawSkill)"
                  >
                    {{
                      openclawSkillToggleBusyName === selectedOpenclawSkill.name
                        ? t("common.processing")
                        : selectedOpenclawSkill.disabled
                          ? t("skills.enableSkill")
                          : t("skills.disableSkill")
                    }}
                  </button>
                  <button
                    v-if="!selectedOpenclawSkill.bundled"
                    type="button"
                    class="lc-btn lc-btn-ghost lc-btn-sm"
                    :disabled="installBusy"
                    @click="updateOpenClawSkill(selectedOpenclawSkill.name)"
                  >
                    {{ openclawSkillActionBusyName === selectedOpenclawSkill.name ? t("common.processing") : t("skills.updateViaOpenclaw") }}
                  </button>
                  <button
                    v-if="!selectedOpenclawSkill.bundled"
                    type="button"
                    class="lc-btn lc-btn-ghost lc-btn-sm btn-danger"
                    :disabled="installBusy"
                    @click="uninstallOpenClawSkill(selectedOpenclawSkill.name)"
                  >
                    {{ openclawSkillActionBusyName === selectedOpenclawSkill.name ? t("common.processing") : t("skills.uninstallViaOpenclaw") }}
                  </button>
                  <button
                    type="button"
                    class="lc-btn lc-btn-ghost lc-btn-sm"
                    @click="jumpToClawHubSearch(selectedOpenclawSkill.name)"
                  >
                    {{ t("skills.searchOnClawhub") }}
                  </button>
                  <a
                    v-if="selectedOpenclawSkill.homepage"
                    :href="selectedOpenclawSkill.homepage"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="lc-btn lc-btn-ghost lc-btn-sm openclaw-detail-link"
                  >{{ t("skills.openHomepage") }}</a>
                  <button
                    type="button"
                    class="skills-sheet-close"
                    :aria-label="t('skills.closeDetail')"
                    @click="closeSkillsDetailPanel"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div
                v-if="skillInstallSuggestions(selectedOpenclawSkill).length"
                class="skills-sheet-extra openclaw-suggestion-list"
              >
                <div
                  v-for="item in skillInstallSuggestions(selectedOpenclawSkill)"
                  :key="`${selectedOpenclawSkill.name}:${item.id ?? item.label ?? item.kind}`"
                  class="openclaw-suggestion-item"
                >
                  <span class="openclaw-cap-chip">{{ item.kind || "install" }}</span>
                  <span>{{ item.label || item.id || t("skills.installHintFallback") }}</span>
                </div>
              </div>
            </template>

            <!-- OpenClaw plugin detail -->
            <template v-else-if="subTab === 'openclaw' && showPluginsCatalog && selectedOpenclawPlugin">
              <div class="skills-sheet-row">
                <span class="skills-sheet-icon" aria-hidden="true">📦</span>
                <div class="skills-sheet-info">
                  <div class="skills-sheet-title">{{ selectedOpenclawPlugin.name?.trim() || selectedOpenclawPlugin.id }}</div>
                  <p v-if="openclawPluginInspectLoading" class="muted small">{{ t("common.loading") }}</p>
                  <p v-else-if="openclawPluginInspectError" class="err small">{{ openclawPluginInspectError }}</p>
                  <p class="skills-sheet-desc">{{ selectedOpenclawPlugin.description ?? "—" }}</p>
                  <p class="muted small"><code>{{ selectedOpenclawPlugin.id }}</code></p>
                </div>
                <div class="skills-sheet-actions">
                  <button
                    type="button"
                    class="lc-btn lc-btn-ghost lc-btn-sm"
                    :disabled="openclawPluginToggleBusyId === selectedOpenclawPlugin.id || openclawPluginActionBusyId === selectedOpenclawPlugin.id"
                    @click="toggleOpenClawPlugin(selectedOpenclawPlugin)"
                  >
                    {{ openclawPluginToggleBusyId === selectedOpenclawPlugin.id ? t("common.processing") : selectedOpenclawPlugin.enabled ? t("skills.disablePlugin") : t("skills.enablePlugin") }}
                  </button>
                  <button
                    type="button"
                    class="lc-btn lc-btn-ghost lc-btn-sm"
                    :disabled="openclawPluginToggleBusyId === selectedOpenclawPlugin.id || openclawPluginActionBusyId === selectedOpenclawPlugin.id"
                    @click="updateOpenClawPlugin(selectedOpenclawPlugin)"
                  >
                    {{ openclawPluginActionBusyId === selectedOpenclawPlugin.id ? t("common.processing") : t("skills.updatePlugin") }}
                  </button>
                  <button
                    type="button"
                    class="lc-btn lc-btn-ghost lc-btn-sm btn-danger"
                    :disabled="openclawPluginToggleBusyId === selectedOpenclawPlugin.id || openclawPluginActionBusyId === selectedOpenclawPlugin.id"
                    @click="uninstallOpenClawPlugin(selectedOpenclawPlugin)"
                  >
                    {{ openclawPluginActionBusyId === selectedOpenclawPlugin.id ? t("common.processing") : t("skills.uninstallPlugin") }}
                  </button>
                  <button
                    type="button"
                    class="skills-sheet-close"
                    :aria-label="t('skills.closeDetail')"
                    @click="closeSkillsDetailPanel"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div v-if="!openclawPluginInspectLoading && selectedOpenclawPlugin" class="skills-sheet-extra">
                <p v-if="openclawPluginInspect?.plugin?.rootDir" class="muted small">
                  {{ t("skills.pluginRootDir") }} <code>{{ openclawPluginInspect.plugin.rootDir }}</code>
                </p>
                <div v-if="pluginCapabilities(selectedOpenclawPlugin).length" class="openclaw-cap-list">
                  <span
                    v-for="cap in pluginCapabilities(selectedOpenclawPlugin)"
                    :key="`${selectedOpenclawPlugin.id}:sheet:${cap}`"
                    class="openclaw-cap-chip"
                  >{{ cap }}</span>
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
                  <p class="openclaw-subtitle">{{ t("skills.configUiHints") }}</p>
                  <div class="openclaw-suggestion-list">
                    <div
                      v-for="(hint, key) in openclawPluginInspect.plugin.configUiHints"
                      :key="`sheet-hint:${key}`"
                      class="openclaw-suggestion-item"
                    >
                      <span class="openclaw-cap-chip">{{ key }}</span>
                      <span>{{ hint.label || hint.help || (hint.advanced ? t("skills.configAdvanced") : t("skills.configItem")) }}</span>
                    </div>
                  </div>
                </div>
                <div
                  v-if="openclawPluginInspect?.diagnostics?.length"
                  class="openclaw-inspect-block"
                >
                  <p class="openclaw-subtitle">{{ t("skills.diagnosticsTitle") }}</p>
                  <div class="openclaw-suggestion-list">
                    <div
                      v-for="(diagnostic, index) in openclawPluginInspect.diagnostics"
                      :key="`sheet-diag:${index}`"
                      class="openclaw-suggestion-item"
                    >
                      <span class="openclaw-cap-chip">{{ String(diagnostic.level ?? diagnostic.severity ?? "info") }}</span>
                      <span>{{ String(diagnostic.message ?? diagnostic.code ?? t("skills.noDiagnosticDetail")) }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <!-- Shared install root row -->
            <template v-else-if="subTab === 'installed' && selectedLocalRow">
              <div class="skills-sheet-row">
                <span class="skills-sheet-icon" aria-hidden="true">📂</span>
                <div class="skills-sheet-info">
                  <div class="skills-sheet-title"><code>{{ selectedLocalRow.slug }}</code></div>
                  <p class="skills-sheet-desc small muted">
                    {{ selectedLocalRow.source }} · {{ selectedLocalRow.installedVersion ?? "—" }}
                  </p>
                </div>
                <div class="skills-sheet-actions">
                  <button
                    type="button"
                    class="lc-btn lc-btn-ghost lc-btn-sm"
                    :disabled="installBusy"
                    @click="onUpdateInstalled(selectedLocalRow)"
                  >
                    {{ t("skills.refreshUpdate") }}
                  </button>
                  <button
                    type="button"
                    class="lc-btn lc-btn-ghost lc-btn-sm btn-danger"
                    :disabled="installBusy"
                    @click="onDeleteInstalled(selectedLocalRow)"
                  >
                    {{ t("skills.removeFromDisk") }}
                  </button>
                  <button
                    type="button"
                    class="skills-sheet-close"
                    :aria-label="t('skills.closeDetail')"
                    @click="closeSkillsDetailPanel"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </template>
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
.skills-dialog {
  display: flex;
  flex-direction: column;
  width: min(820px, 100%);
  height: min(560px, 88vh);
  max-height: 88vh;
  overflow: hidden;
  background: var(--lc-surface-panel);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-lg, 12px);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.22);
  padding: 14px 16px 0;
  box-sizing: border-box;
  position: relative;
}
.skills-web-banner {
  margin: 0 0 8px;
  flex-shrink: 0;
}
.skills-panel-body {
  display: flex;
  flex: 1;
  min-height: 0;
  padding-top: 8px;
  border-top: 1px solid var(--lc-border);
}
.skills-sidebar {
  flex: 0 0 132px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-right: 12px;
  border-right: 1px solid var(--lc-border);
  align-self: stretch;
}
.skills-side-divider {
  height: 1px;
  background: var(--lc-border);
  margin: 6px 4px;
}
.skills-side-count {
  margin-left: 4px;
  font-size: 11px;
  color: var(--lc-text-dim);
  font-weight: 400;
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
  border-left: 3px solid var(--lc-accent);
  padding-left: 9px;
  border-color: transparent;
  color: var(--lc-text);
  background: var(--lc-bg-raised);
  font-weight: 600;
}
.skills-main-column {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding-left: 12px;
  padding-bottom: 8px;
}
.skills-main-scroll {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--lc-border) transparent;
}
.skills-main-scroll::-webkit-scrollbar {
  width: 4px;
}
.skills-main-scroll::-webkit-scrollbar-thumb {
  background: var(--lc-border);
  border-radius: 2px;
}
.skills-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
  padding-bottom: 4px;
}
.skills-head-text {
  flex: 1;
  min-width: 0;
}
.skills-head h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.skills-desc {
  margin: 4px 0 0;
  line-height: 1.4;
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
.skills-toast-action {
  flex-shrink: 0;
  margin-left: auto;
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
.skills-body--market {
  display: flex;
  flex-direction: column;
  min-height: min(360px, 48vh);
}
.skills-search-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  margin-bottom: 10px;
}
.skills-search-wrap {
  flex: 1;
  position: relative;
  min-width: 0;
}
.skills-search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 14px;
  opacity: 0.55;
  pointer-events: none;
}
.skills-search-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px 8px 32px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-raised);
  color: var(--lc-text);
  font-size: 13px;
  font-family: inherit;
}
.skills-search-input:focus {
  outline: none;
  border-color: var(--lc-accent);
}
.skills-view-toggle {
  display: flex;
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  overflow: hidden;
  flex-shrink: 0;
}
.skills-view-btn {
  padding: 7px 10px;
  border: none;
  background: transparent;
  color: var(--lc-text-muted);
  font-size: 14px;
  cursor: pointer;
  font-family: inherit;
  line-height: 1;
}
.skills-view-btn:hover {
  color: var(--lc-text);
  background: var(--lc-bg-elevated);
}
.skills-view-btn.active {
  background: var(--lc-bg-elevated);
  color: var(--lc-text);
  font-weight: 600;
}
.skills-tags-row {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  flex-shrink: 0;
  margin-bottom: 10px;
  padding-bottom: 2px;
  scrollbar-width: none;
}
.skills-tags-row::-webkit-scrollbar {
  display: none;
}
.skills-tag-pill {
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-raised);
  font-size: 12px;
  color: var(--lc-text-muted);
  cursor: pointer;
  white-space: nowrap;
  font-family: inherit;
  flex-shrink: 0;
}
.skills-tag-pill:hover:not(:disabled) {
  color: var(--lc-text);
  border-color: var(--lc-border-strong);
}
.skills-tag-pill--active {
  background: color-mix(in srgb, var(--lc-accent) 15%, transparent) !important;
  border-color: var(--lc-accent) !important;
  color: var(--lc-accent) !important;
}
.skills-tag-pill:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.skills-market-results {
  flex: 1;
  min-height: 120px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--lc-border) transparent;
}
.skills-card-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  align-content: start;
}
@media (max-width: 640px) {
  .skills-card-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 420px) {
  .skills-card-grid {
    grid-template-columns: 1fr;
  }
}
.skills-market-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--lc-border);
  border-radius: 10px;
  background: var(--lc-bg-raised);
  cursor: pointer;
  text-align: left;
  font: inherit;
  box-sizing: border-box;
  transition: border-color 0.12s ease, background 0.12s ease, transform 0.1s ease;
}
.skills-market-card:hover {
  border-color: var(--lc-border-strong);
  background: var(--lc-bg-elevated);
  transform: translateY(-1px);
}
.skills-market-card--active {
  border-color: var(--lc-accent);
  background: var(--lc-accent-soft);
}
.skills-market-card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.skills-market-card-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: var(--lc-bg-elevated);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}
.skills-market-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 10px;
  font-weight: 600;
  background: color-mix(in srgb, var(--lc-accent) 14%, transparent);
  color: var(--lc-accent);
}
.skills-market-badge--plugin {
  background: color-mix(in srgb, var(--lc-success, #22c55e) 14%, transparent);
  color: var(--lc-success, #22c55e);
}
.skills-market-card-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--lc-text);
  line-height: 1.3;
}
.skills-market-card-desc {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--lc-text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.skills-market-card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 10px;
  color: var(--lc-text-dim);
  margin-top: auto;
}
.skills-market-card-meta .dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--lc-border-strong);
}
.skills-market-card-slug {
  font-size: 10px;
  font-family: var(--lc-mono);
  color: var(--lc-accent);
}
.skills-market-card-actions {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}
.skills-bottom {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--lc-surface-panel);
  border-top: 1px solid var(--lc-border);
  border-radius: 0 0 var(--lc-radius-lg, 12px) var(--lc-radius-lg, 12px);
  transform: translateY(100%);
  transition: transform 0.24s cubic-bezier(0.4, 0, 0.2, 1);
  max-height: 220px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.14);
}
.skills-bottom--open {
  transform: translateY(0);
}
.skills-bottom-inner {
  padding: 14px 18px 16px;
  box-sizing: border-box;
  overflow-y: auto;
  scrollbar-width: thin;
  flex: 1;
}
.skills-sheet-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.skills-sheet-icon {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: var(--lc-bg-elevated);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  flex-shrink: 0;
}
.skills-sheet-info {
  flex: 1;
  min-width: 0;
}
.skills-sheet-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--lc-text);
  margin-bottom: 4px;
}
.skills-sheet-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--lc-text-muted);
}
.skills-sheet-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: flex-end;
  gap: 6px;
  flex-shrink: 0;
  max-width: 42%;
}
.skills-sheet-close {
  width: 28px;
  height: 28px;
  border: none;
  background: var(--lc-bg-elevated);
  color: var(--lc-text-muted);
  font-size: 14px;
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.skills-sheet-close:hover {
  color: var(--lc-text);
  background: var(--lc-bg-hover);
}
@keyframes skills-spin { to { transform: rotate(360deg); } }
.skills-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.25);
  border-top-color: #fff;
  border-radius: 50%;
  animation: skills-spin 0.7s linear infinite;
  vertical-align: middle;
  margin-right: 5px;
}
.skills-sheet-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--lc-border);
  font-size: 11px;
}
.skills-meta-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.skills-meta-label {
  font-size: 10px;
  color: var(--lc-text-dim);
}
.skills-meta-value {
  color: var(--lc-text-muted);
}
.skills-sheet-extra {
  margin-top: 10px;
  max-height: 120px;
  overflow-y: auto;
}
.skills-import-root-block {
  margin-bottom: 14px;
}
.skills-field-label {
  display: block;
  font-size: 12px;
  color: var(--lc-text-muted);
  margin-bottom: 6px;
}
.skills-import-root-note {
  margin-top: 6px;
}
.skills-drop-zone {
  border: 1.5px dashed var(--lc-border);
  border-radius: 10px;
  min-height: 100px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  margin-bottom: 16px;
  color: var(--lc-text-muted);
  font-size: 12px;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.skills-drop-zone--active {
  border-color: var(--lc-accent);
  background: var(--lc-accent-soft);
}
.skills-drop-icon {
  font-size: 24px;
  opacity: 0.7;
}
.skills-drop-text {
  margin: 0;
  text-align: center;
  line-height: 1.4;
}
.skills-local-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--lc-border);
  border-radius: 10px;
  background: var(--lc-bg-raised);
  cursor: pointer;
  text-align: left;
  font: inherit;
  transition: border-color 0.12s ease;
}
.skills-local-card:hover {
  border-color: var(--lc-border-strong);
}
.skills-local-card--active {
  border-color: var(--lc-accent);
  background: var(--lc-accent-soft);
}
.skills-local-card-icon {
  font-size: 20px;
}
.skills-local-card-name {
  font-size: 13px;
  font-weight: 600;
}
.skills-local-card-meta {
  font-size: 11px;
  color: var(--lc-text-muted);
}
.skills-empty-local {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 160px;
  color: var(--lc-text-muted);
}
.skills-empty-local-icon {
  font-size: 32px;
  opacity: 0.45;
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
  .skills-main-column {
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
.hub-load-more {
  display: flex;
  justify-content: center;
  margin-top: 12px;
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
/* compact installed list (demo-style) */
.skills-installed-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.skills-installed-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--lc-bg-raised);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  cursor: pointer;
  transition: border-color 0.15s;
  font-family: inherit;
  font-size: 13px;
  text-align: left;
  width: 100%;
}
.skills-installed-item:hover {
  border-color: var(--lc-border-strong);
}
.skills-installed-item--active {
  border-color: var(--lc-accent);
  background: color-mix(in srgb, var(--lc-accent) 6%, transparent);
}
.skills-installed-icon {
  font-size: 18px;
  flex-shrink: 0;
}
.skills-installed-info {
  flex: 1;
  min-width: 0;
}
.skills-installed-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--lc-text);
}
.skills-installed-sub {
  font-size: 11px;
  color: var(--lc-text-dim);
  margin-top: 2px;
}
.skills-installed-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--lc-border-strong);
  flex-shrink: 0;
}
.skills-installed-dot--green {
  background: #34c759;
}
.skills-installed-dot--yellow {
  background: #ff9500;
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
  gap: 4px;
  margin-bottom: 12px;
}
.local-slug-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--lc-text);
}
.local-section-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--lc-text);
  margin: 0 0 8px;
}
.local-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
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
.local-install-rows {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--lc-border);
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 14px;
}
.local-install-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: var(--lc-bg-raised);
}
.local-install-row + .local-install-row {
  border-top: 1px solid var(--lc-border);
}
.local-install-row--drop {
  background: var(--lc-accent-soft);
  outline: 2px solid var(--lc-accent);
  outline-offset: -2px;
}
.local-install-row-info {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.local-install-row-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--lc-text);
}
.local-install-row-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.local-install-folder-btn {
  padding-left: 8px;
  padding-right: 8px;
}
.local-install-msg {
  margin-bottom: 12px;
}
.local-credentials-details {
  cursor: default;
}
.local-credentials-details > summary {
  display: flex;
  align-items: baseline;
  gap: 8px;
  cursor: pointer;
  list-style: none;
  user-select: none;
  font-size: 12px;
  font-weight: 600;
  color: var(--lc-text);
  padding: 2px 0;
}
.local-credentials-details > summary::-webkit-details-marker {
  display: none;
}
.local-credentials-details > summary::before {
  content: "▶";
  font-size: 9px;
  color: var(--lc-text-muted);
  transition: transform 0.15s ease;
  flex-shrink: 0;
}
.local-credentials-details[open] > summary::before {
  transform: rotate(90deg);
}
.local-credentials-summary {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.local-credentials-body {
  padding-top: 12px;
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
