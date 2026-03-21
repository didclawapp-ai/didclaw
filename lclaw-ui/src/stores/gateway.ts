import { GatewayClient } from "@/features/gateway/gateway-client";
import { gatewayHelloOkSchema } from "@/features/gateway/schemas";
import { isLclawElectron } from "@/lib/electron-bridge";
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

  if (isLclawElectron() && window.lclawElectron?.readGatewayLocalConfig) {
    try {
      const local = await window.lclawElectron.readGatewayLocalConfig();
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

  function connect(): void {
    connectRequestId++;
    client.value?.stop();
    client.value = null;
    lastError.value = null;
    helloInfo.value = null;
    status.value = "connecting";

    const req = connectRequestId;
    void loadGatewayConnectOptions().then((opts) => {
      if (req !== connectRequestId) {
        return;
      }
      url.value = opts.url;

      const gc = new GatewayClient({
        url: opts.url,
        token: opts.token,
        password: opts.password,
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
          client.value = null;
          status.value = "error";
          const detailText = error ? describeGatewayError(error) : String(reason ?? "").trim();
          lastError.value = detailText ? `已断开（${code}）：${detailText}` : `已断开（${code}）`;
          if (detailText.toLowerCase().includes("pairing")) {
            lastError.value += " — 请在网关主机执行: openclaw devices list / openclaw devices approve <id>";
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

  return {
    client,
    status,
    lastError,
    helloInfo,
    url,
    connect,
    disconnect,
  };
});
