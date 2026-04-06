import { i18n } from "@/i18n";
import { GatewayClient } from "@/features/gateway/gateway-client";
import {
  GATEWAY_CLIENT_MODE,
  GATEWAY_CLIENT_MODE_UI,
} from "@/features/gateway/gateway-types";
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import { isDidClawDesktop } from "@/lib/desktop-api";
import { isTauri } from "@tauri-apps/api/core";
import { cancelDeferredGatewayConnect } from "@/composables/deferredGatewayConnect";
import { loadOrCreateDeviceIdentity } from "@/lib/device-identity";
import { logSwallowedError } from "@/lib/client-dev-log";
import { defineStore } from "pinia";
import { ref, shallowRef } from "vue";
import type { GatewayConnectionStatus, PendingBackendPairingRepair } from "./gateway-store-types";
import { ensureDesktopOpenClawGatewayForConnect } from "./gateway-store-connect-flow";
import { dispatchGatewayStoreWebSocketEvent } from "./gateway-store-on-event";
import { runGatewayOnClose, runGatewayOnHello } from "./gateway-store-lifecycle";

export type { GatewayConnectionStatus, PendingBackendPairingRepair } from "./gateway-store-types";

export function gatewayUrlFromEnv(): string {
  const raw = import.meta.env.VITE_GATEWAY_URL?.trim();
  if (raw) {
    return raw;
  }
  return "ws://127.0.0.1:18789";
}

type ConnectOpts = { url: string; token?: string; password?: string; deviceToken?: string };

let connectRequestId = 0;

/** 网关 WS 1012（Service Restart）自动重连：指数退避 + 上限，避免无限静默重试 */
const MAX_SERVICE_RESTART_ATTEMPTS = 15;
/** OpenClaw 4.x 配置热重载后 SIGUSR1 重启常需十余秒再接受 WS */
const SERVICE_RESTART_BASE_DELAY_MS = 4500;
const SERVICE_RESTART_MAX_DELAY_MS = 60_000;
let serviceRestartReconnectAttempt = 0;
/** 下一次 `connect()` 是否视为「承接 1012 重连」（不重置尝试计数） */
let pendingServiceRestartReconnect = false;

function resetGatewayServiceRestartState(): void {
  serviceRestartReconnectAttempt = 0;
  pendingServiceRestartReconnect = false;
}

/** Cached deviceToken for auto-reconnect */
let cachedDeviceToken: string | undefined = undefined;

/** Load deviceToken from device identity storage */
async function loadDeviceToken(): Promise<string | undefined> {
  if (cachedDeviceToken) {
    return cachedDeviceToken;
  }
  try {
    const identity = await loadOrCreateDeviceIdentity();
    cachedDeviceToken = identity.deviceToken;
    return cachedDeviceToken;
  } catch (e) {
    logSwallowedError("gateway.loadDeviceToken", e);
    return undefined;
  }
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function loadGatewayConnectOptions(): Promise<ConnectOpts> {
  let finalUrl = gatewayUrlFromEnv();
  let token = import.meta.env.VITE_GATEWAY_TOKEN?.trim() || undefined;
  let password = import.meta.env.VITE_GATEWAY_PASSWORD?.trim() || undefined;

  const desktop = getDidClawDesktopApi();
  if (desktop?.readGatewayLocalConfig) {
    try {
      const local = await desktop.readGatewayLocalConfig();
      if (local.url?.trim()) {
        finalUrl = local.url.trim();
      }
      if (local.token?.trim()) {
        token = local.token.trim();
      }
      if (local.password?.trim()) {
        password = local.password.trim();
      }
    } catch (e) {
      logSwallowedError("gateway.readGatewayLocalConfig", e);
    }
  }

  // If no user token/password, try deviceToken
  const deviceToken = !token && !password ? await loadDeviceToken() : undefined;

  return { url: finalUrl, token, password, deviceToken };
}

export const useGatewayStore = defineStore("gateway", () => {
  const client = shallowRef<GatewayClient | null>(null);
  const status = ref<GatewayConnectionStatus>("disconnected");
  const lastError = ref<string | null>(null);
  const helloInfo = ref<string | null>(null);
  const pendingBackendPairingRepair = ref<PendingBackendPairingRepair | null>(null);
  const backendPairingRepairBusy = ref(false);
  let backendPairingRepairPollTimer: ReturnType<typeof setInterval> | null = null;
  /** Resolved WS URL for display/diagnostics (desktop local config override in didclaw.db) */
  const url = ref(gatewayUrlFromEnv());

  function isBackendRepairRequest(v: unknown): v is PendingBackendPairingRepair {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
    const req = v as Record<string, unknown>;
    const clientId = typeof req.clientId === "string" ? req.clientId : "";
    const clientMode = typeof req.clientMode === "string" ? req.clientMode : "";
    const scopes = Array.isArray(req.scopes) ? req.scopes.filter((x): x is string => typeof x === "string") : [];
    return clientId === "gateway-client" && clientMode === "backend" && scopes.includes("operator.write");
  }

  async function refreshPendingBackendPairingRepair(): Promise<void> {
    if (!client.value?.connected) {
      pendingBackendPairingRepair.value = null;
      return;
    }
    try {
      const res = await client.value.request<{ pending?: unknown[] }>("device.pair.list", {});
      const pending = Array.isArray(res?.pending) ? res.pending : [];
      const hit = pending.find((item) => isBackendRepairRequest(item));
      pendingBackendPairingRepair.value = hit ?? null;
    } catch (e) {
      logSwallowedError("gateway.refreshPendingBackendPairingRepair", e);
    }
  }

  function scheduleRefreshPendingBackendPairingRepair(delayMs = 0): void {
    window.setTimeout(() => {
      void refreshPendingBackendPairingRepair();
    }, delayMs);
  }

  function stopPendingBackendPairingRepairPolling(): void {
    if (backendPairingRepairPollTimer !== null) {
      clearInterval(backendPairingRepairPollTimer);
      backendPairingRepairPollTimer = null;
    }
  }

  function startPendingBackendPairingRepairPolling(): void {
    stopPendingBackendPairingRepairPolling();
    backendPairingRepairPollTimer = setInterval(() => {
      void refreshPendingBackendPairingRepair();
    }, 15_000);
  }

  async function approvePendingBackendPairingRepair(): Promise<boolean> {
    const req = pendingBackendPairingRepair.value;
    if (!req || !client.value?.connected || backendPairingRepairBusy.value) return false;
    backendPairingRepairBusy.value = true;
    try {
      await client.value.request("device.pair.approve", { requestId: req.requestId });
      pendingBackendPairingRepair.value = null;
      helloInfo.value = i18n.global.t("gatewayConn.backendRepairApproved");
      return true;
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      backendPairingRepairBusy.value = false;
    }
  }

  function disconnect(): void {
    cancelDeferredGatewayConnect();
    resetGatewayServiceRestartState();
    connectRequestId++;
    stopPendingBackendPairingRepairPolling();
    client.value?.stop();
    client.value = null;
    status.value = "disconnected";
  }

  /** Refresh displayed WS URL from env / desktop local store (does not reconnect) */
  async function refreshResolvedUrl(): Promise<void> {
    const o = await loadGatewayConnectOptions();
    url.value = o.url;
  }

  /** Disconnect and reconnect with latest config (after saving connection settings) */
  async function reloadConnection(): Promise<void> {
    await refreshResolvedUrl();
    disconnect();
    connect();
  }

  function connect(): void {
    cancelDeferredGatewayConnect();
    const preserveServiceRestartAttempts = pendingServiceRestartReconnect;
    pendingServiceRestartReconnect = false;
    if (!preserveServiceRestartAttempts) {
      serviceRestartReconnectAttempt = 0;
    }
    connectRequestId++;
    client.value?.stop();
    client.value = null;
    lastError.value = null;
    helloInfo.value = null;
    status.value = "connecting";

    const req = connectRequestId;
    void loadGatewayConnectOptions().then(async (opts) => {
      if (req !== connectRequestId) {
        return;
      }
      url.value = opts.url;

      const ensureResult = await ensureDesktopOpenClawGatewayForConnect({
        wsUrl: opts.url,
        isStale: () => req !== connectRequestId,
        delayMs,
      });
      if (ensureResult.kind === "stale") {
        return;
      }
      if (ensureResult.kind === "error") {
        lastError.value = ensureResult.message;
        status.value = "error";
        return;
      }
      const gatewayWasFreshlyStarted = ensureResult.gatewayWasFreshlyStarted;

      const serviceRestartCtl = {
        incrementAttempt: () => {
          serviceRestartReconnectAttempt += 1;
        },
        getAttempt: () => serviceRestartReconnectAttempt,
        setPendingReconnect: (v: boolean) => {
          pendingServiceRestartReconnect = v;
        },
        resetState: resetGatewayServiceRestartState,
        resetAttemptOnSuccessfulHello: () => {
          serviceRestartReconnectAttempt = 0;
        },
        maxAttempts: MAX_SERVICE_RESTART_ATTEMPTS,
        baseDelayMs: SERVICE_RESTART_BASE_DELAY_MS,
        maxDelayMs: SERVICE_RESTART_MAX_DELAY_MS,
      };
      const deviceTokenCtl = {
        getCached: () => cachedDeviceToken,
        clearCached: () => {
          cachedDeviceToken = undefined;
        },
      };
      const sharedLifecycleFields = {
        client,
        status,
        lastError,
        helloInfo,
        pendingBackendPairingRepair,
        gatewayWasFreshlyStarted,
        scheduleRefreshPendingBackendPairingRepair,
        startPendingBackendPairingRepairPolling,
        stopPendingBackendPairingRepairPolling,
        connect,
        serviceRestart: serviceRestartCtl,
        deviceToken: deviceTokenCtl,
      };

      // GatewayClient 回调：onHello（握手成功）→ onEvent（下行）→ onClose（含 1012 退避重连）
      const gc = new GatewayClient({
        url: opts.url,
        token: opts.token,
        password: opts.password,
        deviceToken: opts.deviceToken,
        clientVersion: `didclaw/${__APP_VERSION__}`,
        clientMode: isDidClawDesktop() ? GATEWAY_CLIENT_MODE_UI : GATEWAY_CLIENT_MODE,
        useTauriTunnel: isTauri(),
        onHello: (hello) => {
          runGatewayOnHello(hello, { gc, ...sharedLifecycleFields });
        },
        onEvent: (evt) => {
          dispatchGatewayStoreWebSocketEvent(evt, {
            scheduleRefreshPendingBackendPairingRepair,
          });
        },
        onClose: (info) => {
          runGatewayOnClose(info, { gc, ...sharedLifecycleFields });
        },
      });

      if (req !== connectRequestId) {
        return;
      }
      client.value = gc;
      gc.start();
    });
  }

  void refreshResolvedUrl();

  return {
    client,
    status,
    lastError,
    helloInfo,
    pendingBackendPairingRepair,
    backendPairingRepairBusy,
    url,
    connect,
    disconnect,
    refreshResolvedUrl,
    reloadConnection,
    refreshPendingBackendPairingRepair,
    scheduleRefreshPendingBackendPairingRepair,
    approvePendingBackendPairingRepair,
  };
});
