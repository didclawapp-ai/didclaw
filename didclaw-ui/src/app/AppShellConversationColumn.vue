<script setup lang="ts">
import ChatRunStatusBar from "@/features/chat/ChatRunStatusBar.vue";
import ChatMessageList from "@/features/chat/ChatMessageList.vue";
import InlineToolTimeline from "@/features/chat/InlineToolTimeline.vue";
import MessageComposer from "@/features/chat/MessageComposer.vue";
import type { ChatLine } from "@/lib/chat-line";
import { formatTokenCount } from "@/lib/format-token-count";
import { isDidClawElectron } from "@/lib/electron-bridge";
import { usePreviewStore } from "@/stores/preview";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  historyLoading: boolean;
  displayLines: ChatLine[];
  messageCount: number;
  /** 勿命名为 `selectedIndex`：Volar 易与 DOM `HTMLSelectElement.selectedIndex`（仅 number）混淆。 */
  messageListSelectedIndex: number | null;
  sessionTokenUsage: { in: number; out: number } | null;
  isPreviewPaneOpen: boolean;
}>();

defineEmits<{
  pickLocalFile: [];
  selectMessage: [index: number];
}>();

const { t } = useI18n();
const preview = usePreviewStore();
const { followLatest, showDiagnosticMessages } = storeToRefs(preview);
</script>

<template>
  <div class="left-conversation">
    <div class="panel-title row-title">
      <span>{{ t('shell.messagesTitle') }}</span>
      <div v-if="!props.historyLoading" class="msg-toolbar">
        <label class="msg-filter">
          <input
            type="checkbox"
            :checked="followLatest"
            @change="preview.setFollowLatest(($event.target as HTMLInputElement).checked)"
          >
          {{ t('shell.followLatest') }}
        </label>
        <label class="msg-filter">
          <input
            type="checkbox"
            :checked="showDiagnosticMessages"
            @change="
              preview.setShowDiagnosticMessages(($event.target as HTMLInputElement).checked)
            "
          >
          {{ t('shell.showDiagnostic') }}
        </label>
        <button
          v-if="isDidClawElectron() && !props.isPreviewPaneOpen"
          type="button"
          class="lc-btn lc-btn-ghost lc-btn-xs toolbar-mini"
          :title="`${t('shell.localFileTitle')} ${t('shell.localFileShortcutHint')}`"
          @click="$emit('pickLocalFile')"
        >
          {{ t('shell.localFileBtn') }}
        </button>
        <span
          v-if="props.sessionTokenUsage"
          class="token-usage"
          :title="t('usage.tooltipSession')"
          :aria-label="t('shell.tokenUsageLabel')"
        >
          <span class="token-in">{{ t('usage.in') }}{{ formatTokenCount(props.sessionTokenUsage.in) }}</span>
          <span class="token-out">{{ t('usage.out') }}{{ formatTokenCount(props.sessionTokenUsage.out) }}</span>
        </span>
      </div>
    </div>
    <ChatRunStatusBar />
    <div class="left-messages">
      <template v-if="props.historyLoading">
        <div class="muted">{{ t('shell.historyLoading') }}</div>
        <div class="left-messages-spacer" aria-hidden="true" />
      </template>
      <template
        v-else-if="props.displayLines.length === 0 && props.messageCount > 0 && !showDiagnosticMessages"
      >
        <!-- eslint-disable-next-line vue/no-v-html -->
        <p class="muted filter-hint" v-html="t('shell.messagesFiltered')" />
        <div class="left-messages-spacer" aria-hidden="true" />
      </template>
      <template v-else-if="!props.historyLoading && props.displayLines.length > 0">
        <InlineToolTimeline />
        <div class="left-msg-list-wrap">
          <ChatMessageList
            :lines="props.displayLines"
            :selected-index="props.messageListSelectedIndex"
            :follow-latest="followLatest"
            @select="$emit('selectMessage', $event)"
          />
        </div>
      </template>
      <div
        v-else-if="!props.historyLoading && props.messageCount === 0"
        class="left-msg-list-wrap left-msg-list-wrap--placeholder"
      >
        <p class="muted">{{ t('shell.noMessages') }}</p>
      </div>
      <template v-else-if="!props.historyLoading">
        <p class="muted filter-hint">{{ t('shell.noVisibleMessages') }}</p>
        <div class="left-messages-spacer" aria-hidden="true" />
      </template>
    </div>
  </div>

  <MessageComposer />
</template>

<style scoped>
.left-conversation {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.left-messages {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
  overflow-y: hidden;
}
.left-msg-list-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.left-msg-list-wrap--placeholder {
  align-items: stretch;
  justify-content: center;
  padding: 24px 14px;
}
.left-msg-list-wrap--placeholder .muted {
  margin: 0;
  text-align: center;
}
.left-messages-spacer {
  flex: 1;
  min-height: 0;
}
.left-messages > :deep(.inline-tools),
.left-messages > .muted,
.left-messages > .filter-hint {
  flex-shrink: 0;
}
.panel-title {
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--lc-text-muted);
  padding: 10px 14px;
  background: linear-gradient(180deg, var(--lc-bg-elevated) 0%, var(--lc-bg-raised) 100%);
  border-bottom: 1px solid var(--lc-border);
  flex-shrink: 0;
}
.panel-title.row-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: nowrap;
  padding-top: 12px;
  padding-bottom: 12px;
}
.msg-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.msg-filter {
  font-size: 11px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  white-space: nowrap;
  color: var(--lc-text-dim);
  transition: color 0.15s ease;
}
.msg-filter:hover {
  color: var(--lc-text-muted);
}
.msg-filter input {
  accent-color: var(--lc-accent);
  width: 14px;
  height: 14px;
}
.toolbar-mini {
  margin-left: 0;
}
.token-usage {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-family: var(--lc-mono);
  color: var(--lc-text-dim);
  margin-left: auto;
  white-space: nowrap;
}
.token-in {
  color: var(--lc-text-dim);
}
.token-out {
  color: var(--lc-text-dim);
}
.filter-hint {
  font-size: 12px;
  line-height: 1.5;
  margin: 0;
  padding: 10px 14px;
  color: var(--lc-text-muted);
}
.filter-hint :deep(strong) {
  color: var(--lc-accent);
  font-weight: 600;
}
.muted {
  color: var(--lc-text-muted);
  padding: 10px 14px;
  font-size: 13px;
}
</style>
