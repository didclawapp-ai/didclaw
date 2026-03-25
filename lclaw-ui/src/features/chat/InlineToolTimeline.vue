<script setup lang="ts">
import { toolEntryBelongsToRun } from "@/lib/tool-timeline-run";
import { useChatStore } from "@/stores/chat";
import { useToolTimelineStore } from "@/stores/toolTimeline";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";

const chat = useChatStore();
const tools = useToolTimelineStore();
const { runId, runStartedAtMs } = storeToRefs(chat);
const { entries } = storeToRefs(tools);

const expanded = ref(true);

const forRun = computed(() => {
  const rid = runId.value;
  const t0 = runStartedAtMs.value;
  return entries.value.filter((e) => toolEntryBelongsToRun(e, rid, t0));
});

const displayList = computed(() => [...forRun.value].reverse());

const visible = computed(() => false && runId.value != null && forRun.value.length > 0);
</script>

<template>
  <div v-if="visible" class="inline-tools">
    <button type="button" class="toggle" @click="expanded = !expanded">
      <span>本轮工具 / 事件（{{ forRun.length }}）</span>
      <span class="chev" aria-hidden="true">{{ expanded ? "▼" : "▶" }}</span>
    </button>
    <ul v-show="expanded" class="list">
      <li v-for="e in displayList" :key="e.id" class="row">
        <span class="ev">{{ e.event }}</span>
        <span v-if="e.count > 1" class="cnt">×{{ e.count }}</span>
        <div class="sum">{{ e.summary || "—" }}</div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.inline-tools {
  margin: 0 10px 8px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-elevated);
  overflow: hidden;
  flex-shrink: 0;
}
.toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: linear-gradient(180deg, var(--lc-bg-elevated) 0%, var(--lc-bg-raised) 100%);
  font-size: 11px;
  font-weight: 600;
  color: var(--lc-text-muted);
  cursor: pointer;
  font-family: inherit;
}
.toggle:hover {
  color: var(--lc-text);
}
.chev {
  font-size: 10px;
  opacity: 0.85;
}
.list {
  list-style: none;
  margin: 0;
  padding: 6px 8px 8px;
  max-height: min(200px, 32vh);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.row {
  font-size: 11px;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-raised);
}
.ev {
  font-weight: 700;
  color: var(--lc-accent);
  margin-right: 6px;
}
.cnt {
  font-size: 10px;
  color: var(--lc-text-dim);
}
.sum {
  margin-top: 4px;
  color: var(--lc-text-muted);
  word-break: break-word;
  font-family: var(--lc-mono);
  font-size: 10px;
  line-height: 1.4;
}
</style>
