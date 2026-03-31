<script setup lang="ts">
import AppHeader from "@/app/AppHeader.vue";
import SessionControlBar from "@/app/SessionControlBar.vue";
import SessionHistoryDialog from "@/app/SessionHistoryDialog.vue";
import ToolSidebar from "@/app/ToolSidebar.vue";
import FirstRunWizard from "@/features/onboarding/FirstRunWizard.vue";
import OpenClawUpdatePrompt from "@/features/openclaw/OpenClawUpdatePrompt.vue";
import DidClawUpdatePrompt from "@/features/update/DidClawUpdatePrompt.vue";
import ChatRunStatusBar from "@/features/chat/ChatRunStatusBar.vue";
import ChatMessageList from "@/features/chat/ChatMessageList.vue";
import InlineToolTimeline from "@/features/chat/InlineToolTimeline.vue";
import MessageComposer from "@/features/chat/MessageComposer.vue";
import ExecApprovalDialog from "@/features/chat/ExecApprovalDialog.vue";
import PreviewPane from "@/features/preview/PreviewPane.vue";
import {
  buildListPreview,
  shouldAlwaysHideFromChatList,
  shouldHideDiagnosticChatLine,
} from "@/lib/chat-message-format";
import { messageToChatLine } from "@/lib/chat-line";
import { getDidClawDesktopApi, isDidClawElectron } from "@/lib/electron-bridge";
import { isExternalHttpUrl, openExternalUrl } from "@/lib/open-external";
import { sessionDisplayLabel } from "@/lib/session-display";
import { useChatStore } from "@/stores/chat";
import { useLocalSettingsStore } from "@/stores/localSettings";
import { useFilePreviewStore } from "@/stores/filePreview";
import { usePreviewStore } from "@/stores/preview";
import { useGatewayStore } from "@/stores/gateway";
import { useSessionStore } from "@/stores/session";
import { scheduleDeferredGatewayConnect } from "@/composables/deferredGatewayConnect";
import {
  isFirstRunModelStepComplete,
  markFirstRunModelStepComplete,
  readModelWizardSnoozeExpired,
  showDeferredModelBanner,
  snoozeModelWizard24h,
  syncDeferredModelBannerFromStorage,
  setModelConfigDeferred,
} from "@/composables/modelConfigDeferred";
import { restartGatewayAfterControlUiMerge } from "@/composables/restartGatewayAfterControlUiMerge";
import { useTauriPreviewWindowStrip } from "@/composables/useTauriPreviewWindowStrip";
import { storeToRefs } from "pinia";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

/** Matches the streaming placeholder: show the assistant row before the first delta arrives
 *  (long tasks stay in reasoning/tool phase with no text delta). */

const session = useSessionStore();
const chat = useChatStore();
const gw = useGatewayStore();
const localSettings = useLocalSettingsStore();
const preview = usePreviewStore();
const filePreview = useFilePreviewStore();

const { followLatest, showDiagnosticMessages } = storeToRefs(preview);
const { sessions, allSessions, loading: sessionsLoading, error: sessionsError, activeSessionKey, activeSession } =
  storeToRefs(session);
const {
  messages,
  historyLoading,
  streamText,
  runId,
  openClawPrimaryModel,
  openClawModelPickerRows,
  openClawPrimaryBusy,
  openClawPrimaryPickerError,
  openClawConfigHint,
  flashingSessionKeys,
} = storeToRefs(chat);
const {
  target: fpTarget,
  localLoading: fpLocalLoading,
  localError: fpLocalError,
  chatMessagePreview: fpChatMessagePreview,
} = storeToRefs(filePreview);

const isPreviewPaneOpen = computed(
  () =>
    fpTarget.value != null ||
    fpLocalLoading.value === true ||
    fpLocalError.value != null ||
    fpChatMessagePreview.value != null,
);

const previewPaneRef = ref<HTMLElement | null>(null);
useTauriPreviewWindowStrip(isPreviewPaneOpen, previewPaneRef);

const activeSessionLabel = computed(() => {
  const row = activeSession.value;
  if (activeSessionKey.value) {
    return sessionDisplayLabel(activeSessionKey.value, row?.label);
  }
  return "";
});

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

/** Token usage for the active session (from sessions.list), shown in the toolbar. */
const sessionTokenUsage = computed(() => {
  const row = activeSession.value;
  if (!row) return null;
  const inp = row.inputTokens;
  const out = row.outputTokens;
  if (inp == null && out == null) return null;
  return { in: inp ?? 0, out: out ?? 0 };
});

const sessionSelectOptions = computed(() =>
  sessions.value.map((s) => ({
    key: s.key,
    label: sessionDisplayLabel(s.key, s.label),
    active: s.key === activeSessionKey.value,
    flashing: flashingSessionKeys.value.includes(s.key),
  })),
);

const historyDialogOpen = ref(false);
const canOpenHistorySessions = computed(() => allSessions.value.length > 0);

const canCloseActiveSession = computed(
  () => Boolean(activeSessionKey.value) && activeSessionKey.value !== "agent:main:main",
);

/** Show the model picker when there are registry rows or an existing primary model. */
const showOpenClawModelSelect = computed(
  () =>
    isDidClawElectron() &&
    (openClawModelPickerRows.value.length > 0 || Boolean(openClawPrimaryModel.value?.trim())),
);

const showOnboardingResumeBanner = ref(false);
let unlistenTrayAction: UnlistenFn | undefined;

function onDeferredBannerOpenSettings(): void {
  localSettings.open("providers");
}

function onDeferredBannerDismiss(): void {
  setModelConfigDeferred(false);
  syncDeferredModelBannerFromStorage();
}

async function refreshOnboardingResumeBanner(): Promise<void> {
  if (!isDidClawElectron() || showDeferredModelBanner.value || !readModelWizardSnoozeExpired()) {
    showOnboardingResumeBanner.value = false;
    return;
  }
  const api = getDidClawDesktopApi();
  if (!api?.getOpenClawSetupStatus) {
    showOnboardingResumeBanner.value = !isFirstRunModelStepComplete();
    return;
  }
  try {
    const s = await api.getOpenClawSetupStatus();
    const envReady = s.openclawDirExists && s.openclawConfigState !== "missing";
    if (!envReady) {
      showOnboardingResumeBanner.value = false;
      return;
    }
    let modelReady = isFirstRunModelStepComplete();
    if (!modelReady && api.readOpenClawModelConfig) {
      try {
        const mc = await api.readOpenClawModelConfig();
        const primary = mc.ok ? mc.model?.primary : null;
        if (typeof primary === "string" && primary.trim().length > 0) {
          markFirstRunModelStepComplete();
          modelReady = true;
        }
      } catch {
        /* ignore */
      }
    }
    showOnboardingResumeBanner.value = !modelReady;
  } catch {
    showOnboardingResumeBanner.value = !isFirstRunModelStepComplete();
  }
}

function onResumeOnboarding(): void {
  showOnboardingResumeBanner.value = false;
  window.dispatchEvent(new Event("didclaw-first-run-recheck"));
}

function onSnoozeOnboardingResume(): void {
  showOnboardingResumeBanner.value = false;
  snoozeModelWizard24h();
}

function onFirstRunStatusChanged(): void {
  void refreshOnboardingResumeBanner();
}

function triggerManualUpdateCheck(): void {
  window.dispatchEvent(new CustomEvent("didclaw-check-app-update"));
}

function handleTrayAction(action: string): void {
  switch (action) {
    case "new_chat":
      newChat();
      break;
    case "open_settings":
      localSettings.open("gateway");
      break;
    case "check_update":
      triggerManualUpdateCheck();
      break;
    default:
      break;
  }
}

function cycleSession(direction: 1 | -1): void {
  const rows = sessions.value;
  const count = rows.length;
  if (count <= 1) {
    return;
  }
  const current = activeSessionKey.value;
  const currentIndex = rows.findIndex((row) => row.key === current);
  const startIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (startIndex + direction + count) % count;
  const nextKey = rows[nextIndex]?.key;
  if (!nextKey || nextKey === current) {
    return;
  }
  void session.selectSession(nextKey);
}

function onGlobalKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && historyDialogOpen.value) {
    historyDialogOpen.value = false;
    return;
  }
  if (!event.ctrlKey || event.altKey || event.metaKey || event.key !== "Tab") {
    return;
  }
  event.preventDefault();
  cycleSession(event.shiftKey ? -1 : 1);
}

function onGlobalDocumentClick(event: MouseEvent): void {
  if (!isDidClawElectron()) {
    return;
  }
  if (event.defaultPrevented || event.button !== 0) {
    return;
  }
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const anchor = target.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) {
    return;
  }
  const href = anchor.getAttribute("href")?.trim() || "";
  if (!isExternalHttpUrl(href) || href.startsWith(window.location.origin)) {
    return;
  }
  event.preventDefault();
  void openExternalUrl(href).catch(() => {
    window.alert(t('shell.openExternalFailed'));
  });
}

onMounted(() => {
  window.addEventListener("keydown", onGlobalKeydown);
  document.addEventListener("click", onGlobalDocumentClick, true);
  if (isDidClawElectron()) {
    syncDeferredModelBannerFromStorage();
    void chat.refreshOpenClawModelPicker();
    void refreshOnboardingResumeBanner();
    window.addEventListener("didclaw-first-run-status-changed", onFirstRunStatusChanged);
    if (isTauri()) {
      void listen<string>("didclaw-tray-action", (event) => {
        if (typeof event.payload === "string" && event.payload.length > 0) {
          handleTrayAction(event.payload);
        }
      }).then((fn) => {
        unlistenTrayAction = fn;
      });
    }
  }
  void nextTick(() => {
    void (async () => {
      const api = getDidClawDesktopApi();
      if (!isDidClawElectron()) {
        window.setTimeout(() => {
          gw.connect();
        }, 150);
        return;
      }
      if (!api?.getOpenClawSetupStatus) {
        scheduleDeferredGatewayConnect(gw);
        return;
      }
      try {
        const s = await api.getOpenClawSetupStatus();
        if (s.controlUiAllowedOriginsMerged) {
          await restartGatewayAfterControlUiMerge(gw);
        }
        const envReady = s.openclawDirExists && s.openclawConfigState !== "missing";
        const modelReady = isFirstRunModelStepComplete();
        if (!envReady || !modelReady) {
          return;
        }
        scheduleDeferredGatewayConnect(gw);
      } catch {
        scheduleDeferredGatewayConnect(gw);
      }
    })();
  });
});

onUnmounted(() => {
  window.removeEventListener("keydown", onGlobalKeydown);
  document.removeEventListener("click", onGlobalDocumentClick, true);
  window.removeEventListener("didclaw-first-run-status-changed", onFirstRunStatusChanged);
  unlistenTrayAction?.();
});

watch(
  () => localSettings.visible,
  (now, prev) => {
    if (prev === true && now === false) {
      void refreshOnboardingResumeBanner();
    }
  },
);

watch(showDeferredModelBanner, () => {
  void refreshOnboardingResumeBanner();
});

const displayLines = computed(() => {
  const base = messages.value.map((m) => messageToChatLine(m));
  let list = base;
  if (runId.value != null) {
    const raw = streamText.value ?? "";
    const hasBody = raw.trim().length > 0;
    const pendingLabel = t('shell.streaming');
    const streamingContent = hasBody ? raw : pendingLabel;
    list = [
      ...base,
      {
        role: "assistant" as const,
        text: streamingContent,
        listText: hasBody ? buildListPreview(raw) : pendingLabel,
        streaming: true as const,
      },
    ];
  }
  list = list.filter((line) => !shouldAlwaysHideFromChatList(line.role, line.text));
  if (showDiagnosticMessages.value) {
    return list;
  }
  return list.filter(
    (line) => line.role !== "system" && !shouldHideDiagnosticChatLine(line.role, line.text),
  );
});

const selectedIndex = computed(() => preview.getSelectedIndex(displayLines.value.length));

function onSelectMessage(index: number) {
  preview.selectLine(index, displayLines.value.length);
  const line = displayLines.value[index];
  if (!line) {
    filePreview.clearChatMessagePreview();
    return;
  }
  if (filePreview.tryOpenEmbeddedDataImageFromText(line.text)) {
    return;
  }
  filePreview.forgetEmbeddedChatImageIfAny();
  filePreview.showChatMessageFullText({
    role: line.role,
    text: line.text,
    listText: line.listText,
  });
}

function onSessionSelectChange(key: string): void {
  if (!key || key === activeSessionKey.value) {
    return;
  }
  void session.selectSession(key);
}

function closeActiveSession(): void {
  const key = activeSessionKey.value;
  if (!key || key === "agent:main:main") {
    return;
  }
  void session.closeSession(key);
}

function openHistoryDialog(): void {
  historyDialogOpen.value = true;
}

function closeHistoryDialog(): void {
  historyDialogOpen.value = false;
}

function openHistorySession(key: string): void {
  historyDialogOpen.value = false;
  void session.selectSession(key);
}

function newChat(): void {
  void session.selectSession(window.crypto.randomUUID());
}

async function pickLocalFileForPreview(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api) {
    return;
  }
  const href = await api.pickLocalFile();
  if (href) {
    await filePreview.openUrl(href);
  }
}
</script>

<template>
  <div class="shell">
    <FirstRunWizard v-if="isDidClawElectron()" />
    <OpenClawUpdatePrompt v-if="isDidClawElectron()" />
    <DidClawUpdatePrompt />
    <ExecApprovalDialog />
    <AppHeader />
    <div
      v-if="isDidClawElectron() && showOnboardingResumeBanner"
      class="lc-deferred-model-banner"
      role="status"
    >
      <span class="lc-deferred-model-banner__text">
        {{ t('shell.onboardingIncompleteBanner') }}
      </span>
      <div class="lc-deferred-model-banner__actions">
        <button
          type="button"
          class="lc-btn lc-btn-primary lc-btn-xs"
          @click="onResumeOnboarding"
        >
          {{ t('shell.onboardingResume') }}
        </button>
        <button
          type="button"
          class="lc-btn lc-btn-ghost lc-btn-xs"
          @click="onSnoozeOnboardingResume"
        >
          {{ t('shell.onboardingRemindLater') }}
        </button>
      </div>
    </div>
    <div
      v-if="isDidClawElectron() && showDeferredModelBanner"
      class="lc-deferred-model-banner"
      role="status"
    >
      <span class="lc-deferred-model-banner__text">
        {{ t('shell.deferredModelBanner') }}
      </span>
      <div class="lc-deferred-model-banner__actions">
        <button
          type="button"
          class="lc-btn lc-btn-primary lc-btn-xs"
          @click="onDeferredBannerOpenSettings"
        >
          {{ t('shell.deferredModelOpenSettings') }}
        </button>
        <button
          type="button"
          class="lc-btn lc-btn-ghost lc-btn-xs"
          @click="onDeferredBannerDismiss"
        >
          {{ t('shell.deferredModelDone') }}
        </button>
      </div>
    </div>

    <div class="main-wrap">
      <ToolSidebar />
      <div class="main" :class="{ 'preview-pane-open': isPreviewPaneOpen }">
        <aside class="left">
          <SessionControlBar
            :active-session-key="activeSessionKey"
            :active-session-label="activeSessionLabel"
            :session-select-options="sessionSelectOptions"
            :sessions-loading="sessionsLoading"
            :can-close-active-session="canCloseActiveSession"
            :can-open-history-sessions="canOpenHistorySessions"
            :is-desktop="isDidClawElectron()"
            :show-open-claw-model-select="showOpenClawModelSelect"
            :open-claw-primary-model="openClawPrimaryModel"
            :open-claw-model-picker-rows="openClawModelPickerRows"
            :open-claw-primary-busy="openClawPrimaryBusy"
            :open-claw-primary-picker-error="openClawPrimaryPickerError"
            :open-claw-config-hint="openClawConfigHint"
            @new-chat="newChat"
            @select-session="onSessionSelectChange"
            @close-active-session="closeActiveSession"
            @open-history="openHistoryDialog"
            @set-primary-model="void chat.setOpenClawPrimaryModel($event)"
            @open-ai-settings="localSettings.open('ai')"
          />
          <p v-if="sessionsError" class="err small">{{ sessionsError }}</p>
          <div v-if="sessionsLoading" class="muted">{{ t('shell.sessionsLoading') }}</div>

          <div class="left-conversation">
            <div class="panel-title row-title">
              <span>{{ t('shell.messagesTitle') }}</span>
              <div v-if="!historyLoading" class="msg-toolbar">
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
                  v-if="isDidClawElectron() && !isPreviewPaneOpen"
                  type="button"
                  class="lc-btn lc-btn-ghost lc-btn-xs toolbar-mini"
                  :title="t('shell.localFileTitle')"
                  @click="pickLocalFileForPreview"
                >
                  {{ t('shell.localFileBtn') }}
                </button>
                <span
                  v-if="sessionTokenUsage"
                  class="token-usage"
                  :title="t('usage.tooltipSession')"
                  :aria-label="t('shell.tokenUsageLabel')"
                >
                  <span class="token-in">{{ t('usage.in') }}{{ formatTokenCount(sessionTokenUsage.in) }}</span>
                  <span class="token-out">{{ t('usage.out') }}{{ formatTokenCount(sessionTokenUsage.out) }}</span>
                </span>
              </div>
            </div>
            <ChatRunStatusBar />
            <div class="left-messages">
              <template v-if="historyLoading">
                <div class="muted">{{ t('shell.historyLoading') }}</div>
                <div class="left-messages-spacer" aria-hidden="true" />
              </template>
              <template
                v-else-if="displayLines.length === 0 && messages.length > 0 && !showDiagnosticMessages"
              >
                <!-- eslint-disable-next-line vue/no-v-html -->
                <p class="muted filter-hint" v-html="t('shell.messagesFiltered')" />
                <div class="left-messages-spacer" aria-hidden="true" />
              </template>
              <template v-else-if="!historyLoading && displayLines.length > 0">
                <InlineToolTimeline />
                <div class="left-msg-list-wrap">
                  <ChatMessageList
                    :lines="displayLines"
                    :selected-index="selectedIndex"
                    :follow-latest="followLatest"
                    @select="onSelectMessage"
                  />
                </div>
              </template>
              <div
                v-else-if="!historyLoading && messages.length === 0"
                class="left-msg-list-wrap left-msg-list-wrap--placeholder"
              >
                <p class="muted">{{ t('shell.noMessages') }}</p>
              </div>
              <template v-else-if="!historyLoading">
                <p class="muted filter-hint">{{ t('shell.noVisibleMessages') }}</p>
                <div class="left-messages-spacer" aria-hidden="true" />
              </template>
            </div>
          </div>

          <MessageComposer />
        </aside>

        <section
          v-if="isPreviewPaneOpen"
          ref="previewPaneRef"
          class="right"
          :aria-label="t('shell.previewPaneLabel')"
        >
          <div class="panel-title preview-panel-head">
            <span>{{ t('shell.previewTitle') }}</span>
            <button type="button" class="preview-close-btn" :title="t('shell.previewClose')" @click="filePreview.clear()">&#x2715;</button>
          </div>
          <div class="preview-wrap">
            <PreviewPane />
          </div>
        </section>
      </div>
    </div>
    <SessionHistoryDialog
      :open="historyDialogOpen"
      :rows="allSessions"
      :active-session-key="activeSessionKey"
      @close="closeHistoryDialog"
      @select="openHistorySession"
    />
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  font-family: var(--lc-font);
  font-size: 14px;
  color: var(--lc-text);
}
.lc-deferred-model-banner {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--lc-border);
  background: var(--lc-bg-raised, var(--lc-surface-panel));
  font-size: 12px;
  line-height: 1.45;
}
.lc-deferred-model-banner__text {
  flex: 1;
  min-width: 200px;
  color: var(--lc-text-muted);
}
.lc-deferred-model-banner__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.main-wrap {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding-top: 8px;
}
.main {
  flex: 1;
  display: flex;
  min-height: 0;
  gap: 0;
}
.left {
  flex: 1;
  min-width: 280px;
  border-right: 1px solid var(--lc-border);
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--lc-surface-panel);
}
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
.left-messages > .inline-tools,
.left-messages > .muted,
.left-messages > .filter-hint {
  flex-shrink: 0;
}
.main:not(.preview-pane-open) .left {
  border-right: none;
}
.right {
  flex: 1;
  min-width: 260px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: var(--lc-surface-panel);
  border-left: 1px solid var(--lc-border);
}
.preview-wrap {
  flex: 1;
  min-height: 0;
  padding: 14px 16px 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
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
.preview-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.preview-close-btn {
  flex-shrink: 0;
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 4px;
  font-size: 13px;
  color: var(--lc-text-dim);
  line-height: 1;
  border-radius: var(--lc-radius-sm);
  transition: color 0.15s, background 0.15s;
}
.preview-close-btn:hover {
  color: var(--lc-text);
  background: var(--lc-bg-elevated);
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
.filter-hint strong {
  color: var(--lc-accent);
  font-weight: 600;
}
.err {
  color: var(--lc-error);
  margin: 8px 0 0;
}
.err.small {
  font-size: 12px;
}
.muted {
  color: var(--lc-text-muted);
  padding: 10px 14px;
  font-size: 13px;
}
</style>
