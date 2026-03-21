import type { GatewayEventFrame } from "@/features/gateway/gateway-types";
import { chatEventPayloadSchema, chatHistoryResponseSchema } from "@/features/gateway/schemas";
import { buildImageAttachmentPayload, type GatewayChatAttachmentPayload } from "@/lib/chat-attachment-encode";
import {
  CHAT_OPTIMISTIC_KEY,
  type GatewayChatMessage,
  type OptimisticUserMessage,
  type UiChatMessage,
  isOptimisticUserMessage,
} from "@/lib/chat-messages";
import { describeGatewayError } from "@/lib/gateway-errors";
import { extractChatDeltaText, mergeAssistantStreamDelta } from "@/lib/message-display";
import { formatZodIssues } from "@/lib/zod-format";
import { generateUUID } from "@/lib/uuid";
import { defineStore } from "pinia";
import { nextTick, ref } from "vue";

/** 单文件体积上限（含待预览的 PDF 等）；图片传入网关另有约 4.5MB 限制 */
const MAX_COMPOSER_FILE_BYTES = 50 * 1024 * 1024;

export type PendingComposerFile = {
  id: string;
  file: File;
  objectUrl: string;
};
import { useGatewayStore } from "./gateway";
import { usePreviewStore } from "./preview";
import { useSessionStore } from "./session";

function collectOptimistics(msgs: UiChatMessage[]): OptimisticUserMessage[] {
  return msgs.filter(isOptimisticUserMessage);
}

/** 服务端快照往往比本地少一条刚发的 user（尚未落库）；此时应保留乐观消息，避免只剩「正在生成」一行 */
function mergeIncomingHistoryWithOptimistics(
  incoming: GatewayChatMessage[],
  previous: UiChatMessage[],
): UiChatMessage[] {
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
  const messages = ref<UiChatMessage[]>([]);
  const historyLoading = ref(false);
  const sending = ref(false);
  const streamText = ref<string | null>(null);
  const runId = ref<string | null>(null);
  const draft = ref("");
  const lastError = ref<string | null>(null);
  const pendingComposerFiles = ref<PendingComposerFile[]>([]);

  function addPendingComposerFiles(files: File[]): void {
    for (const file of files) {
      if (!file || file.size <= 0) {
        continue;
      }
      if (file.size > MAX_COMPOSER_FILE_BYTES) {
        lastError.value = `${file.name} 超过 50MB，已跳过`;
        continue;
      }
      const id = generateUUID();
      pendingComposerFiles.value.push({
        id,
        file,
        objectUrl: URL.createObjectURL(file),
      });
    }
  }

  function removePendingComposerFile(id: string): void {
    const i = pendingComposerFiles.value.findIndex((p) => p.id === id);
    if (i < 0) {
      return;
    }
    URL.revokeObjectURL(pendingComposerFiles.value[i].objectUrl);
    pendingComposerFiles.value.splice(i, 1);
  }

  function clearPendingComposerFiles(): void {
    for (const p of pendingComposerFiles.value) {
      URL.revokeObjectURL(p.objectUrl);
    }
    pendingComposerFiles.value = [];
  }

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
      const incoming = (Array.isArray(msgs) ? msgs : []) as GatewayChatMessage[];
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
    const queueSnapshot = pendingComposerFiles.value.slice();
    if (!c?.connected || !key || sending.value) {
      return;
    }
    if (!text && queueSnapshot.length === 0) {
      return;
    }

    const attachmentsPayload: GatewayChatAttachmentPayload[] = [];
    try {
      for (const p of queueSnapshot) {
        if (p.file.type.startsWith("image/")) {
          attachmentsPayload.push(await buildImageAttachmentPayload(p.file));
        }
      }
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e);
      return;
    }

    const nonImages = queueSnapshot.filter((p) => !p.file.type.startsWith("image/"));
    let message = text;
    if (nonImages.length > 0) {
      const lines = nonImages
        .map((x) => `- ${x.file.name}（${x.file.type || "未知类型"}）`)
        .join("\n");
      const block =
        "以下文件已随消息发送；网关当前仅将**图片**作为多模态附件传入模型，其它格式请放到工作区或通过可访问链接提供：\n" +
        lines;
      message = message ? `${message}\n\n---\n${block}` : `---\n${block}`;
    }

    if (!message.trim() && attachmentsPayload.length > 0) {
      message = "（图片附件）";
    }
    if (!message.trim()) {
      return;
    }

    sending.value = true;
    lastError.value = null;
    const idem = generateUUID();
    runId.value = idem;
    streamText.value = null;
    draft.value = "";

    const optimisticParts: string[] = [];
    if (text) {
      optimisticParts.push(text);
    } else if (attachmentsPayload.length > 0) {
      optimisticParts.push("（图片附件）");
    }
    for (const p of queueSnapshot) {
      optimisticParts.push(`📎${p.file.name}`);
    }
    const optimisticText = optimisticParts.length > 0 ? optimisticParts.join(" ") : "（附件）";

    const optimistic: OptimisticUserMessage = {
      role: "user",
      text: optimisticText,
      [CHAT_OPTIMISTIC_KEY]: idem,
    };
    messages.value = [...messages.value, optimistic];
    usePreviewStore().setFollowLatest(true);
    await nextTick();
    try {
      await c.request("chat.send", {
        sessionKey: key,
        message,
        deliver: false,
        idempotencyKey: idem,
        ...(attachmentsPayload.length > 0 ? { attachments: attachmentsPayload } : {}),
      });
      clearPendingComposerFiles();
    } catch (e) {
      messages.value = messages.value.filter(
        (m) => !isOptimisticUserMessage(m) || m[CHAT_OPTIMISTIC_KEY] !== idem,
      );
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
    pendingComposerFiles,
    addPendingComposerFiles,
    removePendingComposerFile,
    clearPendingComposerFiles,
    loadHistory,
    sendMessage,
    abortIfStreaming,
    handleGatewayEvent,
  };
});
