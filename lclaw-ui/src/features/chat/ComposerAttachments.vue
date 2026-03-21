<script setup lang="ts">
import { useChatStore } from "@/stores/chat";
import { useFilePreviewStore } from "@/stores/filePreview";
import { useGatewayStore } from "@/stores/gateway";
import { storeToRefs } from "pinia";
import { ref, watch } from "vue";

const chat = useChatStore();
const filePreview = useFilePreviewStore();
const gw = useGatewayStore();
const { pendingComposerFiles, sending } = storeToRefs(chat);
const { status } = storeToRefs(gw);

const inputRef = ref<HTMLInputElement | null>(null);
/** 附件列表展开；超过 3 个时自动收起以免挤占输入区 */
const listExpanded = ref(true);

watch(
  () => pendingComposerFiles.value.length,
  (n, prev) => {
    if (n === 0) {
      listExpanded.value = true;
      return;
    }
    if (n > 3 && (prev ?? 0) <= 3) {
      listExpanded.value = false;
    }
  },
);

function openPicker(): void {
  inputRef.value?.click();
}

defineExpose({ openPicker });

function onInputChange(ev: Event): void {
  const el = ev.target as HTMLInputElement;
  const list = el.files;
  if (list?.length) {
    chat.addPendingComposerFiles(Array.from(list));
  }
  el.value = "";
}

function onPreview(objectUrl: string, name: string): void {
  void filePreview.openUrl(objectUrl, name);
}

function previewOnly(p: { id: string; objectUrl: string; file: File }): void {
  chat.setPendingIncludeInSend(p.id, false);
  void filePreview.openUrl(p.objectUrl, p.file.name);
}

function onToggleInclude(ev: Event, id: string): void {
  const checked = (ev.target as HTMLInputElement).checked;
  chat.setPendingIncludeInSend(id, checked);
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
  <input
    ref="inputRef"
    type="file"
    class="sr-only"
    multiple
    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.log"
    :disabled="sending || status !== 'connected'"
    @change="onInputChange"
  >

  <div v-if="pendingComposerFiles.length > 0" class="attach-panel">
    <button
      type="button"
      class="panel-toggle"
      :disabled="sending"
      @click="listExpanded = !listExpanded"
    >
      <span class="toggle-label">待发附件（{{ pendingComposerFiles.length }}）</span>
      <span class="chev" aria-hidden="true">{{ listExpanded ? "▼" : "▶" }}</span>
    </button>

    <ul v-show="listExpanded" class="file-list">
      <li v-for="p in pendingComposerFiles" :key="p.id" class="file-row">
        <img
          v-if="p.file.type.startsWith('image/')"
          class="thumb"
          :src="p.objectUrl"
          alt=""
        >
        <div v-else class="thumb thumb-doc" aria-hidden="true">文</div>

        <div class="meta">
          <div class="line1">
            <span class="badge" :data-k="p.file.type.startsWith('image/') ? 'img' : 'doc'">
              {{ p.file.type.startsWith("image/") ? "图" : "文" }}
            </span>
            <span class="name" :title="p.file.name">{{ p.file.name }}</span>
          </div>
          <div class="line2">
            <span class="size">{{ formatSize(p.file.size) }}</span>
            <label class="send-flag" :class="{ off: !p.includeInSend }">
              <input
                type="checkbox"
                :checked="p.includeInSend"
                :disabled="sending"
                @change="onToggleInclude($event, p.id)"
              >
              随信发送
            </label>
          </div>
        </div>

        <div class="actions">
          <button
            type="button"
            class="mini"
            :disabled="sending"
            title="仅预览：不写入消息，发送后仍保留"
            @click="previewOnly(p)"
          >
            仅预览
          </button>
          <button
            type="button"
            class="mini"
            :disabled="sending"
            title="在右侧预览"
            @click="onPreview(p.objectUrl, p.file.name)"
          >
            预览
          </button>
          <button
            type="button"
            class="mini danger"
            :disabled="sending"
            @click="chat.removePendingComposerFile(p.id)"
          >
            移除
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
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
.attach-panel {
  margin-bottom: 8px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-elevated);
  overflow: hidden;
}
.panel-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: linear-gradient(180deg, var(--lc-bg-elevated) 0%, var(--lc-bg-raised) 100%);
  font-size: 12px;
  font-weight: 600;
  color: var(--lc-text-muted);
  cursor: pointer;
  font-family: inherit;
}
.panel-toggle:hover:not(:disabled) {
  color: var(--lc-text);
}
.panel-toggle:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.chev {
  font-size: 10px;
  opacity: 0.8;
}
.file-list {
  list-style: none;
  margin: 0;
  padding: 6px 8px 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: min(220px, 40vh);
  overflow-y: auto;
}
.file-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 10px;
  padding: 8px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-raised);
  font-size: 12px;
}
.thumb {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 6px;
  object-fit: cover;
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-elevated);
}
.thumb-doc {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  color: var(--lc-text-dim);
}
.meta {
  flex: 1;
  min-width: 120px;
}
.line1 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.line2 {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
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
  font-weight: 500;
}
.size {
  color: var(--lc-text-dim);
  font-family: var(--lc-mono);
  font-size: 11px;
}
.send-flag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--lc-text-muted);
  cursor: pointer;
}
.send-flag.off {
  color: var(--lc-text-dim);
}
.send-flag input {
  accent-color: var(--lc-accent);
  width: 13px;
  height: 13px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
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
