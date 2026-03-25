<script setup lang="ts">
import ComposerAttachments from "@/features/chat/ComposerAttachments.vue";
import { useChatStore } from "@/stores/chat";
import { useGatewayStore } from "@/stores/gateway";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const chat = useChatStore();
const gw = useGatewayStore();
const { draft, sending, agentBusy, lastError: chatError, pendingComposerFiles } =
  storeToRefs(chat);
const { status } = storeToRefs(gw);

const hasSendableAttachments = computed(() =>
  pendingComposerFiles.value.some((p) => p.includeInSend),
);

/** 发送按钮色相：红=助手占用，绿=空闲可发，灰=未连接 */
const sendVisualState = computed<"offline" | "busy" | "ready">(() => {
  if (status.value !== "connected") {
    return "offline";
  }
  if (agentBusy.value) {
    return "busy";
  }
  return "ready";
});

const sendButtonTitle = computed(() => {
  if (sendVisualState.value === "offline") {
    return t("composer.sendOffline");
  }
  if (sendVisualState.value === "busy") {
    return t("composer.sendBusy");
  }
  if (!draft.value.trim() && !hasSendableAttachments.value) {
    return t("composer.sendEmpty");
  }
  return t("composer.sendReady");
});

const attachRef = ref<InstanceType<typeof ComposerAttachments> | null>(null);
const dragOver = ref(false);

function onComposerEnter(ev: KeyboardEvent): void {
  if (ev.shiftKey) {
    return;
  }
  ev.preventDefault();
  if (agentBusy.value) {
    return;
  }
  if (!draft.value.trim() && !hasSendableAttachments.value) {
    return;
  }
  void chat.sendMessage();
}

function onPaste(ev: ClipboardEvent): void {
  if (sending.value || status.value !== "connected") {
    return;
  }
  const items = ev.clipboardData?.items;
  if (!items?.length) {
    return;
  }
  const files: File[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it || it.kind !== "file") {
      continue;
    }
    const f = it.getAsFile();
    if (f && f.type.startsWith("image/")) {
      files.push(f);
    }
  }
  if (files.length === 0) {
    return;
  }
  ev.preventDefault();
  chat.addPendingComposerFiles(files);
}

function openAttachmentPicker(): void {
  attachRef.value?.openPicker();
}

function onDragEnter(ev: DragEvent): void {
  if (sending.value || status.value !== "connected") {
    return;
  }
  if (!ev.dataTransfer?.types.includes("Files")) {
    return;
  }
  ev.preventDefault();
  dragOver.value = true;
}

function onDragOver(ev: DragEvent): void {
  if (sending.value || status.value !== "connected") {
    return;
  }
  if (!ev.dataTransfer?.types.includes("Files")) {
    return;
  }
  ev.preventDefault();
}

function onDragLeave(ev: DragEvent): void {
  const root = ev.currentTarget as HTMLElement;
  const rel = ev.relatedTarget as Node | null;
  if (rel && root.contains(rel)) {
    return;
  }
  dragOver.value = false;
}

function onDrop(ev: DragEvent): void {
  dragOver.value = false;
  if (sending.value || status.value !== "connected") {
    return;
  }
  const dt = ev.dataTransfer;
  if (!dt?.files?.length) {
    return;
  }
  ev.preventDefault();
  chat.addPendingComposerFiles(Array.from(dt.files));
}
</script>

<template>
  <div
    class="composer"
    :class="{ 'is-drag-over': dragOver }"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <textarea
      v-model="draft"
      rows="3"
      :placeholder="t('composer.placeholder')"
      :disabled="sending || status !== 'connected'"
      @keydown.enter="onComposerEnter"
      @paste="onPaste"
    />
    <ComposerAttachments ref="attachRef" />
    <div class="row">
      <div class="row-left">
        <button
          type="button"
          class="lc-btn send-btn"
          :class="{
            'send-btn--busy': sendVisualState === 'busy',
            'send-btn--ready': sendVisualState === 'ready',
            'send-btn--offline': sendVisualState === 'offline',
          }"
          :title="sendButtonTitle"
          :disabled="
            sending || status !== 'connected' || agentBusy || (!draft.trim() && !hasSendableAttachments)
          "
          @click="chat.sendMessage()"
        >
          {{ t('common.send') }}
        </button>
        <button
          type="button"
          class="lc-btn lc-btn-ghost"
          :disabled="status !== 'connected'"
          @click="chat.abortIfStreaming()"
        >
          {{ t('common.abort') }}
        </button>
        <button
          type="button"
          class="lc-btn lc-btn-ghost hint-btn"
          :title="t('composer.shortcutTip')"
          aria-label="?"
        >
          ?
        </button>
      </div>
      <button
        type="button"
        class="lc-btn lc-btn-ghost attach-btn"
        :title="t('composer.attachTitle')"
        :disabled="sending || status !== 'connected'"
        @click="openAttachmentPicker"
      >
        {{ t('common.attach') }}
      </button>
    </div>
    <p v-if="chatError" class="err small">{{ chatError }}</p>
  </div>
</template>

<style scoped>
.composer {
  flex: 0 0 auto;
  padding: 12px 14px 14px;
  border-top: 1px solid var(--lc-border);
  background: var(--lc-surface-composer);
  backdrop-filter: blur(8px);
  border-radius: 0;
  transition:
    box-shadow 0.15s ease,
    background 0.15s ease;
}
.composer.is-drag-over {
  box-shadow: inset 0 0 0 2px rgba(6, 182, 212, 0.45);
  background: rgba(6, 182, 212, 0.06);
}
.composer textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  margin-bottom: 6px;
  min-height: 72px;
  padding: 10px 12px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-raised);
  color: var(--lc-text);
  font-family: var(--lc-font);
  font-size: 13px;
  line-height: 1.45;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}
.composer textarea::placeholder {
  color: var(--lc-text-dim);
}
.composer textarea:focus {
  outline: none;
  border-color: var(--lc-border-strong);
  box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.12);
}
.composer textarea:disabled {
  opacity: 0.5;
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.row-left {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.attach-btn {
  margin-left: auto;
}
.hint-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--lc-text-dim);
  border-radius: 50%;
  min-width: unset;
  line-height: 1;
}
.hint-btn:hover:not(:disabled) {
  color: var(--lc-accent);
  border-color: var(--lc-accent);
}
.err {
  color: var(--lc-error);
  margin: 8px 0 0;
}
.err.small {
  font-size: 12px;
}

/* 发送键语义色（覆盖全局 .lc-btn 渐变，仅本组件） */
.send-btn.send-btn--busy {
  border-color: rgba(220, 38, 38, 0.55);
  background: linear-gradient(165deg, #991b1b 0%, #dc2626 52%, #f87171 145%);
  box-shadow: 0 2px 14px rgba(220, 38, 38, 0.28);
}
.send-btn.send-btn--busy:hover:not(:disabled) {
  border-color: #ef4444;
  box-shadow: 0 4px 18px rgba(220, 38, 38, 0.35);
}
.send-btn.send-btn--ready {
  border-color: rgba(5, 150, 105, 0.5);
  background: linear-gradient(165deg, #047857 0%, #059669 50%, #34d399 130%);
  box-shadow: 0 2px 14px rgba(5, 150, 105, 0.22);
}
.send-btn.send-btn--ready:hover:not(:disabled) {
  border-color: #10b981;
  box-shadow: 0 4px 18px rgba(16, 185, 129, 0.3);
}
.send-btn.send-btn--offline {
  border-color: var(--lc-border);
  background: var(--lc-bg-elevated);
  color: var(--lc-text-muted);
  box-shadow: none;
}
.send-btn.send-btn--offline:hover:not(:disabled) {
  border-color: var(--lc-border-strong);
  color: var(--lc-text);
  box-shadow: none;
  transform: none;
}
.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
  transform: none;
}
</style>
