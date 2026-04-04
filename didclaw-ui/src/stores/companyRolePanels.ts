import { sessionKeyBelongsToAgentId } from "@/lib/agent-session-key";
import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";

const LS_KEY = "didclaw.companyRolePanels.v1";

export type CompanyRolePanel = {
  /** 稳定面板 id（用于列表 key） */
  id: string;
  /** OpenClaw agent id */
  agentId: string;
  /** 展示名 */
  label: string;
  /** 该职务主会话 sessionKey（与网关一致：`agent:<id>:main`） */
  sessionKey: string;
};

export function mainSessionKeyForAgent(agentId: string): string {
  const id = agentId.trim();
  return `agent:${id || "main"}:main`;
}

function loadPanelsFromLs(): CompanyRolePanel[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const out: CompanyRolePanel[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== "object") {
        continue;
      }
      const o = row as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id.trim() : "";
      const agentId = typeof o.agentId === "string" ? o.agentId.trim() : "";
      const label = typeof o.label === "string" ? o.label.trim() : agentId;
      if (!id || !agentId) {
        continue;
      }
      const sessionKey =
        typeof o.sessionKey === "string" && o.sessionKey.trim().length > 0
          ? o.sessionKey.trim()
          : mainSessionKeyForAgent(agentId);
      out.push({ id, agentId, label: label || agentId, sessionKey });
    }
    return out;
  } catch {
    return [];
  }
}

export const useCompanyRolePanelsStore = defineStore("companyRolePanels", () => {
  const panels = ref<CompanyRolePanel[]>(loadPanelsFromLs());

  const sessionKeys = computed(() => panels.value.map((p) => p.sessionKey));

  watch(
    panels,
    (next) => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(next));
      } catch {
        /* ignore quota */
      }
    },
    { deep: true },
  );

  function openPanel(agentId: string, label?: string): CompanyRolePanel {
    const aid = agentId.trim();
    const sk = mainSessionKeyForAgent(aid);
    const existing = panels.value.find((p) => p.sessionKey === sk || p.agentId === aid);
    if (existing) {
      return existing;
    }
    const id = crypto.randomUUID?.() ?? `rp-${Date.now()}`;
    const row: CompanyRolePanel = {
      id,
      agentId: aid,
      label: (label ?? aid).trim() || aid,
      sessionKey: sk,
    };
    panels.value = [...panels.value, row];
    return row;
  }

  function openAllFromAgentIds(agentIds: string[], labels?: Record<string, string>): void {
    const next = [...panels.value];
    for (const raw of agentIds) {
      const aid = raw.trim();
      if (!aid || aid === "main") {
        continue;
      }
      const sk = mainSessionKeyForAgent(aid);
      if (next.some((p) => p.sessionKey === sk || p.agentId === aid)) {
        continue;
      }
      next.push({
        id: crypto.randomUUID?.() ?? `rp-${Date.now()}-${aid}`,
        agentId: aid,
        label: labels?.[aid]?.trim() || aid,
        sessionKey: sk,
      });
    }
    panels.value = next;
  }

  function closePanel(panelId: string): void {
    panels.value = panels.value.filter((p) => p.id !== panelId);
  }

  function closeAll(): void {
    panels.value = [];
  }

  /**
   * 将职务列绑定到该 agent 下另一 `sessionKey`（须与 `sessions.list` 中键一致，且第二段为 agentId）。
   */
  function setPanelSessionKey(panelId: string, sessionKey: string): boolean {
    const nextKey = sessionKey.trim();
    const idx = panels.value.findIndex((p) => p.id === panelId);
    if (idx < 0 || !nextKey) {
      return false;
    }
    const row = panels.value[idx];
    if (!sessionKeyBelongsToAgentId(nextKey, row.agentId)) {
      return false;
    }
    const next = [...panels.value];
    next[idx] = { ...row, sessionKey: nextKey };
    panels.value = next;
    return true;
  }

  return {
    panels,
    sessionKeys,
    openPanel,
    openAllFromAgentIds,
    closePanel,
    closeAll,
    setPanelSessionKey,
    mainSessionKeyForAgent,
  };
});
