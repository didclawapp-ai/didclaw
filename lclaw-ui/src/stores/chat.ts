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
import { sortHistoryMessagesOldestFirst } from "@/lib/chat-history-sort";
import { messageToChatLine } from "@/lib/chat-line";
import { OPENCLAW_AFTER_WRITE_HINT } from "@/lib/openclaw-config-hint";
import { describeOpenClawPrimaryModelIncompatibility } from "@/lib/openclaw-model-guards";
import { getDidClawDesktopApi, isDidClawElectron } from "@/lib/electron-bridge";
import {
  isGatewayPushDebugEnabled,
  logGatewayPush,
  summarizeChatEventPayload,
} from "@/lib/gateway-debug-log";
import { describeGatewayError } from "@/lib/gateway-errors";
import { extractChatDeltaText, mergeAssistantStreamDelta } from "@/lib/message-display";
import { formatZodIssues } from "@/lib/zod-format";
import { generateUUID } from "@/lib/uuid";
import { defineStore } from "pinia";
import { computed, nextTick, ref } from "vue";
import { useGatewayStore } from "./gateway";
import { usePreviewStore } from "./preview";
import { useSessionStore } from "./session";

/** 单文件体积上限（含待预览的 PDF 等）；图片传入网关另有约 4.5MB 限制 */
const MAX_COMPOSER_FILE_BYTES = 50 * 1024 * 1024;

export type PendingComposerFile = {
  id: string;
  file: File;
  objectUrl: string;
  /** false：不参与本次 chat.send，发送成功后仍保留在列表（仅预览/对照） */
  includeInSend: boolean;
};

function collectOptimistics(msgs: UiChatMessage[]): OptimisticUserMessage[] {
  return msgs.filter(isOptimisticUserMessage);
}

function normalizeUserText(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/** 与列表展示一致：取 incoming 中**最后一条** user 的正文 */
function lastUserDisplayTextInIncoming(incoming: GatewayChatMessage[]): string | null {
  for (let i = incoming.length - 1; i >= 0; i--) {
    const line = messageToChatLine(incoming[i]);
    if (line.role === "user") {
      const t = normalizeUserText(line.text);
      return t.length > 0 ? t : null;
    }
  }
  return null;
}

/** 正文达到该长度时，与 incoming 内任意 user 比对（避免只比对「最后一条 user」漏掉较早重复） */
const OPTIMISTIC_DEDUP_ANY_USER_MIN_CHARS = 32;

function incomingHasUserWithNormalizedText(
  incoming: GatewayChatMessage[],
  normalized: string,
): boolean {
  if (normalized.length === 0) {
    return false;
  }
  for (let i = 0; i < incoming.length; i++) {
    const line = messageToChatLine(incoming[i]);
    if (line.role === "user" && normalizeUserText(line.text) === normalized) {
      return true;
    }
  }
  return false;
}

/**
 * 当 incoming 已包含与乐观消息同文的 user 时不再追加（否则会出现「用户话重复两次」，
 * 常见于服务端已落库 user 但条数仍短于本地含乐观项时的合并分支）。
 * 短句仍只与「最后一条 user」比对，降低用户连发相同短句时被误删的概率。
 */
function filterRedundantOptimistics(
  incoming: GatewayChatMessage[],
  opts: OptimisticUserMessage[],
): OptimisticUserMessage[] {
  const lastUser = lastUserDisplayTextInIncoming(incoming);
  return opts.filter((o) => {
    const nt = normalizeUserText(o.text);
    if (nt.length === 0) {
      return true;
    }
    if (nt.length >= OPTIMISTIC_DEDUP_ANY_USER_MIN_CHARS) {
      return !incomingHasUserWithNormalizedText(incoming, nt);
    }
    if (lastUser == null) {
      return true;
    }
    return nt !== lastUser;
  });
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
    const keep = filterRedundantOptimistics(incoming, opts);
    return [...incoming, ...keep];
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
  /** 本轮用户发送起点（用于工具时间线对齐与耗时） */
  const runStartedAtMs = ref<number | null>(null);
  /** 最近一次助手 delta 到达时间（卡住检测） */
  const lastDeltaAtMs = ref<number | null>(null);
  const lastCompletedRunDurationMs = ref<number | null>(null);
  const lastCompletedRunAtMs = ref<number | null>(null);

  /**
   * 会话栏模型下拉：与 ~/.openclaw/openclaw.json 同步，切换即写 **primary**（写前备份）。
   * 不向 `chat.send` 附带 `model`（网关 schema 不接受根级该字段）。
   */
  const openClawPrimaryModel = ref("");
  const openClawModelPickerRows = ref<Array<{ value: string; label: string }>>([]);
  const openClawPrimaryBusy = ref(false);
  const openClawPrimaryPickerError = ref<string | null>(null);
  /** 写入 openclaw.json 后的短提示（约 12s 消失） */
  const openClawConfigHint = ref<string | null>(null);
  let openClawConfigHintTimer: number | null = null;

  /** 后台子代理（非当前会话）最近一次 agent 事件时间戳 */
  const backgroundAgentLastSeenMs = ref<number | null>(null);
  /** 后台子代理所在会话 key */
  const backgroundAgentSessionKey = ref<string | null>(null);
  /** 当前正在闪动高亮的会话 key 集合（收到 agent 活动后短暂保持，用于会话按钮闪动提示） */
  const flashingSessionKeys = ref<string[]>([]);

  const FLASH_DURATION_MS = 5000;
  const flashTimers = new Map<string, number>();

  function noteBackgroundAgentActivity(sk: string): void {
    backgroundAgentLastSeenMs.value = Date.now();
    backgroundAgentSessionKey.value = sk;
    // 将该会话标记为闪动状态，5 秒后自动清除
    if (!flashingSessionKeys.value.includes(sk)) {
      flashingSessionKeys.value = [...flashingSessionKeys.value, sk];
    }
    const existing = flashTimers.get(sk);
    if (existing != null) {
      clearTimeout(existing);
    }
    flashTimers.set(
      sk,
      window.setTimeout(() => {
        flashTimers.delete(sk);
        flashingSessionKeys.value = flashingSessionKeys.value.filter((k) => k !== sk);
      }, FLASH_DURATION_MS),
    );
  }

  const agentBusy = computed(() => sending.value || runId.value != null);

  function flashOpenClawConfigHint(message: string = OPENCLAW_AFTER_WRITE_HINT): void {
    openClawConfigHint.value = message;
    if (openClawConfigHintTimer != null) {
      clearTimeout(openClawConfigHintTimer);
    }
    openClawConfigHintTimer = window.setTimeout(() => {
      openClawConfigHint.value = null;
      openClawConfigHintTimer = null;
    }, 14000);
  }

  /** 发送中或助手流式进行中时禁止再发（避免与网关并发 run 打架） */
  const composerPhase = computed(() => {
    if (sending.value) {
      return "sending" as const;
    }
    if (runId.value == null) {
      return "idle" as const;
    }
    const hasText = Boolean(streamText.value?.trim());
    if (hasText) {
      return "streaming" as const;
    }
    return "waiting" as const;
  });

  async function refreshOpenClawModelPicker(): Promise<void> {
    openClawPrimaryPickerError.value = null;
    const desktop = getDidClawDesktopApi();
    if (!isDidClawElectron() || !desktop?.readOpenClawModelConfig) {
      openClawPrimaryModel.value = "";
      openClawModelPickerRows.value = [];
      return;
    }
    try {
      const r = await desktop.readOpenClawModelConfig();
      if (!r.ok) {
        openClawPrimaryModel.value = "";
        openClawModelPickerRows.value = [];
        openClawPrimaryPickerError.value = r.error;
        return;
      }
      const primary =
        r.model && typeof r.model.primary === "string" ? r.model.primary.trim() : "";
      openClawPrimaryModel.value = primary;
      const models = r.models as Record<string, unknown>;
      const keys = Object.keys(models).sort();
      const rows = keys.map((k) => {
        const v = models[k];
        let alias = "";
        if (v && typeof v === "object" && !Array.isArray(v)) {
          const a = (v as { alias?: unknown }).alias;
          if (typeof a === "string" && a.trim()) {
            alias = a.trim();
          }
        }
        return { value: k, label: alias ? `${k}（${alias}）` : k };
      });
      if (primary && !rows.some((x) => x.value === primary)) {
        rows.push({ value: primary, label: `${primary}（当前默认）` });
      }
      rows.sort((a, b) => a.value.localeCompare(b.value));
      openClawModelPickerRows.value = rows;
    } catch (e) {
      openClawPrimaryModel.value = "";
      openClawModelPickerRows.value = [];
      openClawPrimaryPickerError.value = e instanceof Error ? e.message : String(e);
    }
  }

  async function setOpenClawPrimaryModel(nextRaw: string): Promise<void> {
    const next = nextRaw.trim();
    if (!next) {
      return;
    }
    if (next === openClawPrimaryModel.value.trim()) {
      return;
    }
    const primaryBlock = describeOpenClawPrimaryModelIncompatibility(next);
    if (primaryBlock) {
      openClawPrimaryPickerError.value = primaryBlock;
      return;
    }
    const api = getDidClawDesktopApi();
    if (!api?.writeOpenClawModelConfig) {
      openClawPrimaryPickerError.value = "当前无法保存：请使用桌面版，并确认本机已按教程装好助手。";
      return;
    }
    openClawPrimaryBusy.value = true;
    openClawPrimaryPickerError.value = null;
    try {
      const r = await api.writeOpenClawModelConfig({
        model: { primary: next },
      });
      if (!r.ok) {
        openClawPrimaryPickerError.value = r.backupPath
          ? `${r.error}（备份：${r.backupPath}）`
          : r.error;
        return;
      }
      openClawPrimaryModel.value = next;
      await refreshOpenClawModelPicker();
      flashOpenClawConfigHint();
    } catch (e) {
      openClawPrimaryPickerError.value = e instanceof Error ? e.message : String(e);
    } finally {
      openClawPrimaryBusy.value = false;
    }
  }

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
        includeInSend: true,
      });
    }
  }

  function setPendingIncludeInSend(id: string, includeInSend: boolean): void {
    const p = pendingComposerFiles.value.find((x) => x.id === id);
    if (p) {
      p.includeInSend = includeInSend;
    }
  }

  /** 发送成功后移除「参与发送」的项，保留仅预览项 */
  function removeIncludedPendingFiles(): void {
    const next: PendingComposerFile[] = [];
    for (const p of pendingComposerFiles.value) {
      if (p.includeInSend) {
        URL.revokeObjectURL(p.objectUrl);
      } else {
        next.push(p);
      }
    }
    pendingComposerFiles.value = next;
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

  const pendingSilentHistorySource = ref<string | null>(null);

  function markPendingSilentHistorySync(source: string): void {
    pendingSilentHistorySource.value = source;
  }

  function clearPendingSilentHistorySync(): void {
    pendingSilentHistorySource.value = null;
  }

  function flushPendingSilentHistorySync(reason: string): void {
    const source = pendingSilentHistorySource.value;
    if (!source || sending.value || runId.value != null) {
      return;
    }
    pendingSilentHistorySource.value = null;
    logGatewayPush("pending history sync → loadHistory(silent)", {
      source,
      reason,
    });
    void loadHistory({ silent: true });
  }

  async function loadHistory(opts?: { silent?: boolean }): Promise<void> {
    const silent = opts?.silent === true;
    // Silent background syncs (e.g. from sessions.changed) must not interrupt
    // an active streaming run — the final handler will reload history anyway.
    if (silent && (sending.value || runId.value != null)) {
      markPendingSilentHistorySync("loadHistory-silent");
      return;
    }
    const gw = useGatewayStore();
    const c = gw.client;
    const session = useSessionStore();
    const key = session.activeSessionKey;
    if (!c?.connected || !key) {
      logGatewayPush("loadHistory 跳过（未连接或无当前会话）", {
        silent,
        connected: !!c?.connected,
        sessionKey: key,
      });
      messages.value = [];
      streamText.value = null;
      runId.value = null;
      runStartedAtMs.value = null;
      lastDeltaAtMs.value = null;
      return;
    }
    if (silent && isGatewayPushDebugEnabled()) {
      logGatewayPush("loadHistory(silent) 请求 chat.history", { sessionKey: key, limit: 200 });
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
        runStartedAtMs.value = null;
        lastDeltaAtMs.value = null;
        return;
      }
      const msgs = parsed.data.messages;
      const raw = (Array.isArray(msgs) ? msgs : []) as GatewayChatMessage[];
      const incoming = sortHistoryMessagesOldestFirst(raw);
      const previous = messages.value;
      messages.value = mergeIncomingHistoryWithOptimistics(incoming, previous);
      streamText.value = null;
      runId.value = null;
      runStartedAtMs.value = null;
      lastDeltaAtMs.value = null;
      if (silent && isGatewayPushDebugEnabled()) {
        logGatewayPush("loadHistory(silent) 完成", {
          sessionKey: key,
          incomingCount: incoming.length,
          mergedCount: messages.value.length,
        });
      }
    } catch (e) {
      lastError.value = describeGatewayError(e);
      logGatewayPush("loadHistory 失败", {
        silent,
        sessionKey: key,
        error: describeGatewayError(e),
      });
    } finally {
      if (!silent) {
        historyLoading.value = false;
      }
    }
  }

  /**
   * 实测部分网关版本在定时任务 / 后台 run 时大量推送 `cron` 与 `agent`，却**不一定**下发 `chat`。
   * 仅靠 `handleGatewayEvent(chat)` 时主时间线不会实时更新；在**本机未在发送且未有 runId** 时节流拉
   * `chat.history` 与 transcript 对齐（与重连后行为一致）。
   */
  const GATEWAY_CHAT_SYNC_DEBOUNCE_MS = 1500;
  let gatewayChatSyncTimer: number | null = null;

  function scheduleDebouncedSilentHistoryFromGateway(source: string): void {
    if (gatewayChatSyncTimer !== null) {
      clearTimeout(gatewayChatSyncTimer);
    }
    gatewayChatSyncTimer = window.setTimeout(() => {
      gatewayChatSyncTimer = null;
      if (sending.value || runId.value != null) {
        markPendingSilentHistorySync(source);
        logGatewayPush("cron/agent → debounced loadHistory 跳过（本机发送或流式 runId 占用）", {
          source,
        });
        return;
      }
      logGatewayPush("cron/agent → debounced loadHistory(silent)", { source });
      void loadHistory({ silent: true });
    }, GATEWAY_CHAT_SYNC_DEBOUNCE_MS);
  }

  async function sendMessage(): Promise<void> {
    const gw = useGatewayStore();
    const c = gw.client;
    const session = useSessionStore();
    const key = session.activeSessionKey;
    const text = draft.value.trim();
    const queueSnapshot = pendingComposerFiles.value.slice();
    const sendQueue = queueSnapshot.filter((p) => p.includeInSend);
    if (!c?.connected || !key || sending.value || runId.value != null) {
      return;
    }
    if (!text && sendQueue.length === 0) {
      return;
    }

    const attachmentsPayload: GatewayChatAttachmentPayload[] = [];
    try {
      for (const p of sendQueue) {
        if (p.file.type.startsWith("image/")) {
          attachmentsPayload.push(await buildImageAttachmentPayload(p.file));
        }
      }
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e);
      return;
    }

    const nonImages = sendQueue.filter((p) => !p.file.type.startsWith("image/"));
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
    const t0 = Date.now();
    runId.value = idem;
    runStartedAtMs.value = t0;
    lastDeltaAtMs.value = null;
    streamText.value = null;
    draft.value = "";

    const optimisticParts: string[] = [];
    if (text) {
      optimisticParts.push(text);
    } else if (attachmentsPayload.length > 0) {
      optimisticParts.push("（图片附件）");
    }
    for (const p of sendQueue) {
      optimisticParts.push(`📎${p.file.name}`);
    }
    const optimisticText = optimisticParts.length > 0 ? optimisticParts.join(" ") : "（附件）";

    const optimistic: OptimisticUserMessage = {
      role: "user",
      text: optimisticText,
      timestamp: t0,
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
      removeIncludedPendingFiles();
    } catch (e) {
      messages.value = messages.value.filter(
        (m) => !isOptimisticUserMessage(m) || m[CHAT_OPTIMISTIC_KEY] !== idem,
      );
      runId.value = null;
      streamText.value = null;
      runStartedAtMs.value = null;
      lastDeltaAtMs.value = null;
      lastError.value = describeGatewayError(e);
    } finally {
      sending.value = false;
      flushPendingSilentHistorySync("sendMessage.finally");
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
    clearRunTiming();
  }

  function clearRunTiming(): void {
    runStartedAtMs.value = null;
    lastDeltaAtMs.value = null;
  }

  /** 正常结束一轮时记录耗时（中断 / error 不写入，避免误显示「上一轮」） */
  function snapshotRunDuration(): void {
    const start = runStartedAtMs.value;
    if (start != null) {
      lastCompletedRunDurationMs.value = Date.now() - start;
      lastCompletedRunAtMs.value = Date.now();
    } else {
      // start was lost (e.g. externally triggered run); clear stale data so the
      // old "Done · X.Xs" doesn't re-appear from a previous run.
      lastCompletedRunDurationMs.value = null;
      lastCompletedRunAtMs.value = null;
    }
    clearRunTiming();
  }

  /**
   * `chat` 事件载荷若因网关新增字段/状态未入 Zod 枚举而解析失败，仍可能对当前会话有新消息
   *（例如主会话 systemEvent / 定时任务）。对**当前选中会话**节流拉 `chat.history`，避免只靠重连。
   */
  let lastChatHistoryFallbackMs = 0;
  function scheduleHistoryReloadForUnparsedChatEvent(raw: unknown, hint: string): void {
    const p = raw as { sessionKey?: unknown };
    const key = typeof p.sessionKey === "string" ? p.sessionKey : null;
    const sessionStore = useSessionStore();
    const active = sessionStore.activeSessionKey;
    if (!key) {
      logGatewayPush("chat schema miss: 无 sessionKey，跳过 history 兜底", { hint });
      return;
    }
    if (key !== active) {
      logGatewayPush("chat schema miss: sessionKey≠当前选中，跳过 history 兜底", {
        hint,
        eventSessionKey: key,
        activeSessionKey: active,
      });
      return;
    }
    const now = Date.now();
    if (now - lastChatHistoryFallbackMs < 900) {
      logGatewayPush("chat schema miss: 兜底 loadHistory 节流中，跳过", { hint, msSinceLast: now - lastChatHistoryFallbackMs });
      return;
    }
    lastChatHistoryFallbackMs = now;
    console.warn("[didclaw] chat event payload skipped by schema, history fallback:", hint);
    logGatewayPush("chat schema miss → loadHistory(silent)", { hint, sessionKey: key });
    void loadHistory({ silent: true });
  }

  /** 非当前会话的 chat 事件：节流刷新会话列表（例如定时任务新建的隔离会话） */
  let lastSessionsRefreshForOtherSessionMs = 0;
  function scheduleSessionsListRefreshForOtherSession(): void {
    const now = Date.now();
    if (now - lastSessionsRefreshForOtherSessionMs < 1500) {
      return;
    }
    lastSessionsRefreshForOtherSessionMs = now;
    void useSessionStore().refresh();
  }

  /**
   * 网关下行 chat 事件：仅当 `sessionKey` 与当前选中会话一致时更新流式与历史。
   * 定时任务等在**其它会话**运行时，若本机输入区空闲则自动切换到该会话并展示；否则节流刷新侧栏列表。
   */
  function handleGatewayEvent(evt: GatewayEventFrame): void {
    if (evt.event !== "chat") {
      return;
    }
    if (isGatewayPushDebugEnabled()) {
      const sessionStore = useSessionStore();
      logGatewayPush("chat.handle 收到", {
        ...summarizeChatEventPayload(evt.payload),
        activeSessionKey: sessionStore.activeSessionKey,
        localRunId: runId.value ?? null,
        sending: sending.value,
        streamTextLen: streamText.value ? String(streamText.value).length : 0,
      });
    }
    const parsed = chatEventPayloadSchema.safeParse(evt.payload);
    if (!parsed.success) {
      if (import.meta.env.DEV) {
        console.warn("[didclaw] chat event payload invalid:", formatZodIssues(parsed.error));
      }
      scheduleHistoryReloadForUnparsedChatEvent(evt.payload, formatZodIssues(parsed.error));
      return;
    }
    const payload = parsed.data;

    (async () => {
      const sessionStore = useSessionStore();
      const activeKey = sessionStore.activeSessionKey;
      if (payload.sessionKey !== activeKey) {
        const composerIdle =
          !sending.value &&
          runId.value == null &&
          (streamText.value == null || !String(streamText.value).trim());
        const shouldFollow =
          composerIdle &&
          (payload.state === "delta" ||
            payload.state === "final" ||
            payload.state === "aborted" ||
            payload.state === "error");
        logGatewayPush("chat.handle 会话不一致", {
          eventSessionKey: payload.sessionKey,
          activeSessionKey: activeKey,
          state: payload.state,
          composerIdle,
          shouldFollow,
          action: shouldFollow ? "selectSession → 继续处理" : "仅 sessions.refresh（可能丢弃本条 UI 更新）",
        });
        if (shouldFollow) {
          await sessionStore.selectSession(payload.sessionKey);
        } else {
          scheduleSessionsListRefreshForOtherSession();
        }
        if (payload.sessionKey !== useSessionStore().activeSessionKey) {
          logGatewayPush("chat.handle 会话仍不一致，结束（未更新当前聊天区）", {
            eventSessionKey: payload.sessionKey,
            activeAfter: useSessionStore().activeSessionKey,
          });
          return;
        }
      }

      if (payload.state === "delta") {
        logGatewayPush("chat.handle → delta", { runId: payload.runId ?? null });
        lastDeltaAtMs.value = Date.now();
        if (payload.runId) {
          runId.value = payload.runId;
        }
        // 用户切换到正在运行的后台会话时，runStartedAtMs 会因 loadHistory 而清空；
        // 首个到达的 delta 补设起始时间，使计时器能够正常显示
        if (runStartedAtMs.value == null) {
          runStartedAtMs.value = Date.now();
        }
        const chunk = extractChatDeltaText(payload as Record<string, unknown>);
        if (chunk) {
          streamText.value = mergeAssistantStreamDelta(streamText.value, chunk);
        } else {
          logGatewayPush("chat.handle delta 无文本 chunk（可能仅结构化 message）", {
            runId: payload.runId ?? null,
          });
        }
      } else if (payload.state === "final") {
        logGatewayPush("chat.handle → final → loadHistory(silent)", {
          runId: payload.runId ?? null,
          localRunIdBefore: runId.value,
        });
        snapshotRunDuration();
        streamText.value = null;
        runId.value = null;
        clearPendingSilentHistorySync();
        void loadHistory({ silent: true });
      } else if (payload.state === "aborted") {
        logGatewayPush("chat.handle → aborted → loadHistory(silent)", { runId: payload.runId ?? null });
        clearRunTiming();
        streamText.value = null;
        runId.value = null;
        clearPendingSilentHistorySync();
        void loadHistory({ silent: true });
      } else if (payload.state === "error") {
        logGatewayPush("chat.handle → error", {
          runId: payload.runId ?? null,
          errorMessage: payload.errorMessage ?? null,
        });
        clearRunTiming();
        streamText.value = null;
        runId.value = null;
        lastError.value = payload.errorMessage?.trim() || "对话出错（网关返回 error 状态）";
        flushPendingSilentHistorySync("chat.error");
      }
    })().catch((e) => {
      console.error("[didclaw] handleGatewayEvent async error", e);
    });
  }

  return {
    messages,
    historyLoading,
    sending,
    streamText,
    runId,
    runStartedAtMs,
    lastDeltaAtMs,
    lastCompletedRunDurationMs,
    lastCompletedRunAtMs,
    agentBusy,
    composerPhase,
    draft,
    lastError,
    pendingComposerFiles,
    addPendingComposerFiles,
    setPendingIncludeInSend,
    removePendingComposerFile,
    clearPendingComposerFiles,
    loadHistory,
    sendMessage,
    abortIfStreaming,
    handleGatewayEvent,
    scheduleDebouncedSilentHistoryFromGateway,
    openClawPrimaryModel,
    openClawModelPickerRows,
    openClawPrimaryBusy,
    openClawPrimaryPickerError,
    refreshOpenClawModelPicker,
    setOpenClawPrimaryModel,
    openClawConfigHint,
    flashOpenClawConfigHint,
    backgroundAgentLastSeenMs,
    backgroundAgentSessionKey,
    flashingSessionKeys,
    noteBackgroundAgentActivity,
  };
});
