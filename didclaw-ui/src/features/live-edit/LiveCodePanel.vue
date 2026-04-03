<script setup lang="ts">
import { useChatStore } from "@/stores/chat";
import { useLiveEditStore } from "@/stores/liveEdit";
import { storeToRefs } from "pinia";
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const chat = useChatStore();
const live = useLiveEditStore();
const { streamText, runId } = storeToRefs(chat);
const { workspaceRoot, pendingPatches, applyBusyId } = storeToRefs(live);

const streamingPreview = computed(() => {
  if (runId.value == null) {
    return "";
  }
  return (streamText.value ?? "").trim();
});

const pendingList = computed(() =>
  pendingPatches.value.filter((p) => p.status === "pending" || p.status === "error"),
);

function previewLines(diff: string): string {
  const max = 4000;
  return diff.length > max ? `${diff.slice(0, max)}\n…` : diff;
}

async function onPickRoot(): Promise<void> {
  await live.pickWorkspace();
}

async function onApply(id: string): Promise<void> {
  await live.applyPatch(id);
}

function onDiscard(id: string): void {
  live.discardPatch(id);
}
</script>

<template>
  <section class="right right--live-code" :aria-label="t('shell.liveCodePaneLabel')">
    <div class="panel-title live-code-head">
      <span>{{ t("shell.liveCodeTitle") }}</span>
      <button
        type="button"
        class="live-code-close-btn"
        :title="t('shell.liveCodeClose')"
        @click="live.setPanelOpen(false)"
      >
        &#x2715;
      </button>
    </div>

    <div class="live-code-body">
      <p class="muted small live-code-lead">{{ t("shell.liveCodeLead") }}</p>

      <div class="live-code-row">
        <span class="live-code-root-label">{{ t("shell.liveCodeWorkspace") }}</span>
        <button type="button" class="lc-btn lc-btn-ghost lc-btn-xs" @click="onPickRoot">
          {{ t("shell.liveCodePickWorkspace") }}
        </button>
      </div>
      <p v-if="workspaceRoot" class="live-code-root-path" :title="workspaceRoot">
        {{ workspaceRoot }}
      </p>
      <p v-else class="muted small">{{ t("shell.liveCodeNoWorkspace") }}</p>

      <div class="live-code-section">
        <div class="live-code-section-title">{{ t("shell.liveCodeStreamTitle") }}</div>
        <pre v-if="streamingPreview" class="live-code-stream">{{ streamingPreview }}</pre>
        <p v-else class="muted small">{{ t("shell.liveCodeStreamEmpty") }}</p>
      </div>

      <div class="live-code-section">
        <div class="live-code-section-title">{{ t("shell.liveCodePatchesTitle") }}</div>
        <p v-if="pendingList.length === 0" class="muted small">{{ t("shell.liveCodePatchesEmpty") }}</p>
        <ul v-else class="live-code-patch-list">
          <li v-for="p in pendingList" :key="p.id" class="live-code-patch-item">
            <div class="live-code-patch-meta">
              <span class="live-code-patch-id">{{ p.id.slice(0, 8) }}…</span>
              <span v-if="p.status === 'error'" class="live-code-patch-err">{{ t("shell.liveCodePatchError") }}</span>
            </div>
            <pre class="live-code-patch-pre">{{ previewLines(p.unifiedDiff) }}</pre>
            <p v-if="p.applyError" class="live-code-apply-err">{{ p.applyError }}</p>
            <div class="live-code-patch-actions">
              <button
                type="button"
                class="lc-btn lc-btn-primary lc-btn-xs"
                :disabled="!workspaceRoot || applyBusyId === p.id"
                @click="onApply(p.id)"
              >
                {{ applyBusyId === p.id ? t("shell.liveCodeApplying") : t("shell.liveCodeApply") }}
              </button>
              <button type="button" class="lc-btn lc-btn-ghost lc-btn-xs" @click="onDiscard(p.id)">
                {{ t("shell.liveCodeDiscard") }}
              </button>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.right--live-code {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: var(--lc-surface-panel);
}
.live-code-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.live-code-close-btn {
  flex-shrink: 0;
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 4px;
  font-size: 13px;
  color: var(--lc-text-dim);
  line-height: 1;
  border-radius: var(--lc-radius-sm);
  transition:
    color 0.15s,
    background 0.15s;
}
.live-code-close-btn:hover {
  color: var(--lc-text);
  background: var(--lc-bg-elevated);
}
.live-code-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.live-code-lead {
  margin: 0;
  line-height: 1.45;
}
.live-code-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.live-code-root-label {
  font-size: 12px;
  color: var(--lc-text-muted);
}
.live-code-root-path {
  margin: 0;
  font-size: 11px;
  font-family: var(--lc-mono);
  color: var(--lc-text-dim);
  word-break: break-all;
}
.live-code-section-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--lc-text-muted);
  margin-bottom: 6px;
}
.live-code-stream {
  margin: 0;
  padding: 8px 10px;
  font-size: 11px;
  line-height: 1.4;
  font-family: var(--lc-mono);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 160px;
  overflow: auto;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-elevated);
  color: var(--lc-text-muted);
}
.live-code-patch-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.live-code-patch-item {
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  padding: 8px 10px;
  background: var(--lc-bg-elevated);
}
.live-code-patch-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.live-code-patch-id {
  font-size: 10px;
  font-family: var(--lc-mono);
  color: var(--lc-text-dim);
}
.live-code-patch-err {
  font-size: 11px;
  color: var(--lc-error);
}
.live-code-patch-pre {
  margin: 0 0 8px;
  padding: 6px 8px;
  font-size: 10px;
  line-height: 1.35;
  font-family: var(--lc-mono);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 120px;
  overflow: auto;
  border-radius: var(--lc-radius-sm);
  background: var(--lc-bg-raised);
  color: var(--lc-text-muted);
}
.live-code-apply-err {
  margin: 0 0 8px;
  font-size: 11px;
  color: var(--lc-error);
  white-space: pre-wrap;
}
.live-code-patch-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
