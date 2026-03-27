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
import type { ExecApprovalRequest } from "./approval";
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

let connectRequestId = 0;

/** 缓存的 deviceToken，用于自动重连 */
let cachedDeviceToken: string | undefined = undefined;

/** 加载 deviceToken（从设备身份存储） */
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
      /* 忽略损坏的本地文件 */
    }
  }

  // 如果没有用户配置的 token/password，尝试使用 deviceToken
  const deviceToken = !token && !password ? await loadDeviceToken() : undefined;

  return { url: finalUrl, token, password, deviceToken };
}

export const useGatewayStore = defineStore("gateway", () => {
  const client = shallowRef<GatewayClient | null>(null);
  const status = ref<GatewayConnectionStatus>("disconnected");
  const lastError = ref<string | null>(null);
  const helloInfo = ref<string | null>(null);
  /** 当前用于展示与诊断的 WS 地址（含桌面端本地配置覆盖，存于 didclaw.db） */
  const url = ref(gatewayUrlFromEnv());

  function disconnect(): void {
    cancelDeferredGatewayConnect();
    connectRequestId++;
    client.value?.stop();
    client.value = null;
    status.value = "disconnected";
  }

  /** 按当前环境变量 / 桌面本地库刷新顶栏展示的 WS 地址（不自动重连） */
  async function refreshResolvedUrl(): Promise<void> {
    const o = await loadGatewayConnectOptions();
    url.value = o.url;
  }

  /** 断开并按最新配置立即重连（连接设置页保存后调用） */
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
      // 记录本次是否刚启动了新网关进程（插件加载需要额外时间，onHello 时数据可能不完整）
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
        // 本次由桌面端新拉了网关进程时，再给事件循环与隧道一层缓冲，减少首连与 challenge 的竞态。
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
            helloInfo.value = `Gateway ${parsed.data.server.version}`;
          } else {
            helloInfo.value = "Connected";
          }
          status.value = "connected";
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

          // 首次启动的网关：onHello 时插件（WhatsApp / 微信等）可能还在初始化，
          // sessions/channel 状态不完整。等插件就绪后（约 4s）补做一次静默刷新。
          if (gatewayWasFreshlyStarted) {
            window.setTimeout(() => {
              if (client.value !== gc) return; // 连接已切换，放弃
              void import("./session").then(async ({ useSessionStore }) => {
                const reloaded = await useSessionStore().refresh();
                if (!reloaded) {
                  const { useChatStore } = await import("./chat");
                  await useChatStore().loadHistory({ silent: true });
                }
              }).catch((e) => { console.error("[didclaw] deferred onHello refresh error", e); });
            }, 4000);
          }
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
            const p = evt.payload as Record<string, unknown> | undefined;
            // gateway schema uses `id`; tolerate legacy `approvalId` too
            const approvalId =
              p && typeof p.id === "string" ? p.id
              : p && typeof p.approvalId === "string" ? p.approvalId
              : null;
            if (approvalId) {
              void import("./approval").then(({ useApprovalStore }) => {
                useApprovalStore().addPending({
                  approvalId,
                  sessionKey: typeof p?.sessionKey === "string" ? p.sessionKey : undefined,
                  agentId: typeof p?.agentId === "string" ? p.agentId : undefined,
                  systemRunPlan: p?.systemRunPlan as ExecApprovalRequest["systemRunPlan"],
                });
              }).catch((e) => { console.error("[didclaw] approval store error", e); });
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
          const stillCurrent = client.value === gc;
          if (stillCurrent) {
            client.value = null;
            status.value = "error";
            helloInfo.value = null;
            const detailText = error ? describeGatewayError(error) : String(reason ?? "").trim();
            lastError.value = detailText ? `已断开（${code}）：${detailText}` : `已断开（${code}）`;
            
            // 处理配对和设备认证错误
            const lowerDetail = detailText.toLowerCase();
            if (lowerDetail.includes("pairing")) {
              lastError.value += " — 请在网关主机执行: openclaw devices list / openclaw devices approve <id>";
            }
            
            // 如果 deviceToken 失效（AUTH_TOKEN_MISMATCH 或相关错误），清除缓存
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
    url,
    connect,
    disconnect,
    refreshResolvedUrl,
    reloadConnection,
  };
});
