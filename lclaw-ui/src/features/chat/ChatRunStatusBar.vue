<script setup lang="ts">
import { toolEntryBelongsToRun } from "@/lib/tool-timeline-run";
import { useChatStore } from "@/stores/chat";
import { useSessionStore } from "@/stores/session";
import { useToolTimelineStore } from "@/stores/toolTimeline";
import { storeToRefs } from "pinia";
import { computed, onUnmounted, ref, watch } from "vue";

const STALL_NO_FIRST_MS = 35_000;
const STALL_SILENCE_MS = 48_000;
const LAST_RUN_SHOW_MS = 10_000;
const BACKGROUND_EXPIRE_MS = 120_000;

const chat = useChatStore();
const tools = useToolTimelineStore();
const session = useSessionStore();
const {
  runId,
  sending,
  composerPhase,
  runStartedAtMs,
  lastDeltaAtMs,
  lastCompletedRunDurationMs,
  lastCompletedRunAtMs,
  agentBusy,
  backgroundAgentLastSeenMs,
  backgroundAgentSessionKey,
} = storeToRefs(chat);
const { activeSessionKey } = storeToRefs(session);
const { entries } = storeToRefs(tools);

const tick = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;

function isBgActive(): boolean {
  const t = backgroundAgentLastSeenMs.value;
  if (t == null) return false;
  const sk = backgroundAgentSessionKey.value;
  if (sk && sk === activeSessionKey.value) return false;
  return Date.now() - t < BACKGROUND_EXPIRE_MS;
}

function bumpTick(): void {
  tick.value++;
  const at = lastCompletedRunAtMs.value;
  if (!agentBusy.value && (at == null || Date.now() - at >= LAST_RUN_SHOW_MS) && !isBgActive()) {
    if (timer != null) {
      clearInterval(timer);
      timer = null;
    }
  }
}

watch(
  [agentBusy, lastCompletedRunAtMs, backgroundAgentLastSeenMs],
  () => {
    if (timer != null) {
      clearInterval(timer);
      timer = null;
    }
    if (agentBusy.value || isBgActive()) {
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
    return "Sending…";
  }
  if (composerPhase.value === "idle") {
    return "";
  }
  const n = toolEntriesThisRun.value.length;
  if (composerPhase.value === "waiting") {
    return n > 0 ? "Calling tools…" : "Reasoning / waiting for first output…";
  }
  if (n > 0) {
    return `Generating… (${n} tool event${n > 1 ? "s" : ""})`;
  }
  return "Generating…";
});

const stallHint = computed(() => {
  void tick.value;
  if (runId.value == null || sending.value) {
    return null;
  }
  const t0 = runStartedAtMs.value;
  const ld = lastDeltaAtMs.value;
  const now = Date.now();
  // 文本 delta 和工具事件都算「agent 有动静」，取两者最新时间
  const lastToolAt = toolEntriesThisRun.value[0]?.at ?? null;
  const lastActivityAt =
    ld != null || lastToolAt != null
      ? Math.max(ld ?? 0, lastToolAt ?? 0)
      : null;
  if (lastActivityAt == null && t0 != null && now - t0 > STALL_NO_FIRST_MS) {
    return "No reply received for a while. Check gateway or click Abort.";
  }
  if (lastActivityAt != null && now - lastActivityAt > STALL_SILENCE_MS) {
    return "No new output for a while. Click Abort if no progress.";
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
  return `Done · ${(d / 1000).toFixed(1)}s`;
});

const showBackgroundActivity = computed(() => {
  void tick.value;
  if (agentBusy.value) return false;
  return isBgActive();
});

const barVisible = computed(() => agentBusy.value || showLastRun.value || showBackgroundActivity.value);
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
    <template v-else-if="showBackgroundActivity">
      <span class="bg-dot" aria-hidden="true" />
      <span class="bg-label">后台子代理运行中…</span>
      <span class="bg-hint">（切换会话可查看进度）</span>
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
  color: var(--lc-warning-text);
}
.done {
  color: var(--lc-text-muted);
  font-weight: 500;
}
.bg-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--lc-accent, #06b6d4);
  flex-shrink: 0;
  animation: bg-pulse 1.4s ease-in-out infinite;
}
@keyframes bg-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
@media (prefers-reduced-motion: reduce) {
  .bg-dot { animation: none; }
}
.bg-label {
  font-weight: 600;
  color: var(--lc-accent, #06b6d4);
}
.bg-hint {
  font-size: 11px;
  color: var(--lc-text-dim);
}
</style>
