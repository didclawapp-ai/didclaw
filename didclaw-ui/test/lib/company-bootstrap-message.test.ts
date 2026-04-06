import { describe, expect, it } from "vitest";
import {
  buildCompanyAgentBootstrapUserMessage,
  DIDCLAW_COMPANY_BOOTSTRAP_MARKER,
  historyHasCompanyBootstrapMessage,
} from "@/lib/company-bootstrap-message";
import { COMPANY_ROSTER_SKILL_SLUG } from "@/lib/company-roster-skill";

describe("company-bootstrap-message", () => {
  it("includes marker, agent id, session key, roster slug, and peer list", () => {
    const agents = [
      { id: "main", name: "GM", workspace: "/co", model: "" },
      { id: "sales", name: "Sales", workspace: "/co/sales", model: "x" },
    ];
    const md = buildCompanyAgentBootstrapUserMessage(agents[1]!, agents);
    expect(md.startsWith(DIDCLAW_COMPANY_BOOTSTRAP_MARKER)).toBe(true);
    expect(md).toContain("`sales`");
    expect(md).toContain("agent:sales:main");
    expect(md).toContain(COMPANY_ROSTER_SKILL_SLUG);
    expect(md).toContain("`main`");
  });

  it("historyHasCompanyBootstrapMessage detects marker in user role", () => {
    expect(
      historyHasCompanyBootstrapMessage([
        { role: "user", text: `${DIDCLAW_COMPANY_BOOTSTRAP_MARKER}\nhi` } as never,
      ]),
    ).toBe(true);
    expect(historyHasCompanyBootstrapMessage([{ role: "user", text: "hello" } as never])).toBe(
      false,
    );
  });
});
