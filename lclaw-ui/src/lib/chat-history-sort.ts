import type { GatewayChatMessage } from "@/lib/chat-messages";

/**
 * 从网关单条消息上解析毫秒时间戳。
 *
 * OpenClaw 网关 `chat.history` 与官方 Control UI 发送侧均使用顶层 **`timestamp: number`（毫秒）**
 *（见上游 `server-methods/chat.ts` 中 `readSessionMessages` → `slice(-limit)` 与占位消息上的 `timestamp`，
 * 以及 `ui/src/ui/controllers/chat.ts` 里本地追加消息的 `timestamp: Date.now()`）。
 * 此处仍保留若干别名字段以兼容旧数据。
 */
export function extractMessageTimeMs(m: GatewayChatMessage): number | null {
  const o = m as Record<string, unknown>;

  const fromNumber = (v: unknown): number | null => {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return null;
    }
    if (v > 1e15 || v < 0) {
      return null;
    }
    if (v > 1e12) {
      return Math.round(v);
    }
    if (v > 1e9) {
      return Math.round(v * 1000);
    }
    return null;
  };

  const fromString = (v: unknown): number | null => {
    if (typeof v !== "string") {
      return null;
    }
    const p = Date.parse(v);
    return Number.isNaN(p) ? null : p;
  };

  for (const k of ["timestamp", "ts", "time", "t", "createdAt", "updatedAt", "at"]) {
    const v = o[k];
    const n = fromNumber(v) ?? fromString(v);
    if (n != null) {
      return n;
    }
  }

  const meta = o.meta;
  if (meta && typeof meta === "object") {
    const mo = meta as Record<string, unknown>;
    for (const k of ["timestamp", "ts", "time", "t"]) {
      const n = fromNumber(mo[k]) ?? fromString(mo[k]);
      if (n != null) {
        return n;
      }
    }
  }

  return null;
}

/**
 * 将 `chat.history` 的 `messages` 规范为**时间升序**（旧在上、新在下），与左侧列表阅读习惯一致。
 *
 * 官方 Control UI 的 `loadChatHistory` **不对数组再排序**，直接采用网关返回顺序（网关侧来自会话 transcript
 * 的尾部切片，一般为时间正序）。lclaw-ui 在收到载荷后按 `timestamp` 做一次规范化，防止个别版本/路径下顺序异常。
 *
 * - 若**全部**条目可解析时间：按时间升序稳定排序。
 * - 否则若**首尾**皆可解析且首条时间晚于末条：视为整段为 newest-first，**整体反转**。
 */
export function sortHistoryMessagesOldestFirst(msgs: GatewayChatMessage[]): GatewayChatMessage[] {
  if (msgs.length < 2) {
    return msgs;
  }

  const decorated = msgs.map((m, i) => ({
    m,
    i,
    t: extractMessageTimeMs(m),
  }));

  const allHaveTime = decorated.every((d) => d.t != null);
  if (allHaveTime) {
    return [...decorated]
      .sort((a, b) => {
        const d = a.t! - b.t!;
        return d !== 0 ? d : a.i - b.i;
      })
      .map((d) => d.m);
  }

  const firstT = decorated[0]?.t;
  const lastT = decorated[decorated.length - 1]?.t;
  if (firstT != null && lastT != null && firstT > lastT) {
    return [...msgs].reverse();
  }

  return msgs;
}
