import { describe, expect, it } from "vitest";

import {
  buildCompanyRosterSkillMarkdown,
  COMPANY_ROSTER_SKILL_SLUG,
} from "@/lib/company-roster-skill";

describe("buildCompanyRosterSkillMarkdown", () => {
  it("includes frontmatter, slug, and agent main session keys", () => {
    const md = buildCompanyRosterSkillMarkdown({
      agents: [
        { id: "main", name: "Lead", workspace: "default", model: "m1" },
        { id: "sales", name: "Sales", workspace: "default", model: "" },
      ],
      topologyTemplate: "star",
      topology: { enabled: true, allow: ["main", "sales"] },
      charter: "Be concise.",
    });
    expect(md).toContain(`name: ${COMPANY_ROSTER_SKILL_SLUG}`);
    expect(md).toContain("`agent:main:main`");
    expect(md).toContain("`agent:sales:main`");
    expect(md).toContain("Be concise.");
    expect(md).toContain("sessions_send");
    expect(md).toContain("Company workspace");
    expect(md).toContain("node_modules/openclaw/default");
    expect(md).toContain("Autonomous company operations (playbook)");
    expect(md).toContain("HEARTBEAT.md");
    expect(md).toContain("silence is normal");
  });

  it("embeds canonical workspace root when provided", () => {
    const md = buildCompanyRosterSkillMarkdown({
      agents: [{ id: "main", name: "Lead", workspace: "F:/Co/docs", model: "" }],
      topologyTemplate: "off",
      topology: { enabled: false, allow: [] },
      companyWorkspaceRoot: "F:/CompanyOffice",
    });
    expect(md).toContain("F:/CompanyOffice");
    expect(md).toContain("docs/");
    expect(md).toContain("Session messaging is separate");
    expect(md).toContain("sessions_send");
  });

  it("embeds compile caveat when topology snapshot failed to compile", () => {
    const md = buildCompanyRosterSkillMarkdown({
      agents: [{ id: "main", name: "Lead", workspace: "default", model: "" }],
      topologyTemplate: "star",
      topology: { enabled: false, allow: [] },
      topologyCompileErrorCode: "mainNotInAgentsList",
    });
    expect(md).toContain("DidClaw export caveat");
    expect(md).toContain("mainNotInAgentsList");
  });
});
