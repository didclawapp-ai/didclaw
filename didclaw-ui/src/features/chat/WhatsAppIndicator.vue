<script setup lang="ts">
import { useChannelHealth, queryChannelHealthNow } from "@/composables/useChannelHealth";
import { useGatewayStore } from "@/stores/gateway";
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import { storeToRefs } from "pinia";
import { computed, ref, onUnmounted, watch } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const WHATSAPP_PLUGIN_SPEC = "@openclaw/whatsapp";

const gw = useGatewayStore();
const { status: gwStatus } = storeToRefs(gw);
const { whatsAppHealth } = useChannelHealth();

const popupOpen = ref(false);
const qrUrl = ref<string | null>(null);
const qrState = ref<"idle" | "loading" | "installing" | "waiting" | "success" | "failed">("idle");
const qrMessage = ref<string | null>(null);
const installProgress = ref(0);
const busy = ref(false);

function isProviderMissingError(msg: string): boolean {
  return /not available|not supported|provider is not available/i.test(msg);
}

type IndicatorColor = "green" | "amber" | "red" | "gray";

const indicatorColor = computed<IndicatorColor>(() => {
  if (gwStatus.value !== "connected" || !whatsAppHealth.value) return "gray";
  const h = whatsAppHealth.value;
  if (h.linked && h.running && h.connected) return "green";
  if (h.linked) return "amber";
  return "red";
});

const indicatorTitle = computed(() => {
  if (gwStatus.value !== "connected") return t('channel.gwDisconnected');
  if (!whatsAppHealth.value) return t('channel.whatsapp.statusUnknown');
  const h = whatsAppHealth.value;
  if (h.linked && h.running && h.connected) return t('channel.whatsapp.connected');
  if (h.linked && !h.running) return t('channel.whatsapp.linkedNotRunning');
  if (h.linked && !h.connected) return t('channel.whatsapp.linkedNotConnected');
  return t('channel.whatsapp.notLinked');
});

function togglePopup(): void {
  if (gwStatus.value !== "connected") return;
  popupOpen.value = !popupOpen.value;
  if (popupOpen.value) {
    qrState.value = "idle";
    qrUrl.value = null;
    qrMessage.value = null;
    installProgress.value = 0;
  }
}

function closePopup(): void {
  popupOpen.value = false;
}

function onClickOutside(ev: MouseEvent): void {
  const root = (ev.target as HTMLElement).closest(".wa-indicator-root");
  if (!root) closePopup();
}

watch(popupOpen, (v) => {
  if (v) {
    window.addEventListener("click", onClickOutside, { capture: true });
  } else {
    window.removeEventListener("click", onClickOutside, { capture: true });
  }
});

onUnmounted(() => {
  window.removeEventListener("click", onClickOutside, { capture: true });
});

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForGatewayConnected(timeoutMs = 25000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((gwStatus.value as string) === "connected") {
      await delay(800);
      return true;
    }
    await delay(500);
  }
  return false;
}

async function tryWebLoginStart(): Promise<"qr" | "linked" | "provider-missing" | "failed"> {
  const gc = gw.client;
  if (!gc || gwStatus.value !== "connected") return "failed";
  try {
    const res = await gc.request<{ qrDataUrl?: string; message?: string }>(
      "web.login.start",
      { force: false },
    );
    if (!res?.qrDataUrl) {
      await queryChannelHealthNow();
      qrState.value = "success";
      qrMessage.value = res?.message ?? t('channel.whatsapp.alreadyLinked');
      scheduleAutoClose();
      return "linked";
    }
    qrUrl.value = res.qrDataUrl;
    qrState.value = "waiting";
    qrMessage.value = t('channel.whatsapp.scanPrompt');
    return "qr";
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (isProviderMissingError(msg)) return "provider-missing";
    qrState.value = "failed";
    qrMessage.value = msg;
    return "failed";
  }
}

async function autoInstallAndRetry(): Promise<boolean> {
  const api = getDidClawDesktopApi();
  if (!api?.openclawPluginsInstall || !api.writeChannelConfig || !api.restartOpenClawGateway) {
    qrState.value = "failed";
    qrMessage.value = t('channel.whatsapp.noAutoInstall');
    return false;
  }

  if (api.getOpenClawSetupStatus) {
    try {
      const s = await api.getOpenClawSetupStatus();
      if (!s.openclawSetupIndicated || !s.openclawCli?.ok) {
        qrState.value = "failed";
        qrMessage.value = t('channel.needsOpenClawSetup');
        return false;
      }
    } catch {
      /* fall through to attempt install */
    }
  }

  qrState.value = "installing";
  installProgress.value = 0;
  qrMessage.value = t('channel.whatsapp.installingPlugin');

  const installResult = await api.openclawPluginsInstall({ packageSpec: WHATSAPP_PLUGIN_SPEC });
  if (!installResult.ok) {
    qrState.value = "failed";
    qrMessage.value = t('channel.whatsapp.installPluginFailed', { err: (installResult as { error?: string }).error ?? "unknown" });
    return false;
  }
  installProgress.value = 33;

  qrMessage.value = t('channel.whatsapp.enablingChannel');
  const configResult = await api.writeChannelConfig("whatsapp", { enabled: true });
  if (!configResult.ok) {
    qrState.value = "failed";
    qrMessage.value = t('channel.whatsapp.enableFailed', { err: (configResult as { error?: string }).error ?? "unknown" });
    return false;
  }
  installProgress.value = 55;

  qrMessage.value = t('channel.gwRestarting');
  const restartResult = await api.restartOpenClawGateway();
  if (!restartResult?.ok) {
    qrState.value = "failed";
    qrMessage.value = t('channel.gwRestartFailed');
    return false;
  }
  installProgress.value = 70;

  qrMessage.value = t('channel.gwWaitingReconnect');
  await gw.reloadConnection();
  const reconnected = await waitForGatewayConnected();
  if (!reconnected) {
    qrState.value = "failed";
    qrMessage.value = t('channel.whatsapp.gwRestartTimeoutRetry');
    return false;
  }
  installProgress.value = 90;

  qrMessage.value = t('channel.whatsapp.fetchingQr');
  installProgress.value = 100;
  return true;
}

async function startQrFlow(): Promise<void> {
  qrState.value = "loading";
  qrUrl.value = null;
  qrMessage.value = t('channel.whatsapp.requesting');
  installProgress.value = 0;

  const firstAttempt = await tryWebLoginStart();
  if (firstAttempt === "linked" || firstAttempt === "failed") return;

  if (firstAttempt === "qr") {
    await waitForQrScan();
    return;
  }

  // provider-missing: auto-install
  const installed = await autoInstallAndRetry();
  if (!installed) return;

  const secondAttempt = await tryWebLoginStart();
  if (secondAttempt === "linked" || secondAttempt === "failed") return;

  if (secondAttempt === "qr") {
    await waitForQrScan();
    return;
  }

  // Still provider-missing after install
  qrState.value = "failed";
  qrMessage.value = t('channel.whatsapp.installedNotReady');
}

async function waitForQrScan(): Promise<void> {
  const gc = gw.client;
  if (!gc) return;
  try {
    const waitRes = await gc.request<{ connected?: boolean; message?: string }>(
      "web.login.wait",
      { timeoutMs: 120000 },
    );
    if (!waitRes?.connected) {
      qrState.value = "failed";
      qrMessage.value = waitRes?.message ?? t('channel.whatsapp.scanTimeoutOrFailed');
      return;
    }

    qrMessage.value = t('channel.whatsapp.scanSuccessWaiting');
    await delay(3000);
    const h = await queryChannelHealthNow();
    if (h?.running) {
      qrState.value = "success";
      qrMessage.value = t('channel.whatsapp.linkedSuccess');
      scheduleAutoClose();
      return;
    }

    qrMessage.value = t('channel.whatsapp.channelNotStartedRestarting');
    const api = getDidClawDesktopApi();
    if (!api?.restartOpenClawGateway) {
      qrState.value = "success";
      qrMessage.value = t('channel.whatsapp.linkedNeedManualRestart');
      return;
    }
    const restartResult = await api.restartOpenClawGateway();
    if (!restartResult?.ok) {
      qrState.value = "success";
      qrMessage.value = t('channel.whatsapp.linkedGwRestartFailed');
      return;
    }
    await gw.reloadConnection();
    const reconnected = await waitForGatewayConnected(20000);
    if (!reconnected) {
      qrState.value = "success";
      qrMessage.value = t('channel.whatsapp.linkedGwTimeout');
      return;
    }
    await delay(5000);
    const h2 = await queryChannelHealthNow();
    qrState.value = "success";
    qrMessage.value = h2?.running
      ? t('channel.whatsapp.linkedSuccess')
      : t('channel.whatsapp.linkedChannelStarting');
    scheduleAutoClose();
  } catch (e) {
    qrState.value = "failed";
    qrMessage.value = String((e as Error)?.message ?? e);
  }
}

const reconnectMessage = ref<string | null>(null);

async function doReconnect(): Promise<void> {
  const gc = gw.client;
  if (!gc || gwStatus.value !== "connected") return;
  busy.value = true;
  reconnectMessage.value = t('channel.whatsapp.reconnecting');
  try {
    await gc.request("web.login.start", { force: false });
    await delay(3000);
    const h1 = await queryChannelHealthNow();
    if (h1 && h1.running) {
      reconnectMessage.value = null;
      return;
    }

    reconnectMessage.value = t('channel.whatsapp.channelStillNotStarted');
    const api = getDidClawDesktopApi();
    if (!api?.restartOpenClawGateway) {
      reconnectMessage.value = t('channel.whatsapp.reconnectFailedManualRestart');
      return;
    }
    const restartResult = await api.restartOpenClawGateway();
    if (!restartResult?.ok) {
      reconnectMessage.value = t('channel.gwRestartFailed');
      return;
    }
    await gw.reloadConnection();
    const reconnected = await waitForGatewayConnected(20000);
    if (!reconnected) {
      reconnectMessage.value = t('channel.gwRestartTimeout');
      return;
    }
    await delay(4000);
    const h2 = await queryChannelHealthNow();
    reconnectMessage.value = h2?.running ? null : t('channel.restartDoneChannelStarting');
  } catch {
    reconnectMessage.value = t('channel.whatsapp.reconnectFailed');
  } finally {
    busy.value = false;
  }
}

async function doRestartGateway(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.restartOpenClawGateway) return;
  busy.value = true;
  reconnectMessage.value = t('channel.gwRestarting');
  try {
    const restartResult = await api.restartOpenClawGateway();
    if (!restartResult?.ok) {
      reconnectMessage.value = t('channel.gwRestartFailed');
      return;
    }
    await gw.reloadConnection();
    const reconnected = await waitForGatewayConnected(20000);
    if (!reconnected) {
      reconnectMessage.value = t('channel.gwRestartTimeout');
      return;
    }
    await delay(4000);
    const h = await queryChannelHealthNow();
    reconnectMessage.value = h?.running ? null : t('channel.restartDoneChannelStarting');
  } catch {
    reconnectMessage.value = t('channel.restartFailed');
  } finally {
    busy.value = false;
  }
}

function openChannelSetup(): void {
  closePopup();
  window.dispatchEvent(new CustomEvent("didclaw-open-channel-dialog"));
}

let autoCloseTimer: number | null = null;
function scheduleAutoClose(): void {
  if (autoCloseTimer !== null) clearTimeout(autoCloseTimer);
  autoCloseTimer = window.setTimeout(() => {
    autoCloseTimer = null;
    closePopup();
  }, 2000);
}

onUnmounted(() => {
  if (autoCloseTimer !== null) clearTimeout(autoCloseTimer);
});
</script>

<template>
  <div class="wa-indicator-root">
    <button
      type="button"
      class="wa-dot"
      :class="`wa-dot--${indicatorColor}`"
      :title="indicatorTitle"
      :disabled="gwStatus !== 'connected'"
      @click.stop="togglePopup"
    >
      WhatsApp
    </button>

    <Transition name="wa-popup-fade">
      <div v-if="popupOpen" class="wa-popup" @click.stop>
        <!-- Fully connected -->
        <template v-if="indicatorColor === 'green'">
          <div class="wa-popup-status wa-popup-status--ok">{{ t('channel.whatsapp.connected') }}</div>
          <div v-if="whatsAppHealth?.lastError" class="wa-popup-detail">{{ whatsAppHealth.lastError }}</div>
        </template>

        <!-- Linked but degraded -->
        <template v-else-if="indicatorColor === 'amber'">
          <div class="wa-popup-status wa-popup-status--warn">
            {{ whatsAppHealth?.lastError
              ? t('channel.whatsapp.linkedNotRunningErr', { err: whatsAppHealth.lastError })
              : t('channel.whatsapp.linkedChannelNotRunning') }}
          </div>
          <div
            v-if="reconnectMessage"
            class="wa-popup-detail"
          >
            {{ reconnectMessage }}
          </div>
          <div class="wa-popup-actions">
            <button class="wa-popup-btn wa-popup-btn--primary" :disabled="busy" @click="doReconnect">
              {{ busy ? t('channel.whatsapp.reconnecting') : t('channel.reconnect') }}
            </button>
            <button class="wa-popup-btn" :disabled="busy" @click="doRestartGateway">
              {{ t('channel.restartGateway') }}
            </button>
          </div>
        </template>

        <!-- Not linked / unknown -->
        <template v-else-if="indicatorColor === 'red' || indicatorColor === 'gray'">
          <template v-if="qrState === 'idle'">
            <div class="wa-popup-status wa-popup-status--err">{{ t('channel.whatsapp.notLinked') }}</div>
            <button class="wa-popup-btn wa-popup-btn--primary wa-popup-btn--full" @click="startQrFlow">
              {{ t('channel.qrLinkBtn') }}
            </button>
          </template>

          <template v-else-if="qrState === 'loading'">
            <div class="wa-popup-status wa-popup-status--loading">{{ qrMessage }}</div>
          </template>

          <template v-else-if="qrState === 'installing'">
            <div class="wa-popup-status wa-popup-status--loading">{{ qrMessage }}</div>
            <div class="wa-progress-track">
              <div class="wa-progress-bar" :style="{ width: installProgress + '%' }" />
            </div>
          </template>

          <template v-else-if="qrState === 'waiting'">
            <div class="wa-popup-qr">
              <img v-if="qrUrl" :src="qrUrl" alt="WhatsApp QR" class="wa-popup-qr-img">
            </div>
            <div class="wa-popup-status wa-popup-status--loading">{{ qrMessage }}</div>
          </template>

          <template v-else-if="qrState === 'success'">
            <div class="wa-popup-status wa-popup-status--ok">{{ qrMessage }}</div>
          </template>

          <template v-else-if="qrState === 'failed'">
            <div class="wa-popup-status wa-popup-status--err">{{ qrMessage }}</div>
            <div class="wa-popup-actions">
              <button class="wa-popup-btn wa-popup-btn--primary" @click="startQrFlow">
                {{ t('channel.retry') }}
              </button>
              <button class="wa-popup-btn" @click="openChannelSetup">
                {{ t('channel.channelSetup') }}
              </button>
            </div>
          </template>
        </template>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.wa-indicator-root {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.wa-dot {
  height: 28px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-elevated);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, box-shadow 0.15s;
  min-width: unset;
  line-height: 1;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
}
.wa-dot:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.wa-dot--green {
  color: #25d366;
  border-color: rgba(37, 211, 102, 0.4);
}
.wa-dot--green:hover:not(:disabled) {
  border-color: #25d366;
  box-shadow: 0 0 0 3px rgba(37, 211, 102, 0.15);
}
.wa-dot--amber {
  color: #d97706;
  border-color: rgba(217, 119, 6, 0.4);
  animation: wa-pulse 2s ease-in-out infinite;
}
.wa-dot--amber:hover:not(:disabled) {
  border-color: #d97706;
  box-shadow: 0 0 0 3px rgba(217, 119, 6, 0.15);
}
.wa-dot--red {
  color: #dc2626;
  border-color: rgba(220, 38, 38, 0.4);
}
.wa-dot--red:hover:not(:disabled) {
  border-color: #dc2626;
  box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.15);
}
.wa-dot--gray {
  color: var(--lc-text-dim);
}

@keyframes wa-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* Popup */
.wa-popup {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  width: 230px;
  background: var(--lc-surface);
  border: 1px solid var(--lc-border);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
  padding: 12px;
  z-index: 10080;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wa-popup-status {
  font-size: 12px;
  font-weight: 500;
  text-align: center;
}
.wa-popup-status--ok { color: #25d366; }
.wa-popup-status--warn { color: #d97706; }
.wa-popup-status--err { color: #dc2626; }
.wa-popup-status--loading {
  color: var(--lc-accent);
  animation: wa-pulse 1.4s ease-in-out infinite;
}

.wa-popup-detail {
  font-size: 11px;
  color: var(--lc-text-muted);
  text-align: center;
}

.wa-popup-qr {
  display: flex;
  justify-content: center;
}
.wa-popup-qr-img {
  width: 180px;
  height: 180px;
  border-radius: 6px;
  border: 1px solid var(--lc-border);
  background: #fff;
}

.wa-popup-actions {
  display: flex;
  gap: 6px;
}

.wa-popup-btn {
  flex: 1;
  padding: 5px 8px;
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  border: 1px solid var(--lc-border);
  border-radius: 6px;
  background: var(--lc-bg-elevated);
  color: var(--lc-text);
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.wa-popup-btn:hover:not(:disabled) {
  background: var(--lc-bg-hover);
  border-color: var(--lc-border-strong);
}
.wa-popup-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.wa-popup-btn--primary {
  background: linear-gradient(135deg, #0e7490, #0891b2);
  border-color: rgba(8, 145, 178, 0.5);
  color: #fff;
}
.wa-popup-btn--primary:hover:not(:disabled) {
  opacity: 0.9;
}
.wa-popup-btn--full {
  width: 100%;
}

/* Progress bar */
.wa-progress-track {
  height: 4px;
  border-radius: 2px;
  background: var(--lc-border);
  overflow: hidden;
}
.wa-progress-bar {
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--lc-accent), #06b6d4);
  transition: width 0.4s ease;
}

/* Transition */
.wa-popup-fade-enter-active,
.wa-popup-fade-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.wa-popup-fade-enter-from,
.wa-popup-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(4px);
}
</style>
