import { sessionKeyBelongsToAgentId } from "@/lib/agent-session-key";
import { describe, expect, it } from "vitest";

describe("sessionKeyBelongsToAgentId", () => {
  it("matches agent:agentId:…", () => {
    expect(sessionKeyBelongsToAgentId("agent:sales:main", "sales")).toBe(true);
    expect(sessionKeyBelongsToAgentId("agent:sales:whatsapp:direct:x", "sales")).toBe(true);
    expect(sessionKeyBelongsToAgentId("agent:main:main", "main")).toBe(true);
  });
  it("rejects wrong agent segment", () => {
    expect(sessionKeyBelongsToAgentId("agent:sales:main", "other")).toBe(false);
    expect(sessionKeyBelongsToAgentId("agent:main:main", "sales")).toBe(false);
  });
  it("rejects too-short keys", () => {
    expect(sessionKeyBelongsToAgentId("agent:sales", "sales")).toBe(false);
    expect(sessionKeyBelongsToAgentId("", "sales")).toBe(false);
  });
});
