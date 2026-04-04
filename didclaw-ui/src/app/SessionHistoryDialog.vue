<script setup lang="ts">
import { formatSessionHistoryTime, sessionDisplayLabel } from "@/lib/session-display";
import type { WorkspaceMemoryFileRow } from "@/lib/openclaw-workspace-memory";
import type { SessionRow } from "@/stores/session";
import { isDidClawElectron } from "@/lib/electron-bridge";
import { getDidClawDesktopApi } from "@/lib/desktop-api";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps<{
  open: boolean;
  rows: SessionRow[];
  activeSessionKey: string | null;
}>();

const emit = defineEmits<{
  close: [];
  select: [key: string];
  previewMemory: [payload: { path: string; name: string }];
}>();

const search = ref("");
type HistoryTab = "gateway" | "memory";
const tab = ref<HistoryTab>("gateway");
const memoryFiles = ref<WorkspaceMemoryFileRow[]>([]);
const memoryLoading = ref(false);
const memoryError = ref<string | null>(null);

const desktop = computed(() => isDidClawElectron());

watch(
  () => props.open,
  (open) => {
    if (open) {
      search.value = "";
      void refreshMemoryList();
    }
  },
);

async function refreshMemoryList(): Promise<void> {
  if (!desktop.value) {
    memoryFiles.value = [];
    memoryError.value = null;
    return;
  }
  memoryLoading.value = true;
  memoryError.value = null;
  try {
    const api = getDidClawDesktopApi();
    if (!api?.listOpenClawWorkspaceMemory) {
      memoryFiles.value = [];
      return;
    }
    const r = await api.listOpenClawWorkspaceMemory();
    if (r?.ok === true && Array.isArray(r.files)) {
      memoryFiles.value = r.files;
    } else {
      memoryFiles.value = [];
    }
  } catch (e) {
    memoryError.value = e instanceof Error ? e.message : String(e);
    memoryFiles.value = [];
  } finally {
    memoryLoading.value = false;
  }
}

const filteredRows = computed(() => {
  const keyword = search.value.trim().toLowerCase();
  return [...props.rows]
    .sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0))
    .filter((row) => {
      if (!keyword) {
        return true;
      }
      const title = sessionDisplayLabel(row.key, row.label).toLowerCase();
      return (
        title.includes(keyword) ||
        row.key.toLowerCase().includes(keyword) ||
        (row.label ?? "").toLowerCase().includes(keyword)
      );
    });
});

const filteredMemoryRows = computed(() => {
  const keyword = search.value.trim().toLowerCase();
  if (!keyword) {
    return memoryFiles.value;
  }
  return memoryFiles.value.filter((f) => f.name.toLowerCase().includes(keyword));
});

const subtitleText = computed(() =>
  tab.value === "gateway" ? t("sessionHistory.gatewaySubtitle") : t("sessionHistory.memorySubtitle"),
);

const listCount = computed(() =>
  tab.value === "gateway" ? filteredRows.value.length : filteredMemoryRows.value.length,
);

function close(): void {
  emit("close");
}

function selectSession(key: string): void {
  emit("select", key);
}

function openMemoryFile(row: WorkspaceMemoryFileRow): void {
  emit("previewMemory", { path: row.path, name: row.name });
}

function formatMemorySize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "—";
  }
  if (bytes < 1024) {
    return t("sessionHistory.memorySizeB", { n: bytes });
  }
  if (bytes < 1024 * 1024) {
    return t("sessionHistory.memorySizeKb", { n: (bytes / 1024).toFixed(1) });
  }
  return t("sessionHistory.memorySizeMb", { n: (bytes / (1024 * 1024)).toFixed(1) });
}
</script>

<template>
  <transition name="history-fade">
    <div
      v-if="open"
      class="history-overlay"
      @click.self="close"
    >
      <div
        class="history-dialog"
        role="dialog"
        aria-labelledby="history-dialog-title"
        aria-modal="true"
      >
        <div class="history-dialog-head">
          <div>
            <h2 id="history-dialog-title" class="history-dialog-title">{{ t('sessionHistory.title') }}</h2>
            <p class="history-dialog-subtitle">{{ subtitleText }}</p>
          </div>
          <button
            type="button"
            class="history-dialog-close"
            :title="t('sessionHistory.closeBtn')"
            @click="close"
          >
            ×
          </button>
        </div>
        <div v-if="desktop" class="history-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            class="history-tab"
            :class="{ 'is-active': tab === 'gateway' }"
            :aria-selected="tab === 'gateway'"
            @click="tab = 'gateway'"
          >
            {{ t('sessionHistory.tabGateway') }}
          </button>
          <button
            type="button"
            role="tab"
            class="history-tab"
            :class="{ 'is-active': tab === 'memory' }"
            :aria-selected="tab === 'memory'"
            @click="tab = 'memory'"
          >
            {{ t('sessionHistory.tabMemory') }}
          </button>
        </div>
        <div class="history-dialog-toolbar">
          <input
            v-model="search"
            class="history-search-input"
            type="search"
            :placeholder="t('sessionHistory.searchPlaceholder')"
          >
          <span class="history-count">{{ t('sessionHistory.count', { n: listCount }) }}</span>
        </div>
        <template v-if="tab === 'gateway'">
          <div v-if="filteredRows.length > 0" class="history-list">
            <button
              v-for="row in filteredRows"
              :key="row.key"
              type="button"
              class="history-item"
              :class="{ 'is-active': row.key === activeSessionKey }"
              @click="selectSession(row.key)"
            >
              <div class="history-item-main">
                <div class="history-item-title-row">
                  <span class="history-item-title">{{ sessionDisplayLabel(row.key, row.label) }}</span>
                  <span v-if="row.key === activeSessionKey" class="history-item-badge">{{ t('sessionHistory.badgeCurrent') }}</span>
                  <span v-else-if="row.localOnly" class="history-item-badge muted-badge">{{ t('sessionHistory.badgeClosed') }}</span>
                </div>
                <div class="history-item-key">{{ row.key }}</div>
              </div>
              <div class="history-item-time">{{ formatSessionHistoryTime(row.lastActiveAt) }}</div>
            </button>
          </div>
          <div v-else class="history-empty muted">{{ t('sessionHistory.empty') }}</div>
        </template>
        <template v-else>
          <div v-if="memoryLoading" class="history-empty muted">{{ t('sessionHistory.memoryLoading') }}</div>
          <div v-else-if="memoryError" class="history-empty history-memory-err">{{ memoryError }}</div>
          <div v-else-if="filteredMemoryRows.length > 0" class="history-list">
            <button
              v-for="row in filteredMemoryRows"
              :key="row.path"
              type="button"
              class="history-item"
              @click="openMemoryFile(row)"
            >
              <div class="history-item-main">
                <div class="history-item-title-row">
                  <span class="history-item-title">{{ row.name }}</span>
                  <span class="history-item-badge muted-badge">{{ t('sessionHistory.badgeMarkdown') }}</span>
                </div>
                <div class="history-item-key">{{ t('sessionHistory.memoryPathHint') }}</div>
              </div>
              <div class="history-item-meta">
                <span class="history-item-time">{{ formatSessionHistoryTime(row.modifiedMs) }}</span>
                <span class="history-item-size">{{ formatMemorySize(row.size) }}</span>
              </div>
            </button>
          </div>
          <div v-else class="history-empty muted">{{ t('sessionHistory.memoryEmpty') }}</div>
        </template>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.history-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(2, 8, 23, 0.4);
  backdrop-filter: blur(6px);
}
.history-dialog {
  width: min(760px, 100%);
  max-height: min(78vh, 760px);
  display: flex;
  flex-direction: column;
  border: 1px solid var(--lc-border);
  border-radius: 14px;
  background: var(--lc-surface-panel);
  box-shadow: 0 28px 80px rgba(15, 23, 42, 0.28);
  overflow: hidden;
}
.history-dialog-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px 10px;
  border-bottom: 1px solid var(--lc-border);
}
.history-dialog-title {
  margin: 0;
  font-size: 18px;
  color: var(--lc-text);
}
.history-dialog-subtitle {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--lc-text-muted);
}
.history-dialog-close {
  border: none;
  background: transparent;
  color: var(--lc-text-dim);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  padding: 4px;
}
.history-tabs {
  display: flex;
  gap: 8px;
  padding: 10px 18px 0;
  border-bottom: 1px solid var(--lc-border);
}
.history-tab {
  border: 1px solid transparent;
  border-radius: 8px 8px 0 0;
  padding: 8px 14px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  color: var(--lc-text-muted);
  background: transparent;
}
.history-tab.is-active {
  color: var(--lc-text);
  border-color: var(--lc-border);
  border-bottom-color: var(--lc-surface-panel);
  margin-bottom: -1px;
  background: var(--lc-surface-panel);
}
.history-dialog-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--lc-border);
}
.history-search-input {
  flex: 1 1 auto;
  min-width: 0;
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  background: var(--lc-bg-raised);
  color: var(--lc-text);
  padding: 8px 10px;
  font: inherit;
}
.history-search-input:focus {
  outline: none;
  border-color: var(--lc-accent);
  box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.12);
}
.history-count {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--lc-text-muted);
}
.history-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px 16px;
  overflow: auto;
}
.history-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  text-align: left;
  border: 1px solid var(--lc-border);
  border-radius: 12px;
  background: var(--lc-bg-raised);
  padding: 12px 14px;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    transform 0.12s ease;
}
.history-item:hover {
  border-color: var(--lc-accent);
  background: var(--lc-accent-soft);
  transform: translateY(-1px);
}
.history-item.is-active {
  border-color: var(--lc-accent);
  background: rgba(6, 182, 212, 0.12);
}
.history-item-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.history-item-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.history-item-title {
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--lc-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-item-badge {
  flex-shrink: 0;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
  background: rgba(6, 182, 212, 0.12);
  color: var(--lc-accent);
}
.history-item-badge.muted-badge {
  background: var(--lc-bg-hover);
  color: var(--lc-text-muted);
}
.history-item-key {
  font-size: 11px;
  color: var(--lc-text-muted);
  font-family: var(--lc-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-item-time {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--lc-text-dim);
  white-space: nowrap;
}
.history-item-meta {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}
.history-item-size {
  font-size: 11px;
  color: var(--lc-text-dim);
}
.history-empty {
  padding: 20px 18px 24px;
  color: var(--lc-text-muted);
  font-size: 13px;
}
.history-memory-err {
  color: var(--lc-error, #dc2626);
}
.history-fade-enter-active,
.history-fade-leave-active {
  transition: opacity 0.16s ease;
}
.history-fade-enter-active .history-dialog,
.history-fade-leave-active .history-dialog {
  transition: transform 0.16s ease;
}
.history-fade-enter-from,
.history-fade-leave-to {
  opacity: 0;
}
.history-fade-enter-from .history-dialog,
.history-fade-leave-to .history-dialog {
  transform: scale(0.98) translateY(6px);
}
</style>
