/**
 * OpenClaw 会话键形如 `agent:<agentId>:<channel>:…`（主会话常为 `agent:<id>:main`）。
 * 用于职务列筛选「属于某 agent」的 sessions.list 项。
 */
export function sessionKeyBelongsToAgentId(sessionKey: string, agentId: string): boolean {
  const aid = agentId.trim();
  const sk = sessionKey.trim();
  if (!aid || !sk) {
    return false;
  }
  const parts = sk.split(":");
  return parts.length >= 3 && parts[0] === "agent" && parts[1] === aid;
}
