import type { GatewayClient } from "@/features/gateway/gateway-client";
import { GatewayRequestError } from "@/features/gateway/gateway-types";

/** `config.get` 成功载荷为脱敏后的配置快照；`hash` 用于 `config.patch` 的 `baseHash`。 */
export function extractConfigSnapshotHash(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const h = (payload as { hash?: unknown }).hash;
  return typeof h === "string" && h.length > 0 ? h : null;
}

/** 从 `config.get` 响应中取出 `agents.list`（缺省或非法结构时返回空数组）。 */
export function extractAgentsListFromConfigGet(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const config = (payload as { config?: unknown }).config;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return [];
  }
  const agents = (config as { agents?: unknown }).agents;
  if (!agents || typeof agents !== "object" || Array.isArray(agents)) {
    return [];
  }
  const list = (agents as { list?: unknown }).list;
  return Array.isArray(list) ? list : [];
}

/** 从 `config.get` 响应解析 `tools.agentToAgent`（缺省 enabled=false, allow=[]）。 */
export function extractToolsAgentToAgentFromConfigGet(payload: unknown): {
  enabled: boolean;
  allow: string[];
} {
  if (!payload || typeof payload !== "object") {
    return { enabled: false, allow: [] };
  }
  const config = (payload as { config?: unknown }).config;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { enabled: false, allow: [] };
  }
  const tools = (config as { tools?: unknown }).tools;
  if (!tools || typeof tools !== "object" || Array.isArray(tools)) {
    return { enabled: false, allow: [] };
  }
  const ata = (tools as { agentToAgent?: unknown }).agentToAgent;
  if (!ata || typeof ata !== "object" || Array.isArray(ata)) {
    return { enabled: false, allow: [] };
  }
  const o = ata as { enabled?: unknown; allow?: unknown };
  const enabled = o.enabled === true;
  const raw = o.allow;
  if (!Array.isArray(raw)) {
    return { enabled, allow: [] };
  }
  const allow: string[] = [];
  for (const x of raw) {
    if (typeof x === "string") {
      const t = x.trim();
      if (t) {
        allow.push(t);
      }
    }
  }
  allow.sort();
  const dedup = [...new Set(allow)];
  return { enabled, allow: dedup };
}

/** `config.get` → `tools.sessions.visibility`（缺省或非法时返回 null）。 */
export function extractToolsSessionsVisibilityFromConfigGet(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const config = (payload as { config?: unknown }).config;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return null;
  }
  const tools = (config as { tools?: unknown }).tools;
  if (!tools || typeof tools !== "object" || Array.isArray(tools)) {
    return null;
  }
  const sessions = (tools as { sessions?: unknown }).sessions;
  if (!sessions || typeof sessions !== "object" || Array.isArray(sessions)) {
    return null;
  }
  const v = (sessions as { visibility?: unknown }).visibility;
  return typeof v === "string" && v.length > 0 ? v : null;
}

export type PatchToolsAgentToAgentOptions = {
  sessionKey?: string | null;
};

/**
 * 通过 `config.get` → `config.patch` 合并 `tools.agentToAgent`（与 agents.list 相同 raw 补丁模式）。
 * 当 `enabled === true` 时同时写入 `tools.sessions.visibility: "all"`，满足官方跨 agent 会话工具前提。
 */
export async function patchToolsAgentToAgentViaGateway(
  client: GatewayClient,
  agentToAgent: { enabled: boolean; allow: string[] },
  opts?: PatchToolsAgentToAgentOptions,
): Promise<void> {
  const snap = await client.request<unknown>("config.get", {});
  const baseHash = extractConfigSnapshotHash(snap);
  if (!baseHash) {
    throw new Error("config.get: missing hash in response");
  }
  const toolsPatch: Record<string, unknown> = {
    agentToAgent: {
      enabled: agentToAgent.enabled,
      allow: [...agentToAgent.allow].sort(),
    },
  };
  if (agentToAgent.enabled) {
    toolsPatch.sessions = { visibility: "all" };
  }
  const raw = JSON.stringify({ tools: toolsPatch });
  const params: Record<string, unknown> = { raw, baseHash };
  const sk = opts?.sessionKey?.trim();
  if (sk) {
    params.sessionKey = sk;
  }
  await client.request<unknown>("config.patch", params);
}

export function retryAfterSecondsFromGatewayDetails(details: unknown): number | null {
  if (!details || typeof details !== "object") {
    return null;
  }
  const r = (details as { retryAfterMs?: unknown }).retryAfterMs;
  if (typeof r !== "number" || !Number.isFinite(r) || r <= 0) {
    return null;
  }
  return Math.max(1, Math.ceil(r / 1000));
}

export function isGatewayConfigRequestError(err: unknown): err is GatewayRequestError {
  return err instanceof GatewayRequestError;
}

/**
 * OpenClaw `config.patch` 在 `baseHash` 与当前文件不一致时返回 `INVALID_REQUEST`
 *（文案含 “re-run config.get” / “base hash” 等）。
 */
export function isGatewayConfigHashStaleError(err: unknown): boolean {
  if (!isGatewayConfigRequestError(err)) {
    return false;
  }
  const m = err.message.toLowerCase();
  if (m.includes("re-run config.get") || m.includes("config.get and retry")) {
    return true;
  }
  return err.gatewayCode === "INVALID_REQUEST" && m.includes("base hash");
}

/** 合并结果未通过网关配置校验（非 hash 过期类）。 */
export function isGatewayConfigPatchRejectedError(err: unknown): boolean {
  if (!isGatewayConfigRequestError(err)) {
    return false;
  }
  if (isGatewayConfigHashStaleError(err)) {
    return false;
  }
  const m = err.message.toLowerCase();
  return (
    err.gatewayCode === "INVALID_REQUEST" &&
    (m.includes("invalid config") || m.includes("fix before patching"))
  );
}

export type PatchAgentsListMergeOptions = {
  /** 可选；传给网关 `config.patch`，用于重启后的投递上下文。 */
  sessionKey?: string | null;
};

/**
 * 通过官方 `config.get` → `config.patch` 合并 `agents.list`（与网关 `mergeObjectArraysById: true` 一致）。
 */
export async function patchAgentsListMergeViaGateway(
  client: GatewayClient,
  agents: Array<Record<string, unknown>>,
  opts?: PatchAgentsListMergeOptions,
): Promise<void> {
  const snap = await client.request<unknown>("config.get", {});
  const baseHash = extractConfigSnapshotHash(snap);
  if (!baseHash) {
    throw new Error("config.get: missing hash in response");
  }
  const raw = JSON.stringify({ agents: { list: agents } });
  const params: Record<string, unknown> = { raw, baseHash };
  const sk = opts?.sessionKey?.trim();
  if (sk) {
    params.sessionKey = sk;
  }
  await client.request<unknown>("config.patch", params);
}
