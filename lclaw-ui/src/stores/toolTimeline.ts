import type { GatewayEventFrame } from "@/features/gateway/gateway-types";
import { defineStore } from "pinia";
import { ref } from "vue";
import { useSessionStore } from "./session";

export type ToolTimelineEntry = {
  id: string;
  at: number;
  event: string;
  summary: string;
  count: number;
  /** 网关载荷若带 runId 则写入，便于与当前回复轮次对齐 */
  runId?: string;
};

const MAX_ENTRIES = 120;
const FLUSH_MS = 120;

function redact(text: string): string {
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._-]+\b/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9]{8,}\b/gi, "sk-[redacted]")
    .slice(0, 400);
}

function summarizePayload(payload: unknown): string {
  if (payload == null) {
    return "";
  }
  if (typeof payload === "string") {
    return redact(payload);
  }
  try {
    return redact(JSON.stringify(payload));
  } catch {
    return "[不可序列化]";
  }
}

function extractRunId(payload: unknown): string | undefined {
  if (payload == null || typeof payload !== "object") {
    return undefined;
  }
  const r = (payload as { runId?: unknown }).runId;
  return typeof r === "string" && r.length > 0 ? r : undefined;
}

/**
 * 非 chat 类 Gateway 事件时间线（节流合并写入，减轻高频工具事件压力）。
 */
export const useToolTimelineStore = defineStore("toolTimeline", () => {
  const entries = ref<ToolTimelineEntry[]>([]);
  const buffer: GatewayEventFrame[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush(): void {
    timer = null;
    if (buffer.length === 0) {
      return;
    }
    const batch = buffer.splice(0, buffer.length);
    const session = useSessionStore();
    const activeKey = session.activeSessionKey;

    type Merged = { event: string; summary: string; count: number; runId?: string };
    const merged: Merged[] = [];
    for (const evt of batch) {
      const p = evt.payload as { sessionKey?: unknown } | undefined;
      if (
        activeKey &&
        p &&
        typeof p.sessionKey === "string" &&
        p.sessionKey !== activeKey
      ) {
        continue;
      }
      const summary = summarizePayload(evt.payload);
      const runId = extractRunId(evt.payload);
      const tail = merged[merged.length - 1];
      if (
        tail &&
        tail.event === evt.event &&
        tail.summary === summary &&
        tail.runId === runId
      ) {
        tail.count += 1;
      } else {
        merged.push({ event: evt.event, summary, count: 1, runId });
      }
    }

    const now = Date.now();
    const next = [...entries.value];
    for (const m of merged) {
      next.unshift({
        id: `${now}-${Math.random().toString(36).slice(2, 10)}`,
        at: now,
        event: m.event,
        summary: m.summary,
        count: m.count,
        ...(m.runId ? { runId: m.runId } : {}),
      });
    }
    entries.value = next.slice(0, MAX_ENTRIES);
  }

  function scheduleFlush(): void {
    if (timer !== null) {
      return;
    }
    timer = window.setTimeout(flush, FLUSH_MS);
  }

  function ingest(evt: GatewayEventFrame): void {
    if (evt.event === "chat" || evt.event === "connect.challenge") {
      return;
    }
    buffer.push(evt);
    scheduleFlush();
  }

  function clear(): void {
    buffer.length = 0;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    entries.value = [];
  }

  return { entries, ingest, clear };
});
