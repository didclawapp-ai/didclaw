<script setup lang="ts">
import { resetFirstRunWizardLocalState } from "@/composables/modelConfigDeferred";
import AboutDialog from "@/features/about/AboutDialog.vue";
import CronJobsDialog from "@/features/cron/CronJobsDialog.vue";
import DoctorDialog from "@/features/settings/DoctorDialog.vue";
import BackupRestoreDialog from "@/features/settings/BackupRestoreDialog.vue";
import ChannelSetupDialog from "@/features/settings/ChannelSetupDialog.vue";
import GatewayLocalDialog from "@/features/settings/GatewayLocalDialog.vue";
import SkillsManagerDialog from "@/features/skills/SkillsManagerDialog.vue";
import { buildDiagnosticsSnapshot, diagnosticsToPrettyJson } from "@/lib/diagnostics";
import { getDidClawDesktopApi, isDidClawElectron } from "@/lib/electron-bridge";
import { useChatStore } from "@/stores/chat";
import { useGatewayStore } from "@/stores/gateway";
import { useLocalSettingsStore } from "@/stores/localSettings";
import { useSessionStore } from "@/stores/session";
import { storeToRefs } from "pinia";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const gw = useGatewayStore();
const session = useSessionStore();
const chat = useChatStore();
const localSettings = useLocalSettingsStore();

const { status, lastError, helloInfo, url } = storeToRefs(gw);
const { sessions, error: sessionsError, activeSessionKey } = storeToRefs(session);
const { messages, lastError: chatError } = storeToRefs(chat);

const expanded = ref(false);
let collapseTimer: number | null = null;

const cronDialogOpen = ref(false);
const channelDialogOpen = ref(false);
const skillsDialogOpen = ref(false);
const aboutDialogOpen = ref(false);
const doctorDialogOpen = ref(false);
const backupDialogOpen = ref(false);
const copiedDiag = ref(false);
const restartGatewayBusy = ref(false);
let copyTimer: number | null = null;

const showGatewayLocal = computed({
  get: () => localSettings.visible,
  set: (v: boolean) => { if (!v) localSettings.close(); },
});

function onMouseEnter(): void {
  if (collapseTimer !== null) {
    clearTimeout(collapseTimer);
    collapseTimer = null;
  }
  expanded.value = true;
}

function onMouseLeave(): void {
  collapseTimer = window.setTimeout(() => {
    expanded.value = false;
    collapseTimer = null;
  }, 300);
}

async function onRestartGateway(): Promise<void> {
  const desktop = getDidClawDesktopApi();
  if (!desktop?.restartOpenClawGateway || restartGatewayBusy.value) return;
  restartGatewayBusy.value = true;
  try {
    const r = await desktop.restartOpenClawGateway();
    if (r && "ok" in r && r.ok === false) return;
    await gw.reloadConnection();
  } catch { /* handled by gateway store */ } finally {
    restartGatewayBusy.value = false;
  }
}

async function copyDiagnostics(): Promise<void> {
  let tokenConfigured = !!import.meta.env.VITE_GATEWAY_TOKEN?.trim();
  let passwordConfigured = !!import.meta.env.VITE_GATEWAY_PASSWORD?.trim();
  const desktop = getDidClawDesktopApi();
  if (isDidClawElectron() && desktop?.readGatewayLocalConfig) {
    try {
      const c = await desktop.readGatewayLocalConfig();
      if (c.token?.trim()) tokenConfigured = true;
      if (c.password?.trim()) passwordConfigured = true;
    } catch { /* ignore */ }
  }
  const snapshot = buildDiagnosticsSnapshot({
    version: __APP_VERSION__,
    gatewayWsUrl: url.value,
    connectionStatus: status.value,
    helloInfo: helloInfo.value,
    gatewayLastError: lastError.value,
    sessionListError: sessionsError.value,
    activeSessionKey: activeSessionKey.value,
    sessionCount: sessions.value.length,
    chatLastError: chatError.value,
    messageCount: messages.value.length,
    gatewayTokenConfigured: tokenConfigured,
    gatewayPasswordConfigured: passwordConfigured,
  });
  const text = diagnosticsToPrettyJson(snapshot);
  try {
    await navigator.clipboard.writeText(text);
    copiedDiag.value = true;
    if (copyTimer !== null) clearTimeout(copyTimer);
    copyTimer = window.setTimeout(() => {
      copiedDiag.value = false;
      copyTimer = null;
    }, 2000);
  } catch { /* ignore */ }
}

function onOpenChannelDialog(): void {
  channelDialogOpen.value = true;
}

onMounted(() => {
  window.addEventListener("didclaw-open-channel-dialog", onOpenChannelDialog);
});

onUnmounted(() => {
  window.removeEventListener("didclaw-open-channel-dialog", onOpenChannelDialog);
});

function onRedoFirstRunWizard(): void {
  if (!window.confirm(t("header.redoOnboardingConfirm"))) return;
  resetFirstRunWizardLocalState();
  window.dispatchEvent(new CustomEvent("didclaw-first-run-recheck"));
}
</script>

<template>
  <!-- Hover trigger zone (always visible, narrow strip at left edge) -->
  <div
    aria-hidden="true"
    class="ts-trigger"
    @mouseenter="onMouseEnter"
  />

  <!-- Sidebar panel -->
  <nav
    :aria-label="t('header.toolbarLabel')"
    class="ts-panel"
    :class="{ 'ts-panel--open': expanded }"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <ul class="ts-list">
      <li>
        <button type="button" class="ts-item" :title="t('header.cronTitle')" @click="cronDialogOpen = true">
          <span class="ts-icon" aria-hidden="true">&#x23F0;</span>
          <span class="ts-label">{{ t('header.cronBtn') }}</span>
        </button>
      </li>
      <li>
        <button type="button" class="ts-item" :title="t('channel.title')" @click="channelDialogOpen = true">
          <span class="ts-icon" aria-hidden="true">&#x1F4E1;</span>
          <span class="ts-label">{{ t('channel.menuBtn') }}</span>
        </button>
      </li>
      <li>
        <button type="button" class="ts-item" @click="skillsDialogOpen = true">
          <span class="ts-icon" aria-hidden="true">&#x2699;</span>
          <span class="ts-label">{{ t('header.skillsBtn') }}</span>
        </button>
      </li>

      <li class="ts-sep" role="separator" />

      <li v-if="isDidClawElectron()">
        <button
          type="button"
          class="ts-item"
          :disabled="restartGatewayBusy"
          @click="onRestartGateway"
        >
          <span class="ts-icon" aria-hidden="true">&#x1F504;</span>
          <span class="ts-label">{{ restartGatewayBusy ? t('header.restartingGateway') : t('header.restartGateway') }}</span>
        </button>
      </li>
      <li v-if="isDidClawElectron()">
        <button type="button" class="ts-item" @click="doctorDialogOpen = true">
          <span class="ts-icon" aria-hidden="true">&#x1FA7A;</span>
          <span class="ts-label">{{ t('header.doctorBtn') }}</span>
        </button>
      </li>
      <li v-if="isDidClawElectron()">
        <button type="button" class="ts-item" @click="backupDialogOpen = true">
          <span class="ts-icon" aria-hidden="true">&#x1F4BE;</span>
          <span class="ts-label">{{ t('header.backupBtn') }}</span>
        </button>
      </li>
      <li v-if="isDidClawElectron()">
        <button
          type="button"
          class="ts-item"
          :title="t('header.redoOnboardingTitle')"
          @click="onRedoFirstRunWizard"
        >
          <span class="ts-icon" aria-hidden="true">&#x1F527;</span>
          <span class="ts-label">{{ t('header.redoOnboarding') }}</span>
        </button>
      </li>
      <li>
        <button type="button" class="ts-item" @click="copyDiagnostics">
          <span class="ts-icon" aria-hidden="true">&#x1F4CB;</span>
          <span class="ts-label">{{ copiedDiag ? t('header.copyDiagDone') : t('header.copyDiag') }}</span>
        </button>
      </li>

      <li class="ts-sep" role="separator" />

      <li>
        <button type="button" class="ts-item" @click="aboutDialogOpen = true">
          <span class="ts-icon" aria-hidden="true">&#x2139;</span>
          <span class="ts-label">{{ t('header.aboutApp') }}</span>
        </button>
      </li>
    </ul>
  </nav>

  <!-- Dialog mount points (migrated from AppHeader) -->
  <GatewayLocalDialog v-model="showGatewayLocal" />
  <CronJobsDialog v-model="cronDialogOpen" />
  <SkillsManagerDialog v-model="skillsDialogOpen" />
  <AboutDialog v-model="aboutDialogOpen" />
  <DoctorDialog v-model="doctorDialogOpen" />
  <BackupRestoreDialog v-model="backupDialogOpen" />
  <ChannelSetupDialog v-model="channelDialogOpen" />
</template>

<style scoped>
.ts-trigger {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 6px;
  z-index: 199;
}

.ts-panel {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: var(--lc-sidebar-w, 210px);
  z-index: 200;
  background: var(--lc-surface-panel);
  backdrop-filter: blur(14px);
  border-right: 1px solid var(--lc-border);
  box-shadow: var(--lc-shadow-md);
  transform: translateX(-100%);
  opacity: 0;
  transition:
    transform var(--lc-sidebar-speed, 0.22s) ease,
    opacity var(--lc-sidebar-speed, 0.22s) ease;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
}

.ts-panel--open {
  transform: translateX(0);
  opacity: 1;
}

.ts-list {
  list-style: none;
  margin: 0;
  padding: 10px 0;
  flex: 1;
}

.ts-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 16px;
  border: none;
  background: transparent;
  font: inherit;
  font-size: 13px;
  text-align: left;
  color: var(--lc-text);
  cursor: pointer;
  transition: background 0.12s ease;
  white-space: nowrap;
}

.ts-item:hover:not(:disabled) {
  background: var(--lc-accent-soft);
}

.ts-item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ts-icon {
  flex-shrink: 0;
  width: 20px;
  font-size: 14px;
  line-height: 1;
  text-align: center;
}

.ts-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ts-sep {
  height: 1px;
  margin: 5px 12px;
  background: var(--lc-border);
}

</style>
