<script setup lang="ts">
import { formatSessionHistoryTime, sessionDisplayLabel } from "@/lib/session-display";
import type { SessionRow } from "@/stores/session";
import { computed, ref, watch } from "vue";

const props = defineProps<{
  open: boolean;
  rows: SessionRow[];
  activeSessionKey: string | null;
}>();

const emit = defineEmits<{
  close: [];
  select: [key: string];
}>();

const search = ref("");

watch(
  () => props.open,
  (open) => {
    if (open) {
      search.value = "";
    }
  },
);

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

function close(): void {
  emit("close");
}

function selectSession(key: string): void {
  emit("select", key);
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
            <h2 id="history-dialog-title" class="history-dialog-title">历史会话</h2>
            <p class="history-dialog-subtitle">按最近活跃排序，点击即可切换查看。</p>
          </div>
          <button
            type="button"
            class="history-dialog-close"
            title="关闭历史会话"
            @click="close"
          >
            ×
          </button>
        </div>
        <div class="history-dialog-toolbar">
          <input
            v-model="search"
            class="history-search-input"
            type="search"
            placeholder="搜索会话名、渠道或 session key"
          >
          <span class="history-count">共 {{ filteredRows.length }} 条</span>
        </div>
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
                <span v-if="row.key === activeSessionKey" class="history-item-badge">当前</span>
                <span v-else-if="row.localOnly" class="history-item-badge muted-badge">已结束</span>
              </div>
              <div class="history-item-key">{{ row.key }}</div>
            </div>
            <div class="history-item-time">{{ formatSessionHistoryTime(row.lastActiveAt) }}</div>
          </button>
        </div>
        <div v-else class="history-empty muted">没有匹配的历史会话。</div>
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
.history-empty {
  padding: 20px 18px 24px;
  color: var(--lc-text-muted);
  font-size: 13px;
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
