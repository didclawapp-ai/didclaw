import type { GatewayEventFrame } from "@/features/gateway/gateway-types";
import { chatEventPayloadSchema, chatHistoryResponseSchema } from "@/features/gateway/schemas";
import {
  appendLocalAttachmentPathsToMessage,
  buildImageAttachmentPayload,
  NotChatImageAttachmentError,
  type GatewayChatAttachmentPayload,
} from "@/lib/chat-attachment-encode";
import {
  CHAT_OPTIMISTIC_KEY,
  type GatewayChatMessage,
  type OptimisticUserMessage,
  type UiChatMessage,
  isOptimisticUserMessage,
} from "@/lib/chat-messages";
import { CHAT_HISTORY_LIMIT } from "@/lib/chat-history-config";
import { sortHistoryMessagesOldestFirst } from "@/lib/chat-history-sort";
import { messageToChatLine } from "@/lib/chat-line";
import { isOpenClawSessionBootstrapInjection } from "@/lib/chat-message-format";
import { getOpenClawAfterWriteHint } from "@/lib/openclaw-config-hint";
import { buildModelPickerRows, readOpenClawAiSnapshot } from "@/lib/openclaw-ai-config";
import { describeOpenClawPrimaryModelIncompatibility } from "@/lib/openclaw-model-guards";
import { getDidClawDesktopApi, isDidClawElectron } from "@/lib/electron-bridge";
import {
  isGatewayPushDebugEnabled,
  logGatewayPush,
  summarizeChatEventPayload,
} from "@/lib/gateway-debug-log";
import { describeGatewayError } from "@/lib/gateway-errors";
import { logSwallowedError } from "@/lib/client-dev-log";
import { createMinIntervalThrottle } from "@/lib/min-interval-throttle";
import { extractChatDeltaText, mergeAssistantStreamDelta } from "@/lib/message-display";
import { formatZodIssues } from "@/lib/zod-format";
import { generateUUID } from "@/lib/uuid";
import { i18n } from "@/i18n";
import { defineStore } from "pinia";
import { computed, nextTick, reactive, ref } from "vue";
import { useCompanyRolePanelsStore } from "./companyRolePanels";
import { useGatewayStore } from "./gateway";
import { useLiveEditStore } from "./liveEdit";
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

/** 每个 sessionKey 一条聊天表面（主会话 + 职务面板共享 GatewayClient） */
export type ChatSurfaceState = {
  messages: UiChatMessage[];
  historyLoading: boolean;
  sending: boolean;
  streamText: string | null;
  runId: string | null;
  draft: string;
  lastError: string | null;
  pendingComposerFiles: PendingComposerFile[];
  runStartedAtMs: number | null;
  lastDeltaAtMs: number | null;
  lastCompletedRunDurationMs: number | null;
  lastCompletedRunAtMs: number | null;
  pendingSilentHistorySource: string | null;
};

function createEmptyChatSurface(): ChatSurfaceState {
  return {
    messages: [],
    historyLoading: false,
    sending: false,
    streamText: null,
    runId: null,
    draft: "",
    lastError: null,
    pendingComposerFiles: [],
    runStartedAtMs: null,
    lastDeltaAtMs: null,
    lastCompletedRunDurationMs: null,
    lastCompletedRunAtMs: null,
    pendingSilentHistorySource: null,
  };
}

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
  const surfaces = reactive<Record<string, ChatSurfaceState>>({});

  function ensureSurface(sessionKey: string): ChatSurfaceState {
    if (!surfaces[sessionKey]) {
      surfaces[sessionKey] = createEmptyChatSurface();
    }
    return surfaces[sessionKey];
  }

  function getActiveSurface(): ChatSurfaceState | null {
    const k = useSessionStore().activeSessionKey;
    if (!k) {
      return null;
    }
    return ensureSurface(k);
  }

  function trackedSessionKeys(): Set<string> {
    const set = new Set<string>();
    const sk = useSessionStore().activeSessionKey;
    if (sk) {
      set.add(sk);
    }
    for (const p of useCompanyRolePanelsStore().panels) {
      set.add(p.sessionKey);
    }
    return set;
  }

  const messages = computed({
    get: (): UiChatMessage[] => getActiveSurface()?.messages ?? [],
    set: (v: UiChatMessage[]) => {
      const s = getActiveSurface();
      if (s) {
        s.messages = v;
      }
    },
  });
  const historyLoading = computed({
    get: () => getActiveSurface()?.historyLoading ?? false,
    set: (v: boolean) => {
      const s = getActiveSurface();
      if (s) {
        s.historyLoading = v;
      }
    },
  });
  const sending = computed({
    get: () => getActiveSurface()?.sending ?? false,
    set: (v: boolean) => {
      const s = getActiveSurface();
      if (s) {
        s.sending = v;
      }
    },
  });
  const streamText = computed({
    get: () => getActiveSurface()?.streamText ?? null,
    set: (v: string | null) => {
      const s = getActiveSurface();
      if (s) {
        s.streamText = v;
      }
    },
  });
  const runId = computed({
    get: () => getActiveSurface()?.runId ?? null,
    set: (v: string | null) => {
      const s = getActiveSurface();
      if (s) {
        s.runId = v;
      }
    },
  });
  const draft = computed({
    get: () => getActiveSurface()?.draft ?? "",
    set: (v: string) => {
      const s = getActiveSurface();
      if (s) {
        s.draft = v;
      }
    },
  });
  const lastError = computed({
    get: () => getActiveSurface()?.lastError ?? null,
    set: (v: string | null) => {
      const s = getActiveSurface();
      if (s) {
        s.lastError = v;
      }
    },
  });
  const pendingComposerFiles = computed({
    get: () => getActiveSurface()?.pendingComposerFiles ?? [],
    set: (v: PendingComposerFile[]) => {
      const s = getActiveSurface();
      if (s) {
        s.pendingComposerFiles = v;
      }
    },
  });
  const runStartedAtMs = computed({
    get: () => getActiveSurface()?.runStartedAtMs ?? null,
    set: (v: number | null) => {
      const s = getActiveSurface();
      if (s) {
        s.runStartedAtMs = v;
      }
    },
  });
  const lastDeltaAtMs = computed({
    get: () => getActiveSurface()?.lastDeltaAtMs ?? null,
    set: (v: number | null) => {
      const s = getActiveSurface();
      if (s) {
        s.lastDeltaAtMs = v;
      }
    },
  });
  const lastCompletedRunDurationMs = computed({
    get: () => getActiveSurface()?.lastCompletedRunDurationMs ?? null,
    set: (v: number | null) => {
      const s = getActiveSurface();
      if (s) {
        s.lastCompletedRunDurationMs = v;
      }
    },
  });
  const lastCompletedRunAtMs = computed({
    get: () => getActiveSurface()?.lastCompletedRunAtMs ?? null,
    set: (v: number | null) => {
      const s = getActiveSurface();
      if (s) {
        s.lastCompletedRunAtMs = v;
      }
    },
  });

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
  /** Short notice after /new, +New, or when history shows a session-rotation bootstrap line */
  const sessionListNotice = ref<string | null>(null);
  let sessionListNoticeTimer: number | null = null;

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

  const agentBusy = computed(() => {
    const s = getActiveSurface();
    return s ? s.sending || s.runId != null : false;
  });

  function getComposerPhaseFor(sessionKey: string): "idle" | "sending" | "streaming" | "waiting" {
    const s = surfaces[sessionKey];
    if (!s) {
      return "idle";
    }
    if (s.sending) {
      return "sending";
    }
    if (s.runId == null) {
      return "idle";
    }
    const hasText = Boolean(s.streamText?.trim());
    if (hasText) {
      return "streaming";
    }
    return "waiting";
  }

  function flashOpenClawConfigHint(message?: string): void {
    openClawConfigHint.value = message ?? getOpenClawAfterWriteHint();
    if (openClawConfigHintTimer != null) {
      clearTimeout(openClawConfigHintTimer);
    }
    openClawConfigHintTimer = window.setTimeout(() => {
      openClawConfigHint.value = null;
      openClawConfigHintTimer = null;
    }, 14000);
  }

  function flashSessionListNotice(message?: string): void {
    sessionListNotice.value = message ?? i18n.global.t("sessionBar.sessionListNotice");
    if (sessionListNoticeTimer != null) {
      clearTimeout(sessionListNoticeTimer);
    }
    sessionListNoticeTimer = window.setTimeout(() => {
      sessionListNotice.value = null;
      sessionListNoticeTimer = null;
    }, 12000);
  }

  function uiMessagePlainTextForBootstrap(m: UiChatMessage): string {
    if (isOptimisticUserMessage(m)) {
      return m.text;
    }
    const o = m as Record<string, unknown>;
    if (typeof o.text === "string") {
      return o.text;
    }
    if (Array.isArray(o.content)) {
      return (o.content as Array<Record<string, unknown>>)
        .map((p) => (p?.type === "text" && typeof p.text === "string" ? p.text : ""))
        .join("");
    }
    return "";
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
    if (!isDidClawElectron()) {
      openClawPrimaryModel.value = "";
      openClawModelPickerRows.value = [];
      return;
    }
    try {
      const snapshot = await readOpenClawAiSnapshot();
      openClawPrimaryModel.value = snapshot.primaryModel;
      openClawModelPickerRows.value = buildModelPickerRows(snapshot);
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
  function removeIncludedPendingFilesForSurface(surf: ChatSurfaceState): void {
    const next: PendingComposerFile[] = [];
    for (const p of surf.pendingComposerFiles) {
      if (p.includeInSend) {
        URL.revokeObjectURL(p.objectUrl);
      } else {
        next.push(p);
      }
    }
    surf.pendingComposerFiles = next;
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

  function markPendingSilentHistorySync(source: string, sessionKey?: string): void {
    const k = sessionKey ?? useSessionStore().activeSessionKey;
    if (!k) {
      return;
    }
    ensureSurface(k).pendingSilentHistorySource = source;
  }

  function clearPendingSilentHistorySync(sessionKey?: string): void {
    const k = sessionKey ?? useSessionStore().activeSessionKey;
    if (!k) {
      return;
    }
    const surf = surfaces[k];
    if (surf) {
      surf.pendingSilentHistorySource = null;
    }
  }

  function flushPendingSilentHistorySync(reason: string, sessionKey?: string): void {
    const k = sessionKey ?? useSessionStore().activeSessionKey;
    if (!k) {
      return;
    }
    const surf = surfaces[k];
    if (!surf) {
      return;
    }
    const source = surf.pendingSilentHistorySource;
    if (!source || surf.sending || surf.runId != null) {
      return;
    }
    surf.pendingSilentHistorySource = null;
    logGatewayPush("pending history sync → loadHistory(silent)", {
      source,
      reason,
      sessionKey: k,
    });
    void loadHistory({ silent: true, sessionKey: k });
  }

  async function loadHistory(opts?: { silent?: boolean; sessionKey?: string }): Promise<void> {
    const silent = opts?.silent === true;
    const gw = useGatewayStore();
    const c = gw.client;
    const session = useSessionStore();
    const key = opts?.sessionKey ?? session.activeSessionKey;
    if (!key) {
      logGatewayPush("loadHistory 跳过（无 sessionKey）", { silent });
      return;
    }
    const surf = ensureSurface(key);
    // Silent background syncs (e.g. from sessions.changed) must not interrupt
    // an active streaming run — the final handler will reload history anyway.
    if (silent && (surf.sending || surf.runId != null)) {
      markPendingSilentHistorySync("loadHistory-silent", key);
      return;
    }
    if (!c?.connected) {
      logGatewayPush("loadHistory 跳过（未连接或无当前会话）", {
        silent,
        connected: !!c?.connected,
        sessionKey: key,
      });
      surf.messages = [];
      surf.streamText = null;
      surf.runId = null;
      surf.runStartedAtMs = null;
      surf.lastDeltaAtMs = null;
      return;
    }
    if (silent && isGatewayPushDebugEnabled()) {
      logGatewayPush("loadHistory(silent) 请求 chat.history", { sessionKey: key, limit: CHAT_HISTORY_LIMIT });
    }
    if (!silent) {
      surf.historyLoading = true;
    }
    surf.lastError = null;
    try {
      const res = await c.request<unknown>("chat.history", {
        sessionKey: key,
        limit: CHAT_HISTORY_LIMIT,
      });
      const parsed = chatHistoryResponseSchema.safeParse(res);
      if (!parsed.success) {
        surf.lastError = `历史消息格式异常：${formatZodIssues(parsed.error)}`;
        surf.messages = [];
        surf.streamText = null;
        surf.runId = null;
        surf.runStartedAtMs = null;
        surf.lastDeltaAtMs = null;
        return;
      }
      const msgs = parsed.data.messages;
      const raw = (Array.isArray(msgs) ? msgs : []) as GatewayChatMessage[];
      const incoming = sortHistoryMessagesOldestFirst(raw);
      const previous = surf.messages;
      surf.messages = mergeIncomingHistoryWithOptimistics(incoming, previous);
      surf.streamText = null;
      surf.runId = null;
      surf.runStartedAtMs = null;
      surf.lastDeltaAtMs = null;
      if (!silent) {
        const rotated = surf.messages.some((m) =>
          isOpenClawSessionBootstrapInjection(uiMessagePlainTextForBootstrap(m)),
        );
        if (rotated) {
          void session.refresh();
        }
      }
      if (silent && isGatewayPushDebugEnabled()) {
        logGatewayPush("loadHistory(silent) 完成", {
          sessionKey: key,
          incomingCount: incoming.length,
          mergedCount: surf.messages.length,
        });
      }
    } catch (e) {
      surf.lastError = describeGatewayError(e);
      logGatewayPush("loadHistory 失败", {
        silent,
        sessionKey: key,
        error: describeGatewayError(e),
      });
    } finally {
      if (!silent) {
        surf.historyLoading = false;
      }
    }
  }

  /**
   * 实测部分网关版本在定时任务 / 后台 run 时大量推送 `cron` 与 `agent`，却**不一定**下发 `chat`。
   * 仅靠 `handleGatewayEvent(chat)` 时主时间线不会实时更新；在**本机未在发送且未有 runId** 时节流拉
   * `chat.history` 与 transcript 对齐（与重连后行为一致）。
   */
  const GATEWAY_CHAT_SYNC_DEBOUNCE_MS = 1500;
  const gatewayChatSyncTimers: Record<string, number> = {};
  const throttleUnparsedHistoryFallback = createMinIntervalThrottle(900);
  const throttleSessionsRefreshOther = createMinIntervalThrottle(1500);

  function scheduleDebouncedSilentHistoryForSession(sessionKey: string, source: string): void {
    const prev = gatewayChatSyncTimers[sessionKey];
    if (prev != null) {
      clearTimeout(prev);
    }
    gatewayChatSyncTimers[sessionKey] = window.setTimeout(() => {
      delete gatewayChatSyncTimers[sessionKey];
      const surf = surfaces[sessionKey];
      if (!surf) {
        return;
      }
      if (surf.sending || surf.runId != null) {
        markPendingSilentHistorySync(source, sessionKey);
        logGatewayPush("cron/agent → debounced loadHistory 跳过（本机发送或流式 runId 占用）", {
          source,
          sessionKey,
        });
        return;
      }
      logGatewayPush("cron/agent → debounced loadHistory(silent)", { source, sessionKey });
      void loadHistory({ silent: true, sessionKey });
    }, GATEWAY_CHAT_SYNC_DEBOUNCE_MS);
  }

  function scheduleDebouncedSilentHistoryFromGateway(source: string): void {
    const k = useSessionStore().activeSessionKey;
    if (!k) {
      return;
    }
    scheduleDebouncedSilentHistoryForSession(k, source);
  }

  async function sendMessageForSession(sessionKey: string): Promise<void> {
    const gw = useGatewayStore();
    const c = gw.client;
    const session = useSessionStore();
    const key = sessionKey.trim();
    const surf = ensureSurface(key);
    const text = surf.draft.trim();
    const queueSnapshot = surf.pendingComposerFiles.slice();
    const sendQueue = queueSnapshot.filter((p) => p.includeInSend);
    if (!c?.connected || !key || surf.sending || surf.runId != null) {
      return;
    }
    if (!text && sendQueue.length === 0) {
      return;
    }

    const attachmentsPayload: GatewayChatAttachmentPayload[] = [];
    const nonImages: PendingComposerFile[] = [];
    for (const p of sendQueue) {
      try {
        attachmentsPayload.push(await buildImageAttachmentPayload(p.file));
      } catch (e) {
        if (e instanceof NotChatImageAttachmentError) {
          nonImages.push(p);
        } else {
          surf.lastError = e instanceof Error ? e.message : String(e);
          return;
        }
      }
    }
    let message = text;
    if (nonImages.length > 0) {
      const intro = i18n.global.t("composer.nonImageAttachIntro");
      const lines = nonImages
        .map((x) =>
          i18n.global.t("composer.nonImageAttachLine", {
            name: x.file.name,
            type: x.file.type || i18n.global.t("composer.unknownFileType"),
          }),
        )
        .join("\n");
      const block = `${intro}\n${lines}`;
      message = message ? `${message}\n\n---\n${block}` : `---\n${block}`;
    }

    if (!message.trim() && attachmentsPayload.length > 0) {
      message = "（图片附件）";
    }
    message = appendLocalAttachmentPathsToMessage(message, attachmentsPayload);
    if (!message.trim()) {
      return;
    }

    surf.sending = true;
    surf.lastError = null;
    const idem = generateUUID();
    const t0 = Date.now();
    surf.runId = idem;
    surf.runStartedAtMs = t0;
    surf.lastDeltaAtMs = null;
    surf.streamText = null;
    surf.draft = "";

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
    surf.messages = [...surf.messages, optimistic];
    if (key === session.activeSessionKey) {
      usePreviewStore().setFollowLatest(true);
    }
    await nextTick();
    try {
      await c.request("chat.send", {
        sessionKey: key,
        message,
        deliver: false,
        idempotencyKey: idem,
        ...(attachmentsPayload.length > 0 ? { attachments: attachmentsPayload } : {}),
      });
      removeIncludedPendingFilesForSurface(surf);
      const slashHead = text.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
      if (slashHead === "/new" || slashHead === "/reset") {
        void session.refresh();
        flashSessionListNotice();
      }
    } catch (e) {
      surf.messages = surf.messages.filter(
        (m) => !isOptimisticUserMessage(m) || m[CHAT_OPTIMISTIC_KEY] !== idem,
      );
      surf.runId = null;
      surf.streamText = null;
      surf.runStartedAtMs = null;
      surf.lastDeltaAtMs = null;
      surf.lastError = describeGatewayError(e);
    } finally {
      surf.sending = false;
      flushPendingSilentHistorySync("sendMessage.finally", key);
    }
  }

  async function sendMessage(): Promise<void> {
    const k = useSessionStore().activeSessionKey;
    if (!k) {
      return;
    }
    await sendMessageForSession(k);
  }

  async function abortIfStreaming(opts?: { sessionKey?: string }): Promise<void> {
    const gw = useGatewayStore();
    const c = gw.client;
    const session = useSessionStore();
    const key = opts?.sessionKey ?? session.activeSessionKey;
    if (!c?.connected || !key) {
      return;
    }
    const surf = ensureSurface(key);
    try {
      await c.request(
        "chat.abort",
        surf.runId ? { sessionKey: key, runId: surf.runId } : { sessionKey: key },
      );
    } catch (e) {
      logSwallowedError("chat.abortIfStreaming", e);
    }
    surf.streamText = null;
    surf.runId = null;
    surf.runStartedAtMs = null;
    surf.lastDeltaAtMs = null;
  }

  function clearRunTiming(): void {
    const surf = getActiveSurface();
    if (surf) {
      surf.runStartedAtMs = null;
      surf.lastDeltaAtMs = null;
    }
  }

  function snapshotRunDurationForSurface(surf: ChatSurfaceState): void {
    const start = surf.runStartedAtMs;
    if (start != null) {
      surf.lastCompletedRunDurationMs = Date.now() - start;
      surf.lastCompletedRunAtMs = Date.now();
    } else {
      surf.lastCompletedRunDurationMs = null;
      surf.lastCompletedRunAtMs = null;
    }
    surf.runStartedAtMs = null;
    surf.lastDeltaAtMs = null;
  }

  /** 正常结束一轮时记录耗时（中断 / error 不写入，避免误显示「上一轮」） */
  function snapshotRunDuration(): void {
    const surf = getActiveSurface();
    if (surf) {
      snapshotRunDurationForSurface(surf);
    }
  }

  /**
   * `chat` 事件载荷若因网关新增字段/状态未入 Zod 枚举而解析失败，仍可能对当前会话有新消息
   *（例如主会话 systemEvent / 定时任务）。对**当前选中会话**节流拉 `chat.history`，避免只靠重连。
   */
  function scheduleHistoryReloadForUnparsedChatEvent(raw: unknown, hint: string): void {
    const p = raw as { sessionKey?: unknown };
    const key = typeof p.sessionKey === "string" ? p.sessionKey : null;
    const sessionStore = useSessionStore();
    const active = sessionStore.activeSessionKey;
    if (!key) {
      logGatewayPush("chat schema miss: 无 sessionKey，跳过 history 兜底", { hint });
      return;
    }
    const tracked = trackedSessionKeys();
    if (!tracked.has(key)) {
      logGatewayPush("chat schema miss: sessionKey 非主会话且未打开职务面板，跳过 history 兜底", {
        hint,
        eventSessionKey: key,
        activeSessionKey: active,
      });
      return;
    }
    const throttled = throttleUnparsedHistoryFallback();
    if (!throttled.ok) {
      logGatewayPush("chat schema miss: 兜底 loadHistory 节流中，跳过", {
        hint,
        msSinceLast: throttled.msSinceLast,
      });
      return;
    }
    console.warn("[didclaw] chat event payload skipped by schema, history fallback:", hint);
    logGatewayPush("chat schema miss → loadHistory(silent)", { hint, sessionKey: key });
    void loadHistory({ silent: true, sessionKey: key });
  }

  /** 非当前会话的 chat 事件：节流刷新会话列表（例如定时任务新建的隔离会话） */
  function scheduleSessionsListRefreshForOtherSession(): void {
    if (!throttleSessionsRefreshOther().ok) {
      return;
    }
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

    async function processChatGatewayEventPayload(): Promise<void> {
      const sessionStore = useSessionStore();
      const activeKey = sessionStore.activeSessionKey;
      const eventKey = payload.sessionKey;
      const tracked = trackedSessionKeys();

      if (tracked.has(eventKey)) {
        const surf = ensureSurface(eventKey);
        const useLiveEdit = eventKey === activeKey;
        if (payload.state === "delta") {
          logGatewayPush("chat.handle → delta", { runId: payload.runId ?? null, trackedPanel: !useLiveEdit });
          surf.lastDeltaAtMs = Date.now();
          if (payload.runId) {
            surf.runId = payload.runId;
          }
          if (surf.runStartedAtMs == null) {
            surf.runStartedAtMs = Date.now();
          }
          const chunk = extractChatDeltaText(payload as Record<string, unknown>);
          if (chunk) {
            surf.streamText = mergeAssistantStreamDelta(surf.streamText, chunk);
            if (useLiveEdit) {
              useLiveEditStore().ingestStreamingSnapshot(surf.streamText);
            }
          } else {
            logGatewayPush("chat.handle delta 无文本 chunk（可能仅结构化 message）", {
              runId: payload.runId ?? null,
            });
          }
        } else if (payload.state === "final") {
          logGatewayPush("chat.handle → final → loadHistory(silent)", {
            runId: payload.runId ?? null,
            localRunIdBefore: surf.runId,
          });
          snapshotRunDurationForSurface(surf);
          const streamSnap = surf.streamText;
          if (useLiveEdit) {
            useLiveEditStore().ingestFinishedAssistantStream(streamSnap);
          }
          surf.streamText = null;
          surf.runId = null;
          clearPendingSilentHistorySync(eventKey);
          void loadHistory({ silent: true, sessionKey: eventKey });
        } else if (payload.state === "aborted") {
          logGatewayPush("chat.handle → aborted → loadHistory(silent)", { runId: payload.runId ?? null });
          surf.runStartedAtMs = null;
          surf.lastDeltaAtMs = null;
          if (useLiveEdit) {
            useLiveEditStore().ingestFinishedAssistantStream(surf.streamText);
          }
          surf.streamText = null;
          surf.runId = null;
          clearPendingSilentHistorySync(eventKey);
          void loadHistory({ silent: true, sessionKey: eventKey });
        } else if (payload.state === "error") {
          logGatewayPush("chat.handle → error", {
            runId: payload.runId ?? null,
            errorMessage: payload.errorMessage ?? null,
          });
          surf.runStartedAtMs = null;
          surf.lastDeltaAtMs = null;
          if (useLiveEdit) {
            useLiveEditStore().ingestFinishedAssistantStream(surf.streamText);
          }
          surf.streamText = null;
          surf.runId = null;
          surf.lastError =
            payload.errorMessage?.trim() || i18n.global.t("composer.gatewayChatErrorFallback");
          flushPendingSilentHistorySync("chat.error", eventKey);
        }
        return;
      }

      if (eventKey !== activeKey) {
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
        if (runStartedAtMs.value == null) {
          runStartedAtMs.value = Date.now();
        }
        const chunk = extractChatDeltaText(payload as Record<string, unknown>);
        if (chunk) {
          streamText.value = mergeAssistantStreamDelta(streamText.value, chunk);
          useLiveEditStore().ingestStreamingSnapshot(streamText.value);
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
        const streamSnap = streamText.value;
        useLiveEditStore().ingestFinishedAssistantStream(streamSnap);
        streamText.value = null;
        runId.value = null;
        clearPendingSilentHistorySync();
        void loadHistory({ silent: true });
      } else if (payload.state === "aborted") {
        logGatewayPush("chat.handle → aborted → loadHistory(silent)", { runId: payload.runId ?? null });
        clearRunTiming();
        useLiveEditStore().ingestFinishedAssistantStream(streamText.value);
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
        useLiveEditStore().ingestFinishedAssistantStream(streamText.value);
        streamText.value = null;
        runId.value = null;
        lastError.value =
          payload.errorMessage?.trim() || i18n.global.t("composer.gatewayChatErrorFallback");
        flushPendingSilentHistorySync("chat.error");
      }
    }

    void processChatGatewayEventPayload().catch((e) => {
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
    sendMessageForSession,
    surfaces,
    ensureSurface,
    getComposerPhaseFor,
    abortIfStreaming,
    handleGatewayEvent,
    scheduleDebouncedSilentHistoryFromGateway,
    scheduleDebouncedSilentHistoryForSession,
    openClawPrimaryModel,
    openClawModelPickerRows,
    openClawPrimaryBusy,
    openClawPrimaryPickerError,
    refreshOpenClawModelPicker,
    setOpenClawPrimaryModel,
    openClawConfigHint,
    flashOpenClawConfigHint,
    sessionListNotice,
    flashSessionListNotice,
    backgroundAgentLastSeenMs,
    backgroundAgentSessionKey,
    flashingSessionKeys,
    noteBackgroundAgentActivity,
  };
});
