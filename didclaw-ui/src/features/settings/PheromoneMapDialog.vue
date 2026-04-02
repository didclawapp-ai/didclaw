<script setup lang="ts">
import { usePheromoneStore } from "@/stores/pheromone";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [v: boolean] }>();

const { t } = useI18n();
const store = usePheromoneStore();
const { graph, loaded, lastError, runsSinceInject } = storeToRefs(store);

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
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('pheromone.title')"
    width="560px"
    @update:model-value="emit('update:modelValue', $event)"
  >
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
          <strong>{{ graph.lastDecay }}</strong>
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

    <template #footer>
      <div class="ph-actions">
        <el-button
          size="small"
          :loading="resetting"
          type="danger"
          plain
          @click="doReset"
        >
          {{ t("pheromone.reset") }}
        </el-button>
        <div class="ph-actions-right">
          <span v-if="injectDone" class="ph-inject-done">✓ {{ t("pheromone.injected") }}</span>
          <el-button
            size="small"
            :loading="injecting"
            type="primary"
            @click="doInject"
          >
            {{ t("pheromone.injectNow") }}
          </el-button>
          <el-button size="small" @click="emit('update:modelValue', false)">
            {{ t("common.close") }}
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.ph-body { display: flex; flex-direction: column; gap: 14px; }
.ph-empty { padding: 24px 0; text-align: center; }
.ph-dim { opacity: 0.55; font-size: 0.85em; }

.ph-stats-row {
  display: flex; gap: 16px; flex-wrap: wrap;
  padding: 10px 12px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
}
.ph-stat { display: flex; flex-direction: column; gap: 2px; }
.ph-stat strong { font-size: 1.05em; }

.ph-section-title { font-weight: 600; font-size: 0.88em; margin-bottom: 6px; }
.ph-section { display: flex; flex-direction: column; }

.ph-node-list { display: flex; flex-direction: column; gap: 4px; }
.ph-node-row {
  display: flex; align-items: center; gap: 8px;
  padding: 3px 6px; border-radius: 4px;
}
.ph-node-row:hover { background: var(--el-fill-color); }
.ph-topic { flex: 1; font-size: 0.92em; font-weight: 500; }
.ph-bars { font-family: monospace; letter-spacing: 1px; font-size: 0.82em; }
.strength-high { color: var(--el-color-success); }
.strength-mid  { color: var(--el-color-warning); }
.strength-low  { color: var(--el-text-color-placeholder); }
.ph-depth { min-width: 20px; text-align: right; }

.ph-edge-list { display: flex; flex-direction: column; gap: 4px; }
.ph-edge-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 3px 6px; border-radius: 4px; font-size: 0.88em;
}
.ph-edge-row:hover { background: var(--el-fill-color); }
.ph-edge-weight { min-width: 30px; text-align: right; }

.ph-blocked-list { display: flex; flex-direction: column; gap: 4px; }
.ph-blocked-row { display: flex; align-items: center; gap: 8px; font-size: 0.86em; }
.ph-blocked-ctx { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.ph-badge {
  display: inline-block; padding: 1px 6px;
  border-radius: 4px; font-size: 0.78em; font-weight: 600;
}
.ph-badge-blocked {
  background: var(--el-color-warning-light-8);
  color: var(--el-color-warning);
}

.ph-empty-note { padding: 8px 0; }
.ph-error { color: var(--el-color-danger); font-size: 0.85em; }
.ph-footer-note { font-size: 0.8em; margin-top: 4px; }

.ph-actions {
  display: flex; justify-content: space-between; align-items: center;
}
.ph-actions-right { display: flex; align-items: center; gap: 8px; }
.ph-inject-done { color: var(--el-color-success); font-size: 0.88em; }
</style>
