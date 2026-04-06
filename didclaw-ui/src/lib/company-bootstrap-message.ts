import type { GatewayChatMessage } from "@/lib/chat-messages";
import { COMPANY_ROSTER_SKILL_SLUG, type CompanyRosterAgentRow } from "@/lib/company-roster-skill";

function gatewayUserPlainText(m: GatewayChatMessage): string {
  const o = m as Record<string, unknown>;
  if (typeof o.text === "string") {
    return o.text;
  }
  if (Array.isArray(o.content)) {
    return (o.content as Array<Record<string, unknown>>)
      .map((p) => (p?.type === "text" && typeof p.text === "string" ? p.text : ""))
      .join("");
  }
  return "";
}

/** Stable marker for dedup — must not be stripped by transport. */
export const DIDCLAW_COMPANY_BOOTSTRAP_MARKER = "[DidClaw company setup]";

function escInline(s: string): string {
  return s.replace(/`/g, "'").replace(/\r?\n/g, " ");
}

/**
 * First user message seeded into each agent's Web main session after company / roster save.
 * English body aligns with the generated roster SKILL.md.
 */
export function buildCompanyAgentBootstrapUserMessage(
  self: CompanyRosterAgentRow,
  allAgents: CompanyRosterAgentRow[],
): string {
  const id = self.id.trim();
  const name = self.name.trim() || "—";
  const ws = self.workspace.trim() || "default";
  const lines = allAgents
    .filter((a) => a.id.trim().length > 0)
    .map((a) => {
      const aid = a.id.trim();
      const an = a.name.trim() || "—";
      const aw = a.workspace.trim() || "default";
      return `- \`${escInline(aid)}\` — ${escInline(an)} (workspace: \`${escInline(aw)}\`, main session: \`agent:${escInline(aid)}:main\`)`;
    })
    .join("\n");

  return `${DIDCLAW_COMPANY_BOOTSTRAP_MARKER}

You are OpenClaw agent \`${escInline(id)}\` (display name: ${escInline(name)}). Your configured workspace is \`${escInline(ws)}\`. This Web chat uses primary session key \`agent:${escInline(id)}:main\`.

**Company roster skill:** read shared skill \`${COMPANY_ROSTER_SKILL_SLUG}\` (OpenClaw managed skills directory, usually \`~/.openclaw/skills/${COMPANY_ROSTER_SKILL_SLUG}/\`). It lists all roles, session keys, collaboration (\`tools.agentToAgent\`), and cross-session tool rules.

**Role directory (quick reference):**
${lines || "- (none)"}
`;
}

export function historyHasCompanyBootstrapMessage(messages: GatewayChatMessage[]): boolean {
  for (const m of messages) {
    const o = m as Record<string, unknown>;
    if (o.role !== "user") {
      continue;
    }
    if (gatewayUserPlainText(m).includes(DIDCLAW_COMPANY_BOOTSTRAP_MARKER)) {
      return true;
    }
  }
  return false;
}
