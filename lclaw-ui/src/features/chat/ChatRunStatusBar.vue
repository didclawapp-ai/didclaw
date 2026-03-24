<script setup lang="ts">
import { toolEntryBelongsToRun } from "@/lib/tool-timeline-run";
import { useChatStore } from "@/stores/chat";
import { useToolTimelineStore } from "@/stores/toolTimeline";
import { storeToRefs } from "pinia";
import { computed, onUnmounted, ref, watch } from "vue";

const STALL_NO_FIRST_MS = 35_000;
const STALL_SILENCE_MS = 48_000;
const LAST_RUN_SHOW_MS = 10_000;

const chat = useChatStore();
const tools = useToolTimelineStore();
const {
  runId,
  sending,
  composerPhase,
  runStartedAtMs,
  lastDeltaAtMs,
  lastCompletedRunDurationMs,
  lastCompletedRunAtMs,
  agentBusy,
} = storeToRefs(chat);
const { entries } = storeToRefs(tools);

const tick = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;

function bumpTick(): void {
  tick.value++;
  const at = lastCompletedRunAtMs.value;
  if (!agentBusy.value && at != null && Date.now() - at >= LAST_RUN_SHOW_MS) {
    if (timer != null) {
      clearInterval(timer);
      timer = null;
    }
  }
}

watch(
  [agentBusy, lastCompletedRunAtMs],
  () => {
    if (timer != null) {
      clearInterval(timer);
      timer = null;
    }
    if (agentBusy.value) {
      timer = setInterval(bumpTick, 1000);
      return;
    }
    const at = lastCompletedRunAtMs.value;
    if (at != null && Date.now() - at < LAST_RUN_SHOW_MS + 500) {
      timer = setInterval(bumpTick, 500);
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  if (timer != null) {
    clearInterval(timer);
  }
});

const toolEntriesThisRun = computed(() =>
  entries.value.filter((e) => toolEntryBelongsToRun(e, runId.value, runStartedAtMs.value)),
);

const elapsedSec = computed(() => {
  void tick.value;
  const t0 = runStartedAtMs.value;
  if (t0 == null || runId.value == null) {
    return null;
  }
  return Math.max(0, (Date.now() - t0) / 1000);
});

const phaseLabel = computed(() => {
  if (composerPhase.value === "sending") {
    return "正在发送…";
  }
  if (composerPhase.value === "idle") {
    return "";
  }
  const n = toolEntriesThisRun.value.length;
  if (composerPhase.value === "waiting") {
    return n > 0 ? "正在调用工具…" : "推理或工具中，等待输出…";
  }
  if (n > 0) {
    return `正在生成…（含 ${n} 条工具事件）`;
  }
  return "正在生成…";
});

const stallHint = computed(() => {
  void tick.value;
  if (runId.value == null || sending.value) {
    return null;
  }
  const t0 = runStartedAtMs.value;
  const ld = lastDeltaAtMs.value;
  const now = Date.now();
  if (ld == null && t0 != null && now - t0 > STALL_NO_FIRST_MS) {
    return "许久未收到回复，可检查网关或点「中断」。";
  }
  if (ld != null && now - ld > STALL_SILENCE_MS) {
    return "已较长时间无新输出，若仍无进展可点「中断」。";
  }
  return null;
});

const showLastRun = computed(() => {
  void tick.value;
  const at = lastCompletedRunAtMs.value;
  const d = lastCompletedRunDurationMs.value;
  if (at == null || d == null) {
    return false;
  }
  return Date.now() - at < LAST_RUN_SHOW_MS && runId.value == null && !sending.value;
});

const lastRunLabel = computed(() => {
  const d = lastCompletedRunDurationMs.value;
  if (d == null) {
    return "";
  }
  return `完成 · 本轮用时 ${(d / 1000).toFixed(1)}s`;
});

const barVisible = computed(() => agentBusy.value || showLastRun.value);
</script>

<template>
  <div v-if="barVisible" class="run-bar" role="status" aria-live="polite">
    <template v-if="agentBusy">
      <span class="phase">{{ phaseLabel }}</span>
      <span v-if="elapsedSec != null" class="elapsed mono">{{ elapsedSec.toFixed(1) }}s</span>
      <span v-if="stallHint" class="stall">{{ stallHint }}</span>
    </template>
    <template v-else-if="showLastRun">
      <span class="done">{{ lastRunLabel }}</span>
    </template>
  </div>
</template>

<style scoped>
.run-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
  padding: 8px 14px;
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--lc-text-muted);
  background: linear-gradient(180deg, rgba(6, 182, 212, 0.06) 0%, transparent 100%);
  border-bottom: 1px solid var(--lc-border);
  flex-shrink: 0;
}
.phase {
  font-weight: 600;
  color: var(--lc-text);
}
.elapsed {
  font-size: 11px;
  color: var(--lc-text-dim);
}
.mono {
  font-family: var(--lc-mono);
}
.stall {
  flex: 1 1 100%;
  font-size: 11px;
  color: #b45309;
}
.done {
  color: var(--lc-text-muted);
  font-weight: 500;
}
</style>
