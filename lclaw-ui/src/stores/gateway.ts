import { GatewayClient } from "@/features/gateway/gateway-client";
import { gatewayHelloOkSchema } from "@/features/gateway/schemas";
import { describeGatewayError } from "@/lib/gateway-errors";
import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";

export type GatewayConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

function gatewayUrlFromEnv(): string {
  const raw = import.meta.env.VITE_GATEWAY_URL?.trim();
  if (raw) {
    return raw;
  }
  return "ws://127.0.0.1:18789";
}

export const useGatewayStore = defineStore("gateway", () => {
  const client = shallowRef<GatewayClient | null>(null);
  const status = ref<GatewayConnectionStatus>("disconnected");
  const lastError = ref<string | null>(null);
  const helloInfo = ref<string | null>(null);

  const url = computed(() => gatewayUrlFromEnv());

  function disconnect(): void {
    client.value?.stop();
    client.value = null;
    status.value = "disconnected";
  }

  function connect(): void {
    disconnect();
    lastError.value = null;
    helloInfo.value = null;
    status.value = "connecting";

    const token = import.meta.env.VITE_GATEWAY_TOKEN?.trim() || undefined;
    const password = import.meta.env.VITE_GATEWAY_PASSWORD?.trim() || undefined;

    const gc = new GatewayClient({
      url: url.value,
      token,
      password,
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

    client.value = gc;
    gc.start();
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
