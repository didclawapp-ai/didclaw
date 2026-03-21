import type { GatewayEventFrame } from "@/features/gateway/gateway-types";
import { chatEventPayloadSchema, chatHistoryResponseSchema } from "@/features/gateway/schemas";
import { describeGatewayError } from "@/lib/gateway-errors";
import { extractChatDeltaText, mergeAssistantStreamDelta } from "@/lib/message-display";
import { formatZodIssues } from "@/lib/zod-format";
import { generateUUID } from "@/lib/uuid";
import { defineStore } from "pinia";
import { nextTick, ref } from "vue";
import { useGatewayStore } from "./gateway";
import { usePreviewStore } from "./preview";
import { useSessionStore } from "./session";

const OPTIMISTIC_KEY = "_lclawOptimistic";

function isOptimisticMessage(m: unknown): boolean {
  return Boolean(m && typeof m === "object" && OPTIMISTIC_KEY in (m as Record<string, unknown>));
}

function collectOptimistics(msgs: unknown[]): unknown[] {
  return msgs.filter(isOptimisticMessage);
}

/** 服务端快照往往比本地少一条刚发的 user（尚未落库）；此时应保留乐观消息，避免只剩「正在生成」一行 */
function mergeIncomingHistoryWithOptimistics(incoming: unknown[], previous: unknown[]): unknown[] {
  const opts = collectOptimistics(previous);
  if (opts.length === 0) {
    return [...incoming];
  }
  if (incoming.length < previous.length) {
    return [...incoming, ...opts];
  }
  return [...incoming];
}

export const useChatStore = defineStore("chat", () => {
  const messages = ref<unknown[]>([]);
  const historyLoading = ref(false);
  const sending = ref(false);
  const streamText = ref<string | null>(null);
  const runId = ref<string | null>(null);
  const draft = ref("");
  const lastError = ref<string | null>(null);

  async function loadHistory(opts?: { silent?: boolean }): Promise<void> {
    const silent = opts?.silent === true;
    const gw = useGatewayStore();
    const c = gw.client;
    const session = useSessionStore();
    const key = session.activeSessionKey;
    if (!c?.connected || !key) {
      messages.value = [];
      streamText.value = null;
      runId.value = null;
      return;
    }
    if (!silent) {
      historyLoading.value = true;
    }
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
        streamText.value = null;
        runId.value = null;
        return;
      }
      const msgs = parsed.data.messages;
      const incoming = Array.isArray(msgs) ? msgs : [];
      const previous = messages.value;
      messages.value = mergeIncomingHistoryWithOptimistics(incoming, previous);
      streamText.value = null;
      runId.value = null;
    } catch (e) {
      lastError.value = describeGatewayError(e);
    } finally {
      if (!silent) {
        historyLoading.value = false;
      }
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
    streamText.value = null;
    draft.value = "";
    const optimistic = { role: "user" as const, text, [OPTIMISTIC_KEY]: idem };
    messages.value = [...messages.value, optimistic];
    usePreviewStore().setFollowLatest(true);
    await nextTick();
    try {
      await c.request("chat.send", {
        sessionKey: key,
        message: text,
        deliver: false,
        idempotencyKey: idem,
      });
    } catch (e) {
      messages.value = messages.value.filter((m) => {
        if (!m || typeof m !== "object") {
          return true;
        }
        const o = m as Record<string, unknown>;
        return o[OPTIMISTIC_KEY] !== idem;
      });
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
      if (payload.runId) {
        runId.value = payload.runId;
      }
      const chunk = extractChatDeltaText(payload as Record<string, unknown>);
      if (chunk) {
        streamText.value = mergeAssistantStreamDelta(streamText.value, chunk);
      }
    } else if (payload.state === "final") {
      void loadHistory({ silent: true });
    } else if (payload.state === "aborted") {
      void loadHistory({ silent: true });
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
