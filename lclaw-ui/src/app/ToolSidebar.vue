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
  <div aria-hidden="true" class="ts-trigger" @mouseenter="onMouseEnter" />

  <nav
    :aria-label="t('header.toolbarLabel')"
    class="ts-panel"
    :class="{ 'ts-panel--open': expanded }"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <!-- Sidebar header -->
    <div class="ts-head">
      <span class="ts-head-gem" aria-hidden="true" />
      <span class="ts-head-title">DidClaw</span>
    </div>

    <ul class="ts-list">
      <!-- Features group -->
      <li class="ts-group-label">功能</li>
      <li>
        <button type="button" class="ts-item" :title="t('header.cronTitle')" @click="cronDialogOpen = true">
          <span class="ts-icon" aria-hidden="true">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="8" cy="9" r="5.5" />
              <path d="M8 6v3l2 1.5" />
              <path d="M5.5 1.5h5" />
            </svg>
          </span>
          <span class="ts-label">{{ t('header.cronBtn') }}</span>
        </button>
      </li>
      <li>
        <button type="button" class="ts-item" :title="t('channel.title')" @click="channelDialogOpen = true">
          <span class="ts-icon" aria-hidden="true">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 4h9a1 1 0 0 1 1 1v3.5L9.5 10H2a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
              <path d="M5.5 10v1.5a1 1 0 0 0 1 1H13l2 1.5v-5a1 1 0 0 0-1-1h-2" />
            </svg>
          </span>
          <span class="ts-label">{{ t('channel.menuBtn') }}</span>
        </button>
      </li>
      <li>
        <button type="button" class="ts-item" @click="skillsDialogOpen = true">
          <span class="ts-icon" aria-hidden="true">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M8 1.5l1.8 3.7 4.1.6-3 2.9.7 4.1L8 10.7l-3.6 1.9.7-4.1-3-2.9 4.1-.6z" />
            </svg>
          </span>
          <span class="ts-label">{{ t('header.skillsBtn') }}</span>
        </button>
      </li>

      <!-- System group (desktop only) -->
      <template v-if="isDidClawElectron()">
        <li class="ts-group-label">系统</li>
        <li>
          <button type="button" class="ts-item ts-item--danger" :disabled="restartGatewayBusy" @click="onRestartGateway">
            <span class="ts-icon" aria-hidden="true">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2.5 8A5.5 5.5 0 1 0 5 3.5" />
                <path d="M5 1v3H2" />
              </svg>
            </span>
            <span class="ts-label">{{ restartGatewayBusy ? t('header.restartingGateway') : t('header.restartGateway') }}</span>
          </button>
        </li>
        <li>
          <button type="button" class="ts-item" @click="doctorDialogOpen = true">
            <span class="ts-icon" aria-hidden="true">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="1.5,8 4,8 5.5,4.5 8,11.5 10,8 14.5,8" />
              </svg>
            </span>
            <span class="ts-label">{{ t('header.doctorBtn') }}</span>
          </button>
        </li>
        <li>
          <button type="button" class="ts-item" @click="backupDialogOpen = true">
            <span class="ts-icon" aria-hidden="true">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="4.5" width="12" height="9" rx="1.5" />
                <path d="M8 7.5v4M6.5 10l1.5 1.5L9.5 10" />
                <path d="M5 4.5V3.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
              </svg>
            </span>
            <span class="ts-label">{{ t('header.backupBtn') }}</span>
          </button>
        </li>
        <li>
          <button type="button" class="ts-item" :title="t('header.redoOnboardingTitle')" @click="onRedoFirstRunWizard">
            <span class="ts-icon" aria-hidden="true">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="8" cy="8" r="6" />
                <path d="M6.5 5l3.5 3-3.5 3" />
              </svg>
            </span>
            <span class="ts-label">{{ t('header.redoOnboarding') }}</span>
          </button>
        </li>
      </template>

      <!-- Diagnostics copy (always visible) -->
      <li v-if="!isDidClawElectron()" class="ts-group-label">系统</li>
      <li>
        <button type="button" class="ts-item" :class="{ 'ts-item--success': copiedDiag }" @click="copyDiagnostics">
          <span class="ts-icon" aria-hidden="true">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <rect x="5" y="3" width="8" height="10" rx="1.5" />
              <path d="M3 5.5v7A1.5 1.5 0 0 0 4.5 14H10" />
              <path d="M7 7h4M7 9.5h4" />
            </svg>
          </span>
          <span class="ts-label">{{ copiedDiag ? t('header.copyDiagDone') : t('header.copyDiag') }}</span>
        </button>
      </li>

      <!-- About -->
      <li class="ts-sep-thin" role="separator" />
      <li>
        <button type="button" class="ts-item ts-item--muted" @click="aboutDialogOpen = true">
          <span class="ts-icon" aria-hidden="true">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
              <circle cx="8" cy="8" r="6" />
              <path d="M8 7.5v4" />
              <circle cx="8" cy="5.5" r="0.8" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <span class="ts-label">{{ t('header.aboutApp') }}</span>
        </button>
      </li>
    </ul>
  </nav>

  <!-- Dialog mount points -->
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
  width: var(--lc-sidebar-w, 220px);
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

/* ── Header ── */
.ts-head {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 13px 16px 11px;
  border-bottom: 1px solid var(--lc-border);
  flex-shrink: 0;
}
.ts-head-gem {
  display: block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: #dc2626;
  box-shadow: 0 1px 5px rgba(220, 38, 38, 0.4);
  transform: rotate(45deg);
  flex-shrink: 0;
}
.ts-head-title {
  font-family: "Righteous", system-ui, sans-serif;
  font-size: 13px;
  font-weight: 400;
  letter-spacing: 0.03em;
  color: var(--lc-text);
}

/* ── List ── */
.ts-list {
  list-style: none;
  margin: 0;
  padding: 6px 0 14px;
  flex: 1;
}

/* ── Group label ── */
.ts-group-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--lc-text-muted);
  padding: 10px 16px 3px;
  opacity: 0.5;
  user-select: none;
}

/* ── Item ── */
.ts-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 5px 14px 5px 16px;
  border: none;
  background: transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 450;
  text-align: left;
  color: var(--lc-text);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
  white-space: nowrap;
}
.ts-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%) scaleY(0);
  width: 3px;
  height: 56%;
  border-radius: 0 3px 3px 0;
  background: var(--lc-accent);
  transition: transform 0.15s ease;
}
.ts-item:hover:not(:disabled)::before {
  transform: translateY(-50%) scaleY(1);
}
.ts-item:hover:not(:disabled) {
  background: var(--lc-bg-hover, rgba(14, 116, 144, 0.07));
}
.ts-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ── Icon box ── */
.ts-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  flex-shrink: 0;
  background: var(--lc-bg-raised);
  border: 1px solid var(--lc-border);
  color: var(--lc-text-muted);
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.ts-icon svg {
  width: 15px;
  height: 15px;
}
.ts-item:hover:not(:disabled) .ts-icon {
  background: var(--lc-bg-elevated, var(--lc-bg-raised));
  border-color: var(--lc-border-strong, var(--lc-border));
  color: var(--lc-accent);
}

/* Danger variant */
.ts-item--danger .ts-icon {
  color: var(--lc-error, #dc2626);
  border-color: rgba(220, 38, 38, 0.22);
  background: rgba(220, 38, 38, 0.06);
}
.ts-item--danger:hover:not(:disabled) .ts-icon {
  background: rgba(220, 38, 38, 0.12);
  border-color: rgba(220, 38, 38, 0.38);
  color: var(--lc-error, #dc2626);
}
.ts-item--danger::before {
  background: var(--lc-error, #dc2626);
}

/* Success variant (copied) */
.ts-item--success .ts-icon {
  color: var(--lc-success, #059669);
  border-color: rgba(5, 150, 105, 0.22);
  background: rgba(5, 150, 105, 0.06);
}
.ts-item--success::before {
  background: var(--lc-success, #059669);
}

/* Muted variant (about) */
.ts-item--muted {
  color: var(--lc-text-muted);
  font-size: 12px;
}

/* ── Label ── */
.ts-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Thin separator ── */
.ts-sep-thin {
  height: 1px;
  margin: 8px 12px;
  background: var(--lc-border);
  opacity: 0.55;
}
</style>
