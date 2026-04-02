<script setup lang="ts">
import { usePheromoneStore } from "@/stores/pheromone";
import { storeToRefs } from "pinia";
import { computed, ref, watch, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [v: boolean] }>();

const { t } = useI18n();
const store = usePheromoneStore();
const { graph, loaded, lastError, runsSinceInject } = storeToRefs(store);

const injecting = ref(false);
const resetting = ref(false);
const injectDone = ref(false);
const viewMode = ref<"list" | "graph">("list");

const hotNodes = computed(() => store.topNodes(14));
const hotEdges = computed(() => store.topEdges(8));
const blockedPoints = computed(() => graph.value.blockedPoints.slice(-6).reverse());
const trails = computed(() => (graph.value.trails ?? []).slice(-8).reverse());
const dormantCount = computed(() =>
  Object.values(graph.value.nodes).filter((n) => n.dormant).length,
);
const totalTopics = computed(() => Object.keys(graph.value.nodes).length);

function strengthBars(s: number): string {
  const filled = Math.round(s * 5);
  return "█".repeat(filled) + "░".repeat(5 - filled);
}

function strengthClass(s: number): string {
  if (s >= 0.6) return "strength-high";
  if (s >= 0.3) return "strength-mid";
  return "strength-low";
}

async function doInject(): Promise<void> {
  injecting.value = true;
  injectDone.value = false;
  try {
    await store.forceInject();
    injectDone.value = true;
    setTimeout(() => { injectDone.value = false; }, 3000);
  } finally {
    injecting.value = false;
  }
}

async function doReset(): Promise<void> {
  if (!confirm(t("pheromone.resetConfirm"))) return;
  resetting.value = true;
  try {
    await store.resetGraph();
  } finally {
    resetting.value = false;
  }
}

// ── Force-directed graph ────────────────────────────────────────────────────

const canvasRef = ref<HTMLCanvasElement | null>(null);
let animId = 0;

interface FNode { id: string; x: number; y: number; vx: number; vy: number; strength: number; blocked?: boolean }
interface FEdge { a: string; b: string; weight: number; bridge: boolean }

function buildForceData() {
  const nodes: FNode[] = store.topNodes(20).map(([id, n]) => ({
    id, x: Math.random() * 400 + 80, y: Math.random() * 260 + 60,
    vx: 0, vy: 0, strength: n.strength, blocked: n.blocked,
  }));
  const nodeIds = new Set(nodes.map(n => n.id));
  const edges: FEdge[] = Object.entries(graph.value.edges)
    .filter(([k]) => {
      const [a, b] = k.split("→");
      return nodeIds.has(a) && nodeIds.has(b);
    })
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, 30)
    .map(([k, e]) => {
      const [a, b] = k.split("→");
      return { a, b, weight: e.weight, bridge: e.weight < 1 };
    });
  return { nodes, edges };
}

function startGraphLoop() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  stopGraphLoop();
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width = canvas.offsetWidth;
  const H = canvas.height = canvas.offsetHeight;

  const { nodes, edges } = buildForceData();
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  function tick() {
    // Repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const f = 3000 / (d * d);
        a.vx -= (dx / d) * f; a.vy -= (dy / d) * f;
        b.vx += (dx / d) * f; b.vy += (dy / d) * f;
      }
    }
    // Spring attraction along edges
    for (const e of edges) {
      const a = nodeMap.get(e.a), b = nodeMap.get(e.b);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const target = 120, f = (d - target) * 0.015;
      a.vx += (dx / d) * f; a.vy += (dy / d) * f;
      b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    }
    // Center gravity + damping + clamp
    for (const n of nodes) {
      n.vx += (W / 2 - n.x) * 0.002;
      n.vy += (H / 2 - n.y) * 0.002;
      n.vx *= 0.85; n.vy *= 0.85;
      n.x = Math.max(40, Math.min(W - 40, n.x + n.vx));
      n.y = Math.max(30, Math.min(H - 30, n.y + n.vy));
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    // Edges
    for (const e of edges) {
      const a = nodeMap.get(e.a), b = nodeMap.get(e.b);
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = e.bridge
        ? "rgba(99,102,241,0.25)"   // bridge edges: purple, faint
        : `rgba(99,179,237,${Math.min(0.7, e.weight * 0.15 + 0.15)})`;
      ctx.lineWidth = e.bridge ? 1 : Math.min(3, e.weight * 0.4 + 0.5);
      ctx.setLineDash(e.bridge ? [4, 4] : []);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Nodes
    for (const n of nodes) {
      const r = Math.max(14, Math.min(28, n.strength * 32 + 12));
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = n.blocked
        ? "rgba(245,158,11,0.85)"
        : `rgba(99,179,237,${0.3 + n.strength * 0.55})`;
      ctx.fill();
      ctx.strokeStyle = n.blocked ? "#f59e0b" : "#63b3ed";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Label
      ctx.fillStyle = "#e2e8f0";
      ctx.font = `${Math.max(10, Math.min(13, r * 0.75))}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label = n.id.length > 6 ? n.id.slice(0, 6) + "…" : n.id;
      ctx.fillText(label, n.x, n.y);
    }
  }

  function frame() {
    tick(); draw();
    animId = requestAnimationFrame(frame);
  }
  animId = requestAnimationFrame(frame);
}

function stopGraphLoop() {
  if (animId) { cancelAnimationFrame(animId); animId = 0; }
}

watch(viewMode, (v) => {
  if (v === "graph") setTimeout(startGraphLoop, 60);
  else stopGraphLoop();
});

onUnmounted(stopGraphLoop);

watch(() => props.modelValue, (open) => {
  if (open && !loaded.value) store.load();
  if (open && viewMode.value === "graph") setTimeout(startGraphLoop, 100);
  if (!open) stopGraphLoop();
}, { immediate: true });

function close(): void {
  emit("update:modelValue", false);
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") close();
}
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="ph-backdrop" @click.self="close" @keydown="onKeydown">
      <div class="ph-panel" role="dialog" aria-modal="true" tabindex="-1">
        <!-- Header -->
        <div class="ph-head">
          <h2 class="ph-title">{{ t("pheromone.title") }}</h2>
          <div class="ph-head-right">
            <div class="ph-view-toggle">
              <button :class="['ph-toggle-btn', viewMode === 'list' && 'active']" @click="viewMode = 'list'">≡</button>
              <button :class="['ph-toggle-btn', viewMode === 'graph' && 'active']" @click="viewMode = 'graph'">⬡</button>
            </div>
            <button type="button" class="ph-close-btn" @click="close" :aria-label="t('common.close')">✕</button>
          </div>
        </div>

        <!-- Graph view -->
        <canvas v-if="viewMode === 'graph'" ref="canvasRef" class="ph-canvas" />

        <!-- Body -->
        <div v-if="viewMode === 'list'" class="ph-scroll">
          <div v-if="!loaded" class="ph-empty">
            <span class="ph-dim">{{ t("pheromone.loading") }}</span>
          </div>

          <div v-else class="ph-body">
            <!-- Stats bar -->
            <div class="ph-stats-row">
              <span class="ph-stat">
                <strong>{{ totalTopics }}</strong>
                <span class="ph-dim">{{ t("pheromone.topics") }}</span>
              </span>
              <span class="ph-stat">
                <strong>{{ hotEdges.length }}</strong>
                <span class="ph-dim">{{ t("pheromone.edges") }}</span>
              </span>
              <span class="ph-stat">
                <strong>{{ dormantCount }}</strong>
                <span class="ph-dim">{{ t("pheromone.dormant") }}</span>
              </span>
              <span class="ph-stat">
                <strong>{{ graph.lastDecay || "—" }}</strong>
                <span class="ph-dim">{{ t("pheromone.lastDecay") }}</span>
              </span>
            </div>

            <!-- Hot nodes -->
            <div class="ph-section">
              <div class="ph-section-title">🔥 {{ t("pheromone.hotTopics") }}</div>
              <div v-if="hotNodes.length === 0" class="ph-dim ph-empty-note">
                {{ t("pheromone.noData") }}
              </div>
              <div v-else class="ph-node-list">
                <div
                  v-for="[topic, node] in hotNodes"
                  :key="topic"
                  class="ph-node-row"
                >
                  <span class="ph-topic" :title="`count: ${node.count}`">{{ topic }}</span>
                  <span class="ph-bars" :class="strengthClass(node.strength)">
                    {{ strengthBars(node.strength) }}
                  </span>
                  <span class="ph-depth ph-dim">D{{ Math.round(node.depth) }}</span>
                  <span v-if="node.blocked" class="ph-badge ph-badge-blocked">⚠</span>
                </div>
              </div>
            </div>

            <!-- Edges -->
            <div v-if="hotEdges.length > 0" class="ph-section">
              <div class="ph-section-title">🔗 {{ t("pheromone.associations") }}</div>
              <div class="ph-edge-list">
                <div v-for="[edge, e] in hotEdges" :key="edge" class="ph-edge-row">
                  <span class="ph-edge-label">{{ edge.replace("→", " → ") }}</span>
                  <span class="ph-edge-weight ph-dim">×{{ Math.round(e.weight) }}</span>
                </div>
              </div>
            </div>

            <!-- Cognitive trails -->
            <div v-if="trails.length > 0" class="ph-section">
              <div class="ph-section-title">🧭 {{ t("pheromone.trails") }}</div>
              <div class="ph-trail-list">
                <div v-for="tr in trails" :key="tr.date + tr.entry" class="ph-trail-row">
                  <span class="ph-trail-emotion">{{ { A:'⚡', B:'✨', C:'🌧', N:'·' }[tr.emotion] }}</span>
                  <span class="ph-trail-entry">{{ tr.entry }}</span>
                  <span class="ph-trail-arrow ph-dim">→</span>
                  <span class="ph-trail-exit">{{ tr.exit }}</span>
                  <span class="ph-trail-date ph-dim">{{ tr.date }}</span>
                </div>
              </div>
            </div>

            <!-- Blocked points -->
            <div v-if="blockedPoints.length > 0" class="ph-section">
              <div class="ph-section-title">🧱 {{ t("pheromone.blocked") }}</div>
              <div class="ph-blocked-list">
                <div v-for="b in blockedPoints" :key="b.node" class="ph-blocked-row">
                  <span class="ph-badge ph-badge-blocked">{{ b.node }}</span>
                  <span class="ph-dim ph-blocked-ctx">{{ b.context.slice(0, 50) }}…</span>
                </div>
              </div>
            </div>

            <!-- Error -->
            <div v-if="lastError" class="ph-error">{{ lastError }}</div>

            <!-- Footer note -->
            <div class="ph-footer-note ph-dim">
              {{ t("pheromone.injectNote", { runs: runsSinceInject }) }}
            </div>
          </div>
        </div>

        <!-- Footer actions -->
        <div class="ph-foot">
          <button
            type="button"
            class="ph-btn ph-btn-danger"
            :disabled="resetting"
            @click="doReset"
          >
            {{ resetting ? "…" : t("pheromone.reset") }}
          </button>
          <div class="ph-foot-right">
            <span v-if="injectDone" class="ph-inject-done">✓ {{ t("pheromone.injected") }}</span>
            <button
              type="button"
              class="ph-btn ph-btn-primary"
              :disabled="injecting"
              @click="doInject"
            >
              {{ injecting ? "…" : t("pheromone.injectNow") }}
            </button>
            <button type="button" class="ph-btn" @click="close">
              {{ t("common.close") }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ph-backdrop {
  position: fixed;
  inset: 0;
  z-index: 12000;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ph-panel {
  background: var(--lc-surface-panel);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  width: 560px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  box-shadow: var(--lc-shadow-sm);
}

/* Header */
.ph-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--lc-border);
  flex-shrink: 0;
}
.ph-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--lc-text);
}
.ph-close-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--lc-text-muted);
  font-size: 14px;
  padding: 2px 6px;
  border-radius: 4px;
}
.ph-close-btn:hover { background: var(--lc-hover); color: var(--lc-text); }

/* Scrollable body */
.ph-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  min-height: 0;
}

.ph-body { display: flex; flex-direction: column; gap: 14px; }
.ph-empty { padding: 24px 0; text-align: center; }
.ph-dim { opacity: 0.55; font-size: 0.85em; }

.ph-stats-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  padding: 10px 12px;
  background: var(--lc-bg-elevated);
  border-radius: var(--lc-radius-sm);
}
.ph-stat { display: flex; flex-direction: column; gap: 2px; }
.ph-stat strong { font-size: 1.05em; }

.ph-section-title { font-weight: 600; font-size: 0.88em; margin-bottom: 6px; }
.ph-section { display: flex; flex-direction: column; }

.ph-node-list { display: flex; flex-direction: column; gap: 4px; }
.ph-node-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 6px;
  border-radius: 4px;
}
.ph-node-row:hover { background: var(--lc-bg-elevated); }
.ph-topic { flex: 1; font-size: 0.92em; font-weight: 500; }
.ph-bars { font-family: monospace; letter-spacing: 1px; font-size: 0.82em; }
.strength-high { color: #22c55e; }
.strength-mid  { color: #f59e0b; }
.strength-low  { color: var(--lc-text-muted); }
.ph-depth { min-width: 20px; text-align: right; }

.ph-edge-list { display: flex; flex-direction: column; gap: 4px; }
.ph-edge-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 6px;
  border-radius: 4px;
  font-size: 0.88em;
}
.ph-edge-row:hover { background: var(--lc-bg-elevated); }
.ph-edge-weight { min-width: 30px; text-align: right; }

.ph-trail-list { display: flex; flex-direction: column; gap: 4px; }
.ph-trail-row {
  display: flex; align-items: center; gap: 6px;
  padding: 3px 6px; border-radius: 4px; font-size: 0.88em;
}
.ph-trail-row:hover { background: var(--lc-bg-elevated); }
.ph-trail-emotion { min-width: 16px; text-align: center; }
.ph-trail-entry { font-weight: 600; }
.ph-trail-exit { font-weight: 600; }
.ph-trail-date { margin-left: auto; font-size: 0.8em; }

.ph-blocked-list { display: flex; flex-direction: column; gap: 4px; }
.ph-blocked-row { display: flex; align-items: center; gap: 8px; font-size: 0.86em; }
.ph-blocked-ctx { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.ph-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 0.78em;
  font-weight: 600;
}
.ph-badge-blocked {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
}

.ph-empty-note { padding: 8px 0; }
.ph-error { color: #ef4444; font-size: 0.85em; }
.ph-footer-note { font-size: 0.8em; margin-top: 4px; }

/* Footer */
.ph-canvas {
  flex: 1;
  width: 100%;
  min-height: 320px;
  display: block;
  background: var(--lc-bg-elevated);
}

.ph-head-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ph-view-toggle {
  display: flex;
  border: 1px solid var(--lc-border);
  border-radius: 6px;
  overflow: hidden;
}

.ph-toggle-btn {
  background: none;
  border: none;
  padding: 3px 10px;
  cursor: pointer;
  color: var(--lc-text-muted);
  font-size: 14px;
  transition: background 0.15s;
}
.ph-toggle-btn.active {
  background: var(--lc-bg-elevated);
  color: var(--lc-text);
}
.ph-toggle-btn:hover:not(.active) { background: var(--lc-hover); }

.ph-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px 16px;
  border-top: 1px solid var(--lc-border);
  flex-shrink: 0;
}
.ph-foot-right { display: flex; align-items: center; gap: 8px; }
.ph-inject-done { color: #22c55e; font-size: 0.88em; }

.ph-btn {
  padding: 5px 14px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-raised);
  color: var(--lc-text);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}
.ph-btn:hover:not(:disabled) { background: var(--lc-bg-elevated); }
.ph-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.ph-btn-primary {
  background: var(--lc-accent, #2563eb);
  color: #fff;
  border-color: transparent;
}
.ph-btn-primary:hover:not(:disabled) { filter: brightness(1.1); }
.ph-btn-danger {
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.3);
}
.ph-btn-danger:hover:not(:disabled) { background: rgba(239, 68, 68, 0.08); }
</style>
