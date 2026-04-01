<script setup lang="ts">
import { useChannelHealth, queryWechatHealthNow } from "@/composables/useChannelHealth";
import { useGatewayStore } from "@/stores/gateway";
import { useSessionStore } from "@/stores/session";
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import { storeToRefs } from "pinia";
import { computed, ref, onUnmounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { isTauri } from "@tauri-apps/api/core";

const { t } = useI18n();
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import QRCode from "qrcode";

const WECHAT_PLUGIN_SPEC = "@tencent-weixin/openclaw-weixin";
const WECHAT_SESSION_PREFIX = "agent:main:openclaw-weixin:";

const gw = useGatewayStore();
const sessionStore = useSessionStore();
const { status: gwStatus } = storeToRefs(gw);
const { sessions } = storeToRefs(sessionStore);
const { wechatHealth } = useChannelHealth();

const popupOpen = ref(false);
const qrState = ref<"idle" | "loading" | "waiting" | "success" | "failed">("idle");
const qrMessage = ref<string | null>(null);
const qrDataUrl = ref<string | null>(null);
const busy = ref(false);
const reconnectMessage = ref<string | null>(null);

let unlistenLine: UnlistenFn | null = null;
let unlistenQr: UnlistenFn | null = null;
let unlistenDone: UnlistenFn | null = null;

function cleanupListeners(): void {
  unlistenLine?.(); unlistenLine = null;
  unlistenQr?.(); unlistenQr = null;
  unlistenDone?.(); unlistenDone = null;
}

type IndicatorColor = "green" | "amber" | "red" | "gray";

const hasWechatSession = computed(() =>
  sessions.value.some((row) => row.key.startsWith(WECHAT_SESSION_PREFIX) && row.localOnly !== true),
);

const indicatorColor = computed<IndicatorColor>(() => {
  if (gwStatus.value !== "connected") return "gray";
  if (!wechatHealth.value) return hasWechatSession.value ? "green" : "gray";
  const h = wechatHealth.value;
  // WeChat plugin health may not expose a stable `linked` flag.
  // If the channel is already running and connected, treat it as ready.
  if ((h.running && h.connected) || hasWechatSession.value) return "green";
  if (h.linked || h.running || h.connected) return "amber";
  return "red";
});

const indicatorTitle = computed(() => {
  if (gwStatus.value !== "connected") return t('channel.gwDisconnected');
  if (!wechatHealth.value) return hasWechatSession.value ? t('channel.wechat.connected') : t('channel.wechat.statusUnknown');
  const h = wechatHealth.value;
  if ((h.running && h.connected) || hasWechatSession.value) return t('channel.wechat.connected');
  if (h.linked && !h.running) return t('channel.wechat.linkedNotRunning');
  if (h.linked && !h.connected) return t('channel.wechat.linkedNotConnected');
  if (h.running && !h.connected) return t('channel.wechat.runningNotConnected');
  if (!h.running && h.connected) return t('channel.wechat.connecting');
  return t('channel.wechat.notLinked');
});

function togglePopup(): void {
  if (gwStatus.value !== "connected") return;
  popupOpen.value = !popupOpen.value;
  if (popupOpen.value) {
    qrState.value = "idle";
    qrDataUrl.value = null;
    qrMessage.value = null;
    reconnectMessage.value = null;
  }
}

function closePopup(): void {
  popupOpen.value = false;
}

function onClickOutside(ev: MouseEvent): void {
  const root = (ev.target as HTMLElement).closest(".wc-indicator-root");
  if (!root) closePopup();
}

watch(popupOpen, (v) => {
  if (v) {
    window.addEventListener("click", onClickOutside, { capture: true });
  } else {
    window.removeEventListener("click", onClickOutside, { capture: true });
    if (qrState.value !== "success") cleanupListeners();
  }
});

onUnmounted(() => {
  window.removeEventListener("click", onClickOutside, { capture: true });
  cleanupListeners();
  if (autoCloseTimer !== null) clearTimeout(autoCloseTimer);
});

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensureGatewayConnected(timeoutMs = 18000): Promise<boolean> {
  const isConnected = () => (gwStatus.value as string) === "connected";
  if (isConnected()) return true;
  await delay(2000);
  if (isConnected()) return true;
  await gw.reloadConnection();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isConnected()) {
      await delay(800);
      return true;
    }
    await delay(500);
  }
  return false;
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

async function renderQr(url: string): Promise<void> {
  try {
    qrDataUrl.value = await QRCode.toDataURL(url, {
      width: 180,
      margin: 1,
      errorCorrectionLevel: "M",
    });
  } catch {
    qrDataUrl.value = null;
  }
}

function isMissingTauriCommandError(error: unknown): boolean {
  const msg = String((error as Error)?.message ?? error ?? "");
  return /not allowed|command not found|unknown command/i.test(msg);
}

function looksLikePluginAlreadyInstalled(result: {
  ok: boolean;
  error?: string;
  stdout?: string;
  stderr?: string;
}): boolean {
  const combined = [result.error, result.stdout, result.stderr].filter(Boolean).join("\n");
  return /plugin already exists|already at \d+\.\d+\.\d+/i.test(combined);
}

async function ensureWechatPluginInstalled(): Promise<boolean> {
  const api = getDidClawDesktopApi();

  if (api?.checkChannelPluginInstalled) {
    try {
      const state = await api.checkChannelPluginInstalled("wechat");
      if (!state.ok) {
        qrState.value = "failed";
        qrMessage.value = t('channel.wechat.pluginCheckFailed', { err: state.error ?? "unknown" });
        return false;
      }
      if (state.installed) return true;
    } catch (err) {
      if (!isMissingTauriCommandError(err)) {
        qrState.value = "failed";
        qrMessage.value = t('channel.wechat.pluginCheckFailed', { err: String((err as Error)?.message ?? err) });
        return false;
      }
      // Tauri command not registered yet — fall through to install
    }
  }

  if (!api?.openclawPluginsInstall) {
    qrState.value = "failed";
    qrMessage.value = t('channel.wechat.noAutoInstall');
    return false;
  }

  qrMessage.value = t('channel.wechat.installingPlugin');
  const result = await api.openclawPluginsInstall({ packageSpec: WECHAT_PLUGIN_SPEC });
  if (!result.ok) {
    if (looksLikePluginAlreadyInstalled(result)) return true;
    qrState.value = "failed";
    qrMessage.value = t('channel.wechat.pluginInstallFailed', { err: (result as { error?: string }).error ?? "unknown" });
    return false;
  }

  qrMessage.value = t('channel.wechat.installDoneStartingQr');
  return true;
}

async function startQrFlow(): Promise<void> {
  if (!isTauri()) {
    openChannelSetup();
    return;
  }
  const api = getDidClawDesktopApi();
  if (!api?.startChannelQrFlow) {
    openChannelSetup();
    return;
  }

  if (api.getOpenClawSetupStatus) {
    try {
      const s = await api.getOpenClawSetupStatus();
      if (!s.openclawDirExists || !s.openclawCli?.ok) {
        qrState.value = "failed";
        qrMessage.value = t('channel.needsOpenClawSetup');
        return;
      }
    } catch {
      /* fall through */
    }
  }

  qrState.value = "loading";
  qrDataUrl.value = null;
  qrMessage.value = t('channel.wechat.checkingPlugin');

  const pluginReady = await ensureWechatPluginInstalled();
  if (!pluginReady) return;

  if (gwStatus.value !== "connected") {
    qrMessage.value = t('channel.wechat.gwWaitingRestore');
    const reconnected = await ensureGatewayConnected();
    qrMessage.value = reconnected
      ? t('channel.wechat.gwRestoredStartingLogin')
      : t('channel.wechat.gwTimeoutRetryLogin');
  }

  qrMessage.value = t('channel.wechat.startingLogin');
  cleanupListeners();
  const flowId = crypto.randomUUID();

  if (isTauri()) {
    try {
      unlistenLine = await listen<{ flowId?: string; stream: string; line: string }>(
        "channel:line",
        (e) => {
          if (e.payload.flowId !== flowId) return;
          const m = e.payload.line.match(/https:\/\/liteapp\.weixin\.qq\.com\/\S+/);
          if (m) void renderQr(m[0].trim());
        },
      );
    } catch { /* ignore */ }

    try {
      unlistenQr = await listen<{ flowId?: string; url: string }>(
        "channel:qr",
        (e) => {
          if (e.payload.flowId !== flowId) return;
          if (e.payload.url.includes("liteapp.weixin.qq.com") || e.payload.url.includes("weixin")) {
            void renderQr(e.payload.url);
          }
        },
      );
    } catch { /* ignore */ }

    try {
      unlistenDone = await listen<{ flowId?: string; ok: boolean; exitCode?: number; error?: string }>(
        "channel:done",
        (e) => {
          if (e.payload.flowId !== flowId) return;
          cleanupListeners();
          if (!e.payload.ok) {
            qrState.value = "failed";
            qrMessage.value = t('channel.wechat.loginFailed', { code: e.payload.exitCode ?? "?" });
            return;
          }
          void onWechatScanSuccess();
        },
      );
    } catch { /* ignore */ }
  }

  qrState.value = "waiting";
  qrMessage.value = t('channel.wechat.waitingQr');

  try {
    const gatewayUrl = gw.url.replace("ws://", "http://").replace("wss://", "https://");
    await api.startChannelQrFlow("wechat", gatewayUrl, flowId);
  } catch (e) {
    cleanupListeners();
    qrState.value = "failed";
    qrMessage.value = String((e as Error)?.message ?? e);
  }
}

async function onWechatScanSuccess(): Promise<void> {
  qrMessage.value = t('channel.wechat.scanSuccessWaiting');
  qrDataUrl.value = null;

  const writeApi = getDidClawDesktopApi();
  if (writeApi?.writeChannelConfig) {
    try {
      await writeApi.writeChannelConfig("openclaw-weixin", { enabled: true });
    } catch { /* ignore */ }
  }

  await delay(5000);
  if (gwStatus.value === "connected") {
    const h = await queryWechatHealthNow();
    if (h?.running) {
      qrState.value = "success";
      qrMessage.value = t('channel.wechat.linkedSuccess');
      scheduleAutoClose();
      return;
    }
  }

  qrMessage.value = t('channel.gwRestoredWaiting');
  const reconnected = await ensureGatewayConnected(35000);
  if (!reconnected) {
    qrState.value = "success";
    qrMessage.value = t('channel.wechat.linkedButGwNotReady');
    return;
  }

  qrMessage.value = t('channel.wechat.gwRestoredCheckingChannel');
  const deadline = Date.now() + 35000;
  while (Date.now() < deadline) {
    await delay(1000);
    if (gwStatus.value === "connected") {
      const h2 = await queryWechatHealthNow();
      if (h2?.running) {
        qrState.value = "success";
        qrMessage.value = t('channel.wechat.linkedSuccess');
        scheduleAutoClose();
        return;
      }
    }
  }

  qrState.value = "success";
  qrMessage.value = t('channel.wechat.linkedChannelStarting');
  scheduleAutoClose();
}

async function doRestartGateway(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.restartOpenClawGateway) return;
  busy.value = true;
  reconnectMessage.value = t('channel.gwRestarting');
  try {
    const result = await api.restartOpenClawGateway();
    if (!result?.ok) {
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
    const h = await queryWechatHealthNow();
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
</script>

<template>
  <div class="wc-indicator-root">
    <button
      type="button"
      class="wc-dot"
      :class="`wc-dot--${indicatorColor}`"
      :title="indicatorTitle"
      :disabled="gwStatus !== 'connected'"
      @click.stop="togglePopup"
    >
      WX
    </button>

    <Transition name="wc-popup-fade">
      <div
        v-if="popupOpen"
        class="wc-popup"
        @click.stop
      >
        <!-- Fully connected -->
        <template v-if="indicatorColor === 'green'">
          <div class="wc-popup-status wc-popup-status--ok">{{ t('channel.wechat.connected') }}</div>
          <div
            v-if="wechatHealth?.lastError"
            class="wc-popup-detail"
          >
            {{ wechatHealth.lastError }}
          </div>
        </template>

        <!-- Linked but degraded -->
        <template v-else-if="indicatorColor === 'amber'">
          <div class="wc-popup-status wc-popup-status--warn">
            {{ wechatHealth?.lastError
              ? t('channel.wechat.channelNotReadyErr', { err: wechatHealth.lastError })
              : t('channel.wechat.channelNotFullyReady') }}
          </div>
          <div
            v-if="reconnectMessage"
            class="wc-popup-detail"
          >
            {{ reconnectMessage }}
          </div>
          <div class="wc-popup-actions">
            <button
              class="wc-popup-btn wc-popup-btn--primary"
              :disabled="busy"
              @click="doRestartGateway"
            >
              {{ busy ? t('channel.restarting') : t('channel.restartGateway') }}
            </button>
            <button
              class="wc-popup-btn"
              :disabled="busy"
              @click="startQrFlow"
            >
              {{ t('channel.wechat.relink') }}
            </button>
          </div>
        </template>

        <!-- Not linked / unknown -->
        <template v-else-if="indicatorColor === 'red' || indicatorColor === 'gray'">
          <template v-if="qrState === 'idle'">
            <div class="wc-popup-status wc-popup-status--err">{{ t('channel.wechat.notLinked') }}</div>
            <button
              class="wc-popup-btn wc-popup-btn--primary wc-popup-btn--full"
              @click="startQrFlow"
            >
              {{ t('channel.qrLinkBtn') }}
            </button>
          </template>

          <template v-else-if="qrState === 'loading'">
            <div class="wc-popup-status wc-popup-status--loading">{{ qrMessage }}</div>
          </template>

          <template v-else-if="qrState === 'waiting'">
            <div
              v-if="qrDataUrl"
              class="wc-popup-qr"
            >
              <img
                :src="qrDataUrl"
                :alt="t('channel.wechat.qrAlt')"
                class="wc-popup-qr-img"
              >
            </div>
            <div
              v-else
              class="wc-popup-qr-placeholder"
            >
              {{ t('channel.wechat.waitingQrGen') }}
            </div>
            <div class="wc-popup-status wc-popup-status--loading">{{ qrMessage }}</div>
          </template>

          <template v-else-if="qrState === 'success'">
            <div class="wc-popup-status wc-popup-status--ok">{{ qrMessage }}</div>
          </template>

          <template v-else-if="qrState === 'failed'">
            <div class="wc-popup-status wc-popup-status--err">{{ qrMessage }}</div>
            <div class="wc-popup-actions">
              <button
                class="wc-popup-btn wc-popup-btn--primary"
                @click="startQrFlow"
              >
                {{ t('channel.retry') }}
              </button>
              <button
                class="wc-popup-btn"
                @click="openChannelSetup"
              >
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
.wc-indicator-root {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.wc-dot {
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
.wc-dot:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.wc-dot--green {
  color: #07c160;
  border-color: rgba(7, 193, 96, 0.4);
}
.wc-dot--green:hover:not(:disabled) {
  border-color: #07c160;
  box-shadow: 0 0 0 3px rgba(7, 193, 96, 0.15);
}
.wc-dot--amber {
  color: #d97706;
  border-color: rgba(217, 119, 6, 0.4);
  animation: wc-pulse 2s ease-in-out infinite;
}
.wc-dot--amber:hover:not(:disabled) {
  border-color: #d97706;
  box-shadow: 0 0 0 3px rgba(217, 119, 6, 0.15);
}
.wc-dot--red {
  color: #dc2626;
  border-color: rgba(220, 38, 38, 0.4);
}
.wc-dot--red:hover:not(:disabled) {
  border-color: #dc2626;
  box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.15);
}
.wc-dot--gray {
  color: var(--lc-text-dim);
}

@keyframes wc-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* Popup */
.wc-popup {
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

.wc-popup-status {
  font-size: 12px;
  font-weight: 500;
  text-align: center;
}
.wc-popup-status--ok { color: #07c160; }
.wc-popup-status--warn { color: #d97706; }
.wc-popup-status--err { color: #dc2626; }
.wc-popup-status--loading {
  color: var(--lc-accent);
  animation: wc-pulse 1.4s ease-in-out infinite;
}

.wc-popup-detail {
  font-size: 11px;
  color: var(--lc-text-muted);
  text-align: center;
}

.wc-popup-qr {
  display: flex;
  justify-content: center;
}
.wc-popup-qr-img {
  width: 180px;
  height: 180px;
  border-radius: 6px;
  border: 1px solid var(--lc-border);
  background: #fff;
}
.wc-popup-qr-placeholder {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--lc-text-dim);
}

.wc-popup-actions {
  display: flex;
  gap: 6px;
}

.wc-popup-btn {
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
.wc-popup-btn:hover:not(:disabled) {
  background: var(--lc-bg-hover);
  border-color: var(--lc-border-strong);
}
.wc-popup-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.wc-popup-btn--primary {
  background: linear-gradient(135deg, #059652, #07c160);
  border-color: rgba(7, 193, 96, 0.5);
  color: #fff;
}
.wc-popup-btn--primary:hover:not(:disabled) {
  opacity: 0.9;
}
.wc-popup-btn--full {
  width: 100%;
}

/* Transition */
.wc-popup-fade-enter-active,
.wc-popup-fade-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.wc-popup-fade-enter-from,
.wc-popup-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(4px);
}
</style>
