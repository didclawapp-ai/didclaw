/**
 * Pheromone Memory Store
 *
 * Watches chat run completions, extracts topics from the last exchange,
 * updates the local pheromone graph, and periodically injects the memory
 * section into AGENTS.md.
 *
 * This store is purely additive — it never modifies existing store logic.
 */

import {
  applyDecay,
  emptyGraph,
  extractTopics,
  generateMemorySection,
  shouldInjectMemory,
  type PheromoneGraph,
  updateGraph,
} from "@/lib/pheromone-engine";
import { getDidClawDesktopApi, isDidClawDesktop } from "@/lib/electron-bridge";
import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { useChatStore } from "./chat";

const RUNS_SINCE_INJECT_KEY = "pheromone_runs_since_inject";

export const usePheromoneStore = defineStore("pheromone", () => {
  const graph = ref<PheromoneGraph>(emptyGraph());
  const loaded = ref(false);
  const loading = ref(false);
  const lastError = ref<string | null>(null);
  const runsSinceInject = ref(0);

  // ── persistence ──────────────────────────────────────────────────────────

  async function load(): Promise<void> {
    if (!isDidClawDesktop()) return;
    if (loading.value) return;
    const api = getDidClawDesktopApi();
    if (!api?.readPheromoneGraph) return;
    loading.value = true;
    try {
      const raw = await api.readPheromoneGraph();
      if (raw && typeof raw === "object" && "nodes" in raw) {
        graph.value = raw as PheromoneGraph;
      }
      // Restore run counter from KV (best-effort; errors don't block load)
      try {
        const stored = await api.didclawKvGet(RUNS_SINCE_INJECT_KEY);
        runsSinceInject.value = stored ? parseInt(stored, 10) || 0 : 0;
      } catch {
        // KV not available; keep default 0
      }
      loaded.value = true;
    } catch (e) {
      lastError.value = String(e);
      // Mark loaded anyway so we don't retry every run
      loaded.value = true;
    } finally {
      loading.value = false;
    }
  }

  async function persist(): Promise<void> {
    if (!isDidClawDesktop()) return;
    const api = getDidClawDesktopApi();
    if (!api?.writePheromoneGraph) return;
    try {
      await api.writePheromoneGraph(graph.value);
      try {
        await api.didclawKvSet(RUNS_SINCE_INJECT_KEY, String(runsSinceInject.value));
      } catch {
        // KV not available; graph still saved
      }
    } catch (e) {
      lastError.value = String(e);
    }
  }

  // ── decay (once per day) ─────────────────────────────────────────────────

  function maybeDecay(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (graph.value.lastDecay !== today) {
      graph.value = applyDecay(graph.value);
    }
  }

  // ── AGENTS.md injection ──────────────────────────────────────────────────

  async function injectMemory(): Promise<void> {
    if (!isDidClawDesktop()) return;
    const api = getDidClawDesktopApi();
    if (!api?.injectPheromoneAgentsMd) return;
    try {
      const content = generateMemorySection(graph.value);
      await api.injectPheromoneAgentsMd(content, undefined);
      runsSinceInject.value = 0;
    } catch (e) {
      lastError.value = String(e);
    }
  }

  // ── main hook: called after each completed run ────────────────────────────

  async function onRunCompleted(messages: unknown[]): Promise<void> {
    if (!isDidClawDesktop()) return;
    if (!loaded.value) await load();

    maybeDecay();

    // Find the last user→assistant pair from recent messages
    const msgs = messages as Array<Record<string, unknown>>;
    let userText = "";
    let assistantText = "";

    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      const role = m.role as string | undefined;
      const content = (m.content ?? m.text ?? "") as string;
      if (!assistantText && role === "assistant") {
        assistantText = typeof content === "string" ? content : "";
      } else if (!userText && role === "user") {
        userText = typeof content === "string" ? content : "";
      }
      if (userText && assistantText) break;
    }

    if (!userText && !assistantText) return;

    graph.value = updateGraph(graph.value, userText, assistantText);
    runsSinceInject.value += 1;

    await persist();

    if (shouldInjectMemory(graph.value, runsSinceInject.value)) {
      await injectMemory();
      await persist();
    }
  }

  // ── wire up: watch chat store for run completion ─────────────────────────

  function init(): void {
    const chatStore = useChatStore();
    watch(
      () => chatStore.lastCompletedRunAtMs,
      async (newVal, oldVal) => {
        if (newVal !== null && newVal !== oldVal) {
          await onRunCompleted(chatStore.messages);
        }
      },
    );
  }

  // ── public API ───────────────────────────────────────────────────────────

  function topNodes(limit = 10) {
    return Object.entries(graph.value.nodes)
      .filter(([, n]) => !n.dormant)
      .sort((a, b) => b[1].strength - a[1].strength)
      .slice(0, limit);
  }

  function topEdges(limit = 6) {
    return Object.entries(graph.value.edges)
      .sort((a, b) => b[1].weight - a[1].weight)
      .slice(0, limit);
  }

  /** Quick topic list for external use (e.g. debug display) */
  function previewTopics(): string[] {
    return topNodes(5).map(([k]) => k);
  }

  /** Force-inject memory to AGENTS.md (user-triggered from UI) */
  async function forceInject(): Promise<void> {
    await injectMemory();
    await persist();
  }

  /** Reset graph (user-triggered from UI) */
  async function resetGraph(): Promise<void> {
    graph.value = emptyGraph();
    runsSinceInject.value = 0;
    await persist();
  }

  /** Re-extract topics from arbitrary text (used for testing) */
  function previewExtract(text: string): string[] {
    return extractTopics(text);
  }

  return {
    graph,
    loaded,
    lastError,
    runsSinceInject,
    load,
    init,
    topNodes,
    topEdges,
    previewTopics,
    forceInject,
    resetGraph,
    previewExtract,
  };
});
