<script setup lang="ts">
import ChatLineBody from "@/features/chat/ChatLineBody.vue";
import type { ChatLine } from "@/lib/chat-line";
import { measureElement, useVirtualizer } from "@tanstack/vue-virtual";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import type { ComponentPublicInstance } from "vue";

const props = defineProps<{
  lines: ChatLine[];
  selectedIndex: number | null;
  /** 为 true 时滚到底部并对齐最后一行末尾，避免 align:auto 把视图顶到最上 */
  followLatest?: boolean;
}>();

const emit = defineEmits<{
  select: [index: number];
}>();

const parentRef = ref<HTMLElement | null>(null);

const virtualizerOptions = computed(() => ({
  count: props.lines.length,
  getScrollElement: () => parentRef.value,
  /** 初值仅作占位，真实高度由 measureElement + ResizeObserver 写入 */
  estimateSize: (index: number) => {
    const t = props.lines[index]?.listText ?? props.lines[index]?.text ?? "";
    const lines = 1 + (t.match(/\n/g)?.length ?? 0);
    return Math.min(32 + lines * 18, 400);
  },
  overscan: 6,
  measureElement,
}));

const virtualizer = useVirtualizer(virtualizerOptions);

function rowRef(el: Element | ComponentPublicInstance | null): void {
  const node = el instanceof HTMLElement ? el : null;
  virtualizer.value.measureElement(node);
}

function atListEnd(): boolean {
  const n = props.lines.length;
  if (n === 0) {
    return false;
  }
  return props.selectedIndex === n - 1;
}

/** 最后一行在视口底部对齐（跟随最新 / 流式增高） */
function scrollLastToEnd(): void {
  if (!parentRef.value || props.lines.length === 0 || !atListEnd()) {
    return;
  }
  const last = props.lines.length - 1;
  const run = (): void => {
    virtualizer.value.scrollToIndex(last, { align: "end" });
  };
  void nextTick(() => {
    run();
    requestAnimationFrame(() => {
      run();
    });
  });
}

/** 跟随最新：新增一行时滚到底 */
watch(
  () => props.lines.length,
  (n, prev) => {
    if (!props.followLatest) {
      return;
    }
    if (n > prev && atListEnd()) {
      scrollLastToEnd();
    }
  },
);

watch(
  () => props.selectedIndex,
  (idx) => {
    if (idx === null || idx < 0 || !parentRef.value) {
      return;
    }
    void nextTick(() => {
      const useEnd = props.followLatest && idx === props.lines.length - 1;
      virtualizer.value.scrollToIndex(idx, { align: useEnd ? "end" : "auto" });
      if (useEnd) {
        requestAnimationFrame(() => {
          virtualizer.value.scrollToIndex(idx, { align: "end" });
        });
      }
    });
  },
);

/** 流式输出：行数不变但末尾行变长，仍需贴底 */
watch(
  () => {
    const last = props.lines.at(-1);
    if (!last) {
      return "";
    }
    const t = last.listText ?? last.text ?? "";
    return `${last.streaming ? "1" : "0"}:${t.length}:${t.slice(0, 64)}`;
  },
  () => {
    if (!props.followLatest || !atListEnd()) {
      return;
    }
    scrollLastToEnd();
  },
);

function onRowClick(index: number) {
  emit("select", index);
}

onMounted(() => {
  if (props.followLatest && props.lines.length > 0 && atListEnd()) {
    scrollLastToEnd();
  }
});
</script>

<template>
  <div ref="parentRef" class="scroll">
    <div
      class="inner"
      :style="{
        height: `${virtualizer.getTotalSize()}px`,
        width: '100%',
        position: 'relative',
      }"
    >
      <div
        v-for="item in virtualizer.getVirtualItems()"
        :key="String(item.key)"
        :ref="rowRef"
        class="row"
        :data-index="item.index"
        :class="[
          'role-' + (lines[item.index]?.role ?? 'unknown'),
          {
            selected: selectedIndex === item.index,
            stream: lines[item.index]?.streaming,
          },
        ]"
        :style="{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          transform: `translateY(${item.start}px)`,
        }"
        @click="onRowClick(item.index)"
      >
        <div class="row-head">
          <span class="tag">{{ lines[item.index]?.role ?? "?" }}</span>
          <span v-if="lines[item.index]?.timeLabel" class="time">{{
            lines[item.index]?.timeLabel
          }}</span>
        </div>
        <ChatLineBody class="txt" :text="lines[item.index]?.listText ?? lines[item.index]?.text ?? ''" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.scroll {
  flex: 1;
  min-height: 120px;
  overflow: auto;
  padding: 8px 10px 12px;
}
.row-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 12px;
}
.time {
  font-size: 11px;
  font-weight: 500;
  color: var(--lc-text-dim);
  font-family: var(--lc-mono);
  letter-spacing: 0.02em;
}
.row {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  padding: 10px 12px 12px;
  margin-bottom: 6px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  cursor: pointer;
  box-sizing: border-box;
  max-width: 92%;
  background: var(--lc-bg-raised);
  box-shadow: var(--lc-shadow-sm);
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    box-shadow 0.15s ease;
}

/* User messages: right-aligned, violet tint */
.row.role-user {
  margin-left: auto;
  max-width: 80%;
  background: var(--lc-violet-soft);
  border-color: rgba(139, 92, 246, 0.22);
}
.row.role-user:hover {
  background: rgba(139, 92, 246, 0.14);
  border-color: rgba(139, 92, 246, 0.35);
}

/* Assistant messages: left-aligned, cyan tint */
.row.role-assistant {
  margin-right: auto;
  background: var(--lc-accent-soft);
  border-color: rgba(6, 182, 212, 0.18);
}
.row.role-assistant:hover {
  background: rgba(6, 182, 212, 0.12);
  border-color: rgba(6, 182, 212, 0.32);
}

/* System/tool messages: compact, neutral */
.row.role-system,
.row.role-tool {
  max-width: 88%;
  background: var(--lc-bg-elevated);
  opacity: 0.85;
}

.row:not(.role-user):not(.role-assistant):hover {
  background: var(--lc-bg-elevated);
  border-color: var(--lc-border);
}
.row.selected {
  border-color: var(--lc-border-strong);
  box-shadow:
    0 0 0 1px rgba(6, 182, 212, 0.2),
    0 6px 20px rgba(15, 23, 42, 0.06);
}
.row.role-user.selected {
  background: rgba(139, 92, 246, 0.18);
}
.row.role-assistant.selected {
  background: rgba(6, 182, 212, 0.15);
}
.row.stream {
  border-style: dashed;
  border-color: rgba(6, 182, 212, 0.45);
  animation: lc-stream-pulse 2s ease-in-out infinite;
}
@keyframes lc-stream-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(6, 182, 212, 0.06);
  }
  50% {
    box-shadow: 0 0 16px 2px rgba(6, 182, 212, 0.08);
  }
}
.row.role-assistant .tag {
  color: var(--lc-accent);
}
.row.role-user .tag {
  color: var(--lc-violet);
}
.row.role-system .tag {
  color: var(--lc-text-dim);
}
.row.role-tool .tag {
  color: var(--lc-warning);
}
.tag {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--lc-text-muted);
}
.txt {
  margin: 0;
  min-width: 0;
  color: var(--lc-text);
}
</style>
