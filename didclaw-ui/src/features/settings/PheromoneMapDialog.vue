<script setup lang="ts">
import { usePheromoneStore } from "@/stores/pheromone";
import { storeToRefs } from "pinia";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [v: boolean] }>();

const { t } = useI18n();
const store = usePheromoneStore();
const { graph, loaded, lastError, runsSinceInject } = storeToRefs(store);

watch(() => props.modelValue, (open) => {
  if (open && !loaded.value) store.load();
}, { immediate: true });

const injecting = ref(false);
const resetting = ref(false);
const injectDone = ref(false);

const hotNodes = computed(() => store.topNodes(14));
const hotEdges = computed(() => store.topEdges(8));
const blockedPoints = computed(() => graph.value.blockedPoints.slice(-6).reverse());
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
          <button type="button" class="ph-close-btn" @click="close" :aria-label="t('common.close')">✕</button>
        </div>

        <!-- Body -->
        <div class="ph-scroll">
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
