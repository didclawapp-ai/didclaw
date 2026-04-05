<script setup lang="ts">
import { getOpenClawAfterWriteHint } from "@/lib/openclaw-config-hint";
import { getDidClawDesktopApi, isDidClawElectron } from "@/lib/electron-bridge";
import { isDidClawDesktop } from "@/lib/desktop-api";
import { buildModelPickerRows, readOpenClawAiSnapshot } from "@/lib/openclaw-ai-config";
import {
  type AgentTopologyEdge,
  compileAgentToAgentTopology,
  inferTopologyTemplate,
  type TopologyTemplate,
} from "@/lib/agent-to-agent-topology";
import {
  buildCompanyRosterSkillMarkdown,
  COMPANY_ROSTER_SKILL_SLUG,
} from "@/lib/company-roster-skill";
import {
  isGatewayConfigHashStaleError,
  isGatewayConfigPatchRejectedError,
  isGatewayConfigRequestError,
  patchAgentsListMergeViaGateway,
  patchSkillsEntryEnabledViaGateway,
  patchToolsAgentToAgentViaGateway,
  extractAgentsListFromConfigGet,
  extractToolsAgentToAgentFromConfigGet,
  extractToolsSessionsVisibilityFromConfigGet,
  retryAfterSecondsFromGatewayDetails,
} from "@/lib/openclaw-gateway-config";
import { writeOpenClawSkillEnabled } from "@/lib/skills-invoke";
import { useChatStore } from "@/stores/chat";
import { useCompanyRolePanelsStore } from "@/stores/companyRolePanels";
import { useGatewayStore } from "@/stores/gateway";
import { useSessionStore } from "@/stores/session";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useI18n();
const chat = useChatStore();
const companyPanels = useCompanyRolePanelsStore();
const gateway = useGatewayStore();
const sessionStore = useSessionStore();

const busy = ref(false);
const error = ref<string | null>(null);
const listJson = ref<string>("[]");

const rows = ref<Array<{ id: string; name: string; workspace: string; model: string }>>([
  { id: "", name: "", workspace: "default", model: "" },
]);

/** Phase 2：`tools.agentToAgent` 协作拓扑 */
const topoTemplate = ref<TopologyTemplate>("off");
const topoCustomEdges = ref<AgentTopologyEdge[]>([]);
const topoBusy = ref(false);
const topoError = ref<string | null>(null);
const topoAllowReadback = ref<string>("");

/** 第五步：共享公司技能（~/.openclaw/skills + skills.entries） */
const rosterCharter = ref("");
/** 公司共享工作区根（绝对路径），写入 roster 技能，避免职务默认落到 npm 包内 default */
const rosterWorkspaceRoot = ref("");
const rosterBusy = ref(false);
const rosterError = ref<string | null>(null);

/** 来自 `readOpenClawAiSnapshot`（桌面版），用于 model 列下拉 */
const modelPickerRows = ref<Array<{ value: string; label: string }>>([]);
const modelPickerError = ref<string | null>(null);
/** 新增行时预填为当前全局主模型 */
const suggestedDefaultModel = ref("");

async function loadModelPickerOptions(): Promise<void> {
  modelPickerError.value = null;
  modelPickerRows.value = [];
  suggestedDefaultModel.value = "";
  if (!isDidClawDesktop()) {
    return;
  }
  try {
    const snap = await readOpenClawAiSnapshot();
    modelPickerRows.value = buildModelPickerRows(snap);
    suggestedDefaultModel.value = snap.primaryModel.trim();
  } catch (e) {
    modelPickerError.value = e instanceof Error ? e.message : String(e);
  }
}

const modelOptionsForSelect = computed(() => {
  const map = new Map<string, { value: string; label: string }>();
  for (const o of modelPickerRows.value) {
    map.set(o.value, o);
  }
  for (const r of rows.value) {
    const m = r.model.trim();
    if (m && !map.has(m)) {
      map.set(m, { value: m, label: m });
    }
  }
  return [...map.values()].sort((a, b) => a.value.localeCompare(b.value));
});

const useModelSelect = computed(() => isDidClawDesktop() && modelOptionsForSelect.value.length > 0);

const rowsMissingModel = computed(() =>
  rows.value.some((r) => r.id.trim() !== "" && r.model.trim() === ""),
);

function agentItemToRow(o: unknown): { id: string; name: string; workspace: string; model: string } | null {
  if (o == null || typeof o !== "object" || Array.isArray(o)) {
    return null;
  }
  const r = o as Record<string, unknown>;
  return {
    id: typeof r.id === "string" ? r.id : "",
    name: typeof r.name === "string" ? r.name : "",
    workspace:
      typeof r.workspace === "string" && r.workspace.trim() !== "" ? r.workspace : "default",
    model: typeof r.model === "string" ? r.model : "",
  };
}

/** 将只读 JSON 预览同步到上方可编辑表格（打开向导 / 点刷新 / 保存成功后调用）。 */
function syncRowsFromListJson(): void {
  try {
    const raw = listJson.value.trim();
    if (!raw.startsWith("[")) {
      return;
    }
    const a = JSON.parse(raw) as unknown;
    if (!Array.isArray(a)) {
      return;
    }
    const mapped: Array<{ id: string; name: string; workspace: string; model: string }> = [];
    for (const item of a) {
      const row = agentItemToRow(item);
      if (row) {
        mapped.push(row);
      }
    }
    rows.value =
      mapped.length > 0 ? mapped : [{ id: "", name: "", workspace: "default", model: "" }];
  } catch {
    /* 解析失败时保留当前 rows */
  }
}

const canUseDesktop = computed(() => isDidClawElectron() && !!getDidClawDesktopApi()?.writeOpenClawAgentsListMerge);
const canSaveViaGateway = computed(() => !!gateway.client?.connected);
/** 已连接 Gateway 时可通过 `config.patch` 写入；否则需桌面版 Tauri 合并。 */
const canMergeAgents = computed(() => canSaveViaGateway.value || canUseDesktop.value);

const agentIdsFromRows = computed(() =>
  [...new Set(rows.value.map((r) => r.id.trim()).filter((id) => id.length > 0))],
);

const topologyAgentSelectOptions = computed(() => agentIdsFromRows.value);

const canTopologyDesktopWrite = computed(
  () => isDidClawElectron() && !!getDidClawDesktopApi()?.writeOpenClawToolsAgentToAgentMerge,
);
const canSaveTopology = computed(() => canSaveViaGateway.value || canTopologyDesktopWrite.value);

const canSyncCompanyRosterSkill = computed(
  () => isDidClawElectron() && !!getDidClawDesktopApi()?.writeOpenclawCompanyRosterSkill,
);

const rosterSkillPreview = computed(() => {
  const ids = agentIdsFromRows.value;
  const topo = compileAgentToAgentTopology({
    template: topoTemplate.value,
    agentIds: ids,
    customEdges: topoCustomEdges.value,
  });
  const topology = topo.ok ? topo.config : { enabled: false, allow: [] as string[] };
  const agents = rows.value
    .map((r) => ({
      id: r.id.trim(),
      name: r.name.trim(),
      workspace: r.workspace.trim() || "default",
      model: r.model.trim(),
    }))
    .filter((r) => r.id.length > 0);
  return buildCompanyRosterSkillMarkdown({
    agents,
    topologyTemplate: topoTemplate.value,
    topology,
    companyWorkspaceRoot: rosterWorkspaceRoot.value,
    charter: rosterCharter.value,
  });
});

/** 星型/主↔子依赖 agents.list 中的 main，与 allow 白名单一致 */
const showTopologyMainMissingWarning = computed(() => {
  const t = topoTemplate.value;
  if (t !== "star" && t !== "bidirectional") {
    return false;
  }
  return !agentIdsFromRows.value.includes("main");
});

function formatGatewaySaveError(err: unknown): string {
  if (isGatewayConfigRequestError(err)) {
    if (isGatewayConfigHashStaleError(err)) {
      return t("company.gatewayConfigHashStale");
    }
    if (isGatewayConfigPatchRejectedError(err)) {
      return t("company.gatewayConfigInvalidPatch", { message: err.message });
    }
    const waitSec = retryAfterSecondsFromGatewayDetails(err.details);
    if (err.gatewayCode === "UNAVAILABLE" && waitSec != null) {
      return t("company.gatewayConfigRateLimited", { seconds: waitSec });
    }
    return t("company.gatewayConfigRequestFailed", { message: err.message });
  }
  if (err instanceof Error && err.message.includes("config.get: missing hash")) {
    return t("company.gatewayConfigMissingHash");
  }
  return err instanceof Error ? err.message : String(err);
}

const parsedAgentList = computed((): Array<{ id?: string }> => {
  try {
    const a = JSON.parse(listJson.value) as unknown;
    return Array.isArray(a) ? (a as Array<{ id?: string }>) : [];
  } catch {
    return [];
  }
});

function isOpenableRoleAgent(pid: unknown): pid is { id: string } {
  if (pid == null || typeof pid !== "object") {
    return false;
  }
  const id = (pid as { id?: unknown }).id;
  if (typeof id !== "string") {
    return false;
  }
  const t = id.trim();
  return t.length > 0 && t !== "main";
}

async function refreshList(): Promise<void> {
  error.value = null;
  const gc = gateway.client;
  if (gc?.connected) {
    try {
      const payload = await gc.request<unknown>("config.get", {});
      const fromGw = extractAgentsListFromConfigGet(payload);
      listJson.value = JSON.stringify(fromGw, null, 2);
      syncRowsFromListJson();
      return;
    } catch (e) {
      error.value = formatGatewaySaveError(e);
    }
  }
  const api = getDidClawDesktopApi();
  if (!api?.readOpenClawAgentsList) {
    if (!listJson.value || listJson.value === "[]") {
      listJson.value = "[]";
    }
    return;
  }
  try {
    const r = await api.readOpenClawAgentsList();
    if (!r.ok) {
      listJson.value = `Error: ${(r as { error: string }).error}`;
      return;
    }
    listJson.value = JSON.stringify(r.list ?? [], null, 2);
    syncRowsFromListJson();
  } catch (e) {
    listJson.value = String(e);
  }
}

function buildTopologyReadbackJson(
  ata: { enabled: boolean; allow: string[] },
  sessionsVisibility: string | null,
): string {
  return JSON.stringify(
    {
      agentToAgent: { enabled: ata.enabled, allow: ata.allow },
      sessions: { visibility: sessionsVisibility },
    },
    null,
    2,
  );
}

function applyTopologyFromOfficial(
  ata: { enabled: boolean; allow: string[] },
  sessionsVisibility: string | null,
): void {
  const ids = agentIdsFromRows.value;
  const inferred = inferTopologyTemplate(ata, ids);
  topoTemplate.value = inferred;
  if (inferred === "custom" && ata.enabled && ata.allow.length > 0) {
    const m = "main";
    if (ata.allow.includes(m)) {
      topoCustomEdges.value = ata.allow
        .filter((id) => id !== m)
        .map((to) => ({ from: m, to }));
    } else {
      topoCustomEdges.value = [];
    }
  } else if (inferred !== "custom") {
    topoCustomEdges.value = [];
  }
  topoAllowReadback.value = buildTopologyReadbackJson(ata, sessionsVisibility);
}

async function refreshTopologyState(): Promise<void> {
  topoError.value = null;
  const gc = gateway.client;
  if (gc?.connected) {
    try {
      const payload = await gc.request<unknown>("config.get", {});
      applyTopologyFromOfficial(
        extractToolsAgentToAgentFromConfigGet(payload),
        extractToolsSessionsVisibilityFromConfigGet(payload),
      );
      return;
    } catch (e) {
      topoError.value = formatGatewaySaveError(e);
    }
  }
  const api = getDidClawDesktopApi();
  if (!api?.readOpenClawToolsAgentToAgent) {
    topoAllowReadback.value = "";
    return;
  }
  try {
    const r = await api.readOpenClawToolsAgentToAgent();
    if (r.ok) {
      const allow = Array.isArray(r.allow) ? r.allow.filter((x): x is string => typeof x === "string") : [];
      const sv =
        typeof r.sessionsVisibility === "string" && r.sessionsVisibility.length > 0
          ? r.sessionsVisibility
          : null;
      applyTopologyFromOfficial({ enabled: r.enabled === true, allow }, sv);
    }
  } catch {
    topoAllowReadback.value = "";
  }
}

async function refreshHubData(): Promise<void> {
  await refreshList();
  await loadModelPickerOptions();
  await refreshTopologyState();
}

watch(topoTemplate, (next, prev) => {
  if (next === "custom" && (prev === "star" || prev === "bidirectional")) {
    const m = "main";
    const subs = agentIdsFromRows.value.filter((id) => id !== m);
    topoCustomEdges.value = subs.map((to) => ({ from: m, to }));
  }
  if (next !== "custom" && next !== "off") {
    topoError.value = null;
  }
});

function addTopoEdgeRow(): void {
  topoCustomEdges.value = [...topoCustomEdges.value, { from: "", to: "" }];
}

function removeTopoEdgeRow(i: number): void {
  topoCustomEdges.value = topoCustomEdges.value.filter((_, j) => j !== i);
}

function topologyErrorMessage(code: string): string {
  const key = `company.topologyErr.${code}`;
  const msg = t(key);
  return msg === key ? code : msg;
}

async function saveTopology(): Promise<void> {
  topoError.value = null;
  if (!canSaveTopology.value) {
    topoError.value = t("company.saveNeedsDesktopOrGateway");
    return;
  }
  const ids = agentIdsFromRows.value;
  if (topoTemplate.value === "full" && ids.length > 2) {
    const ok = window.confirm(t("company.topologyFullMeshConfirm"));
    if (!ok) {
      return;
    }
  }
  const compiled = compileAgentToAgentTopology({
    template: topoTemplate.value,
    agentIds: ids,
    customEdges: topoCustomEdges.value,
  });
  if (!compiled.ok) {
    topoError.value = topologyErrorMessage(compiled.error);
    return;
  }
  topoBusy.value = true;
  let attemptedGatewayWrite = false;
  try {
    const gc = gateway.client;
    const api = getDidClawDesktopApi();
    if (gc?.connected) {
      attemptedGatewayWrite = true;
      try {
        await patchToolsAgentToAgentViaGateway(gc, compiled.config, {
          sessionKey: sessionStore.activeSessionKey,
        });
        chat.flashOpenClawConfigHint(
          [t("company.afterWriteTopologyViaGateway"), getOpenClawAfterWriteHint()].filter(Boolean).join("\n\n"),
        );
        await refreshTopologyState();
        return;
      } catch (e) {
        if (!api?.writeOpenClawToolsAgentToAgentMerge) {
          topoError.value = formatGatewaySaveError(e);
          return;
        }
      }
    }
    if (!api?.writeOpenClawToolsAgentToAgentMerge) {
      topoError.value = t("company.saveNeedsDesktopOrGateway");
      return;
    }
    const res = await api.writeOpenClawToolsAgentToAgentMerge(compiled.config);
    if (!res.ok) {
      topoError.value = res.backupPath ? `${res.error}（备份：${res.backupPath}）` : res.error;
      return;
    }
    chat.flashOpenClawConfigHint(
      [
        attemptedGatewayWrite
          ? `${t("company.afterWriteTopologyLocalFallbackLead")}\n${getOpenClawAfterWriteHint()}`
          : getOpenClawAfterWriteHint(),
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
    await refreshTopologyState();
  } catch (e) {
    topoError.value = e instanceof Error ? e.message : String(e);
  } finally {
    topoBusy.value = false;
  }
}

watch(
  () => props.open,
  (v) => {
    if (v) {
      void refreshHubData();
    }
  },
);

function addRow(): void {
  rows.value = [
    ...rows.value,
    {
      id: "",
      name: "",
      workspace: "default",
      model: suggestedDefaultModel.value.trim(),
    },
  ];
}

function removeRow(i: number): void {
  rows.value = rows.value.filter((_, j) => j !== i);
}

async function saveAgents(): Promise<void> {
  error.value = null;
  const api = getDidClawDesktopApi();
  let primaryModelFallback = "";
  if (isDidClawDesktop()) {
    try {
      const snap = await readOpenClawAiSnapshot();
      primaryModelFallback = snap.primaryModel.trim();
    } catch {
      /* 无法读取快照时仅按表格原样写入 */
    }
  }
  const agents: Record<string, unknown>[] = [];
  for (const r of rows.value) {
    const id = r.id.trim();
    if (!id) {
      continue;
    }
    const o: Record<string, unknown> = { id };
    if (r.name.trim()) {
      o.name = r.name.trim();
    }
    if (r.workspace.trim()) {
      o.workspace = r.workspace.trim();
    }
    let modelVal = r.model.trim();
    if (!modelVal && id !== "main" && primaryModelFallback) {
      modelVal = primaryModelFallback;
    }
    if (modelVal) {
      o.model = modelVal;
    }
    agents.push(o);
  }
  if (agents.length === 0) {
    error.value = t("company.needOneAgentId");
    return;
  }
  if (!canMergeAgents.value) {
    error.value = t("company.saveNeedsDesktopOrGateway");
    return;
  }
  busy.value = true;
  let attemptedGatewayWrite = false;
  try {
    const gc = gateway.client;
    if (gc?.connected) {
      attemptedGatewayWrite = true;
      try {
        await patchAgentsListMergeViaGateway(gc, agents, {
          sessionKey: sessionStore.activeSessionKey,
        });
        const gwExtra = await collectSubagentAuthSyncLines();
        chat.flashOpenClawConfigHint(
          [t("company.afterWriteAgentsViaGateway"), ...gwExtra].filter(Boolean).join("\n\n"),
        );
        await refreshHubData();
        return;
      } catch (e) {
        if (!api?.writeOpenClawAgentsListMerge) {
          error.value = formatGatewaySaveError(e);
          return;
        }
        /* 有桌面合并能力时继续走下方 Tauri，不在此置错以免成功后仍显示警告。 */
      }
    }
    if (!api?.writeOpenClawAgentsListMerge) {
      error.value = t("company.saveNeedsDesktopOrGateway");
      return;
    }
    const res = await api.writeOpenClawAgentsListMerge({ agents });
    if (!res.ok) {
      error.value = res.backupPath ? `${res.error}（备份：${res.backupPath}）` : res.error;
      return;
    }
    const mergeExtra = authSyncLinesFromMergeRes(res);
    chat.flashOpenClawConfigHint(
      [
        attemptedGatewayWrite
          ? `${t("company.afterWriteAgentsLocalFallbackLead")}\n${getOpenClawAfterWriteHint()}`
          : getOpenClawAfterWriteHint(),
        ...mergeExtra,
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
    await refreshHubData();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

function openRoleForAgent(agentId: string): void {
  companyPanels.openPanel(agentId.trim());
}

function openAllNonMain(): void {
  try {
    const parsed = JSON.parse(listJson.value) as unknown;
    if (!Array.isArray(parsed)) {
      return;
    }
    const ids: string[] = [];
    const labels: Record<string, string> = {};
    for (const item of parsed) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const o = item as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id.trim() : "";
      if (!id || id === "main") {
        continue;
      }
      ids.push(id);
      const name = typeof o.name === "string" ? o.name.trim() : "";
      if (name) {
        labels[id] = name;
      }
    }
    companyPanels.openAllFromAgentIds(ids, labels);
  } catch {
    /* ignore */
  }
}

function onBackdrop(): void {
  emit("close");
}

/** 将 main 的 auth-profiles 同步到子代理目录；返回文案片段供与保存提示合并。 */
async function collectSubagentAuthSyncLines(): Promise<string[]> {
  const api = getDidClawDesktopApi();
  if (!api?.syncOpenclawSubagentAuthProfilesFromMain) {
    return [];
  }
  try {
    const sync = await api.syncOpenclawSubagentAuthProfilesFromMain();
    if (!sync.ok) {
      return [];
    }
    const lines: string[] = [];
    const synced = (sync.synced ?? []).filter((x): x is string => typeof x === "string");
    if (synced.length > 0) {
      lines.push(t("company.authProfilesSyncedHint", { agents: synced.join(", ") }));
    }
    const errs = sync.errors ?? [];
    if (errs.length > 0) {
      const detail = errs
        .map((e) => {
          const id = e && typeof e === "object" ? String((e as { agentId?: string }).agentId ?? "?") : "?";
          const msg = e && typeof e === "object" ? String((e as { error?: string }).error ?? "") : String(e);
          return `${id}: ${msg}`;
        })
        .join("; ");
      lines.push(t("company.authProfilesSyncErrorsHint", { detail }));
    }
    return lines;
  } catch {
    return [];
  }
}

async function syncCompanyRosterSkill(): Promise<void> {
  rosterError.value = null;
  const api = getDidClawDesktopApi();
  if (!api?.writeOpenclawCompanyRosterSkill) {
    rosterError.value = t("company.rosterNeedsDesktop");
    return;
  }
  const agents = rows.value
    .map((r) => ({ id: r.id.trim() }))
    .filter((r) => r.id.length > 0);
  if (agents.length === 0) {
    rosterError.value = t("company.needOneAgentId");
    return;
  }
  const md = rosterSkillPreview.value;
  rosterBusy.value = true;
  try {
    const w = await api.writeOpenclawCompanyRosterSkill({ skillMd: md });
    if (!w.ok) {
      rosterError.value = w.error ?? t("company.rosterWriteFailed");
      return;
    }
    const parts: string[] = [
      t("company.afterWriteRosterSkillDisk", {
        path: "path" in w && typeof w.path === "string" ? w.path : COMPANY_ROSTER_SKILL_SLUG,
        slug: COMPANY_ROSTER_SKILL_SLUG,
      }),
    ];
    if ("backupPath" in w && typeof w.backupPath === "string" && w.backupPath.length > 0) {
      parts.push(t("company.afterWriteRosterSkillBackup", { path: w.backupPath }));
    }
    const gc = gateway.client;
    if (gc?.connected) {
      try {
        await patchSkillsEntryEnabledViaGateway(gc, COMPANY_ROSTER_SKILL_SLUG, true, {
          sessionKey: sessionStore.activeSessionKey,
        });
        parts.push(t("company.afterWriteRosterSkillGateway"));
      } catch (e) {
        try {
          await writeOpenClawSkillEnabled(COMPANY_ROSTER_SKILL_SLUG, true);
          parts.push(
            t("company.afterWriteRosterSkillLocalFallback", {
              message: formatGatewaySaveError(e),
            }),
          );
        } catch (e2) {
          rosterError.value =
            t("company.rosterSkillFileOkConfigFailed", {
              message: e2 instanceof Error ? e2.message : String(e2),
            }) + `\n${formatGatewaySaveError(e)}`;
          return;
        }
      }
    } else {
      try {
        await writeOpenClawSkillEnabled(COMPANY_ROSTER_SKILL_SLUG, true);
        parts.push(t("company.afterWriteRosterSkillOpenclawJson"));
      } catch (e) {
        rosterError.value = e instanceof Error ? e.message : String(e);
        return;
      }
    }
    chat.flashOpenClawConfigHint(
      [...parts, getOpenClawAfterWriteHint()].filter(Boolean).join("\n\n"),
    );
  } catch (e) {
    rosterError.value = e instanceof Error ? e.message : String(e);
  } finally {
    rosterBusy.value = false;
  }
}

function authSyncLinesFromMergeRes(res: {
  authProfilesSynced?: unknown;
  authProfilesSyncErrors?: unknown;
}): string[] {
  const lines: string[] = [];
  const synced = res.authProfilesSynced;
  if (Array.isArray(synced) && synced.length > 0 && synced.every((x) => typeof x === "string")) {
    lines.push(t("company.authProfilesSyncedHint", { agents: synced.join(", ") }));
  }
  const errs = res.authProfilesSyncErrors;
  if (Array.isArray(errs) && errs.length > 0) {
    const detail = errs
      .map((e) => {
        if (e && typeof e === "object") {
          const o = e as { agentId?: string; error?: string };
          return `${o.agentId ?? "?"}: ${o.error ?? ""}`;
        }
        return String(e);
      })
      .join("; ");
    lines.push(t("company.authProfilesSyncErrorsHint", { detail }));
  }
  return lines;
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="hub-overlay" @click.self="onBackdrop">
      <div class="hub-dialog" role="dialog" aria-modal="true" :aria-label="t('company.hubTitle')" @click.stop>
        <header class="hub-head">
          <h2 class="hub-title">{{ t("company.hubTitle") }}</h2>
          <button type="button" class="hub-x" :aria-label="t('company.closeDialog')" @click="emit('close')">×</button>
        </header>

        <div class="hub-body">
          <p v-if="!canMergeAgents" class="err">{{ t("company.saveNeedsDesktopOrGateway") }}</p>

          <section class="hub-section">
            <h3>{{ t("company.wizardSection") }}</h3>
            <p class="hint">{{ t("company.wizardHint") }}</p>
            <p v-if="modelPickerError" class="hint model-picker-err">{{ t("company.modelPickerLoadFailed", { message: modelPickerError }) }}</p>
            <p v-if="rowsMissingModel" class="hint model-missing-hint">{{ t("company.rowsMissingModelHint") }}</p>
            <table class="grid-table">
              <thead>
                <tr>
                  <th>{{ t("company.colId") }}</th>
                  <th>{{ t("company.colName") }}</th>
                  <th>{{ t("company.colWorkspace") }}</th>
                  <th>{{ t("company.colModel") }}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in rows" :key="i">
                  <td><input v-model="r.id" class="inp" :placeholder="t('company.phId')"></td>
                  <td><input v-model="r.name" class="inp" :placeholder="t('company.phName')"></td>
                  <td><input v-model="r.workspace" class="inp"></td>
                  <td>
                    <select v-if="useModelSelect" v-model="r.model" class="inp model-select">
                      <option value="">{{ t("company.modelUseDefault") }}</option>
                      <option v-for="opt in modelOptionsForSelect" :key="opt.value" :value="opt.value">
                        {{ opt.label }}
                      </option>
                    </select>
                    <input v-else v-model="r.model" class="inp" :placeholder="t('company.phModel')">
                  </td>
                  <td>
                    <button type="button" class="lc-btn lc-btn-ghost lc-btn-xs" @click="removeRow(i)">−</button>
                  </td>
                </tr>
              </tbody>
            </table>
            <div class="row-actions">
              <button type="button" class="lc-btn lc-btn-ghost lc-btn-sm" @click="addRow">{{ t("company.addRow") }}</button>
              <button
                type="button"
                class="lc-btn lc-btn-primary lc-btn-sm"
                :disabled="busy || !canMergeAgents"
                @click="saveAgents"
              >
                {{ t("company.mergeToOpenclaw") }}
              </button>
            </div>
          </section>

          <section class="hub-section">
            <h3>{{ t("company.topologySection") }}</h3>
            <p class="hint">{{ t("company.topologyHint") }}</p>
            <p class="hint">{{ t("company.topologyVsColumnsHint") }}</p>
            <p v-if="showTopologyMainMissingWarning" class="hint topology-main-missing">
              {{ t("company.topologyMainMissingWarning") }}
            </p>
            <p class="hint">{{ t("company.topologyRuntimeHint") }}</p>
            <p class="hint">
              <a
                class="topology-doc-link"
                href="https://docs.openclaw.ai/concepts/multi-agent"
                target="_blank"
                rel="noopener noreferrer"
              >{{ t("company.topologyDocMultiAgent") }}</a>
              ·
              <a
                class="topology-doc-link"
                href="https://docs.openclaw.ai/gateway/security"
                target="_blank"
                rel="noopener noreferrer"
              >{{ t("company.topologyDocSecurity") }}</a>
            </p>
            <div class="topology-row">
              <label class="topology-label">{{ t("company.topologyTemplate") }}</label>
              <select v-model="topoTemplate" class="inp topology-select" :disabled="topoBusy">
                <option value="off">{{ t("company.topologyTplOff") }}</option>
                <option value="star">{{ t("company.topologyTplStar") }}</option>
                <option value="bidirectional">{{ t("company.topologyTplBidirectional") }}</option>
                <option value="full">{{ t("company.topologyTplFull") }}</option>
                <option value="custom">{{ t("company.topologyTplCustom") }}</option>
              </select>
            </div>
            <div v-if="topoTemplate === 'custom'" class="topology-custom">
              <p class="hint">{{ t("company.topologyCustomHint") }}</p>
              <table class="grid-table">
                <thead>
                  <tr>
                    <th>{{ t("company.topologyFrom") }}</th>
                    <th>{{ t("company.topologyTo") }}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(edge, ei) in topoCustomEdges" :key="ei">
                    <td>
                      <select v-model="edge.from" class="inp model-select">
                        <option value="">{{ t("company.topologyPickAgent") }}</option>
                        <option v-for="aid in topologyAgentSelectOptions" :key="`f-${ei}-${aid}`" :value="aid">
                          {{ aid }}
                        </option>
                      </select>
                    </td>
                    <td>
                      <select v-model="edge.to" class="inp model-select">
                        <option value="">{{ t("company.topologyPickAgent") }}</option>
                        <option v-for="aid in topologyAgentSelectOptions" :key="`t-${ei}-${aid}`" :value="aid">
                          {{ aid }}
                        </option>
                      </select>
                    </td>
                    <td>
                      <button type="button" class="lc-btn lc-btn-ghost lc-btn-xs" @click="removeTopoEdgeRow(ei)">−</button>
                    </td>
                  </tr>
                </tbody>
              </table>
              <button type="button" class="lc-btn lc-btn-ghost lc-btn-sm" @click="addTopoEdgeRow">
                {{ t("company.topologyAddEdge") }}
              </button>
            </div>
            <p v-if="topoAllowReadback" class="hint topology-readback-label">{{ t("company.topologyCurrentJson") }}</p>
            <pre v-if="topoAllowReadback" class="json-preview topology-json-preview">{{ topoAllowReadback }}</pre>
            <div class="row-actions">
              <button
                type="button"
                class="lc-btn lc-btn-primary lc-btn-sm"
                :disabled="topoBusy || !canSaveTopology"
                @click="saveTopology"
              >
                {{ t("company.topologySave") }}
              </button>
            </div>
            <p v-if="topoError" class="err">{{ topoError }}</p>
          </section>

          <section class="hub-section">
            <h3>{{ t("company.rosterSection") }}</h3>
            <p class="hint">{{ t("company.rosterHint") }}</p>
            <p class="hint">
              <code class="roster-slug">{{ COMPANY_ROSTER_SKILL_SLUG }}</code>
              ·
              <span>{{ t("company.rosterManagedDirHint") }}</span>
            </p>
            <label class="roster-charter-label">{{ t("company.rosterWorkspaceLabel") }}</label>
            <input
              v-model="rosterWorkspaceRoot"
              type="text"
              class="inp roster-workspace-root"
              :placeholder="t('company.rosterWorkspacePlaceholder')"
            >
            <p class="hint roster-workspace-hint">{{ t("company.rosterWorkspaceHint") }}</p>
            <label class="roster-charter-label">{{ t("company.rosterCharterLabel") }}</label>
            <textarea
              v-model="rosterCharter"
              class="inp roster-charter"
              rows="3"
              :placeholder="t('company.rosterCharterPlaceholder')"
            />
            <p class="hint roster-preview-label">{{ t("company.rosterPreviewLabel") }}</p>
            <pre class="json-preview roster-md-preview">{{ rosterSkillPreview }}</pre>
            <div class="row-actions">
              <button
                type="button"
                class="lc-btn lc-btn-primary lc-btn-sm"
                :disabled="rosterBusy || !canSyncCompanyRosterSkill"
                @click="syncCompanyRosterSkill"
              >
                {{ t("company.rosterSync") }}
              </button>
            </div>
            <p v-if="!canSyncCompanyRosterSkill" class="hint">{{ t("company.rosterNeedsDesktop") }}</p>
            <p v-if="rosterError" class="err">{{ rosterError }}</p>
          </section>

          <section class="hub-section">
            <h3>{{ t("company.currentAgentsJson") }}</h3>
            <pre class="json-preview">{{ listJson }}</pre>
            <div class="row-actions">
              <button type="button" class="lc-btn lc-btn-ghost lc-btn-sm" :disabled="busy" @click="refreshHubData">
                {{ t("company.refreshList") }}
              </button>
              <button type="button" class="lc-btn lc-btn-ghost lc-btn-sm" @click="openAllNonMain">
                {{ t("company.openAllRolePanels") }}
              </button>
            </div>
            <p class="hint">{{ t("company.openPanelHint") }}</p>
            <ul class="agent-quick">
              <li v-for="(pid, idx) in parsedAgentList" :key="idx">
                <button
                  v-if="isOpenableRoleAgent(pid)"
                  type="button"
                  class="lc-btn lc-btn-ghost lc-btn-xs"
                  @click="openRoleForAgent(pid.id)"
                >
                  {{ t("company.openRolePanel") }}: {{ pid.id }}
                </button>
              </li>
            </ul>
          </section>

          <p v-if="error" class="err">{{ error }}</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.hub-overlay {
  position: fixed;
  inset: 0;
  z-index: 12000;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.hub-dialog {
  width: min(840px, 100%);
  max-height: min(90vh, 900px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--lc-surface-panel);
  color: var(--lc-text);
  border-radius: var(--lc-radius-md);
  border: 1px solid var(--lc-border);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
}
.hub-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--lc-border);
}
.hub-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.hub-x {
  background: none;
  border: none;
  font-size: 22px;
  cursor: pointer;
  color: var(--lc-text-dim);
  line-height: 1;
}
.hub-x:hover {
  color: var(--lc-text);
}
.hub-body {
  padding: 14px 16px 18px;
  overflow: auto;
}
.hub-section {
  margin-bottom: 20px;
}
.hub-section h3 {
  margin: 0 0 8px;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--lc-text-muted);
}
.hint {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--lc-text-muted);
  line-height: 1.45;
}
.grid-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  margin-bottom: 10px;
}
.grid-table th,
.grid-table td {
  border: 1px solid var(--lc-border);
  padding: 4px 6px;
  text-align: left;
}
.inp {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  padding: 4px 6px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-raised);
  color: var(--lc-text);
}
.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.json-preview {
  margin: 0 0 10px;
  padding: 10px;
  font-size: 11px;
  line-height: 1.4;
  overflow: auto;
  max-height: 200px;
  background: var(--lc-bg-raised);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  white-space: pre-wrap;
  word-break: break-all;
}
.agent-quick {
  margin: 8px 0 0;
  padding-left: 18px;
  font-size: 12px;
}
.err {
  color: var(--lc-error);
  font-size: 13px;
  margin-top: 8px;
}
.model-select {
  cursor: pointer;
}
.model-picker-err {
  color: var(--lc-text-muted);
}
.model-missing-hint {
  color: var(--lc-warning, #b45309);
}
.topology-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.topology-label {
  font-size: 12px;
  color: var(--lc-text-muted);
}
.topology-select {
  min-width: 220px;
}
.topology-custom {
  margin-bottom: 12px;
}
.topology-doc-link {
  color: var(--lc-accent, #3b82f6);
  text-decoration: none;
}
.topology-doc-link:hover {
  text-decoration: underline;
}
.topology-readback-label {
  margin-top: 8px;
}
.topology-json-preview {
  max-height: 120px;
}
.topology-main-missing {
  color: var(--lc-warning, #b45309);
}
.roster-slug {
  font-size: 11px;
}
.roster-charter-label {
  display: block;
  font-size: 12px;
  color: var(--lc-text-muted);
  margin-bottom: 6px;
}
.roster-workspace-root {
  width: 100%;
  box-sizing: border-box;
  margin-bottom: 6px;
}
.roster-workspace-hint {
  margin-top: 0;
  margin-bottom: 12px;
}
.roster-charter {
  width: 100%;
  box-sizing: border-box;
  margin-bottom: 10px;
  font-family: inherit;
  resize: vertical;
  min-height: 64px;
}
.roster-preview-label {
  margin-top: 4px;
}
.roster-md-preview {
  max-height: 200px;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 11px;
}
</style>
