import { describe, expect, it } from "vitest";
import {
  extractMessageTimeMs,
  sortHistoryMessagesOldestFirst,
} from "@/lib/chat-history-sort";
import type { GatewayChatMessage } from "@/lib/chat-messages";

function msg(fields: Record<string, unknown>): GatewayChatMessage {
  return fields as unknown as GatewayChatMessage;
}

describe("extractMessageTimeMs", () => {
  it("returns millisecond timestamp when value is > 1e12", () => {
    expect(extractMessageTimeMs(msg({ timestamp: 1_700_000_000_000 }))).toBe(1_700_000_000_000);
  });

  it("converts seconds to milliseconds when value is between 1e9 and 1e12", () => {
    expect(extractMessageTimeMs(msg({ timestamp: 1_700_000_000 }))).toBe(1_700_000_000_000);
  });

  it("rejects values below 1e9", () => {
    expect(extractMessageTimeMs(msg({ timestamp: 999_999_999 }))).toBeNull();
  });

  it("rejects values above 1e15", () => {
    expect(extractMessageTimeMs(msg({ timestamp: 1e16 }))).toBeNull();
  });

  it("rejects negative values", () => {
    expect(extractMessageTimeMs(msg({ timestamp: -1 }))).toBeNull();
  });

  it("rejects NaN and Infinity", () => {
    expect(extractMessageTimeMs(msg({ timestamp: NaN }))).toBeNull();
    expect(extractMessageTimeMs(msg({ timestamp: Infinity }))).toBeNull();
  });

  it("parses ISO string timestamp", () => {
    const iso = "2024-01-15T10:00:00.000Z";
    expect(extractMessageTimeMs(msg({ timestamp: iso }))).toBe(Date.parse(iso));
  });

  it("returns null for non-parseable string", () => {
    expect(extractMessageTimeMs(msg({ timestamp: "not-a-date" }))).toBeNull();
  });

  it("checks alias fields: ts, time, t, createdAt, updatedAt, at", () => {
    const ts = 1_700_000_000_000;
    expect(extractMessageTimeMs(msg({ ts }))).toBe(ts);
    expect(extractMessageTimeMs(msg({ time: ts }))).toBe(ts);
    expect(extractMessageTimeMs(msg({ t: ts }))).toBe(ts);
    expect(extractMessageTimeMs(msg({ createdAt: ts }))).toBe(ts);
    expect(extractMessageTimeMs(msg({ updatedAt: ts }))).toBe(ts);
    expect(extractMessageTimeMs(msg({ at: ts }))).toBe(ts);
  });

  it("reads from nested meta object", () => {
    const ts = 1_700_000_000_000;
    expect(extractMessageTimeMs(msg({ meta: { timestamp: ts } }))).toBe(ts);
    expect(extractMessageTimeMs(msg({ meta: { ts } }))).toBe(ts);
  });

  it("returns null when no timestamp field present", () => {
    expect(extractMessageTimeMs(msg({ role: "user", content: "hello" }))).toBeNull();
  });
});

describe("sortHistoryMessagesOldestFirst", () => {
  it("returns array as-is when fewer than 2 messages", () => {
    const single = [msg({ timestamp: 1_700_000_001_000 })];
    expect(sortHistoryMessagesOldestFirst(single)).toBe(single);
    expect(sortHistoryMessagesOldestFirst([])).toEqual([]);
  });

  it("sorts ascending when all messages have timestamps", () => {
    const a = msg({ timestamp: 1_700_000_003_000, id: "a" });
    const b = msg({ timestamp: 1_700_000_001_000, id: "b" });
    const c = msg({ timestamp: 1_700_000_002_000, id: "c" });
    const result = sortHistoryMessagesOldestFirst([a, b, c]);
    expect(result.map((m) => (m as Record<string, unknown>).id)).toEqual(["b", "c", "a"]);
  });

  it("preserves original order as tiebreaker for equal timestamps", () => {
    const ts = 1_700_000_000_000;
    const a = msg({ timestamp: ts, id: "a" });
    const b = msg({ timestamp: ts, id: "b" });
    const result = sortHistoryMessagesOldestFirst([a, b]);
    expect(result.map((m) => (m as Record<string, unknown>).id)).toEqual(["a", "b"]);
  });

  it("reverses array when first timestamp is newer than last (newest-first detection)", () => {
    const newer = msg({ timestamp: 1_700_000_002_000, id: "new" });
    const middle = msg({ id: "mid" }); // no timestamp
    const older = msg({ timestamp: 1_700_000_001_000, id: "old" });
    const result = sortHistoryMessagesOldestFirst([newer, middle, older]);
    expect(result.map((m) => (m as Record<string, unknown>).id)).toEqual(["old", "mid", "new"]);
  });

  it("leaves order unchanged when timestamps are missing and not newest-first", () => {
    const a = msg({ id: "a" });
    const b = msg({ id: "b" });
    const result = sortHistoryMessagesOldestFirst([a, b]);
    expect(result.map((m) => (m as Record<string, unknown>).id)).toEqual(["a", "b"]);
  });

  it("does not mutate the input array", () => {
    const a = msg({ timestamp: 1_700_000_002_000 });
    const b = msg({ timestamp: 1_700_000_001_000 });
    const input = [a, b];
    sortHistoryMessagesOldestFirst(input);
    expect(input[0]).toBe(a);
  });
});
