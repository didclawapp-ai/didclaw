<script setup lang="ts">
import ComposerAttachments from "@/features/chat/ComposerAttachments.vue";
import { useChatStore } from "@/stores/chat";
import { useGatewayStore } from "@/stores/gateway";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";

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
    return "未连接网关";
  }
  if (sendVisualState.value === "busy") {
    return "助手回复进行中，结束后按钮会变绿";
  }
  if (!draft.value.trim() && !hasSendableAttachments.value) {
    return "输入内容或添加待发附件后发送";
  }
  return "发送（会话空闲）";
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
      placeholder="输入消息…（截图可 Ctrl+V 粘贴为图片）"
      :disabled="sending || status !== 'connected'"
      @keydown.enter="onComposerEnter"
      @paste="onPaste"
    />
    <ComposerAttachments ref="attachRef" />
    <p class="composer-hint">
      Enter 发送，Shift+Enter 换行 · 助手回复进行中时「发送」会禁用，可先编辑下一条 · 拖入 / <kbd>Ctrl</kbd>+<kbd>V</kbd> 添加图片 · 「随信发送」与「仅预览」见附件区
    </p>
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
          发送
        </button>
        <button
          type="button"
          class="lc-btn lc-btn-ghost"
          :disabled="status !== 'connected'"
          @click="chat.abortIfStreaming()"
        >
          中断
        </button>
      </div>
      <button
        type="button"
        class="lc-btn lc-btn-ghost attach-btn"
        title="选择文件（图片、PDF、Office…）"
        :disabled="sending || status !== 'connected'"
        @click="openAttachmentPicker"
      >
        附件
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
.composer-hint {
  margin: 0 0 8px;
  padding: 0;
  font-size: 11px;
  line-height: 1.45;
  color: var(--lc-text-dim);
}
.composer-hint code {
  font-family: var(--lc-mono);
  font-size: 10px;
  color: var(--lc-accent);
}
.composer-hint kbd {
  font-family: var(--lc-mono);
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-elevated);
  color: var(--lc-text-muted);
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
