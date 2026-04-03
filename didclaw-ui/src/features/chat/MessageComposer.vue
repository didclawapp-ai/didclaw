<script setup lang="ts">
import ComposerAttachments from "@/features/chat/ComposerAttachments.vue";
import SlashCommandPicker from "@/features/chat/SlashCommandPicker.vue";
import WhatsAppIndicator from "@/features/chat/WhatsAppIndicator.vue";
import WeChatIndicator from "@/features/chat/WeChatIndicator.vue";
import {
  extractSlashQuery,
  filterCommands,
  isSlashDraftReadyToSend,
  type SlashCommand,
} from "@/features/chat/slash-commands";
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
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const dragOver = ref(false);

// ─── Slash 命令 ────────────────────────────────────────────────────────────

const slashQuery = computed(() => extractSlashQuery(draft.value));
const slashFiltered = computed(() =>
  slashQuery.value !== null ? filterCommands(slashQuery.value) : [],
);
const showSlashPicker = computed(
  () => slashQuery.value !== null && slashFiltered.value.length > 0,
);
const slashActiveIndex = ref(0);

/** 选中 slash 命令：填入草稿，有参数时末尾加空格让用户继续输入 */
function selectSlashCommand(cmd: SlashCommand): void {
  draft.value = cmd.hasArgs ? `${cmd.command} ` : cmd.command;
  slashActiveIndex.value = 0;
  void textareaRef.value?.focus();
}

/** picker 消失时重置高亮索引 */
function onSlashPickerClose(): void {
  slashActiveIndex.value = 0;
}

function onComposerKeydown(ev: KeyboardEvent): void {
  if (!showSlashPicker.value) return;

  if (ev.key === "ArrowDown") {
    ev.preventDefault();
    slashActiveIndex.value = (slashActiveIndex.value + 1) % slashFiltered.value.length;
  } else if (ev.key === "ArrowUp") {
    ev.preventDefault();
    slashActiveIndex.value =
      (slashActiveIndex.value - 1 + slashFiltered.value.length) % slashFiltered.value.length;
  } else if (ev.key === "Tab" || ev.key === "Enter") {
    if (ev.key === "Enter" && ev.shiftKey) return;
    if (ev.key === "Enter" && isSlashDraftReadyToSend(draft.value)) return;
    ev.preventDefault();
    const cmd = slashFiltered.value[slashActiveIndex.value];
    if (cmd) selectSlashCommand(cmd);
  } else if (ev.key === "Escape") {
    ev.preventDefault();
    draft.value = "";
    onSlashPickerClose();
  }
}

function onComposerEnter(ev: KeyboardEvent): void {
  if (ev.shiftKey) {
    return;
  }
  // 选择器打开且草稿尚未构成可发送的完整命令时，Enter 用于补全当前高亮项
  if (showSlashPicker.value && !isSlashDraftReadyToSend(draft.value)) {
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

/** Clipboard image sources vary by OS / WebView2; type is often empty for screenshots. */
function collectClipboardImageFiles(cd: DataTransfer | null): File[] {
  if (!cd) {
    return [];
  }
  const out: File[] = [];
  const seen = new Set<string>();
  const track = (f: File | null): void => {
    if (!f || f.size <= 0) {
      return;
    }
    const key = `${f.size}:${f.lastModified}:${f.name || ""}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(f);
  };

  const items = cd.items;
  if (items?.length) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it) {
        continue;
      }
      if (it.type.startsWith("image/")) {
        track(it.getAsFile());
        continue;
      }
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (
          f &&
          (f.type.startsWith("image/") ||
            f.type === "" ||
            f.type === "application/octet-stream")
        ) {
          track(f);
        }
      }
    }
  }

  if (out.length === 0 && cd.files?.length) {
    for (let i = 0; i < cd.files.length; i++) {
      const f = cd.files[i];
      if (
        f &&
        (f.type.startsWith("image/") ||
          f.type === "" ||
          f.type === "application/octet-stream")
      ) {
        track(f);
      }
    }
  }

  return out;
}

function onPaste(ev: ClipboardEvent): void {
  if (sending.value || status.value !== "connected") {
    return;
  }
  const files = collectClipboardImageFiles(ev.clipboardData);
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
    <div class="textarea-wrap">
      <Transition name="slash-fade">
        <SlashCommandPicker
          v-if="showSlashPicker"
          :commands="slashFiltered"
          :active-index="slashActiveIndex"
          @select="selectSlashCommand"
          @close="onSlashPickerClose"
        />
      </Transition>
      <textarea
        ref="textareaRef"
        v-model="draft"
        rows="3"
        :placeholder="t('composer.placeholder')"
        :disabled="sending || status !== 'connected'"
        @keydown="onComposerKeydown"
        @keydown.enter="onComposerEnter"
        @paste="onPaste"
      />
    </div>
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
        <div class="shortcut-popover-wrap">
          <button
            type="button"
            class="lc-btn lc-btn-ghost shortcut-kbd-btn"
            :aria-label="t('composer.shortcutsPopoverLabel')"
            :title="t('composer.shortcutsPopoverLabel')"
          >
            <svg class="shortcut-kbd-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="1.25" y="4" width="13.5" height="8.5" rx="1.75" stroke="currentColor" stroke-width="1.25" />
              <path
                stroke="currentColor"
                stroke-width="1.25"
                stroke-linecap="round"
                d="M4.25 7.25h1.1M7.45 7.25h1.1M10.65 7.25h1.1M4.25 9.55h7.5"
              />
            </svg>
          </button>
          <div class="shortcut-popover-hover-bridge" aria-hidden="true" />
          <div class="shortcut-popover-panel" role="tooltip">
            <div class="shortcut-popover-title">{{ t('composer.shortcutsTitle') }}</div>
            <ul class="shortcut-popover-list">
              <li>{{ t('composer.shortcutLineSidebar') }}</li>
              <li>{{ t('composer.shortcutLinePreview') }}</li>
              <li>{{ t('composer.shortcutLineSession') }}</li>
            </ul>
          </div>
        </div>
      </div>
      <div class="row-right">
        <WeChatIndicator />
        <WhatsAppIndicator />
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
.textarea-wrap {
  position: relative;
  margin-bottom: 6px;
}

.composer textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  margin-bottom: 0;
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
.row-right {
  display: flex;
  align-items: center;
  gap: 10px;
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

.shortcut-popover-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.shortcut-kbd-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  min-width: unset;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--lc-text-dim);
}
.shortcut-kbd-icon {
  width: 15px;
  height: 15px;
}
.shortcut-kbd-btn:hover:not(:disabled) {
  color: var(--lc-accent);
  border-color: var(--lc-accent);
}
/* Invisible hover bridge so the pointer can move from the button to the panel above */
.shortcut-popover-hover-bridge {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 100%;
  height: 10px;
}
.shortcut-popover-panel {
  position: absolute;
  left: 0;
  bottom: calc(100% + 10px);
  z-index: 40;
  min-width: 280px;
  max-width: min(360px, 92vw);
  padding: 10px 12px 11px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: var(--lc-surface-panel);
  box-shadow: var(--lc-shadow-md);
  font-size: 12px;
  line-height: 1.45;
  color: var(--lc-text);
  text-align: left;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    opacity 0.14s ease,
    visibility 0.14s ease;
}
.shortcut-popover-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--lc-text-muted);
  margin-bottom: 8px;
}
.shortcut-popover-list {
  margin: 0;
  padding: 0 0 0 1.1em;
  list-style: disc;
}
.shortcut-popover-list li {
  margin-bottom: 5px;
}
.shortcut-popover-list li:last-child {
  margin-bottom: 0;
}
.shortcut-popover-wrap:hover .shortcut-popover-panel,
.shortcut-popover-wrap:focus-within .shortcut-popover-panel {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
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

/* Slash picker 弹出过渡 */
.slash-fade-enter-active,
.slash-fade-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.slash-fade-enter-from,
.slash-fade-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
