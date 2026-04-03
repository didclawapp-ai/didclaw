import { describe, expect, it } from "vitest";
import {
  agentEventWarrantsChatHistorySync,
  summarizeChatEventPayload,
  summarizeGatewayEvent,
} from "@/lib/gateway-debug-log";

describe("summarizeChatEventPayload", () => {
  it("summarizes string message length", () => {
    const s = summarizeChatEventPayload({
      sessionKey: "k",
      state: "delta",
      message: "hello",
      runId: "r1",
    });
    expect(s.sessionKey).toBe("k");
    expect(s.state).toBe("delta");
    expect(s.message).toBe("string(5)");
    expect(s.runId).toBe("r1");
  });

  it("truncates long errorMessage", () => {
    const long = "x".repeat(200);
    const s = summarizeChatEventPayload({ errorMessage: long });
    expect(String(s.errorMessage).length).toBeLessThanOrEqual(123);
    expect(String(s.errorMessage)).toContain("…");
  });
});

describe("agentEventWarrantsChatHistorySync", () => {
  it("returns true for non-tool stream", () => {
    expect(agentEventWarrantsChatHistorySync({ stream: "lifecycle" })).toBe(true);
  });

  it("returns false for tool stream without result phase", () => {
    expect(
      agentEventWarrantsChatHistorySync({ stream: "tool", data: { phase: "start" } }),
    ).toBe(false);
  });

  it("returns true for tool stream with result phase", () => {
    expect(
      agentEventWarrantsChatHistorySync({ stream: "tool", data: { phase: "result" } }),
    ).toBe(true);
  });
});

describe("summarizeGatewayEvent", () => {
  it("uses chat payload summarizer for chat events", () => {
    const s = summarizeGatewayEvent({
      event: "chat",
      seq: 3,
      payload: { sessionKey: "sk", state: "final", message: "hi" },
    });
    expect(s.event).toBe("chat");
    expect(s.seq).toBe(3);
    expect(s.payload).toMatchObject({ sessionKey: "sk", state: "final" });
  });

  it("lists object keys for non-chat events", () => {
    const s = summarizeGatewayEvent({
      event: "sessions.changed",
      payload: { a: 1, b: 2 },
    });
    expect(s.payload).toMatchObject({ keys: ["a", "b"], keyCount: 2 });
  });
});
