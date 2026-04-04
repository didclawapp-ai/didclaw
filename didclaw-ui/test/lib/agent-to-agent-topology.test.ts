import {
  allowListFromDirectedEdges,
  allowListStarFromMain,
  compileAgentToAgentTopology,
  directedGraphHasCycle,
  inferTopologyTemplate,
  OFFICIAL_AGENT_TO_AGENT_MIN_EXAMPLE,
  roundTripAllowOnly,
} from "@/lib/agent-to-agent-topology";
import { describe, expect, it } from "vitest";

describe("agent-to-agent-topology", () => {
  it("official min example snapshot", () => {
    expect(OFFICIAL_AGENT_TO_AGENT_MIN_EXAMPLE).toMatchInlineSnapshot(`
      {
        "tools": {
          "agentToAgent": {
            "allow": [
              "home",
              "work",
            ],
            "enabled": false,
          },
        },
      }
    `);
  });

  it("allowListStarFromMain", () => {
    expect(allowListStarFromMain(["sales", "main", "x"])).toEqual(["main", "sales", "x"]);
    expect(allowListStarFromMain(["main"])).toEqual(["main"]);
  });

  it("compile star and infer round-trip", () => {
    const r = compileAgentToAgentTopology({
      template: "star",
      agentIds: ["main", "a", "b"],
    });
    expect(r).toEqual({ ok: true, config: { enabled: true, allow: ["a", "b", "main"] } });
    expect(inferTopologyTemplate(r.ok ? r.config : { enabled: false, allow: [] }, ["main", "a", "b"])).toBe(
      "star",
    );
  });

  it("star/bidirectional requires main in agents.list", () => {
    const r = compileAgentToAgentTopology({
      template: "star",
      agentIds: ["sales", "tech"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("mainNotInAgentsList");
    }
  });

  it("compile off", () => {
    expect(
      compileAgentToAgentTopology({ template: "off", agentIds: ["main"] }),
    ).toEqual({ ok: true, config: { enabled: false, allow: [] } });
  });

  it("custom edges union allow and block cycles", () => {
    expect(
      compileAgentToAgentTopology({
        template: "custom",
        agentIds: ["main", "a"],
        customEdges: [{ from: "main", to: "a" }],
      }),
    ).toEqual({ ok: true, config: { enabled: true, allow: ["a", "main"] } });

    const cyc = compileAgentToAgentTopology({
      template: "custom",
      agentIds: ["main", "a"],
      customEdges: [
        { from: "main", to: "a" },
        { from: "a", to: "main" },
      ],
    });
    expect(cyc.ok).toBe(false);
    if (!cyc.ok) {
      expect(cyc.error).toBe("directedCycle");
    }
  });

  it("directedGraphHasCycle", () => {
    expect(directedGraphHasCycle([{ from: "main", to: "a" }])).toBe(false);
    expect(
      directedGraphHasCycle([
        { from: "main", to: "a" },
        { from: "a", to: "main" },
      ]),
    ).toBe(true);
  });

  it("allowListFromDirectedEdges", () => {
    expect(
      allowListFromDirectedEdges([
        { from: "main", to: "x" },
        { from: "x", to: "y" },
      ]),
    ).toEqual(["main", "x", "y"]);
  });

  it("roundTripAllowOnly", () => {
    expect(roundTripAllowOnly([{ from: "main", to: "sales" }])).toEqual(["main", "sales"]);
  });
});
