/** 第五步：共享公司技能 slug，须与 Tauri `openclaw_company_roster_skill` 一致。 */
export const COMPANY_ROSTER_SKILL_SLUG = "didclaw-company-roster";

import type {
  AgentToAgentOfficial,
  TopologyTemplate,
} from "@/lib/agent-to-agent-topology";

export type CompanyRosterAgentRow = {
  id: string;
  name: string;
  workspace: string;
  model: string;
};

function escTableCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function topologyNarration(template: TopologyTemplate, cfg: AgentToAgentOfficial): string {
  if (!cfg.enabled) {
    return [
      "Cross-agent **tool delegation** (one agent invoking another’s tools via OpenClaw’s peer policy) is **off** in this export: `tools.agentToAgent.enabled: false`. The `allow` list is empty or ignored for that feature.",
      "",
      "**Session messaging is separate:** `sessions_list`, `sessions_history`, and `sessions_send` are **not** the same subsystem as `tools.agentToAgent`. When you act as the **operator** in the Web UI, you may still be able to post to other roles using their `agent:<id>:main` session keys—use `sessions_list` to discover keys and try `sessions_send` per gateway rules. **Do not** refuse to greet peer roles solely because this section shows `agentToAgent` disabled.",
      "",
      "If collaboration should be on but this file says off, re-run DidClaw **Company & roles → Save** or verify live `tools.agentToAgent` in `openclaw.json`.",
    ].join("\n");
  }
  const allow = [...cfg.allow].sort().join(", ");
  switch (template) {
    case "star":
    case "bidirectional":
      return `Hub / main-centric preset: **enabled** with undirected allow peer set [\`${allow}\`] (OpenClaw \`tools.agentToAgent.allow\`).`;
    case "full":
      return `Full mesh preset: **enabled** with allow [\`${allow}\`] — high exposure; verify this matches intentional policy.`;
    case "custom":
      return `Custom edges preset: **enabled**; allow is the union of edge endpoints [\`${allow}\`].`;
    case "off":
    default:
      return `Topology template is **off**; cross-agent tools should be disabled.`;
  }
}

/**
 * 公司「办公区」：与 OpenClaw `agents.list[].workspace` 对齐的共享根目录说明。
 * 若未填 `companyWorkspaceRoot`，仍输出通用约定（避免落到 npm 包内 `default`）。
 */
function buildCompanyWorkspaceSection(companyWorkspaceRoot?: string): string {
  const avoidBundled =
    "**Avoid** storing long-term deliverables only under the global npm tree `.../node_modules/openclaw/default` — that folder can be replaced when OpenClaw is upgraded. Use a **normal project directory** you own (and ideally version-control).";

  const subdirs = `
### Suggested subfolders (optional)

| Folder | Role |
|--------|------|
| \`docs/\` | Specs, reports, Markdown deliverables |
| \`deliverables/\` | Milestone or client-facing outputs |
| \`research/\` | Drafts, notes, raw research |
| \`shared/\` | Cross-role assets everyone may read |
| \`_scratch/\` | Experiments (often gitignored) |
`;

  const root = companyWorkspaceRoot?.trim();
  if (root) {
    return `## Company workspace (shared "office")

Treat **one directory** as the company **physical workspace** (like one office floor). In \`openclaw.json\` → \`agents.list\`, set **each** agent's \`workspace\` to this root **or** a subdirectory under it (e.g. \`.../sales\` vs \`.../tech\`) so file tools write to predictable paths.

- **Canonical root (operator-defined):** \`${escTableCell(root)}\`
${subdirs}
${avoidBundled}
`;
  }

  return `## Company workspace (shared "office")

Configure **explicit absolute** workspace paths in \`agents.list\` (\`workspace\` per agent). The literal token \`default\` often resolves to OpenClaw's **bundled** sample tree under the global install — fine for demos, **not** ideal as your only document archive.
${subdirs}
${avoidBundled}
`;
}

/** Claude Code–style playbook: how roles turn roster data into self-propelled (file + session) company work. */
function buildAutonomousCompanyPlaybookSection(): string {
  return `## Autonomous company operations (playbook)

### When this skill matters

- You are acting as **one of the roles** in the table above (or helping the human operate them in DidClaw).
- The human wants **more than chat**: progress should live in the **shared workspace** as Markdown and short cross-role pings.

### Critical: silence is normal

- **You do not run new turns by yourself** while the human is idle. If there is **no new user message**, **no heartbeat / HEARTBEAT wake**, and **no cron / scheduled job**, expect **no further actions**—that is correct behavior, not a stuck agent.
- To get ongoing “company pulse”, the human (or ops) should use **OpenClaw heartbeat**, **Cron**, or short **HEARTBEAT.md** directives—not an always-on chat loop.

### File-first deliverables (push the company forward)

- **Prefer writing to disk** over long chat-only summaries. Use \`docs/\`, \`deliverables/\`, \`research/\`, or \`shared/\` (see above).
- Use **predictable names** so peers can \`read\` without asking: e.g. \`project_info_for_sales.md\`, \`*_evaluation.md\`, \`COMMUNICATION_PROTOCOL.md\`, dated notes under \`memory/\` if your workspace uses OpenClaw memory layout.
- When you finish a slice of work, **end with a one-line “handoff”** in the file (who should read next, what’s blocked).

### Role-shaped autonomy (within a user-driven turn)

- **Sales / GTM:** market framing, ICP, competitive notes, collateral outlines → \`research/\` + \`deliverables/\`.
- **Engineering:** architecture, risk, code-quality notes → \`docs/\` or \`eng_evaluation.md\`-style artifacts; link paths, don’t paste huge trees in chat.
- **Operations:** cadence, checklists, cross-team protocols → short Markdown in \`docs/\`; keep templates **copy-pasteable**.
- **Main / leadership:** consolidate conflicts, set priorities in one place (e.g. \`shared/PRIORITIES.md\`) when the charter asks for it.

### Heartbeat and scheduled wakes

- When the runtime asks you to read **\`HEARTBEAT.md\`** (workspace root, exact case), do it **before** heavy tooling.
- If the file is **empty or placeholder-only**, respond per gateway rules (often **\`HEARTBEAT_OK\`**) after stating there are **no pending directives**—**do not** launch \`openclaw doctor\` or long diagnostics unless \`HEARTBEAT.md\` or the operator explicitly asks.
- If the file contains **concrete directives**, execute **smallest useful** steps first (one file update or one \`sessions_send\`), then report.

### Cross-role messaging (\`sessions_send\`)

- Use **official session tools** only; target peers at \`agent:<id>:main\` for Web primary sessions (see table).
- **Keep pings short** (blocker, decision needed, link to new file). Avoid duplicate essays already stored in Markdown.
- Respect live \`tools.agentToAgent\` and gateway policy—**session tools stay valid** even when cross-agent *tool* delegation is off.

### Load-aware behavior (multi-column / nested runs)

- Prefer **one consolidated write** over many tiny edits when several roles may run in parallel.
- If tools time out or lanes are busy, **record state in a single workspace file** and stop; the human can retry—**do not** spin endless retries in chat.
`;
}

/** 生成写入 `~/.openclaw/skills/didclaw-company-roster/SKILL.md` 的正文（英文，便于模型一致理解）。 */
export function buildCompanyRosterSkillMarkdown(input: {
  agents: CompanyRosterAgentRow[];
  topologyTemplate: TopologyTemplate;
  topology: AgentToAgentOfficial;
  /** 公司共享工作区根路径（绝对路径），写入技能供各职务对齐 */
  companyWorkspaceRoot?: string;
  charter?: string;
  /**
   * When `compileAgentToAgentTopology` failed for this export, pass its `error` code so readers
   * know the disabled shape below may not match live `openclaw.json`.
   */
  topologyCompileErrorCode?: string;
}): string {
  const agents = input.agents
    .map((r) => ({
      id: r.id.trim(),
      name: r.name.trim(),
      workspace: r.workspace.trim() || "default",
      model: r.model.trim(),
    }))
    .filter((r) => r.id.length > 0);

  const rows = agents
    .map((r) => {
      const mainKey = `agent:${r.id}:main`;
      return `| \`${escTableCell(r.id)}\` | ${escTableCell(r.name || "—")} | \`${escTableCell(r.workspace)}\` | ${escTableCell(r.model || "—")} | \`${escTableCell(mainKey)}\` |`;
    })
    .join("\n");

  const charterBlock =
    input.charter?.trim() ?
      `## Company charter (operator-provided)\n\n${input.charter.trim()}\n`
    : "";

  const topoText = topologyNarration(input.topologyTemplate, input.topology);
  const workspaceBlock = buildCompanyWorkspaceSection(input.companyWorkspaceRoot);
  const compileCaveat =
    input.topologyCompileErrorCode ?
      `> **DidClaw export caveat:** This snapshot did not compile to a valid OpenClaw \`tools.agentToAgent\` shape (reason: \`${escTableCell(input.topologyCompileErrorCode)}\`). The collaboration summary below uses \`enabled: false\` as a placeholder. **Live gateway config may differ**—inspect \`openclaw.json\` or gateway diagnostics before telling the user collaboration is impossible.\n\n`
    : "";

  const playbook = buildAutonomousCompanyPlaybookSection();

  return `---
name: ${COMPANY_ROSTER_SKILL_SLUG}
description: >-
  DidClaw virtual company: roster, session keys, workspace layout, agentToAgent, cross-session messaging,
  and a playbook for file-first deliverables, heartbeat behavior, and load-aware multi-role work.
---

# Company roster (DidClaw)

This skill is generated by DidClaw. It lists **OpenClaw multi-agent roles**, how to address **Web** primary sessions, and **how roles should behave** to keep the “company” moving without chat-only fluff.

## Roles (from \`agents.list\`)

| Agent id | Display name | Workspace | Model (if set) | Web main \`sessionKey\` |
|----------|----------------|-----------|----------------|-------------------------|
${rows || "| — | — | — | — | — |"}

${workspaceBlock}
## Collaboration (\`tools.agentToAgent\`)

${compileCaveat}${topoText}

Official field shape: \`{ enabled: boolean, allow: string[] }\`. **Allow** is an undirected peer set for who may use cross-agent tools — it is **not** a directed org chart.

## Cross-session messaging

Use **official session tools** (e.g. \`sessions_list\`, \`sessions_history\`, \`sessions_send\`) per OpenClaw docs.

- **Do not** treat the WebSocket client display name or UI label as a \`sessionKey\`.
- For **non-Web** channels (e.g. WhatsApp, Feishu), \`sessionKey\` values may **not** follow \`agent:<id>:main\`; discover them via \`sessions_list\` or your ops mapping.

${charterBlock}${playbook}## Reloading

If the gateway does not hot-reload skills or \`skills.entries\`, restart the OpenClaw gateway or re-open sessions after DidClaw updates this file.
`;
}
