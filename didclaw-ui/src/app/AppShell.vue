<script setup lang="ts">
import AppHeader from "@/app/AppHeader.vue";
import AppShellConversationColumn from "@/app/AppShellConversationColumn.vue";
import AppShellTopBanners from "@/app/AppShellTopBanners.vue";
import SessionControlBar from "@/app/SessionControlBar.vue";
import SessionHistoryDialog from "@/app/SessionHistoryDialog.vue";
import ToolSidebar from "@/app/ToolSidebar.vue";
import FirstRunWizard from "@/features/onboarding/FirstRunWizard.vue";
import OpenClawUpdatePrompt from "@/features/openclaw/OpenClawUpdatePrompt.vue";
import DidClawUpdatePrompt from "@/features/update/DidClawUpdatePrompt.vue";
import ExecApprovalDialog from "@/features/chat/ExecApprovalDialog.vue";
import LiveCodePanel from "@/features/live-edit/LiveCodePanel.vue";
import PreviewPane from "@/features/preview/PreviewPane.vue";
import { getDidClawDesktopApi, isDidClawElectron } from "@/lib/electron-bridge";
import { absolutePathToFileUrl } from "@/lib/openclaw-workspace-memory";
import { useAppShellConversationPanel } from "@/composables/useAppShellConversationPanel";
import { useAppShellExternalDocumentClick } from "@/composables/useAppShellExternalDocumentClick";
import { useAppShellGlobalShortcuts } from "@/composables/useAppShellGlobalShortcuts";
import { useAppShellLifecycle } from "@/composables/useAppShellLifecycle";
import { useAppShellOnboardingBanners } from "@/composables/useAppShellOnboardingBanners";
import { useAppShellSessionToolbar } from "@/composables/useAppShellSessionToolbar";
import { useTauriPreviewWindowStrip } from "@/composables/useTauriPreviewWindowStrip";
import { useChatStore } from "@/stores/chat";
import { useLiveEditStore } from "@/stores/liveEdit";
import { useLocalSettingsStore } from "@/stores/localSettings";
import { useFilePreviewStore } from "@/stores/filePreview";
import { useGatewayStore } from "@/stores/gateway";
import { storeToRefs } from "pinia";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const {
  session,
  activeSessionLabel,
  sessionTokenUsage,
  sessionSelectOptions,
  canOpenHistorySessions,
  canCloseActiveSession,
  showOpenClawModelSelect,
  cycleSession,
} = useAppShellSessionToolbar();

const { loading: sessionsLoading, error: sessionsError, allSessions, activeSessionKey } =
  storeToRefs(session);

const chat = useChatStore();
const liveEditStore = useLiveEditStore();
const gw = useGatewayStore();
const localSettings = useLocalSettingsStore();
const filePreview = useFilePreviewStore();

const { experimentalEnabled: liveCodeExperimental, panelOpen: liveCodePanelOpen } =
  storeToRefs(liveEditStore);

const {
  messages,
  openClawPrimaryModel,
  openClawModelPickerRows,
  openClawPrimaryBusy,
  openClawPrimaryPickerError,
  openClawConfigHint,
  sessionListNotice,
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

const isLiveCodeShellOpen = computed(
  () =>
    isDidClawElectron() &&
    liveCodeExperimental.value === true &&
    liveCodePanelOpen.value === true,
);

const isRightPaneOpen = computed(() => isPreviewPaneOpen.value || isLiveCodeShellOpen.value);

const rightStackRef = ref<HTMLElement | null>(null);
useTauriPreviewWindowStrip(isRightPaneOpen, rightStackRef);

function toggleLiveCodePanel(): void {
  liveEditStore.setPanelOpen(!liveCodePanelOpen.value);
}

const historyDialogOpen = ref(false);

const {
  showOnboardingResumeBanner,
  refreshOnboardingResumeBanner,
  onResumeOnboarding,
  onSnoozeOnboardingResume,
  onFirstRunStatusChanged,
  onDeferredBannerOpenSettings,
  onDeferredBannerDismiss,
} = useAppShellOnboardingBanners(localSettings);

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

const { onGlobalDocumentClick } = useAppShellExternalDocumentClick();

const { displayLines, selectedIndex, onSelectMessage, historyLoading } = useAppShellConversationPanel();

watch(activeSessionKey, () => {
  liveEditStore.onActiveSessionChanged();
});

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

function previewWorkspaceMemoryFile(payload: { path: string; name: string }): void {
  historyDialogOpen.value = false;
  void filePreview.openUrl(absolutePathToFileUrl(payload.path), payload.name);
}

async function newChat(): Promise<void> {
  await session.selectSession(window.crypto.randomUUID());
  void session.refresh();
  chat.flashSessionListNotice();
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

const { onGlobalKeydown } = useAppShellGlobalShortcuts({
  historyDialogOpen,
  isPreviewPaneOpen,
  clearPreview: () => filePreview.clear(),
  pickLocalFileForPreview,
  cycleSession,
});

useAppShellLifecycle({
  gw,
  chat,
  refreshOnboardingResumeBanner,
  onFirstRunStatusChanged,
  handleTrayAction,
});

onMounted(() => {
  window.addEventListener("keydown", onGlobalKeydown);
  document.addEventListener("click", onGlobalDocumentClick, true);
});

onUnmounted(() => {
  window.removeEventListener("keydown", onGlobalKeydown);
  document.removeEventListener("click", onGlobalDocumentClick, true);
});
</script>

<template>
  <div class="shell">
    <FirstRunWizard v-if="isDidClawElectron()" />
    <OpenClawUpdatePrompt v-if="isDidClawElectron()" />
    <DidClawUpdatePrompt />
    <ExecApprovalDialog />
    <AppHeader />
    <AppShellTopBanners
      :show-onboarding-resume-banner="showOnboardingResumeBanner"
      @resume-onboarding="onResumeOnboarding"
      @snooze-onboarding="onSnoozeOnboardingResume"
      @deferred-open-settings="onDeferredBannerOpenSettings"
      @deferred-dismiss="onDeferredBannerDismiss"
    />

    <div class="main-wrap">
      <ToolSidebar />
      <div class="main" :class="{ 'preview-pane-open': isRightPaneOpen }">
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
            :session-list-notice="sessionListNotice"
            @new-chat="newChat"
            @select-session="onSessionSelectChange"
            @close-active-session="closeActiveSession"
            @open-history="openHistoryDialog"
            @set-primary-model="void chat.setOpenClawPrimaryModel($event)"
            @open-ai-settings="localSettings.open('ai')"
          />
          <p v-if="sessionsError" class="err small">{{ sessionsError }}</p>
          <div v-if="sessionsLoading" class="muted">{{ t('shell.sessionsLoading') }}</div>

          <AppShellConversationColumn
            :history-loading="historyLoading"
            :display-lines="displayLines"
            :message-count="messages.length"
            :message-list-selected-index="selectedIndex"
            :session-token-usage="sessionTokenUsage"
            :is-preview-pane-open="isPreviewPaneOpen"
            :show-live-code-toolbar="isDidClawElectron() && liveCodeExperimental"
            @pick-local-file="pickLocalFileForPreview"
            @select-message="onSelectMessage"
            @toggle-live-code="toggleLiveCodePanel"
          />
        </aside>

        <section
          v-if="isRightPaneOpen"
          ref="rightStackRef"
          class="right-stack"
        >
          <section
            v-if="isPreviewPaneOpen"
            class="right right--preview"
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
          <LiveCodePanel v-if="isLiveCodeShellOpen" />
        </section>
      </div>
    </div>
    <SessionHistoryDialog
      :open="historyDialogOpen"
      :rows="allSessions"
      :active-session-key="activeSessionKey"
      @close="closeHistoryDialog"
      @select="openHistorySession"
      @preview-memory="previewWorkspaceMemoryFile"
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
  /* fixed AppHeader 不占文档流，为会话栏/模型条等留出顶栏高度 */
  padding-top: var(--lc-app-header-height);
}
.main-wrap {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
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
.main:not(.preview-pane-open) .left {
  border-right: none;
}
.right-stack {
  flex: 1;
  min-width: 260px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  border-left: 1px solid var(--lc-border);
  background: var(--lc-surface-panel);
}
.right-stack .right--preview {
  flex: 1;
  min-height: 0;
  border-bottom: 1px solid var(--lc-border);
}
.right-stack .right--preview:last-child {
  border-bottom: none;
}
.right {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: var(--lc-surface-panel);
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
