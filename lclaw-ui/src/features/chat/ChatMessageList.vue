<script setup lang="ts">
import type { ChatLine } from "@/lib/chat-line";
import { useVirtualizer } from "@tanstack/vue-virtual";
import { computed, nextTick, ref, watch } from "vue";

const props = defineProps<{
  lines: ChatLine[];
  selectedIndex: number | null;
}>();

const emit = defineEmits<{
  select: [index: number];
}>();

const parentRef = ref<HTMLElement | null>(null);

const virtualizerOptions = computed(() => ({
  count: props.lines.length,
  getScrollElement: () => parentRef.value,
  estimateSize: () => 88,
  overscan: 8,
}));

const virtualizer = useVirtualizer(virtualizerOptions);

/** 跟随最新：新消息时滚到底 */
watch(
  () => props.lines.length,
  (n, prev) => {
    if (n > prev && props.selectedIndex === n - 1) {
      void nextTick(() => {
        virtualizer.value.scrollToIndex(n - 1, { align: "end" });
      });
    }
  },
);

watch(
  () => props.selectedIndex,
  (idx) => {
    if (idx !== null && idx >= 0 && parentRef.value) {
      void nextTick(() => {
        virtualizer.value.scrollToIndex(idx, { align: "auto" });
      });
    }
  },
);

function onRowClick(index: number) {
  emit("select", index);
}
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
        class="row"
        :class="{
          selected: selectedIndex === item.index,
          stream: lines[item.index]?.streaming,
        }"
        :style="{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          minHeight: `${item.size}px`,
          transform: `translateY(${item.start}px)`,
        }"
        @click="onRowClick(item.index)"
      >
        <span class="tag">{{ lines[item.index]?.role ?? '?' }}</span>
        <pre class="txt">{{ lines[item.index]?.text ?? '' }}</pre>
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
  padding: 8px;
  margin-bottom: 2px;
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
  margin: 4px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 13px;
}
</style>
