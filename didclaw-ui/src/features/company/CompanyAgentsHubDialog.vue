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
  type CompanyRosterAgentRow,
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
import { useGatewayStore } from "@/stores/gateway";
import { useSessionStore } from "@/stores/session";
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useI18n();
const chat = useChatStore();
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

/** 第五步：共享公司技能（~/.openclaw/skills + skills.entries） */
const rosterCharter = ref("");
/** 公司共享工作区根（绝对路径），写入 roster 技能，避免职务默认落到 npm 包内 default */
const rosterWorkspaceRoot = ref("");
const rosterBusy = ref(false);
const rosterError = ref<string | null>(null);

/** 合并保存 / 同步 roster 成功后，向各 `agent:<id>:main` 发送一条开场 user 消息（需网关）。 */
const seedIntroAfterSave = ref(true);

/** 五步向导：0 公司信息 → 1 架构 → 2 职务 → 3 协作拓扑 → 4 完成 */
const WIZARD_LAST_STEP = 4;
/** 职务表人数预设（上限 7，与内存说明一致） */
const rosterPresetSizes = [3, 4, 5, 6, 7] as const;
const wizardStep = ref(0);
const wizardCompanyName = ref("");
const wizardCompanyTagline = ref("");
const structureChoice = ref<"" | "flat" | "pyramid">("");
const wizardBlockReason = ref("");
const syncRosterOnFinish = ref(true);
const wizardApplyAllBusy = ref(false);
/** 一键保存成功后跳过下一次关闭时的草稿写入，避免把已提交状态又写回 sessionStorage */
const skipWizardDraftOnNextClose = ref(false);

/** 关闭 hub 时持久化向导草稿，避免再次打开被重置或 `refreshList` 覆盖未保存的表格 */
const WIZARD_DRAFT_KEY = "didclaw-company-hub-wizard-draft-v1";

type WizardDraftV1 = {
  v: 1;
  wizardStep: number;
  wizardCompanyName: string;
  wizardCompanyTagline: string;
  structureChoice: "" | "flat" | "pyramid";
  rows: Array<{ id: string; name: string; workspace: string; model: string }>;
  topoTemplate: TopologyTemplate;
  topoCustomEdges: AgentTopologyEdge[];
  rosterCharter: string;
  rosterWorkspaceRoot: string;
  seedIntroAfterSave: boolean;
  syncRosterOnFinish: boolean;
};

function isTopologyTemplate(x: unknown): x is TopologyTemplate {
  return x === "off" || x === "star" || x === "bidirectional" || x === "full" || x === "custom";
}

function isStructureChoice(x: unknown): x is "" | "flat" | "pyramid" {
  return x === "" || x === "flat" || x === "pyramid";
}

function normalizeDraftRows(
  rowsRaw: unknown,
): Array<{ id: string; name: string; workspace: string; model: string }> {
  if (!Array.isArray(rowsRaw) || rowsRaw.length === 0) {
    return [{ id: "", name: "", workspace: "default", model: "" }];
  }
  const out: Array<{ id: string; name: string; workspace: string; model: string }> = [];
  for (const item of rowsRaw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const r = item as Record<string, unknown>;
    out.push({
      id: typeof r.id === "string" ? r.id : "",
      name: typeof r.name === "string" ? r.name : "",
      workspace:
        typeof r.workspace === "string" && r.workspace.trim() !== "" ? r.workspace : "default",
      model: typeof r.model === "string" ? r.model : "",
    });
  }
  return out.length > 0 ? out : [{ id: "", name: "", workspace: "default", model: "" }];
}

function parseWizardDraftJson(raw: string): WizardDraftV1 | null {
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") {
      return null;
    }
    const d = o as Record<string, unknown>;
    if (d.v !== 1) {
      return null;
    }
    if (!isTopologyTemplate(d.topoTemplate) || !isStructureChoice(d.structureChoice)) {
      return null;
    }
    const st = d.wizardStep;
    const ws = typeof st === "number" && Number.isFinite(st) ? Math.floor(st) : 0;
    const edgesRaw = d.topoCustomEdges;
    const topoCustomEdges: AgentTopologyEdge[] = [];
    if (Array.isArray(edgesRaw)) {
      for (const e of edgesRaw) {
        if (!e || typeof e !== "object") {
          continue;
        }
        const ed = e as Record<string, unknown>;
        const from = typeof ed.from === "string" ? ed.from : "";
        const to = typeof ed.to === "string" ? ed.to : "";
        topoCustomEdges.push({ from, to });
      }
    }
    return {
      v: 1,
      wizardStep: ws,
      wizardCompanyName: typeof d.wizardCompanyName === "string" ? d.wizardCompanyName : "",
      wizardCompanyTagline: typeof d.wizardCompanyTagline === "string" ? d.wizardCompanyTagline : "",
      structureChoice: d.structureChoice,
      rows: normalizeDraftRows(d.rows),
      topoTemplate: d.topoTemplate,
      topoCustomEdges,
      rosterCharter: typeof d.rosterCharter === "string" ? d.rosterCharter : "",
      rosterWorkspaceRoot: typeof d.rosterWorkspaceRoot === "string" ? d.rosterWorkspaceRoot : "",
      seedIntroAfterSave: d.seedIntroAfterSave === false ? false : true,
      syncRosterOnFinish: d.syncRosterOnFinish === false ? false : true,
    };
  } catch {
    return null;
  }
}

function loadWizardDraft(): WizardDraftV1 | null {
  if (typeof sessionStorage === "undefined") {
    return null;
  }
  try {
    const raw = sessionStorage.getItem(WIZARD_DRAFT_KEY);
    if (!raw) {
      return null;
    }
    return parseWizardDraftJson(raw);
  } catch {
    return null;
  }
}

function saveWizardDraft(): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  try {
    const d: WizardDraftV1 = {
      v: 1,
      wizardStep: wizardStep.value,
      wizardCompanyName: wizardCompanyName.value,
      wizardCompanyTagline: wizardCompanyTagline.value,
      structureChoice: structureChoice.value,
      rows: rows.value.map((r) => ({ ...r })),
      topoTemplate: topoTemplate.value,
      topoCustomEdges: topoCustomEdges.value.map((e) => ({ ...e })),
      rosterCharter: rosterCharter.value,
      rosterWorkspaceRoot: rosterWorkspaceRoot.value,
      seedIntroAfterSave: seedIntroAfterSave.value,
      syncRosterOnFinish: syncRosterOnFinish.value,
    };
    sessionStorage.setItem(WIZARD_DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* quota / private mode */
  }
}

function clearWizardDraft(): void {
  try {
    sessionStorage.removeItem(WIZARD_DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

function applyWizardDraft(d: WizardDraftV1): void {
  wizardStep.value = Math.min(WIZARD_LAST_STEP, Math.max(0, d.wizardStep));
  wizardCompanyName.value = d.wizardCompanyName;
  wizardCompanyTagline.value = d.wizardCompanyTagline;
  structureChoice.value = d.structureChoice;
  rows.value = d.rows.map((r) => ({ ...r }));
  topoTemplate.value = d.topoTemplate;
  topoCustomEdges.value = d.topoCustomEdges.map((e) => ({ ...e }));
  rosterCharter.value = d.rosterCharter;
  rosterWorkspaceRoot.value = d.rosterWorkspaceRoot;
  seedIntroAfterSave.value = d.seedIntroAfterSave;
  syncRosterOnFinish.value = d.syncRosterOnFinish;
}

async function bootstrapCompanyHubWhenOpen(): Promise<void> {
  wizardBlockReason.value = "";
  const draft = loadWizardDraft();
  await loadModelPickerOptions();
  if (!draft) {
    wizardStep.value = 0;
  }
  await refreshList();
  await refreshTopologyState();
  if (draft) {
    applyWizardDraft(draft);
  }
}

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

function rosterAgentsFromRows(): CompanyRosterAgentRow[] {
  return rows.value
    .map((r) => ({
      id: r.id.trim(),
      name: r.name.trim(),
      workspace: r.workspace.trim() || "default",
      model: r.model.trim(),
    }))
    .filter((r) => r.id.length > 0);
}

async function appendSeedBootstrapLines(lines: string[]): Promise<void> {
  if (!seedIntroAfterSave.value) {
    return;
  }
  const agents = rosterAgentsFromRows();
  if (agents.length === 0) {
    return;
  }
  if (!gateway.client?.connected) {
    lines.push(t("company.seedBootstrapNeedGateway"));
    return;
  }
  const r = await chat.seedCompanyAgentBootstrapUserMessages({ agents });
  if (r.seeded.length > 0) {
    lines.push(t("company.seedBootstrapSeeded", { ids: r.seeded.join(", ") }));
  }
  if (r.skipped.length > 0) {
    lines.push(t("company.seedBootstrapSkippedDup", { ids: r.skipped.join(", ") }));
  }
  if (r.failed.length > 0) {
    const detail = r.failed.map((f) => `${f.agentId}: ${f.error}`).join("; ");
    lines.push(t("company.seedBootstrapFailed", { detail }));
  }
}

const rosterSkillPreview = computed(() => {
  const ids = agentIdsFromRows.value;
  const topo = compileAgentToAgentTopology({
    template: topoTemplate.value,
    agentIds: ids,
    customEdges: topoCustomEdges.value,
  });
  const topology = topo.ok ? topo.config : { enabled: false, allow: [] as string[] };
  const agents = rosterAgentsFromRows();
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

const wizardStepLabel = computed(() => t(`company.wizardStepLabel${wizardStep.value}`));

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

function applyTopologyFromOfficial(
  ata: { enabled: boolean; allow: string[] },
  _sessionsVisibility: string | null,
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
    /* ignore */
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
      topoError.value = t("company.topologyFullMeshSaveCancelled");
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
    if (!v) {
      if (!skipWizardDraftOnNextClose.value) {
        saveWizardDraft();
      } else {
        skipWizardDraftOnNextClose.value = false;
      }
      return;
    }
    void bootstrapCompanyHubWhenOpen();
  },
);

/** 扁平架构预设代号（7 个以内）；须符合 agent id 字母开头规则 */
const ROSTER_PRESET_IDS_FLAT = ["sales", "ops", "eng", "legal", "pm", "support", "analyst"] as const;
/** 金字塔架构在 main 之后的预设代号（至多 6 个，与 main 合计 ≤7） */
const ROSTER_PRESET_IDS_AFTER_MAIN = ["sales", "ops", "eng", "legal", "pm", "support"] as const;

/** 将职务表设为目标人数（3–7），预填代号；会覆盖当前行。 */
function applyRosterPreset(count: number): void {
  const n = Math.min(7, Math.max(3, Math.floor(count)));
  const m = suggestedDefaultModel.value.trim();
  const pyramid = structureChoice.value === "pyramid";
  const ids: string[] = pyramid
    ? ["main", ...ROSTER_PRESET_IDS_AFTER_MAIN.slice(0, n - 1)]
    : [...ROSTER_PRESET_IDS_FLAT.slice(0, n)];
  rows.value = ids.map((id) => ({ id, name: "", workspace: "default", model: m }));
}

function applyStructureTemplate(choice: "flat" | "pyramid"): void {
  const m = suggestedDefaultModel.value.trim();
  const filled = rows.value.filter((r) => r.id.trim() !== "");
  if (choice === "pyramid") {
    if (filled.length === 0) {
      rows.value = [
        { id: "main", name: "", workspace: "default", model: m },
        { id: "sales", name: "", workspace: "default", model: m },
      ];
    } else if (!agentIdsFromRows.value.includes("main")) {
      rows.value = [
        { id: "main", name: "", workspace: "default", model: m },
        ...rows.value.filter((r) => r.id.trim() !== ""),
      ];
    }
  } else if (filled.length === 0) {
    rows.value = [
      { id: "", name: "", workspace: "default", model: m },
      { id: "", name: "", workspace: "default", model: m },
    ];
  }
}

function maybePrefillRosterCharterFromWizard(): void {
  if (rosterCharter.value.trim()) {
    return;
  }
  const name = wizardCompanyName.value.trim();
  const tag = wizardCompanyTagline.value.trim();
  if (!name && !tag) {
    return;
  }
  rosterCharter.value = [name ? `# ${name}` : "", tag].filter(Boolean).join("\n\n");
}

function wizardBack(): void {
  wizardBlockReason.value = "";
  if (wizardStep.value > 0) {
    wizardStep.value -= 1;
  }
}

function wizardNext(): void {
  wizardBlockReason.value = "";
  if (wizardStep.value === 0) {
    if (!wizardCompanyName.value.trim()) {
      wizardBlockReason.value = t("company.wizardNeedCompanyName");
      return;
    }
  } else if (wizardStep.value === 1) {
    if (structureChoice.value !== "flat" && structureChoice.value !== "pyramid") {
      wizardBlockReason.value = t("company.wizardNeedStructure");
      return;
    }
    applyStructureTemplate(structureChoice.value);
  } else if (wizardStep.value === 2) {
    if (rosterAgentsFromRows().length === 0) {
      wizardBlockReason.value = t("company.wizardNeedOneRole");
      return;
    }
  }
  if (wizardStep.value < WIZARD_LAST_STEP) {
    wizardStep.value += 1;
    if (wizardStep.value === WIZARD_LAST_STEP) {
      void nextTick(() => {
        maybePrefillRosterCharterFromWizard();
      });
    }
  }
}

function wizardGoToStep(i: number): void {
  if (i < 0 || i > WIZARD_LAST_STEP || i > wizardStep.value) {
    return;
  }
  wizardBlockReason.value = "";
  wizardStep.value = i;
}

async function wizardApplyAll(): Promise<void> {
  wizardApplyAllBusy.value = true;
  wizardBlockReason.value = "";
  error.value = null;
  topoError.value = null;
  rosterError.value = null;
  try {
    await saveAgents();
    if (error.value) {
      return;
    }
    await saveTopology();
    if (topoError.value) {
      return;
    }
    if (canSyncCompanyRosterSkill.value && syncRosterOnFinish.value) {
      await syncCompanyRosterSkill();
      if (rosterError.value) {
        return;
      }
    }
    clearWizardDraft();
    skipWizardDraftOnNextClose.value = true;
  } finally {
    wizardApplyAllBusy.value = false;
  }
}

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
        const gwLines = [t("company.afterWriteAgentsViaGateway"), ...gwExtra].filter(Boolean);
        await appendSeedBootstrapLines(gwLines);
        chat.flashOpenClawConfigHint(gwLines.join("\n\n"));
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
    const mergeLines = [
      attemptedGatewayWrite
        ? `${t("company.afterWriteAgentsLocalFallbackLead")}\n${getOpenClawAfterWriteHint()}`
        : getOpenClawAfterWriteHint(),
      ...mergeExtra,
    ].filter(Boolean);
    await appendSeedBootstrapLines(mergeLines);
    chat.flashOpenClawConfigHint(mergeLines.join("\n\n"));
    await refreshHubData();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
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
    await appendSeedBootstrapLines(parts);
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
          <div class="hub-head-text">
            <h2 class="hub-title">{{ t("company.hubTitle") }}</h2>
            <p class="hub-wizard-step-eyebrow">{{ wizardStepLabel }}</p>
          </div>
          <button type="button" class="hub-x" :aria-label="t('company.closeDialog')" @click="emit('close')">×</button>
        </header>

        <div class="hub-wizard-stepper" role="tablist" :aria-label="t('company.wizardStepperAria')">
          <button
            v-for="si in 5"
            :key="si - 1"
            type="button"
            class="hub-step-dot"
            :class="{ 'hub-step-dot--active': wizardStep === si - 1, 'hub-step-dot--done': wizardStep > si - 1 }"
            :disabled="si - 1 > wizardStep"
            :aria-current="wizardStep === si - 1 ? 'step' : undefined"
            :title="t(`company.wizardStepLabel${si - 1}`)"
            @click="wizardGoToStep(si - 1)"
          />
        </div>

        <div class="hub-body">
          <p v-if="!canMergeAgents" class="err">{{ t("company.saveNeedsDesktopOrGateway") }}</p>

          <section v-show="wizardStep === 0" class="hub-section hub-wizard-panel">
            <h3>{{ t("company.wizardStep0Title") }}</h3>
            <p class="hint">{{ t("company.wizardStep0Hint") }}</p>
            <label class="wizard-field-label">{{ t("company.wizardCompanyNameLabel") }}</label>
            <input v-model="wizardCompanyName" type="text" class="inp wizard-company-name" autocomplete="organization">
            <label class="wizard-field-label">{{ t("company.wizardCompanyTaglineLabel") }}</label>
            <textarea
              v-model="wizardCompanyTagline"
              class="inp wizard-company-tagline"
              rows="2"
              :placeholder="t('company.wizardCompanyTaglinePh')"
            />
          </section>

          <section v-show="wizardStep === 1" class="hub-section hub-wizard-panel">
            <h3>{{ t("company.wizardStep1Title") }}</h3>
            <p class="hint">{{ t("company.wizardStep1Hint") }}</p>
            <div class="wizard-structure-grid">
              <div class="wizard-structure-cell">
                <input id="wiz-struct-flat" v-model="structureChoice" class="wizard-structure-input" type="radio" value="flat">
                <label class="wizard-structure-card" for="wiz-struct-flat">
                  <strong>{{ t("company.wizardStructureFlatTitle") }}</strong>
                  <span>{{ t("company.wizardStructureFlatDesc") }}</span>
                </label>
              </div>
              <div class="wizard-structure-cell">
                <input id="wiz-struct-pyramid" v-model="structureChoice" class="wizard-structure-input" type="radio" value="pyramid">
                <label class="wizard-structure-card" for="wiz-struct-pyramid">
                  <strong>{{ t("company.wizardStructurePyramidTitle") }}</strong>
                  <span>{{ t("company.wizardStructurePyramidDesc") }}</span>
                </label>
              </div>
            </div>
          </section>

          <section v-show="wizardStep === 2" class="hub-section hub-wizard-panel">
            <h3>{{ t("company.wizardStep2Title") }}</h3>
            <p class="hint">{{ t("company.wizardStep2MemoryHint") }}</p>
            <div class="wizard-roster-presets" role="group" :aria-label="t('company.wizardRosterPresetGroupAria')">
              <span class="wizard-roster-presets-label">{{ t("company.wizardRosterPresetLabel") }}</span>
              <button
                v-for="presetN in rosterPresetSizes"
                :key="presetN"
                type="button"
                class="lc-btn lc-btn-ghost lc-btn-sm"
                :title="t('company.wizardRosterPresetBtnTitle', { n: presetN })"
                @click="applyRosterPreset(presetN)"
              >
                {{ t("company.wizardRosterPresetN", { n: presetN }) }}
              </button>
            </div>
            <p class="hint wizard-roster-preset-foot">{{ t("company.wizardRosterPresetFoot") }}</p>
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
            </div>
          </section>

          <section v-show="wizardStep === 3" class="hub-section hub-wizard-panel">
            <h3>{{ t("company.wizardStep3Title") }}</h3>
            <p class="hint">{{ t("company.wizardStep3Hint") }}</p>
            <p v-if="showTopologyMainMissingWarning" class="hint topology-main-missing">
              {{ t("company.topologyMainMissingWarning") }}
            </p>
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
          </section>

          <section v-show="wizardStep === 4" class="hub-section hub-wizard-panel hub-wizard-finish">
            <h3>{{ t("company.wizardStep4Title") }}</h3>
            <p class="hint wizard-finish-hint">{{ t("company.wizardStep4FinishHint") }}</p>
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
              rows="8"
              :placeholder="t('company.rosterCharterPlaceholder')"
            />
            <div class="row-actions wizard-finish-actions">
              <button
                type="button"
                class="lc-btn lc-btn-primary"
                :disabled="wizardApplyAllBusy || busy || topoBusy || rosterBusy || !canMergeAgents"
                @click="wizardApplyAll"
              >
                {{ t("company.wizardFinishSave") }}
              </button>
            </div>
            <p v-if="rosterError" class="err">{{ rosterError }}</p>
          </section>

          <p v-if="wizardBlockReason" class="err">{{ wizardBlockReason }}</p>
          <p v-if="error" class="err">{{ error }}</p>
          <p v-if="topoError && wizardStep >= 3" class="err">{{ topoError }}</p>
        </div>

        <footer class="hub-wizard-footer">
          <button
            type="button"
            class="lc-btn lc-btn-ghost lc-btn-sm"
            :disabled="wizardStep === 0"
            @click="wizardBack"
          >
            {{ t("company.wizardBack") }}
          </button>
          <button
            v-if="wizardStep < WIZARD_LAST_STEP"
            type="button"
            class="lc-btn lc-btn-primary lc-btn-sm"
            @click="wizardNext"
          >
            {{ t("company.wizardNext") }}
          </button>
        </footer>
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
.hub-head-text {
  min-width: 0;
}
.hub-wizard-step-eyebrow {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--lc-text-muted);
  font-weight: 500;
}
.hub-wizard-stepper {
  display: flex;
  justify-content: center;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--lc-border);
  flex-shrink: 0;
}
.hub-step-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: none;
  padding: 0;
  background: var(--lc-border);
  cursor: pointer;
  transition: transform 0.12s ease, background 0.12s ease;
}
.hub-step-dot--active {
  background: var(--lc-accent, #3b82f6);
  transform: scale(1.2);
}
.hub-step-dot--done:not(.hub-step-dot--active) {
  background: color-mix(in srgb, var(--lc-accent, #3b82f6) 55%, var(--lc-border));
}
.hub-step-dot:disabled {
  opacity: 0.35;
  cursor: default;
  transform: none;
}
.hub-wizard-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-top: 1px solid var(--lc-border);
  flex-shrink: 0;
  background: var(--lc-surface-panel);
}
.hub-wizard-panel h3 {
  text-transform: none;
  letter-spacing: normal;
  font-size: 14px;
  color: var(--lc-text);
}
.wizard-field-label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  margin: 0 0 4px;
  color: var(--lc-text-muted);
}
.wizard-company-name {
  margin-bottom: 12px;
}
.wizard-company-tagline {
  margin-bottom: 0;
  resize: vertical;
  min-height: 48px;
}
.wizard-structure-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.wizard-structure-cell {
  position: relative;
}
@media (max-width: 560px) {
  .wizard-structure-grid {
    grid-template-columns: 1fr;
  }
}
.wizard-structure-input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
  pointer-events: none;
}
.wizard-structure-card {
  display: block;
  border: 2px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  padding: 12px 10px;
  cursor: pointer;
  text-align: center;
  transition:
    border-color 0.12s ease,
    background 0.12s ease;
}
.wizard-structure-card:hover {
  border-color: color-mix(in srgb, var(--lc-accent, #3b82f6) 35%, var(--lc-border));
  background: var(--lc-bg-raised);
}
.wizard-structure-input:focus-visible + .wizard-structure-card {
  outline: 2px solid var(--lc-accent, #3b82f6);
  outline-offset: 2px;
}
.wizard-structure-input:checked + .wizard-structure-card {
  border-color: var(--lc-accent, #3b82f6);
  background: color-mix(in srgb, var(--lc-accent, #3b82f6) 12%, transparent);
}
.wizard-structure-card strong {
  display: block;
  font-size: 13px;
  margin-bottom: 4px;
}
.wizard-structure-card span {
  font-size: 11px;
  color: var(--lc-text-muted);
  line-height: 1.35;
}
.wizard-roster-presets {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 10px 0 6px;
}
.wizard-roster-presets-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--lc-text-muted);
  margin-right: 4px;
}
.wizard-roster-preset-foot {
  margin-top: 0;
  margin-bottom: 10px;
  font-size: 12px;
}
.hub-wizard-finish .wizard-finish-hint {
  margin-bottom: 12px;
}
.wizard-finish-actions {
  margin-top: 14px;
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
  flex: 1;
  min-height: 0;
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
.topology-main-missing {
  color: var(--lc-warning, #b45309);
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
  min-height: 120px;
}
</style>
