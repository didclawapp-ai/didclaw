import { extractCompleteDiffBlocksFromText } from "@/lib/live-edit-fenced-diff";
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import { defineStore } from "pinia";
import { ref } from "vue";

const LS_EXPERIMENTAL = "didclaw.liveEdit.experimental";
const LS_ROOT = "didclaw.liveEdit.workspaceRoot";
const LS_PANEL = "didclaw.liveEdit.panelOpen";

export type LiveEditPatchStatus = "pending" | "applied" | "discarded" | "error";

export type LiveEditPendingPatch = {
  id: string;
  unifiedDiff: string;
  createdAt: number;
  status: LiveEditPatchStatus;
  applyError?: string;
};

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function fnv1aHex(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export const useLiveEditStore = defineStore("liveEdit", () => {
  const experimentalEnabled = ref(lsGet(LS_EXPERIMENTAL) === "1");
  const workspaceRoot = ref<string | null>(lsGet(LS_ROOT));
  const panelOpen = ref(lsGet(LS_PANEL) === "1");
  const pendingPatches = ref<LiveEditPendingPatch[]>([]);
  const applyBusyId = ref<string | null>(null);
  const diffHashesSeen = ref<Set<string>>(new Set());

  function setExperimental(on: boolean): void {
    experimentalEnabled.value = on;
    lsSet(LS_EXPERIMENTAL, on ? "1" : "0");
    if (!on) {
      panelOpen.value = false;
      lsSet(LS_PANEL, "0");
    }
  }

  function setPanelOpen(on: boolean): void {
    panelOpen.value = on;
    lsSet(LS_PANEL, on ? "1" : "0");
  }

  function setWorkspaceRoot(path: string | null): void {
    workspaceRoot.value = path;
    if (path) {
      lsSet(LS_ROOT, path);
    } else {
      try {
        localStorage.removeItem(LS_ROOT);
      } catch {
        /* ignore */
      }
    }
  }

  function onActiveSessionChanged(): void {
    pendingPatches.value = [];
    diffHashesSeen.value = new Set();
  }

  function enqueuePatchesFromText(text: string | null | undefined): void {
    if (!experimentalEnabled.value) {
      return;
    }
    const raw = text?.trim();
    if (!raw) {
      return;
    }
    const blocks = extractCompleteDiffBlocksFromText(raw);
    for (const unifiedDiff of blocks) {
      const h = fnv1aHex(unifiedDiff);
      if (diffHashesSeen.value.has(h)) {
        continue;
      }
      diffHashesSeen.value.add(h);
      pendingPatches.value.push({
        id: crypto.randomUUID(),
        unifiedDiff,
        createdAt: Date.now(),
        status: "pending",
      });
    }
  }

  function discardPatch(id: string): void {
    const p = pendingPatches.value.find((x) => x.id === id);
    if (p && (p.status === "pending" || p.status === "error")) {
      p.status = "discarded";
    }
  }

  function clearDiscarded(): void {
    pendingPatches.value = pendingPatches.value.filter((p) => p.status !== "discarded");
  }

  async function pickWorkspace(): Promise<void> {
    const api = getDidClawDesktopApi();
    if (!api?.liveEditPickWorkspace) {
      return;
    }
    const picked = await api.liveEditPickWorkspace();
    if (picked) {
      setWorkspaceRoot(picked);
    }
  }

  async function applyPatch(id: string): Promise<void> {
    const api = getDidClawDesktopApi();
    if (!api?.liveEditApplyUnifiedDiff) {
      return;
    }
    const root = workspaceRoot.value?.trim();
    if (!root) {
      return;
    }
    const p = pendingPatches.value.find((x) => x.id === id);
    if (!p || p.status === "applied" || p.status === "discarded") {
      return;
    }
    applyBusyId.value = id;
    p.applyError = undefined;
    try {
      const res = await api.liveEditApplyUnifiedDiff({
        root,
        diff: p.unifiedDiff,
      });
      if (res.ok) {
        p.status = "applied";
      } else {
        p.status = "error";
        const failed = res.results?.filter((r) => !r.ok) ?? [];
        p.applyError =
          failed.map((r) => `${r.path}: ${r.error ?? "failed"}`).join("\n") || "apply failed";
      }
    } catch (e) {
      p.status = "error";
      p.applyError = e instanceof Error ? e.message : String(e);
    } finally {
      applyBusyId.value = null;
    }
  }

  return {
    experimentalEnabled,
    workspaceRoot,
    panelOpen,
    pendingPatches,
    applyBusyId,
    setExperimental,
    setPanelOpen,
    setWorkspaceRoot,
    onActiveSessionChanged,
    ingestFinishedAssistantStream: enqueuePatchesFromText,
    discardPatch,
    clearDiscarded,
    pickWorkspace,
    applyPatch,
  };
});
