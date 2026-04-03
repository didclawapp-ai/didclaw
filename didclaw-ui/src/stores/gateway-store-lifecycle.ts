import { i18n } from "@/i18n";
import type { GatewayClient } from "@/features/gateway/gateway-client";
import type { GatewayRequestError } from "@/features/gateway/gateway-types";
import { gatewayHelloOkSchema } from "@/features/gateway/schemas";
import { describeGatewayError } from "@/lib/gateway-errors";
import { clearDeviceToken } from "@/lib/device-identity";
import { logSwallowedError } from "@/lib/client-dev-log";
import type { Ref, ShallowRef } from "vue";
import type { GatewayConnectionStatus, PendingBackendPairingRepair } from "./gateway-store-types";

/** 1012 退避重连：由 gateway store 持有可变状态，经此对象传入生命周期回调 */
export type GatewayServiceRestartCtl = {
  incrementAttempt: () => void;
  getAttempt: () => number;
  setPendingReconnect: (v: boolean) => void;
  resetState: () => void;
  resetAttemptOnSuccessfulHello: () => void;
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
};

export type GatewayDeviceTokenCtl = {
  getCached: () => string | undefined;
  clearCached: () => void;
};

export type GatewaySocketLifecycle = {
  gc: GatewayClient;
  client: ShallowRef<GatewayClient | null>;
  status: Ref<GatewayConnectionStatus>;
  lastError: Ref<string | null>;
  helloInfo: Ref<string | null>;
  pendingBackendPairingRepair: Ref<PendingBackendPairingRepair | null>;
  gatewayWasFreshlyStarted: boolean;
  scheduleRefreshPendingBackendPairingRepair: (delayMs?: number) => void;
  startPendingBackendPairingRepairPolling: () => void;
  stopPendingBackendPairingRepairPolling: () => void;
  connect: () => void;
  serviceRestart: GatewayServiceRestartCtl;
  deviceToken: GatewayDeviceTokenCtl;
};

export function runGatewayOnHello(hello: unknown, L: GatewaySocketLifecycle): void {
  L.serviceRestart.resetAttemptOnSuccessfulHello();
  const parsed = gatewayHelloOkSchema.safeParse(hello);
  if (parsed.success && parsed.data.server?.version) {
    L.helloInfo.value = i18n.global.t("gatewayConn.helloVersion", {
      version: parsed.data.server.version,
    });
  } else {
    L.helloInfo.value = i18n.global.t("gatewayConn.helloConnected");
  }
  L.status.value = "connected";
  L.scheduleRefreshPendingBackendPairingRepair();
  L.scheduleRefreshPendingBackendPairingRepair(1500);
  L.startPendingBackendPairingRepairPolling();
  void import("./session").then(async ({ useSessionStore }) => {
    const reloaded = await useSessionStore().refresh();
    if (!reloaded) {
      const { useChatStore } = await import("./chat");
      await useChatStore().loadHistory({ silent: true });
    }
  }).catch((e) => { console.error("[didclaw] onHello session refresh error", e); });
  void import("./chat").then(({ useChatStore }) => {
    void useChatStore().refreshOpenClawModelPicker();
  }).catch((e) => { console.error("[didclaw] onHello model picker error", e); });

  if (L.gatewayWasFreshlyStarted) {
    window.setTimeout(() => {
      if (L.client.value !== L.gc) return;
      void import("./session").then(async ({ useSessionStore }) => {
        const reloaded = await useSessionStore().refresh();
        if (!reloaded) {
          const { useChatStore } = await import("./chat");
          await useChatStore().loadHistory({ silent: true });
        }
      }).catch((e) => { console.error("[didclaw] deferred onHello refresh error", e); });
    }, 4000);
  }

  window.setTimeout(() => {
    if (L.client.value !== L.gc) return;
    void import("./session").then(async ({ useSessionStore }) => {
      const reloaded = await useSessionStore().refresh();
      if (!reloaded) {
        const { useChatStore } = await import("./chat");
        await useChatStore().loadHistory({ silent: true });
      }
    }).catch((e) => { console.error("[didclaw] 20s background sync error", e); });
  }, 20000);
}

export function runGatewayOnClose(
  info: { code: number; reason: string; error?: GatewayRequestError },
  L: GatewaySocketLifecycle,
): void {
  const { code, reason, error } = info;
  /**
   * GatewayClient 在 socket close 后会 scheduleReconnect。
   * 若此处仅把 client 置空而不 stop 当前实例，会出现「孤儿」重连：store 已无引用，
   * 但旧实例仍在后台建连，易与后续手动连接打架并触发 1008 等异常。
   */
  L.gc.stop();
  L.stopPendingBackendPairingRepairPolling();
  const stillCurrent = L.client.value === L.gc;
  if (!stillCurrent) return;

  L.client.value = null;
  L.helloInfo.value = null;
  L.pendingBackendPairingRepair.value = null;

  const isServiceRestart =
    code === 1012 ||
    String(reason ?? "").toLowerCase().includes("service restart");
  if (isServiceRestart) {
    L.serviceRestart.incrementAttempt();
    if (L.serviceRestart.getAttempt() > L.serviceRestart.maxAttempts) {
      L.status.value = "error";
      L.helloInfo.value = null;
      L.lastError.value = i18n.global.t("gatewayConn.serviceRestartGiveUp", {
        max: L.serviceRestart.maxAttempts,
      });
      L.serviceRestart.resetState();
      return;
    }
    const delayMs = Math.min(
      L.serviceRestart.maxDelayMs,
      L.serviceRestart.baseDelayMs *
        Math.pow(2, Math.max(0, L.serviceRestart.getAttempt() - 1)),
    );
    L.helloInfo.value = i18n.global.t("gatewayConn.serviceRestartRetrying", {
      current: L.serviceRestart.getAttempt(),
      max: L.serviceRestart.maxAttempts,
    });
    L.status.value = "connecting";
    L.lastError.value = null;
    L.serviceRestart.setPendingReconnect(true);
    window.setTimeout(() => {
      if (L.client.value === null && L.status.value === "connecting") {
        L.connect();
      }
    }, delayMs);
    return;
  }

  L.status.value = "error";
  const detailText = error ? describeGatewayError(error) : String(reason ?? "").trim();
  L.lastError.value = detailText
    ? i18n.global.t("gatewayConn.disconnectedWithDetail", { code, detail: detailText })
    : i18n.global.t("gatewayConn.disconnectedCodeOnly", { code });

  const lowerDetail = detailText.toLowerCase();
  if (lowerDetail.includes("pairing")) {
    L.lastError.value += i18n.global.t("gatewayConn.pairingHint");
  }

  const isAuthError = lowerDetail.includes("unauthorized") ||
    lowerDetail.includes("auth") ||
    lowerDetail.includes("token") ||
    error?.gatewayCode === "AUTH_TOKEN_MISMATCH" ||
    error?.gatewayCode?.startsWith("DEVICE_AUTH_");
  if (isAuthError && L.deviceToken.getCached()) {
    console.log("[didclaw] clearing cached deviceToken due to auth error");
    L.deviceToken.clearCached();
    void clearDeviceToken().catch((e) => {
      logSwallowedError("gateway.clearDeviceToken", e);
    });
  }
}
