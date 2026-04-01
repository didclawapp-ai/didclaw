import { defineStore } from "pinia";
import { ref } from "vue";

/** Gateway `exec.approval.requested` 事件 payload 的关键字段 */
export interface ExecApprovalRequest {
  approvalId: string;
  sessionKey?: string;
  sessionLabel?: string | null;
  agentId?: string;
  host?: string | null;
  resolvedPath?: string | null;
  security?: string | null;
  ask?: string | null;
  createdAtMs?: number;
  expiresAtMs?: number;
  systemRunPlan?: {
    argv?: string[];
    cwd?: string | null;
    commandText?: string;
    commandPreview?: string | null;
    rawCommand?: string;
  };
  /** Sanitized display line from gateway `request.command` */
  command?: string;
  /** Optional richer preview from gateway `request.commandPreview` */
  commandPreview?: string;
  commandArgv?: string[];
  cwd?: string | null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function normalizeApprovalId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length > 0 ? t : null;
}

/**
 * OpenClaw broadcasts `{ id, request: { command, cwd, systemRunPlan, ... }, ... }`.
 * Older clients/tests may use a flat payload; accept both.
 */
export function parseExecApprovalRequestedPayload(
  p: Record<string, unknown>,
): ExecApprovalRequest | null {
  const innerReq = isPlainObject(p.request) ? p.request : null;
  const approvalId =
    normalizeApprovalId(p.id) ??
    normalizeApprovalId(p.approvalId) ??
    (innerReq ? normalizeApprovalId(innerReq.id) : null);
  if (!approvalId) {
    return null;
  }

  const inner = innerReq ?? p;

  const systemRunPlanRaw = inner.systemRunPlan ?? inner.system_run_plan;
  const systemRunPlan = isPlainObject(systemRunPlanRaw)
    ? (systemRunPlanRaw as ExecApprovalRequest["systemRunPlan"])
    : undefined;

  const cwdInner = inner.cwd;
  const cwd =
    typeof cwdInner === "string"
      ? cwdInner
      : cwdInner === null
        ? null
        : undefined;

  const sessionKey =
    typeof inner.sessionKey === "string"
      ? inner.sessionKey
      : typeof p.sessionKey === "string"
        ? p.sessionKey
        : undefined;

  const agentId =
    typeof inner.agentId === "string"
      ? inner.agentId
      : typeof p.agentId === "string"
        ? p.agentId
        : undefined;

  const sessionLabel =
    typeof inner.sessionLabel === "string"
      ? inner.sessionLabel
      : typeof inner.session === "string"
        ? inner.session
        : inner.session === null
          ? null
          : typeof p.sessionLabel === "string"
            ? p.sessionLabel
            : typeof p.session === "string"
              ? p.session
              : undefined;

  const host =
    typeof inner.host === "string"
      ? inner.host
      : inner.host === null
        ? null
        : typeof p.host === "string"
          ? p.host
          : p.host === null
            ? null
            : undefined;

  const resolvedPath =
    typeof inner.resolvedPath === "string"
      ? inner.resolvedPath
      : inner.resolvedPath === null
        ? null
        : typeof p.resolvedPath === "string"
          ? p.resolvedPath
          : p.resolvedPath === null
            ? null
            : undefined;

  const createdAtMs =
    typeof p.createdAtMs === "number" && Number.isFinite(p.createdAtMs)
      ? p.createdAtMs
      : undefined;

  const expiresAtMs =
    typeof p.expiresAtMs === "number" && Number.isFinite(p.expiresAtMs)
      ? p.expiresAtMs
      : undefined;

  const security =
    typeof inner.security === "string"
      ? inner.security
      : inner.security === null
        ? null
        : typeof p.security === "string"
          ? p.security
          : p.security === null
            ? null
            : undefined;

  const ask =
    typeof inner.ask === "string"
      ? inner.ask
      : inner.ask === null
        ? null
        : typeof p.ask === "string"
          ? p.ask
          : p.ask === null
            ? null
            : undefined;

  const command =
    typeof inner.command === "string"
      ? inner.command
      : typeof p.command === "string"
        ? p.command
        : undefined;

  const commandPreview =
    typeof inner.commandPreview === "string"
      ? inner.commandPreview
      : typeof p.commandPreview === "string"
        ? p.commandPreview
        : undefined;

  const argvFromInner = inner.commandArgv;
  const argvFromP = p.commandArgv;
  const commandArgv = Array.isArray(argvFromInner)
    ? (argvFromInner as string[])
    : Array.isArray(argvFromP)
      ? (argvFromP as string[])
      : undefined;

  const cwdTop = p.cwd;
  const cwdMerged =
    cwd !== undefined
      ? cwd
      : typeof cwdTop === "string"
        ? cwdTop
        : cwdTop === null
          ? null
          : undefined;

  return {
    approvalId,
    sessionKey,
    sessionLabel,
    agentId,
    host,
    resolvedPath,
    security,
    ask,
    createdAtMs,
    expiresAtMs,
    systemRunPlan,
    command,
    commandPreview,
    commandArgv,
    cwd: cwdMerged,
  };
}

export type ApprovalDecision = "allow-once" | "allow-always" | "deny";

export const useApprovalStore = defineStore("approval", () => {
  /** 等待响应的审批队列（按到达顺序排列，UI 展示最先到达的那条） */
  const pending = ref<ExecApprovalRequest[]>([]);
  const recentNotice = ref<string | null>(null);
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;

  function addPending(req: ExecApprovalRequest): void {
    if (pending.value.find((p) => p.approvalId === req.approvalId)) return;
    pending.value = [...pending.value, req];
  }

  function removePending(approvalId: string): void {
    pending.value = pending.value.filter((p) => p.approvalId !== approvalId);
  }

  function setRecentNotice(message: string | null, timeoutMs = 2400): void {
    recentNotice.value = message;
    if (noticeTimer) clearTimeout(noticeTimer);
    if (message) {
      noticeTimer = setTimeout(() => {
        recentNotice.value = null;
      }, timeoutMs);
    } else {
      noticeTimer = null;
    }
  }

  return { pending, recentNotice, addPending, removePending, setRecentNotice };
});
