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
        :class="{
          selected: selectedIndex === item.index,
          stream: lines[item.index]?.streaming,
        }"
        :style="{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          transform: `translateY(${item.start}px)`,
        }"
        @click="onRowClick(item.index)"
      >
        <span class="tag">{{ lines[item.index]?.role ?? '?' }}</span>
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
  padding: 4px;
}
.row {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  padding: 8px;
  padding-bottom: 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  cursor: pointer;
  box-sizing: border-box;
}
.row:hover {
  background: #f5f5f5;
}
.row.selected {
  border-color: #1976d2;
  background: #e3f2fd;
}
.row.stream {
  border-style: dashed;
  border-color: #90caf9;
}
.tag {
  font-size: 10px;
  text-transform: uppercase;
  color: #666;
}
.txt {
  margin: 0;
  min-width: 0;
}
</style>
