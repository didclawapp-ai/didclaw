/**
 * 网关 WebSocket **下行事件**诊断日志（定时任务 / 主会话不实时刷新等排障）。
 *
 * - **开发构建**：默认开启（`import.meta.env.DEV`）。
 * - **生产 / Tauri**：在控制台执行后刷新：
 *   `localStorage.setItem("didclaw_debug_gateway", "1"); location.reload()`
 * - 关闭：`localStorage.removeItem("didclaw_debug_gateway"); location.reload()`
 * - **开发构建下想静音**：`localStorage.setItem("didclaw_debug_gateway", "0"); location.reload()`
 */

const STORAGE_KEY = "didclaw_debug_gateway";

export function isGatewayPushDebugEnabled(): boolean {
  try {
    if (typeof localStorage !== "undefined") {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === "0") {
        return false;
      }
      if (v === "1") {
        return true;
      }
    }
  } catch {
    /* ignore */
  }
  return import.meta.env.DEV;
}

const PREFIX = "[didclaw][gateway-push]";

export function logGatewayPush(message: string, detail?: Record<string, unknown>): void {
  if (!isGatewayPushDebugEnabled()) {
    return;
  }
  if (detail && Object.keys(detail).length > 0) {
    console.info(PREFIX, message, detail);
  } else {
    console.info(PREFIX, message);
  }
}

/** 避免把整段 message 打进控制台 */
export function summarizeChatEventPayload(payload: unknown): Record<string, unknown> {
  if (payload == null) {
    return { payload: String(payload) };
  }
  if (typeof payload !== "object" || Array.isArray(payload)) {
    return { type: typeof payload };
  }
  const p = payload as Record<string, unknown>;
  const msg = p.message;
  let messageHint: string | undefined;
  if (msg == null) {
    messageHint = undefined;
  } else if (typeof msg === "string") {
    messageHint = `string(${msg.length})`;
  } else if (typeof msg === "object") {
    messageHint = Array.isArray(msg) ? `array(${msg.length})` : "object";
  } else {
    messageHint = typeof msg;
  }
  return {
    sessionKey: p.sessionKey,
    state: p.state,
    runId: p.runId,
    message: messageHint,
    errorMessage:
      typeof p.errorMessage === "string"
        ? p.errorMessage.length > 120
          ? `${p.errorMessage.slice(0, 120)}…`
          : p.errorMessage
        : p.errorMessage,
  };
}

/**
 * `agent` 事件在工具调用过程中会高频下发（start/update）；只对「可能已写入 transcript」的时机触发
 * `chat.history`，减少请求与 incoming 条数抖动。非 `tool` 流（lifecycle / compaction 等）仍同步。
 */
export function agentEventWarrantsChatHistorySync(payload: unknown): boolean {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
    return true;
  }
  const p = payload as Record<string, unknown>;
  if (p.stream == null) {
    return true;
  }
  if (p.stream !== "tool") {
    return true;
  }
  const data = p.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return false;
  }
  const phase = (data as Record<string, unknown>).phase;
  return phase === "result";
}

export function summarizeGatewayEvent(evt: { event: string; seq?: number; payload?: unknown }): {
  event: string;
  seq: number | null;
  payload: Record<string, unknown>;
} {
  const seq = typeof evt.seq === "number" ? evt.seq : null;
  if (evt.event === "chat") {
    return { event: evt.event, seq, payload: summarizeChatEventPayload(evt.payload) };
  }
  if (evt.payload != null && typeof evt.payload === "object" && !Array.isArray(evt.payload)) {
    const keys = Object.keys(evt.payload as object);
    return {
      event: evt.event,
      seq,
      payload: { keys: keys.slice(0, 12), keyCount: keys.length },
    };
  }
  return { event: evt.event, seq, payload: { kind: typeof evt.payload } };
}
