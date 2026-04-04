/** Phase 2：职务协作拓扑 → 官方 `tools.agentToAgent`（仅 enabled + allow[]）。 */

export const MAX_TOPOLOGY_EDGES = 64;

export type AgentTopologyEdge = { from: string; to: string };

export type TopologyTemplate = "off" | "star" | "bidirectional" | "full" | "custom";

const AGENT_ID_RE = /^[a-zA-Z][a-zA-Z0-9._-]*$/;

export function isValidOpenClawAgentId(id: string): boolean {
  const t = id.trim();
  return t.length > 0 && AGENT_ID_RE.test(t);
}

/** 官方文档最小示例形态（snapshot 测试用）。 */
export const OFFICIAL_AGENT_TO_AGENT_MIN_EXAMPLE = {
  tools: {
    agentToAgent: {
      enabled: false,
      allow: ["home", "work"],
    },
  },
} as const;

export type AgentToAgentOfficial = {
  enabled: boolean;
  allow: string[];
};

function sortedUnique(ids: string[]): string[] {
  const u = [...new Set(ids.map((x) => x.trim()).filter(Boolean))];
  u.sort();
  return u;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/** 星型 / 主↔子：allow 为 main 与全部非 main 职务 id（官方 allow 为无向集合）。 */
export function allowListStarFromMain(agentIds: string[], mainId = "main"): string[] {
  const ids = sortedUnique(agentIds);
  const m = mainId.trim() || "main";
  const subs = ids.filter((id) => id !== m);
  if (subs.length === 0) {
    return [m];
  }
  return sortedUnique([m, ...subs]);
}

export function allowListFullMesh(agentIds: string[]): string[] {
  return sortedUnique(agentIds);
}

export function allowListFromDirectedEdges(edges: AgentTopologyEdge[]): string[] {
  const ids: string[] = [];
  for (const e of edges) {
    ids.push(e.from.trim(), e.to.trim());
  }
  return sortedUnique(ids);
}

/** 有向图是否存在环（用于自定义边产品层提示）。 */
export function directedGraphHasCycle(edges: AgentTopologyEdge[]): boolean {
  const nodes = new Set<string>();
  for (const e of edges) {
    const a = e.from.trim();
    const b = e.to.trim();
    if (a && b) {
      nodes.add(a);
      nodes.add(b);
    }
  }
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    adj.set(n, []);
  }
  for (const e of edges) {
    const a = e.from.trim();
    const b = e.to.trim();
    if (!a || !b || a === b) {
      continue;
    }
    adj.get(a)?.push(b);
  }
  const visited = new Set<string>();
  const stack = new Set<string>();
  function dfs(u: string): boolean {
    visited.add(u);
    stack.add(u);
    for (const v of adj.get(u) ?? []) {
      if (!visited.has(v)) {
        if (dfs(v)) {
          return true;
        }
      } else if (stack.has(v)) {
        return true;
      }
    }
    stack.delete(u);
    return false;
  }
  for (const n of nodes) {
    if (!visited.has(n) && dfs(n)) {
      return true;
    }
  }
  return false;
}

export type CompileTopologyInput = {
  template: TopologyTemplate;
  /** 当前职务 id 列表（含 main） */
  agentIds: string[];
  customEdges?: AgentTopologyEdge[];
  mainId?: string;
};

export type CompileTopologyResult =
  | { ok: true; config: AgentToAgentOfficial }
  | { ok: false; error: string };

export function compileAgentToAgentTopology(input: CompileTopologyInput): CompileTopologyResult {
  const mainId = (input.mainId ?? "main").trim() || "main";
  const agentIds = sortedUnique(input.agentIds);
  if (agentIds.length === 0) {
    return { ok: false, error: "needAtLeastOneAgentId" };
  }
  for (const id of agentIds) {
    if (!isValidOpenClawAgentId(id)) {
      return { ok: false, error: "invalidAgentId" };
    }
  }

  if (input.template === "off") {
    return { ok: true, config: { enabled: false, allow: [] } };
  }

  let allow: string[] = [];
  switch (input.template) {
    case "star":
    case "bidirectional":
      if (!agentIds.includes(mainId)) {
        return { ok: false, error: "mainNotInAgentsList" };
      }
      allow = allowListStarFromMain(agentIds, mainId);
      break;
    case "full":
      allow = allowListFullMesh(agentIds);
      break;
    case "custom": {
      const edges = input.customEdges ?? [];
      if (edges.length > MAX_TOPOLOGY_EDGES) {
        return { ok: false, error: "tooManyEdges" };
      }
      for (const e of edges) {
        const a = e.from.trim();
        const b = e.to.trim();
        if (!a || !b) {
          return { ok: false, error: "edgeEmptyEndpoint" };
        }
        if (a === b) {
          return { ok: false, error: "edgeSelfLoop" };
        }
        if (!isValidOpenClawAgentId(a) || !isValidOpenClawAgentId(b)) {
          return { ok: false, error: "invalidAgentId" };
        }
        if (!agentIds.includes(a) || !agentIds.includes(b)) {
          return { ok: false, error: "edgeUnknownAgent" };
        }
      }
      if (directedGraphHasCycle(edges)) {
        return { ok: false, error: "directedCycle" };
      }
      allow = allowListFromDirectedEdges(edges);
      if (allow.length === 0) {
        return { ok: false, error: "customNeedsEdge" };
      }
      break;
    }
    default:
      return { ok: false, error: "unknownTemplate" };
  }

  return { ok: true, config: { enabled: true, allow } };
}

export function inferTopologyTemplate(
  cfg: AgentToAgentOfficial,
  agentIds: string[],
  mainId = "main",
): TopologyTemplate {
  const allow = sortedUnique(cfg.allow);
  const ids = sortedUnique(agentIds);
  const m = mainId.trim() || "main";

  if (!cfg.enabled && allow.length === 0) {
    return "off";
  }

  const star = allowListStarFromMain(ids, m);
  if (cfg.enabled && allow.length >= 2 && arraysEqual(allow, star)) {
    return "star";
  }

  const full = allowListFullMesh(ids);
  if (cfg.enabled && ids.length >= 2 && arraysEqual(allow, full)) {
    return "full";
  }

  return "custom";
}

/** 单测用：边表 → 官方配置 → 再解析 allow（无向），不恢复有向边。 */
export function roundTripAllowOnly(edges: AgentTopologyEdge[]): string[] {
  const r = compileAgentToAgentTopology({
    template: "custom",
    agentIds: allowListFromDirectedEdges(edges),
    customEdges: edges,
  });
  if (!r.ok) {
    return [];
  }
  return r.config.allow;
}
