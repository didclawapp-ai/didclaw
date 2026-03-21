<script setup lang="ts">
import { useChatStore } from "@/stores/chat";
import { useFilePreviewStore } from "@/stores/filePreview";
import { useGatewayStore } from "@/stores/gateway";
import { storeToRefs } from "pinia";
import { ref } from "vue";

const chat = useChatStore();
const filePreview = useFilePreviewStore();
const gw = useGatewayStore();
const { pendingComposerFiles, sending } = storeToRefs(chat);
const { status } = storeToRefs(gw);

const inputRef = ref<HTMLInputElement | null>(null);
const dragOver = ref(false);

function openPicker(): void {
  inputRef.value?.click();
}

function onInputChange(ev: Event): void {
  const el = ev.target as HTMLInputElement;
  const list = el.files;
  if (list?.length) {
    chat.addPendingComposerFiles(Array.from(list));
  }
  el.value = "";
}

function onDrop(ev: DragEvent): void {
  dragOver.value = false;
  const dt = ev.dataTransfer;
  if (!dt?.files?.length) {
    return;
  }
  chat.addPendingComposerFiles(Array.from(dt.files));
}

function onPreview(objectUrl: string, name: string): void {
  void filePreview.openUrl(objectUrl, name);
}

function formatSize(n: number): string {
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
</script>

<template>
  <div
    class="attach-zone"
    :class="{ 'is-over': dragOver, disabled: sending || status !== 'connected' }"
    @dragenter.prevent="dragOver = true"
    @dragover.prevent="dragOver = true"
    @dragleave.prevent="dragOver = false"
    @drop.prevent="onDrop"
  >
    <input
      ref="inputRef"
      type="file"
      class="sr-only"
      multiple
      accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.log"
      :disabled="sending || status !== 'connected'"
      @change="onInputChange"
    >
    <div class="zone-inner">
      <p class="hint">
        拖拽文件到此处，或
        <button
          type="button"
          class="linkish"
          :disabled="sending || status !== 'connected'"
          @click="openPicker"
        >
          选择文件
        </button>
      </p>
      <p class="sub">
        图片将作为 <code>chat.send.attachments</code> 传入网关；PDF/Office 等可在右侧预览，文字说明会写入消息（网关侧目前主要处理图片附件）。
      </p>
    </div>
  </div>

  <ul v-if="pendingComposerFiles.length > 0" class="file-list">
    <li v-for="p in pendingComposerFiles" :key="p.id" class="file-row">
      <span class="badge" :data-k="p.file.type.startsWith('image/') ? 'img' : 'doc'">
        {{ p.file.type.startsWith("image/") ? "图" : "文" }}
      </span>
      <span class="name" :title="p.file.name">{{ p.file.name }}</span>
      <span class="size">{{ formatSize(p.file.size) }}</span>
      <button
        type="button"
        class="mini lc-btn-ghost"
        :disabled="sending"
        title="在右侧预览"
        @click="onPreview(p.objectUrl, p.file.name)"
      >
        预览
      </button>
      <button
        type="button"
        class="mini lc-btn-ghost danger"
        :disabled="sending"
        @click="chat.removePendingComposerFile(p.id)"
      >
        移除
      </button>
    </li>
  </ul>
</template>

<style scoped>
.attach-zone {
  margin-bottom: 10px;
  padding: 10px 12px;
  border-radius: var(--lc-radius-sm);
  border: 1px dashed rgba(6, 182, 212, 0.35);
  background: rgba(6, 182, 212, 0.04);
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}
.attach-zone.is-over:not(.disabled) {
  border-color: var(--lc-accent);
  background: rgba(6, 182, 212, 0.1);
}
.attach-zone.disabled {
  opacity: 0.5;
  pointer-events: none;
}
.hint {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--lc-text-muted);
}
.sub {
  margin: 0;
  font-size: 11px;
  line-height: 1.45;
  color: var(--lc-text-dim);
}
.sub code {
  font-family: var(--lc-mono);
  font-size: 10px;
}
.linkish {
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  color: var(--lc-accent);
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
  font-size: inherit;
}
.linkish:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}
.file-list {
  list-style: none;
  margin: 0 0 10px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.file-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-raised);
  font-size: 12px;
}
.badge {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--lc-bg-elevated);
  color: var(--lc-text-muted);
}
.badge[data-k="img"] {
  background: rgba(6, 182, 212, 0.15);
  color: #0e7490;
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--lc-text);
}
.size {
  color: var(--lc-text-dim);
  font-family: var(--lc-mono);
  font-size: 11px;
}
.mini {
  font-size: 11px;
  padding: 4px 10px;
  border-radius: var(--lc-radius-sm);
  cursor: pointer;
  border: 1px solid var(--lc-border);
  background: transparent;
  color: var(--lc-text-muted);
}
.mini:hover:not(:disabled) {
  border-color: var(--lc-border-strong);
  color: var(--lc-text);
}
.mini.danger:hover:not(:disabled) {
  border-color: rgba(220, 38, 38, 0.4);
  color: var(--lc-error);
}
</style>
