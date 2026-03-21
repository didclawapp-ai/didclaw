<script setup lang="ts">
import ComposerAttachments from "@/features/chat/ComposerAttachments.vue";
import { useChatStore } from "@/stores/chat";
import { useGatewayStore } from "@/stores/gateway";
import { storeToRefs } from "pinia";

const chat = useChatStore();
const gw = useGatewayStore();
const { draft, sending, lastError: chatError, pendingComposerFiles } = storeToRefs(chat);
const { status } = storeToRefs(gw);

function onComposerEnter(ev: KeyboardEvent): void {
  if (ev.shiftKey) {
    return;
  }
  ev.preventDefault();
  if (!draft.value.trim() && pendingComposerFiles.value.length === 0) {
    return;
  }
  void chat.sendMessage();
}
</script>

<template>
  <div class="composer">
    <ComposerAttachments />
    <textarea
      v-model="draft"
      rows="3"
      placeholder="输入消息…"
      :disabled="sending || status !== 'connected'"
      @keydown.enter="onComposerEnter"
    />
    <p class="composer-hint">Enter 发送，Shift+Enter 换行</p>
    <div class="row">
      <button
        type="button"
        class="lc-btn"
        :disabled="
          sending || status !== 'connected' || (!draft.trim() && pendingComposerFiles.length === 0)
        "
        @click="chat.sendMessage()"
      >
        发送
      </button>
      <button type="button" class="lc-btn lc-btn-ghost" :disabled="status !== 'connected'" @click="chat.abortIfStreaming()">
        中断
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
  line-height: 1.35;
  color: var(--lc-text-dim);
}
.row {
  display: flex;
  gap: 10px;
}
.err {
  color: var(--lc-error);
  margin: 8px 0 0;
}
.err.small {
  font-size: 12px;
}
</style>
