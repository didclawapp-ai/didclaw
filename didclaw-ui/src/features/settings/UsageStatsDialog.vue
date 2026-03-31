<script setup lang="ts">
import { formatSessionHistoryTime, sessionDisplayLabel } from "@/lib/session-display";
import { useSessionStore } from "@/stores/session";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [v: boolean] }>();

const { t } = useI18n();
const sessionStore = useSessionStore();
const { allSessions } = storeToRefs(sessionStore);

const refreshing = ref(false);

/** Sessions with at least some token data, sorted newest-first. */
const rows = computed(() =>
  [...allSessions.value]
    .filter((s) => s.inputTokens != null || s.outputTokens != null || s.totalTokens != null)
    .sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0)),
);

const totalInput = computed(() => rows.value.reduce((acc, s) => acc + (s.inputTokens ?? 0), 0));
const totalOutput = computed(() => rows.value.reduce((acc, s) => acc + (s.outputTokens ?? 0), 0));
const totalAll = computed(() =>
  rows.value.reduce(
    (acc, s) => acc + (s.totalTokens ?? (s.inputTokens ?? 0) + (s.outputTokens ?? 0)),
    0,
  ),
);

async function doRefresh(): Promise<void> {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    await sessionStore.refresh();
  } finally {
    refreshing.value = false;
  }
}

function close(): void {
  emit("update:modelValue", false);
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") close();
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="us-backdrop" @click.self="close" @keydown="onKeydown">
      <div class="us-panel" role="dialog" aria-modal="true" :aria-labelledby="'us-title'" tabindex="-1">
        <!-- Header -->
        <div class="us-head">
          <h2 id="us-title">{{ t('usageStats.title') }}</h2>
          <div class="us-head-actions">
            <button
              type="button"
              class="us-refresh-btn"
              :disabled="refreshing"
              @click="doRefresh"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2.5 8A5.5 5.5 0 1 0 5 3.5" />
                <path d="M5 1v3H2" />
              </svg>
              {{ refreshing ? t('common.refreshing') : t('common.refresh') }}
            </button>
            <button type="button" class="us-close" :aria-label="t('common.close')" @click="close">✕</button>
          </div>
        </div>

        <!-- Summary cards -->
        <div class="us-summary">
          <div class="us-stat-card">
            <div class="us-stat-label">{{ t('usageStats.sessions') }}</div>
            <div class="us-stat-value">{{ allSessions.length }}</div>
          </div>
          <div class="us-stat-card">
            <div class="us-stat-label">{{ t('usageStats.totalInput') }}</div>
            <div class="us-stat-value us-stat-value--in">{{ fmt(totalInput) }}</div>
            <div class="us-stat-unit">{{ t('usageStats.tokenUnit') }}</div>
          </div>
          <div class="us-stat-card">
            <div class="us-stat-label">{{ t('usageStats.totalOutput') }}</div>
            <div class="us-stat-value us-stat-value--out">{{ fmt(totalOutput) }}</div>
            <div class="us-stat-unit">{{ t('usageStats.tokenUnit') }}</div>
          </div>
          <div class="us-stat-card us-stat-card--highlight">
            <div class="us-stat-label">{{ t('usageStats.totalAll') }}</div>
            <div class="us-stat-value">{{ fmt(totalAll) }}</div>
            <div class="us-stat-unit">{{ t('usageStats.tokenUnit') }}</div>
          </div>
        </div>

        <!-- Table -->
        <div class="us-table-wrap">
          <p v-if="rows.length === 0" class="us-empty">{{ t('usageStats.noData') }}</p>
          <table v-else class="us-table">
            <thead>
              <tr>
                <th>{{ t('usageStats.sessionCol') }}</th>
                <th>{{ t('usageStats.lastActiveCol') }}</th>
                <th class="us-num">{{ t('usageStats.inputCol') }}</th>
                <th class="us-num">{{ t('usageStats.outputCol') }}</th>
                <th class="us-num">{{ t('usageStats.sumCol') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.key">
                <td class="us-session-name" :title="row.key">
                  {{ sessionDisplayLabel(row.key, row.label) }}
                </td>
                <td class="us-time muted">{{ formatSessionHistoryTime(row.lastActiveAt) }}</td>
                <td class="us-num us-in">{{ row.inputTokens != null ? fmt(row.inputTokens) : '—' }}</td>
                <td class="us-num us-out">{{ row.outputTokens != null ? fmt(row.outputTokens) : '—' }}</td>
                <td class="us-num us-total">
                  {{
                    row.totalTokens != null
                      ? fmt(row.totalTokens)
                      : (row.inputTokens != null || row.outputTokens != null)
                        ? fmt((row.inputTokens ?? 0) + (row.outputTokens ?? 0))
                        : '—'
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Footer note -->
        <p class="us-note muted">{{ t('usageStats.note') }}</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.us-backdrop {
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
.us-panel {
  width: min(640px, 100%);
  max-height: min(80vh, 600px);
  background: var(--lc-surface-panel);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  box-shadow: var(--lc-shadow-sm);
  padding: 20px 22px 18px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* Header */
.us-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.us-head h2 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
}
.us-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.us-refresh-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border: 1px solid var(--lc-border);
  border-radius: 6px;
  background: var(--lc-bg-raised);
  color: var(--lc-text-muted);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.us-refresh-btn svg {
  width: 13px;
  height: 13px;
}
.us-refresh-btn:hover:not(:disabled) {
  background: var(--lc-bg-elevated);
  color: var(--lc-accent);
}
.us-refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.us-close {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--lc-text-muted);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.us-close:hover {
  background: var(--lc-error-bg);
  color: var(--lc-error);
}

/* Summary cards */
.us-summary {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  flex-shrink: 0;
}
.us-stat-card {
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  padding: 12px 14px 10px;
  background: var(--lc-bg-elevated);
  min-width: 0;
}
.us-stat-card--highlight {
  border-color: rgba(37, 99, 235, 0.3);
  background: rgba(37, 99, 235, 0.05);
}
.us-stat-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--lc-text-muted);
  margin-bottom: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.us-stat-value {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--lc-text);
  font-variant-numeric: tabular-nums;
}
.us-stat-value--in { color: #2563eb; }
.us-stat-value--out { color: #059669; }
.us-stat-unit {
  font-size: 10px;
  color: var(--lc-text-muted);
  margin-top: 2px;
}

/* Table */
.us-table-wrap {
  flex: 1;
  overflow-y: auto;
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  min-height: 0;
}
.us-empty {
  margin: 0;
  padding: 24px 18px;
  font-size: 13px;
  color: var(--lc-text-muted);
  text-align: center;
  line-height: 1.6;
}
.us-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.us-table thead {
  position: sticky;
  top: 0;
  background: var(--lc-surface-panel);
  z-index: 1;
}
.us-table th {
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--lc-text-muted);
  text-align: left;
  border-bottom: 1px solid var(--lc-border);
  white-space: nowrap;
}
.us-table td {
  padding: 7px 12px;
  border-bottom: 1px solid var(--lc-border);
  vertical-align: middle;
}
.us-table tbody tr:last-child td {
  border-bottom: none;
}
.us-table tbody tr:hover td {
  background: var(--lc-bg-hover, rgba(14, 116, 144, 0.05));
}
.us-session-name {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.us-time {
  white-space: nowrap;
  font-size: 12px;
}
.us-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.us-in { color: #2563eb; }
.us-out { color: #059669; }
.us-total { font-weight: 600; color: var(--lc-text); }
.muted { color: var(--lc-text-muted); }

/* Footer note */
.us-note {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  flex-shrink: 0;
}
</style>
