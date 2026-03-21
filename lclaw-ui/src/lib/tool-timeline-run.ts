import type { ToolTimelineEntry } from "@/stores/toolTimeline";

/** 将工具时间线条目归属到当前助手 run（优先 payload.runId，否则用本轮开始时间戳对齐） */
export function toolEntryBelongsToRun(
  e: ToolTimelineEntry,
  activeRunId: string | null,
  runStartedAtMs: number | null,
): boolean {
  if (activeRunId == null) {
    return false;
  }
  if (e.runId && e.runId === activeRunId) {
    return true;
  }
  if (!e.runId && runStartedAtMs != null && e.at >= runStartedAtMs) {
    return true;
  }
  return false;
}
