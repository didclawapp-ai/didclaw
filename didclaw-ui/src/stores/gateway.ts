import { i18n } from "@/i18n";
import { parseExecApprovalRequestedPayload } from "./approval";
import { GatewayClient } from "@/features/gateway/gateway-client";
import {
  GATEWAY_CLIENT_MODE,
  GATEWAY_CLIENT_MODE_UI,
} from "@/features/gateway/gateway-types";
import { gatewayHelloOkSchema } from "@/features/gateway/schemas";
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import { isDidClawDesktop } from "@/lib/desktop-api";
import { isTauri } from "@tauri-apps/api/core";
import { cancelDeferredGatewayConnect } from "@/composables/deferredGatewayConnect";
import { describeGatewayError } from "@/lib/gateway-errors";
import {
  agentEventWarrantsChatHistorySync,
  isGatewayPushDebugEnabled,
  logGatewayPush,
  summarizeGatewayEvent,
} from "@/lib/gateway-debug-log";
import { loadOrCreateDeviceIdentity, clearDeviceToken } from "@/lib/device-identity";
import { defineStore } from "pinia";
import { ref, shallowRef } from "vue";

export type GatewayConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export function gatewayUrlFromEnv(): string {
  const raw = import.meta.env.VITE_GATEWAY_URL?.trim();
  if (raw) {
    return raw;
  }
  return "ws://127.0.0.1:18789";
}

type ConnectOpts = { url: string; token?: string; password?: string; deviceToken?: string };

type PendingBackendPairingRepair = {
  requestId: string;
  deviceId?: string;
  clientId?: string;
  clientMode?: string;
  displayName?: string;
  scopes: string[];
  ts?: number;
};

let connectRequestId = 0;

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
  } catch {
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
    } catch {
      /* ignore corrupt local file */
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
    } catch {
      /* ignore */
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

      const desktop = getDidClawDesktopApi();
      // Track if we just started a new gateway process (plugins need time; onHello data may be incomplete)
      let gatewayWasFreshlyStarted = false;
      if (desktop?.ensureOpenClawGateway) {
        const ensured = await desktop.ensureOpenClawGateway({ wsUrl: opts.url });
        if (req !== connectRequestId) {
          return;
        }
        if (!ensured.ok) {
          lastError.value = ensured.error;
          status.value = "error";
          return;
        }
        // Brief delay after desktop started gateway to reduce first-connect vs challenge races
        if (ensured.started) {
          gatewayWasFreshlyStarted = true;
          await delayMs(400);
          if (req !== connectRequestId) {
            return;
          }
        }
      }

      const gc = new GatewayClient({
        url: opts.url,
        token: opts.token,
        password: opts.password,
        deviceToken: opts.deviceToken,
        clientVersion: `didclaw/${__APP_VERSION__}`,
        clientMode: isDidClawDesktop() ? GATEWAY_CLIENT_MODE_UI : GATEWAY_CLIENT_MODE,
        useTauriTunnel: isTauri(),
        onHello: (hello) => {
          const parsed = gatewayHelloOkSchema.safeParse(hello);
          if (parsed.success && parsed.data.server?.version) {
            helloInfo.value = i18n.global.t("gatewayConn.helloVersion", {
              version: parsed.data.server.version,
            });
          } else {
            helloInfo.value = i18n.global.t("gatewayConn.helloConnected");
          }
          status.value = "connected";
          scheduleRefreshPendingBackendPairingRepair();
          scheduleRefreshPendingBackendPairingRepair(1500);
          startPendingBackendPairingRepairPolling();
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

          // Fresh gateway: plugins (WhatsApp / WeChat, etc.) may still init at onHello.
          // After ~4s, one more silent refresh when sessions/channel data is ready.
          if (gatewayWasFreshlyStarted) {
            window.setTimeout(() => {
              if (client.value !== gc) return; // connection replaced, skip
              void import("./session").then(async ({ useSessionStore }) => {
                const reloaded = await useSessionStore().refresh();
                if (!reloaded) {
                  const { useChatStore } = await import("./chat");
                  await useChatStore().loadHistory({ silent: true });
                }
              }).catch((e) => { console.error("[didclaw] deferred onHello refresh error", e); });
            }, 4000);
          }

          // ~20s after stable connect: background silent refresh to align OpenClaw + desktop data
          window.setTimeout(() => {
            if (client.value !== gc) return; // connection replaced, skip
            void import("./session").then(async ({ useSessionStore }) => {
              const reloaded = await useSessionStore().refresh();
              if (!reloaded) {
                const { useChatStore } = await import("./chat");
                await useChatStore().loadHistory({ silent: true });
              }
            }).catch((e) => { console.error("[didclaw] 20s background sync error", e); });
          }, 20000);
        },
        onEvent: (evt) => {
          if (isGatewayPushDebugEnabled()) {
            const s = summarizeGatewayEvent(evt);
            logGatewayPush("WS event → store", {
              ...s,
              note: "chat / sessions.changed / cron·agent→history 等",
            });
          } else if (import.meta.env.DEV && evt.event !== "chat") {
            console.debug("[didclaw][gateway event]", evt.event, evt.payload);
          }
          /**
           * 与官方 Control UI `app-gateway.ts` 一致：会话列表或消息在网关侧变化时广播
           * `sessions.changed`。若不处理，仅依赖 `chat` 流式事件，会出现定时任务等写入主会话后
           * 界面不刷新、重连后 `chat.history` 才对齐的现象。
           */
          if (evt.event === "sessions.changed") {
            if (isGatewayPushDebugEnabled()) {
              logGatewayPush("sessions.changed → await refresh 后 loadHistory(silent)，避免与主会话竞态");
            }
            void import("./session").then(async ({ useSessionStore }) => {
              const reloaded = await useSessionStore().refresh();
              if (!reloaded) {
                const { useChatStore } = await import("./chat");
                await useChatStore().loadHistory({ silent: true });
              }
            }).catch((e) => { console.error("[didclaw] sessions.changed error", e); });
          }
          /**
           * cron 事件在任务状态变化时立即发出，早于 delivery/announce 落库。
           * 若此处直接触发 loadHistory，会以旧快照覆盖界面上已流式显示的投递消息（消息闪现后消失）。
           * 正确的同步时机：
           *   - 隔离任务 announce 投递 → 网关发出 agent 事件（sessionKey = 主会话）→ 下方 agent 分支处理
           *   - 主会话任务 → 心跳处理后 agent 事件（sessionKey = 主会话）→ 下方 agent 分支处理
           *   - sessions.changed → 兜底刷新（上方已处理）
           * 因此 cron 事件本身不需要触发 loadHistory。
           */
          if (evt.event === "cron" && isGatewayPushDebugEnabled()) {
            const pl = evt.payload;
            const keys =
              pl && typeof pl === "object" && !Array.isArray(pl)
                ? Object.keys(pl as object).slice(0, 14)
                : [];
            logGatewayPush("cron WS event（仅记录，不触发 loadHistory，由后续 agent 事件处理）", { keys });
          }
          if (evt.event === "agent") {
            const p = evt.payload as { sessionKey?: unknown } | undefined;
            const sk = p && typeof p.sessionKey === "string" ? p.sessionKey : null;
            void import("./session").then(({ useSessionStore }) => {
              const sessionStore = useSessionStore();
              const active = sessionStore.activeSessionKey;
              if (!sk || !active || sk !== active) {
                if (sk && sk !== active) {
                  void import("./chat").then(async ({ useChatStore }) => {
                    const chatStore = useChatStore();
                    /**
                     * 检查是否为「首次出现」的后台会话（flashingSessionKeys 尚未包含它）。
                     * 对于 WhatsApp 等渠道，Gateway 仅发 agent 事件而不发 chat.delta，
                     * 依赖 chat.delta 的 shouldFollow 逻辑无法触发切换，需在此补充：
                     * 首个 agent 事件到达时若 composer 空闲则自动切换到该会话。
                     */
                    const isFirstAgentBurst = !chatStore.flashingSessionKeys.includes(sk);
                    chatStore.noteBackgroundAgentActivity(sk);
                    if (isFirstAgentBurst) {
                      const composerIdle =
                        !chatStore.sending &&
                        chatStore.runId == null &&
                        (chatStore.streamText == null || !String(chatStore.streamText).trim());
                      if (composerIdle) {
                        if (isGatewayPushDebugEnabled()) {
                          logGatewayPush("agent WS event（新后台会话，composer 空闲）→ selectSession", {
                            sessionKey: sk,
                          });
                        }
                        await sessionStore.selectSession(sk);
                      }
                    }
                  }).catch((e) => { console.error("[didclaw] background agent note error", e); });
                }
                return;
              }
              if (!agentEventWarrantsChatHistorySync(evt.payload)) {
                if (isGatewayPushDebugEnabled()) {
                  logGatewayPush("agent WS event 跳过 history 同步（多为 tool start/update）", {
                    sessionKey: sk,
                  });
                }
                return;
              }
              if (isGatewayPushDebugEnabled()) {
                logGatewayPush(
                  "agent WS event（sessionKey=当前选中）→ scheduleDebouncedSilentHistoryFromGateway",
                  { sessionKey: sk },
                );
              }
              void import("./chat").then(({ useChatStore }) => {
                useChatStore().scheduleDebouncedSilentHistoryFromGateway("agent");
              }).catch((e) => { console.error("[didclaw] agent history sync error", e); });
            }).catch((e) => { console.error("[didclaw] agent session check error", e); });
          }
          void import("./chat").then(({ useChatStore }) => {
            useChatStore().handleGatewayEvent(evt);
          }).catch((e) => { console.error("[didclaw] handleGatewayEvent dispatch error", e); });
          void import("./toolTimeline").then(({ useToolTimelineStore }) => {
            useToolTimelineStore().ingest(evt);
          }).catch((e) => { console.error("[didclaw] toolTimeline ingest error", e); });
          if (evt.event === "exec.approval.requested") {
            const p = evt.payload;
            if (p && typeof p === "object" && !Array.isArray(p)) {
              const normalized = parseExecApprovalRequestedPayload(p as Record<string, unknown>);
              if (normalized) {
                void import("./approval").then(({ useApprovalStore }) => {
                  useApprovalStore().addPending(normalized);
                }).catch((e) => { console.error("[didclaw] approval store error", e); });
              }
            }
          }
          if (evt.event === "exec.approval.resolved") {
            const pl = evt.payload as { id?: unknown; decision?: unknown } | undefined;
            const rid = pl && typeof pl.id === "string" ? pl.id.trim() : "";
            const decision = pl && typeof pl.decision === "string" ? pl.decision : "";
            if (rid) {
              void import("./approval").then(({ useApprovalStore }) => {
                const approvalStore = useApprovalStore();
                approvalStore.removePending(rid);
                const shortId = rid.slice(0, 8);
                if (decision === "allow-once") {
                  approvalStore.setRecentNotice(
                    i18n.global.t("approval.confirmedAllowOnce", { id: shortId }),
                    3200,
                  );
                } else if (decision === "allow-always") {
                  approvalStore.setRecentNotice(
                    i18n.global.t("approval.confirmedAllowAlways", { id: shortId }),
                    3200,
                  );
                } else if (decision === "deny") {
                  approvalStore.setRecentNotice(
                    i18n.global.t("approval.confirmedDeny", { id: shortId }),
                    3200,
                  );
                }
                scheduleRefreshPendingBackendPairingRepair();
                scheduleRefreshPendingBackendPairingRepair(1200);
              }).catch((e) => { console.error("[didclaw] approval resolved handler error", e); });
            }
          }
        },
        onClose: ({ code, reason, error }) => {
          /**
           * GatewayClient 在 socket close 后会 scheduleReconnect。
           * 若此处仅把 client 置空而不 stop 当前实例，会出现「孤儿」重连：store 已无引用，
           * 但旧实例仍在后台建连，易与后续手动连接打架并触发 1008 等异常。
           */
          gc.stop();
          stopPendingBackendPairingRepairPolling();
          const stillCurrent = client.value === gc;
          if (!stillCurrent) return;

          client.value = null;
          helloInfo.value = null;
          pendingBackendPairingRepair.value = null;

          // WS 1012 = Service Restart: gateway is restarting (e.g. after plugin install).
          // Auto-reconnect after a short delay instead of showing a persistent error.
          const isServiceRestart =
            code === 1012 ||
            String(reason ?? "").toLowerCase().includes("service restart");
          if (isServiceRestart) {
            status.value = "connecting";
            lastError.value = null;
            window.setTimeout(() => {
              // Only reconnect if nothing else has taken over
              if (client.value === null && status.value === "connecting") {
                connect();
              }
            }, 3000);
            return;
          }

          status.value = "error";
          const detailText = error ? describeGatewayError(error) : String(reason ?? "").trim();
          lastError.value = detailText
            ? i18n.global.t("gatewayConn.disconnectedWithDetail", { code, detail: detailText })
            : i18n.global.t("gatewayConn.disconnectedCodeOnly", { code });

          const lowerDetail = detailText.toLowerCase();
          if (lowerDetail.includes("pairing")) {
            lastError.value += i18n.global.t("gatewayConn.pairingHint");
          }

          // Clear cached deviceToken on AUTH_TOKEN_MISMATCH / device auth errors
          const isAuthError = lowerDetail.includes("unauthorized") ||
                             lowerDetail.includes("auth") ||
                             lowerDetail.includes("token") ||
                             error?.gatewayCode === "AUTH_TOKEN_MISMATCH" ||
                             error?.gatewayCode?.startsWith("DEVICE_AUTH_");
          if (isAuthError && cachedDeviceToken) {
            console.log("[didclaw] clearing cached deviceToken due to auth error");
            cachedDeviceToken = undefined;
            void clearDeviceToken().catch(() => { /* ignore */ });
          }
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
