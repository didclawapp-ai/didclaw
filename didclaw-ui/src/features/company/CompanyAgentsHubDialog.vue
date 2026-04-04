<script setup lang="ts">
import { getOpenClawAfterWriteHint } from "@/lib/openclaw-config-hint";
import { getDidClawDesktopApi, isDidClawElectron } from "@/lib/electron-bridge";
import {
  isGatewayConfigHashStaleError,
  isGatewayConfigPatchRejectedError,
  isGatewayConfigRequestError,
  patchAgentsListMergeViaGateway,
  extractAgentsListFromConfigGet,
  retryAfterSecondsFromGatewayDetails,
} from "@/lib/openclaw-gateway-config";
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

watch(
  () => props.open,
  (v) => {
    if (v) {
      void refreshList();
    }
  },
);

function addRow(): void {
  rows.value = [...rows.value, { id: "", name: "", workspace: "default", model: "" }];
}

function removeRow(i: number): void {
  rows.value = rows.value.filter((_, j) => j !== i);
}

async function saveAgents(): Promise<void> {
  error.value = null;
  const api = getDidClawDesktopApi();
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
    if (r.model.trim()) {
      o.model = r.model.trim();
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
        chat.flashOpenClawConfigHint(t("company.afterWriteAgentsViaGateway"));
        await refreshList();
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
    chat.flashOpenClawConfigHint(
      attemptedGatewayWrite
        ? `${t("company.afterWriteAgentsLocalFallbackLead")}\n${getOpenClawAfterWriteHint()}`
        : getOpenClawAfterWriteHint(),
    );
    await refreshList();
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
                  <td><input v-model="r.model" class="inp" :placeholder="t('company.phModel')"></td>
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
            <h3>{{ t("company.currentAgentsJson") }}</h3>
            <pre class="json-preview">{{ listJson }}</pre>
            <div class="row-actions">
              <button type="button" class="lc-btn lc-btn-ghost lc-btn-sm" :disabled="busy" @click="refreshList">
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
  width: min(720px, 100%);
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
</style>
