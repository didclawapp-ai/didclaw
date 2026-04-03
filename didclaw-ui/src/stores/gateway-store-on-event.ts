import type { GatewayEventFrame } from "@/features/gateway/gateway-types";
import { i18n } from "@/i18n";
import {
  agentEventWarrantsChatHistorySync,
  isGatewayPushDebugEnabled,
  logGatewayPush,
  summarizeGatewayEvent,
} from "@/lib/gateway-debug-log";
import { parseExecApprovalRequestedPayload } from "./approval";

export type GatewayStoreOnEventDeps = {
  scheduleRefreshPendingBackendPairingRepair: (delayMs?: number) => void;
};

/**
 * 网关 WebSocket 下行事件分发（与 `gateway.ts` 内原 `onEvent` 一致）。
 * 独立文件以便阅读与单测接入，避免 `connect()` 单函数过长。
 */
export function dispatchGatewayStoreWebSocketEvent(
  evt: GatewayEventFrame,
  deps: GatewayStoreOnEventDeps,
): void {
  const { scheduleRefreshPendingBackendPairingRepair } = deps;

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
}
