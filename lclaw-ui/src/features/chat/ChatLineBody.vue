<script setup lang="ts">
import { segmentTextWithLinks } from "@/lib/extract-chat-links";
import { useFilePreviewStore } from "@/stores/filePreview";
import { computed } from "vue";

const props = defineProps<{
  text: string;
}>();

const filePreview = useFilePreviewStore();
const segments = computed(() => segmentTextWithLinks(props.text));

function onLink(url: string, label: string, ev: MouseEvent): void {
  ev.stopPropagation();
  filePreview.openUrl(url, label);
}
</script>

<template>
  <div class="body">
    <template v-for="(seg, i) in segments" :key="i">
      <span v-if="seg.type === 'text'" class="txt-plain">{{ seg.text }}</span>
      <button
        v-else
        type="button"
        class="link-chip"
        :title="seg.url"
        @click="onLink(seg.url, seg.label, $event)"
      >
        {{ seg.label }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.body {
  margin: 4px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.45;
}
.txt-plain {
  white-space: pre-wrap;
}
.link-chip {
  display: inline-block;
  margin: 2px 4px 2px 0;
  padding: 2px 8px;
  max-width: 100%;
  font-size: 12px;
  font-family: ui-monospace, monospace;
  color: #0d47a1;
  background: #e3f2fd;
  border: 1px solid #90caf9;
  border-radius: 6px;
  cursor: pointer;
  vertical-align: baseline;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
}
.link-chip:hover {
  background: #bbdefb;
}
</style>
