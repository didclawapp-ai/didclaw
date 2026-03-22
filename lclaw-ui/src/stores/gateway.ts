import { GatewayClient } from "@/features/gateway/gateway-client";
import {
  GATEWAY_CLIENT_MODE,
  GATEWAY_CLIENT_MODE_UI,
} from "@/features/gateway/gateway-types";
import { gatewayHelloOkSchema } from "@/features/gateway/schemas";
import { getLclawDesktopApi } from "@/lib/electron-bridge";
import { isLclawDesktop } from "@/lib/desktop-api";
import { isTauri } from "@tauri-apps/api/core";
import { describeGatewayError } from "@/lib/gateway-errors";
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

type ConnectOpts = { url: string; token?: string; password?: string };

let connectRequestId = 0;

async function loadGatewayConnectOptions(): Promise<ConnectOpts> {
  let finalUrl = gatewayUrlFromEnv();
  let token = import.meta.env.VITE_GATEWAY_TOKEN?.trim() || undefined;
  let password = import.meta.env.VITE_GATEWAY_PASSWORD?.trim() || undefined;

  const desktop = getLclawDesktopApi();
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

  return { url: finalUrl, token, password };
}

export const useGatewayStore = defineStore("gateway", () => {
  const client = shallowRef<GatewayClient | null>(null);
  const status = ref<GatewayConnectionStatus>("disconnected");
  const lastError = ref<string | null>(null);
  const helloInfo = ref<string | null>(null);
  /** 当前用于展示与诊断的 WS 地址（含 Electron 本地配置覆盖） */
  const url = ref(gatewayUrlFromEnv());

  function disconnect(): void {
    connectRequestId++;
    client.value?.stop();
    client.value = null;
    status.value = "disconnected";
  }

  /** 按当前环境变量 / Electron 本地文件刷新顶栏展示的 WS 地址（不自动重连） */
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

      const desktop = getLclawDesktopApi();
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
      }

      const gc = new GatewayClient({
        url: opts.url,
        token: opts.token,
        password: opts.password,
        clientMode: isLclawDesktop() ? GATEWAY_CLIENT_MODE_UI : GATEWAY_CLIENT_MODE,
        useTauriTunnel: isTauri(),
        onHello: (hello) => {
          const parsed = gatewayHelloOkSchema.safeParse(hello);
          if (parsed.success && parsed.data.server?.version) {
            helloInfo.value = `Gateway ${parsed.data.server.version}`;
          } else {
            helloInfo.value = "Connected";
          }
          status.value = "connected";
          void import("./session").then(({ useSessionStore }) => {
            void useSessionStore().refresh();
          });
          void import("./chat").then(({ useChatStore }) => {
            void useChatStore().refreshOpenClawModelPicker();
          });
        },
        onEvent: (evt) => {
          if (import.meta.env.DEV && evt.event !== "chat") {
            console.debug("[lclaw-ui][gateway event]", evt.event, evt.payload);
          }
          void import("./chat").then(({ useChatStore }) => {
            useChatStore().handleGatewayEvent(evt);
          });
          void import("./toolTimeline").then(({ useToolTimelineStore }) => {
            useToolTimelineStore().ingest(evt);
          });
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
            if (detailText.toLowerCase().includes("pairing")) {
              lastError.value += " — 请在网关主机执行: openclaw devices list / openclaw devices approve <id>";
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
