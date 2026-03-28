<script setup lang="ts">
import { useChannelHealth, queryChannelHealthNow } from "@/composables/useChannelHealth";
import { useGatewayStore } from "@/stores/gateway";
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import { storeToRefs } from "pinia";
import { computed, ref, onUnmounted, watch } from "vue";

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
  if (gwStatus.value !== "connected") return "Gateway 未连接";
  if (!whatsAppHealth.value) return "WhatsApp 状态未知";
  const h = whatsAppHealth.value;
  if (h.linked && h.running && h.connected) return "WhatsApp 已连接";
  if (h.linked && !h.running) return "WhatsApp 会话已绑定但未运行";
  if (h.linked && !h.connected) return "WhatsApp 会话已绑定但未连接";
  return "WhatsApp 未关联";
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
      qrMessage.value = res?.message ?? "WhatsApp 已关联";
      scheduleAutoClose();
      return "linked";
    }
    qrUrl.value = res.qrDataUrl;
    qrState.value = "waiting";
    qrMessage.value = "请用手机扫描二维码";
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
    qrMessage.value = "桌面端不支持自动安装插件";
    return false;
  }

  if (api.getOpenClawSetupStatus) {
    try {
      const s = await api.getOpenClawSetupStatus();
      if (!s.openclawDirExists || !s.openclawCli?.ok) {
        qrState.value = "failed";
        qrMessage.value = "请先完成 OpenClaw 初始化安装（重启应用将弹出向导）";
        return false;
      }
    } catch {
      /* fall through to attempt install */
    }
  }

  qrState.value = "installing";
  installProgress.value = 0;
  qrMessage.value = "正在安装 WhatsApp 插件…";

  const installResult = await api.openclawPluginsInstall({ packageSpec: WHATSAPP_PLUGIN_SPEC });
  if (!installResult.ok) {
    qrState.value = "failed";
    qrMessage.value = `插件安装失败：${(installResult as { error?: string }).error ?? "未知错误"}`;
    return false;
  }
  installProgress.value = 33;

  qrMessage.value = "正在启用 WhatsApp 渠道…";
  const configResult = await api.writeChannelConfig("whatsapp", { enabled: true });
  if (!configResult.ok) {
    qrState.value = "failed";
    qrMessage.value = `启用渠道失败：${(configResult as { error?: string }).error ?? "未知错误"}`;
    return false;
  }
  installProgress.value = 55;

  qrMessage.value = "正在重启 Gateway…";
  const restartResult = await api.restartOpenClawGateway();
  if (!restartResult?.ok) {
    qrState.value = "failed";
    qrMessage.value = "Gateway 重启失败";
    return false;
  }
  installProgress.value = 70;

  qrMessage.value = "等待 Gateway 重新连接…";
  await gw.reloadConnection();
  const reconnected = await waitForGatewayConnected();
  if (!reconnected) {
    qrState.value = "failed";
    qrMessage.value = "Gateway 重启后连接超时，请稍后重试";
    return false;
  }
  installProgress.value = 90;

  qrMessage.value = "正在获取二维码…";
  installProgress.value = 100;
  return true;
}

async function startQrFlow(): Promise<void> {
  qrState.value = "loading";
  qrUrl.value = null;
  qrMessage.value = "正在请求…";
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
  qrMessage.value = "插件安装完成但仍未就绪，请打开渠道设置手动操作";
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
      qrMessage.value = waitRes?.message ?? "扫码超时或失败";
      return;
    }

    qrMessage.value = "扫码成功，等待渠道启动…";
    await delay(3000);
    const h = await queryChannelHealthNow();
    if (h?.running) {
      qrState.value = "success";
      qrMessage.value = "WhatsApp 关联成功";
      scheduleAutoClose();
      return;
    }

    qrMessage.value = "渠道未自动启动，正在重启 Gateway…";
    const api = getDidClawDesktopApi();
    if (!api?.restartOpenClawGateway) {
      qrState.value = "success";
      qrMessage.value = "绑定成功，请手动重启 Gateway 以启动渠道";
      return;
    }
    const restartResult = await api.restartOpenClawGateway();
    if (!restartResult?.ok) {
      qrState.value = "success";
      qrMessage.value = "绑定成功，Gateway 重启失败，请手动重启";
      return;
    }
    await gw.reloadConnection();
    const reconnected = await waitForGatewayConnected(20000);
    if (!reconnected) {
      qrState.value = "success";
      qrMessage.value = "绑定成功，Gateway 连接超时，请稍后检查";
      return;
    }
    await delay(5000);
    const h2 = await queryChannelHealthNow();
    qrState.value = "success";
    qrMessage.value = h2?.running
      ? "WhatsApp 关联成功"
      : "绑定成功，渠道正在启动中";
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
  reconnectMessage.value = "正在重新连接…";
  try {
    await gc.request("web.login.start", { force: false });
    await delay(3000);
    const h1 = await queryChannelHealthNow();
    if (h1 && h1.running) {
      reconnectMessage.value = null;
      return;
    }

    reconnectMessage.value = "渠道仍未启动，正在重启 Gateway…";
    const api = getDidClawDesktopApi();
    if (!api?.restartOpenClawGateway) {
      reconnectMessage.value = "重连未能启动渠道，请手动重启 Gateway";
      return;
    }
    const restartResult = await api.restartOpenClawGateway();
    if (!restartResult?.ok) {
      reconnectMessage.value = "Gateway 重启失败";
      return;
    }
    await gw.reloadConnection();
    const reconnected = await waitForGatewayConnected(20000);
    if (!reconnected) {
      reconnectMessage.value = "Gateway 重启后连接超时";
      return;
    }
    await delay(4000);
    const h2 = await queryChannelHealthNow();
    reconnectMessage.value = h2?.running ? null : "重启完成，渠道可能需要几秒钟启动";
  } catch {
    reconnectMessage.value = "重新连接失败";
  } finally {
    busy.value = false;
  }
}

async function doRestartGateway(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.restartOpenClawGateway) return;
  busy.value = true;
  reconnectMessage.value = "正在重启 Gateway…";
  try {
    const restartResult = await api.restartOpenClawGateway();
    if (!restartResult?.ok) {
      reconnectMessage.value = "Gateway 重启失败";
      return;
    }
    await gw.reloadConnection();
    const reconnected = await waitForGatewayConnected(20000);
    if (!reconnected) {
      reconnectMessage.value = "Gateway 重启后连接超时";
      return;
    }
    await delay(4000);
    const h = await queryChannelHealthNow();
    reconnectMessage.value = h?.running ? null : "重启完成，渠道可能需要几秒钟启动";
  } catch {
    reconnectMessage.value = "重启失败";
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
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
      </svg>
    </button>

    <Transition name="wa-popup-fade">
      <div v-if="popupOpen" class="wa-popup" @click.stop>
        <!-- Fully connected -->
        <template v-if="indicatorColor === 'green'">
          <div class="wa-popup-status wa-popup-status--ok">WhatsApp 已连接</div>
          <div v-if="whatsAppHealth?.lastError" class="wa-popup-detail">{{ whatsAppHealth.lastError }}</div>
        </template>

        <!-- Linked but degraded -->
        <template v-else-if="indicatorColor === 'amber'">
          <div class="wa-popup-status wa-popup-status--warn">
            {{ whatsAppHealth?.lastError
              ? `已绑定，未运行（${whatsAppHealth.lastError}）`
              : '已绑定，渠道未运行' }}
          </div>
          <div
            v-if="reconnectMessage"
            class="wa-popup-detail"
          >
            {{ reconnectMessage }}
          </div>
          <div class="wa-popup-actions">
            <button class="wa-popup-btn wa-popup-btn--primary" :disabled="busy" @click="doReconnect">
              {{ busy ? '重连中…' : '重新连接' }}
            </button>
            <button class="wa-popup-btn" :disabled="busy" @click="doRestartGateway">
              重启 Gateway
            </button>
          </div>
        </template>

        <!-- Not linked / unknown -->
        <template v-else-if="indicatorColor === 'red' || indicatorColor === 'gray'">
          <template v-if="qrState === 'idle'">
            <div class="wa-popup-status wa-popup-status--err">WhatsApp 未关联</div>
            <button class="wa-popup-btn wa-popup-btn--primary wa-popup-btn--full" @click="startQrFlow">
              扫码关联
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
                重试
              </button>
              <button class="wa-popup-btn" @click="openChannelSetup">
                渠道设置
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
  width: 28px;
  height: 28px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-elevated);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, box-shadow 0.15s;
  min-width: unset;
  line-height: 1;
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
