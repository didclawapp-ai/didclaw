<script setup lang="ts">
import type { ChatLine } from "@/lib/chat-line";
import { renderMarkdownToSafeHtml } from "@/lib/markdown-render";
import { usePreviewStore } from "@/stores/preview";
import { storeToRefs } from "pinia";
import { computed } from "vue";

const props = defineProps<{
  lines: ChatLine[];
}>();

const preview = usePreviewStore();
const { followLatest } = storeToRefs(preview);

const selectedIndex = computed(() => preview.getSelectedIndex(props.lines.length));

const selectedLine = computed(() => {
  const i = selectedIndex.value;
  if (i === null) {
    return null;
  }
  return props.lines[i] ?? null;
});

const html = computed(() => {
  const line = selectedLine.value;
  if (!line?.text?.trim()) {
    return "";
  }
  return renderMarkdownToSafeHtml(line.text);
});

const isAssistantOrUser = computed(() => {
  const r = selectedLine.value?.role;
  return r === "assistant" || r === "user";
});
</script>

<template>
  <div class="preview-root">
    <div class="toolbar">
      <label class="chk">
        <input
          type="checkbox"
          :checked="followLatest"
          @change="preview.setFollowLatest(($event.target as HTMLInputElement).checked)"
        >
        跟随最新
      </label>
      <span v-if="selectedLine" class="meta"> #{{ (selectedIndex ?? 0) + 1 }} · {{ selectedLine.role }} </span>
    </div>

    <div v-if="!selectedLine" class="empty muted">选择左侧一条消息查看 Markdown 预览。</div>
    <!-- 已通过 DOMPurify 消毒，仅渲染 Markdown 输出 -->
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div v-else-if="isAssistantOrUser && html" class="md preview-md" v-html="html" />
    <pre v-else class="plain">{{ selectedLine.text }}</pre>
  </div>
</template>

<style scoped>
.preview-root {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 10px;
  margin-bottom: 8px;
  border-bottom: 1px solid #eee;
  flex-shrink: 0;
}
.chk {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
}
.meta {
  font-size: 12px;
  color: #666;
}
.empty {
  padding: 12px;
}
.plain {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  flex: 1;
  overflow: auto;
}
.md {
  flex: 1;
  overflow: auto;
  font-size: 14px;
  line-height: 1.55;
}
</style>

<style>
/* v-html 注入内容：样式限在 .preview-md 下 */
.preview-md h1,
.preview-md h2,
.preview-md h3 {
  margin: 0.6em 0 0.35em;
  font-weight: 600;
}
.preview-md p {
  margin: 0.4em 0;
}
.preview-md ul,
.preview-md ol {
  margin: 0.4em 0;
  padding-left: 1.4em;
}
.preview-md pre {
  padding: 10px;
  background: #f4f4f4;
  border-radius: 6px;
  overflow: auto;
  font-size: 12px;
}
.preview-md code {
  font-family: ui-monospace, monospace;
  font-size: 0.92em;
}
.preview-md pre code {
  font-size: inherit;
}
.preview-md table {
  border-collapse: collapse;
  width: 100%;
  margin: 0.5em 0;
  font-size: 13px;
}
.preview-md th,
.preview-md td {
  border: 1px solid #ddd;
  padding: 6px 8px;
}
.preview-md a {
  color: #1565c0;
}
</style>
