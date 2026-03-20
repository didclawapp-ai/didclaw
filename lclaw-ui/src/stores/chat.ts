import type { GatewayEventFrame } from "@/features/gateway/gateway-types";
import { chatEventPayloadSchema, chatHistoryResponseSchema } from "@/features/gateway/schemas";
import { describeGatewayError } from "@/lib/gateway-errors";
import { extractDisplayText } from "@/lib/message-display";
import { formatZodIssues } from "@/lib/zod-format";
import { generateUUID } from "@/lib/uuid";
import { defineStore } from "pinia";
import { ref } from "vue";
import { useGatewayStore } from "./gateway";
import { useSessionStore } from "./session";

export const useChatStore = defineStore("chat", () => {
  const messages = ref<unknown[]>([]);
  const historyLoading = ref(false);
  const sending = ref(false);
  const streamText = ref<string | null>(null);
  const runId = ref<string | null>(null);
  const draft = ref("");
  const lastError = ref<string | null>(null);

  async function loadHistory(): Promise<void> {
    const gw = useGatewayStore();
    const c = gw.client;
    const session = useSessionStore();
    const key = session.activeSessionKey;
    if (!c?.connected || !key) {
      messages.value = [];
      return;
    }
    historyLoading.value = true;
    lastError.value = null;
    try {
      const res = await c.request<unknown>("chat.history", {
        sessionKey: key,
        limit: 200,
      });
      const parsed = chatHistoryResponseSchema.safeParse(res);
      if (!parsed.success) {
        lastError.value = `历史消息格式异常：${formatZodIssues(parsed.error)}`;
        messages.value = [];
        return;
      }
      const msgs = parsed.data.messages;
      messages.value = Array.isArray(msgs) ? msgs : [];
      streamText.value = null;
      runId.value = null;
    } catch (e) {
      lastError.value = describeGatewayError(e);
    } finally {
      historyLoading.value = false;
    }
  }

  async function sendMessage(): Promise<void> {
    const gw = useGatewayStore();
    const c = gw.client;
    const session = useSessionStore();
    const key = session.activeSessionKey;
    const text = draft.value.trim();
    if (!c?.connected || !key || !text || sending.value) {
      return;
    }
    sending.value = true;
    lastError.value = null;
    const idem = generateUUID();
    runId.value = idem;
    streamText.value = "";
    draft.value = "";
    try {
      await c.request("chat.send", {
        sessionKey: key,
        message: text,
        deliver: false,
        idempotencyKey: idem,
      });
    } catch (e) {
      runId.value = null;
      streamText.value = null;
      lastError.value = describeGatewayError(e);
    } finally {
      sending.value = false;
    }
  }

  async function abortIfStreaming(): Promise<void> {
    const gw = useGatewayStore();
    const c = gw.client;
    const session = useSessionStore();
    const key = session.activeSessionKey;
    if (!c?.connected || !key) {
      return;
    }
    try {
      await c.request("chat.abort", runId.value ? { sessionKey: key, runId: runId.value } : { sessionKey: key });
    } catch {
      /* ignore */
    }
    streamText.value = null;
    runId.value = null;
  }

  function handleGatewayEvent(evt: GatewayEventFrame): void {
    if (evt.event !== "chat") {
      return;
    }
    const parsed = chatEventPayloadSchema.safeParse(evt.payload);
    if (!parsed.success) {
      if (import.meta.env.DEV) {
        console.warn("[lclaw-ui] chat event payload invalid:", formatZodIssues(parsed.error));
      }
      return;
    }
    const payload = parsed.data;
    const session = useSessionStore();
    if (payload.sessionKey !== session.activeSessionKey) {
      return;
    }

    if (payload.state === "delta") {
      const next = extractDisplayText(payload.message);
      if (next) {
        const current = streamText.value ?? "";
        if (!current || next.length >= current.length) {
          streamText.value = next;
        }
      }
    } else if (payload.state === "final") {
      void loadHistory();
      streamText.value = null;
      runId.value = null;
    } else if (payload.state === "aborted") {
      void loadHistory();
      streamText.value = null;
      runId.value = null;
    } else if (payload.state === "error") {
      streamText.value = null;
      runId.value = null;
      lastError.value = payload.errorMessage?.trim() || "对话出错（网关返回 error 状态）";
    }
  }

  return {
    messages,
    historyLoading,
    sending,
    streamText,
    runId,
    draft,
    lastError,
    loadHistory,
    sendMessage,
    abortIfStreaming,
    handleGatewayEvent,
  };
});
