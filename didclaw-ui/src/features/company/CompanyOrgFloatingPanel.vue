<script setup lang="ts">
import { getDidClawDesktopApi, isDidClawElectron } from "@/lib/electron-bridge";
import { useCompanyRolePanelsStore } from "@/stores/companyRolePanels";
import { storeToRefs } from "pinia";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const company = useCompanyRolePanelsStore();
const { panels } = storeToRefs(company);

const expanded = ref(false);
const rootRef = ref<HTMLElement | null>(null);
const agentsLoading = ref(false);
const agentsError = ref<string | null>(null);
/** `{ id: string, name?: string }[]` from openclaw.json */
const configuredAgents = ref<Array<{ id: string; name?: string }>>([]);

const badgeCount = computed(() => panels.value.length);

async function loadConfiguredAgents(): Promise<void> {
  if (!isDidClawElectron()) {
    return;
  }
  const api = getDidClawDesktopApi();
  if (!api?.readOpenClawAgentsList) {
    agentsError.value = t("company.floatingNoApi");
    return;
  }
  agentsLoading.value = true;
  agentsError.value = null;
  try {
    const r = await api.readOpenClawAgentsList();
    if (!r.ok) {
      agentsError.value = "error" in r ? r.error : t("company.floatingLoadFailed");
      configuredAgents.value = [];
      return;
    }
    const list = Array.isArray(r.list) ? r.list : [];
    const out: Array<{ id: string; name?: string }> = [];
    for (const row of list) {
      if (!row || typeof row !== "object") {
        continue;
      }
      const o = row as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id.trim() : "";
      if (!id) {
        continue;
      }
      const name = typeof o.name === "string" ? o.name.trim() : undefined;
      out.push(name ? { id, name } : { id });
    }
    configuredAgents.value = out;
  } catch (e) {
    agentsError.value = e instanceof Error ? e.message : String(e);
    configuredAgents.value = [];
  } finally {
    agentsLoading.value = false;
  }
}

function toggle(): void {
  expanded.value = !expanded.value;
}

function openHub(): void {
  expanded.value = false;
  window.dispatchEvent(new CustomEvent("didclaw-open-company-hub"));
}

function openRole(agentId: string): void {
  company.openPanel(agentId);
}

function onDocClick(ev: MouseEvent): void {
  if (!expanded.value) {
    return;
  }
  const el = rootRef.value;
  if (el && ev.target instanceof Node && !el.contains(ev.target)) {
    expanded.value = false;
  }
}

watch(expanded, (v) => {
  if (v) {
    void loadConfiguredAgents();
  }
});

onMounted(() => {
  document.addEventListener("click", onDocClick, true);
});

onUnmounted(() => {
  document.removeEventListener("click", onDocClick, true);
});
</script>

<template>
  <div v-if="isDidClawElectron()" ref="rootRef" class="org-float">
    <button
      type="button"
      class="org-float-fab"
      :class="{ 'org-float-fab--open': expanded }"
      :aria-expanded="expanded"
      :title="t('company.floatingToggleTitle')"
      @click.stop="toggle"
    >
      <span class="org-float-fab-label">{{ t("company.floatingFab") }}</span>
      <span v-if="badgeCount > 0" class="org-float-badge">{{ badgeCount }}</span>
    </button>

    <div v-if="expanded" class="org-float-panel" role="region" :aria-label="t('company.floatingRegion')">
      <div class="org-float-section">
        <div class="org-float-h">{{ t("company.floatingOpenedColumns") }}</div>
        <p v-if="panels.length === 0" class="org-float-muted">{{ t("company.floatingNoColumns") }}</p>
        <ul v-else class="org-float-list">
          <li v-for="p in panels" :key="p.id" class="org-float-row">
            <span class="org-float-row-text">{{ p.label }} · {{ p.agentId }}</span>
            <button type="button" class="lc-btn lc-btn-ghost lc-btn-xs" @click="company.closePanel(p.id)">
              {{ t("company.floatingClose") }}
            </button>
          </li>
        </ul>
      </div>

      <div class="org-float-section">
        <div class="org-float-h">{{ t("company.floatingConfiguredAgents") }}</div>
        <p v-if="agentsLoading" class="org-float-muted">{{ t("company.floatingLoading") }}</p>
        <p v-else-if="agentsError" class="org-float-err">{{ agentsError }}</p>
        <p v-else-if="configuredAgents.length === 0" class="org-float-muted">{{ t("company.floatingEmptyAgents") }}</p>
        <ul v-else class="org-float-list">
          <li v-for="a in configuredAgents" :key="a.id" class="org-float-row">
            <span class="org-float-row-text">{{ a.name ? `${a.name} (${a.id})` : a.id }}</span>
            <button
              v-if="a.id !== 'main'"
              type="button"
              class="lc-btn lc-btn-ghost lc-btn-xs"
              @click="openRole(a.id)"
            >
              {{ t("company.floatingOpenColumn") }}
            </button>
          </li>
        </ul>
      </div>

      <div class="org-float-actions">
        <button type="button" class="lc-btn lc-btn-primary lc-btn-sm" @click="openHub">
          {{ t("company.floatingOpenHub") }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.org-float {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 9000;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
}
.org-float-fab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  border-radius: 999px;
  border: 1px solid var(--lc-border);
  background: var(--lc-surface-panel);
  color: var(--lc-text);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.12);
  transition: background 0.15s, border-color 0.15s;
}
.org-float-fab:hover {
  background: var(--lc-bg-elevated);
}
.org-float-fab--open {
  border-color: var(--lc-accent, #3b82f6);
}
.org-float-fab-label {
  letter-spacing: 0.02em;
}
.org-float-badge {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--lc-accent, #3b82f6);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 20px;
  text-align: center;
}
.org-float-panel {
  width: min(320px, calc(100vw - 32px));
  max-height: min(420px, 55vh);
  overflow: auto;
  padding: 12px 14px;
  border-radius: var(--lc-radius-md);
  border: 1px solid var(--lc-border);
  background: var(--lc-surface-panel);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
}
.org-float-section {
  margin-bottom: 14px;
}
.org-float-section:last-of-type {
  margin-bottom: 10px;
}
.org-float-h {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--lc-text-muted);
  margin-bottom: 8px;
}
.org-float-muted {
  margin: 0;
  font-size: 12px;
  color: var(--lc-text-muted);
}
.org-float-err {
  margin: 0;
  font-size: 12px;
  color: var(--lc-error);
}
.org-float-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.org-float-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--lc-border);
  font-size: 12px;
}
.org-float-row:last-child {
  border-bottom: none;
}
.org-float-row-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.org-float-actions {
  padding-top: 4px;
  border-top: 1px solid var(--lc-border);
}
</style>
