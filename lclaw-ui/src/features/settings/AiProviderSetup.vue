<script setup lang="ts">
import { PROVIDER_CATALOG, type ProviderCatalogEntry } from "@/lib/provider-catalog";
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import { useChatStore } from "@/stores/chat";
import { afterOpenClawModelConfigSaved, afterOpenClawProvidersSaved } from "@/composables/modelConfigDeferred";
import { ref, watch } from "vue";

const props = defineProps<{ open: boolean }>();

const chat = useChatStore();

/** 已从 OpenClaw 读取的 provider 配置快照 */
const savedProviders = ref<Record<string, Record<string, unknown>>>({});
/** 当前主力模型，如 "zai/glm-5" */
const currentPrimary = ref("");

/** 展开的卡片 id */
const expandedId = ref<string | null>(null);
/** 编辑中的 API Key */
const editingKey = ref("");
/** 是否显示明文 */
const showKey = ref(false);
/** 当前选择的接口节点：main | alt */
const nodeChoice = ref<"main" | "alt">("main");
/** 可编辑的接口地址 */
const editingBaseUrl = ref("");
/** 可编辑的模型列表（comma-separated 编辑态） */
const modelEditMode = ref(false);
const modelEditText = ref("");

const busy = ref(false);
const toast = ref<string | null>(null);
const toastTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const error = ref<string | null>(null);

function setToast(msg: string) {
  toast.value = msg;
  error.value = null;
  if (toastTimer.value) clearTimeout(toastTimer.value);
  toastTimer.value = setTimeout(() => { toast.value = null; }, 5000);
}

watch(() => props.open, (v) => {
  if (v) void loadAll();
  else {
    expandedId.value = null;
    toast.value = null;
    error.value = null;
  }
}, { immediate: true });

async function loadAll() {
  const api = getDidClawDesktopApi();
  if (!api) return;
  try {
    const [pr, mr] = await Promise.all([
      api.readOpenClawProviders?.(),
      api.readOpenClawModelConfig?.(),
    ]);
    if (pr?.ok && pr.providers) {
      const next: Record<string, Record<string, unknown>> = {};
      for (const [k, v] of Object.entries(pr.providers)) {
        if (v && typeof v === "object" && !Array.isArray(v)) {
          next[k] = v as Record<string, unknown>;
        }
      }
      savedProviders.value = next;
    }
    if (mr?.ok && mr.model?.primary) {
      currentPrimary.value = String(mr.model.primary);
    }
  } catch { /* ignore */ }
}

function isConfigured(entry: ProviderCatalogEntry): boolean {
  const snap = savedProviders.value[entry.id];
  if (!snap) return false;
  if (!entry.apiKeyRequired) return true;
  const k = snap.apiKey;
  return typeof k === "string" && k.trim().length > 0;
}

function isPrimary(entry: ProviderCatalogEntry): boolean {
  return currentPrimary.value.startsWith(entry.id + "/");
}

function currentPrimaryLabel(): string {
  if (!currentPrimary.value) return "未设置";
  const [pid, mid] = currentPrimary.value.split("/");
  const entry = PROVIDER_CATALOG.find((e) => e.id === pid);
  return entry ? `${entry.icon} ${entry.name} · ${mid}` : currentPrimary.value;
}

function expandCard(entry: ProviderCatalogEntry) {
  if (expandedId.value === entry.id) {
    expandedId.value = null;
    return;
  }
  expandedId.value = entry.id;
  showKey.value = false;
  modelEditMode.value = false;
  nodeChoice.value = "main";
  // 填充已有 Key
  const snap = savedProviders.value[entry.id];
  const existingKey = snap?.apiKey;
  editingKey.value = typeof existingKey === "string" ? existingKey : "";
  // 填充已有接口地址（优先已保存的，否则取目录默认）
  const existingUrl = snap?.baseUrl ?? snap?.baseURL;
  editingBaseUrl.value = typeof existingUrl === "string" && existingUrl.trim()
    ? existingUrl.trim()
    : entry.baseUrl;
  // 模型列表
  const currentModels = modelsFromSnap(snap, entry);
  modelEditText.value = currentModels.join(", ");
}

function modelsFromSnap(snap: Record<string, unknown> | undefined, entry: ProviderCatalogEntry): string[] {
  const raw = snap?.models;
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((m) => (m && typeof m === "object" ? (m as { id?: string }).id ?? "" : String(m))).filter(Boolean);
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return Object.keys(raw as Record<string, unknown>);
  }
  return entry.models.slice();
}

function activeBaseUrl(entry: ProviderCatalogEntry): string {
  return nodeChoice.value === "alt" && entry.baseUrlAlt ? entry.baseUrlAlt : entry.baseUrl;
}

/** 切换节点时将预置地址同步到输入框 */
function onNodeChange(entry: ProviderCatalogEntry, choice: "main" | "alt") {
  nodeChoice.value = choice;
  editingBaseUrl.value = activeBaseUrl(entry);
}

function editedModels(entry: ProviderCatalogEntry): string[] {
  // modelEditText 在 expandCard 时由 snap 初始化，用户编辑后保持最新值。
  // 无论编辑模式是否关闭（"完成"按钮只切显示形态），只要文本非空就以它为准；
  // 仅在文本为空时（未展开过该卡片）回退到 snap / 目录默认值。
  if (modelEditMode.value || modelEditText.value.trim()) {
    return modelEditText.value
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const snap = savedProviders.value[entry.id];
  return modelsFromSnap(snap, entry);
}

async function applyProvider(entry: ProviderCatalogEntry, setPrimary: boolean) {
  const api = getDidClawDesktopApi();
  if (!api?.writeOpenClawProvidersPatch || !api?.writeOpenClawModelConfig) return;

  error.value = null;
  busy.value = true;
  try {
    const models: Record<string, Record<string, unknown>> = {};
    for (const mid of editedModels(entry)) {
      models[mid] = {};
    }
    const providerBody: Record<string, unknown> = {
      baseUrl: editingBaseUrl.value.trim() || activeBaseUrl(entry),
      models,
      ...entry.extras,
    };
    if (entry.apiKeyRequired) {
      providerBody.apiKey = editingKey.value.trim();
    } else {
      // Ollama needs a placeholder key
      providerBody.apiKey = "ollama-local";
    }

    const pr = await api.writeOpenClawProvidersPatch({ patch: { [entry.id]: providerBody } });
    if (!pr.ok) {
      error.value = String(pr.error || "保存失败");
      return;
    }

    // Read current model config to preserve models from other providers
    const existingConfig = await api.readOpenClawModelConfig?.();
    const existingModels: Record<string, Record<string, unknown>> = {};
    if (existingConfig?.ok) {
      const em = existingConfig.models as Record<string, unknown> | undefined;
      if (em && typeof em === "object") {
        for (const [k, v] of Object.entries(em)) {
          // Keep models that belong to other providers
          if (!k.startsWith(`${entry.id}/`)) {
            existingModels[k] = (v && typeof v === "object" && !Array.isArray(v))
              ? (v as Record<string, unknown>)
              : {};
          }
        }
      }
    }

    // Build model refs for this provider: "providerId/modelId"
    const thisProviderModels: Record<string, Record<string, unknown>> = {};
    for (const mid of editedModels(entry)) {
      thisProviderModels[`${entry.id}/${mid}`] = {};
    }
    const mergedModels = { ...existingModels, ...thisProviderModels };

    const primaryRef = `${entry.id}/${entry.defaultModel}`;
    const mr = await api.writeOpenClawModelConfig({
      model: setPrimary ? { primary: primaryRef } : undefined,
      models: mergedModels,
    });
    if (!mr.ok) {
      error.value = String(mr.error || "设置模型失败");
      return;
    }
    if (setPrimary) {
      currentPrimary.value = primaryRef;
    }

    // 刷新
    savedProviders.value = {
      ...savedProviders.value,
      [entry.id]: { ...providerBody },
    };
    expandedId.value = null;
    modelEditMode.value = false;
    void chat.refreshOpenClawModelPicker();
    chat.flashOpenClawConfigHint();
    afterOpenClawProvidersSaved();
    if (setPrimary) afterOpenClawModelConfigSaved();
    setToast(setPrimary
      ? `✓ 已保存并将 ${entry.name} 设为主力模型`
      : `✓ ${entry.name} 配置已保存`);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

async function removeProvider(entry: ProviderCatalogEntry) {
  if (!window.confirm(`确定移除「${entry.name}」的配置？`)) return;
  const api = getDidClawDesktopApi();
  if (!api?.writeOpenClawProvidersPatch) return;
  busy.value = true;
  try {
    await api.writeOpenClawProvidersPatch({ patch: { [entry.id]: null } });
    const next = { ...savedProviders.value };
    delete next[entry.id];
    savedProviders.value = next;
    if (currentPrimary.value.startsWith(entry.id + "/")) {
      currentPrimary.value = "";
    }
    expandedId.value = null;
    void chat.refreshOpenClawModelPicker();
    setToast(`已移除 ${entry.name}`);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="aips">
    <!-- 当前主力模型 -->
    <div class="aips-primary-bar" :class="{ 'aips-primary-bar--set': currentPrimary }">
      <span class="aips-primary-label">当前主力模型</span>
      <span class="aips-primary-value">{{ currentPrimaryLabel() }}</span>
    </div>

    <!-- 反馈 -->
    <p v-if="toast" class="aips-toast">{{ toast }}</p>
    <p v-if="error" class="aips-error">{{ error }}</p>

    <!-- 服务商卡片网格 -->
    <div class="aips-grid">
      <div
        v-for="entry in PROVIDER_CATALOG"
        :key="entry.id"
        class="aips-card"
        :class="{
          'aips-card--active': expandedId === entry.id,
          'aips-card--configured': isConfigured(entry),
          'aips-card--primary': isPrimary(entry),
        }"
        :style="{ '--card-color': entry.color }"
        @click="expandCard(entry)"
      >
        <div class="aips-card-body">
          <div class="aips-card-name">{{ entry.name }}</div>
          <div class="aips-card-desc">{{ entry.description }}</div>
        </div>
        <div class="aips-card-status">
          <span v-if="isPrimary(entry)" class="aips-badge aips-badge--primary">主力</span>
          <span v-else-if="isConfigured(entry)" class="aips-badge aips-badge--ok">已配置</span>
        </div>
      </div>
    </div>

    <!-- 展开配置面板 -->
    <Transition name="aips-panel">
      <div v-if="expandedId" class="aips-panel">
        <template v-for="entry in PROVIDER_CATALOG" :key="entry.id">
          <template v-if="entry.id === expandedId">
            <div class="aips-panel-head" :style="{ borderColor: entry.color }">
              <span class="aips-panel-title">{{ entry.name }}</span>
              <a v-if="entry.docsUrl" :href="entry.docsUrl" target="_blank" rel="noopener" class="aips-panel-docs">文档 ↗</a>
              <button type="button" class="aips-panel-close" @click="expandedId = null">✕</button>
            </div>

            <!-- 接口地址 -->
            <div class="aips-field">
              <div class="aips-field-label-row">
                <span class="aips-field-label">接口地址</span>
                <div v-if="entry.baseUrlAlt" class="aips-node-pills">
                  <button
                    type="button"
                    class="aips-node-pill"
                    :class="{ 'aips-node-pill--active': nodeChoice === 'main' }"
                    @click="onNodeChange(entry, 'main')"
                  >{{ entry.baseUrlLabel }}</button>
                  <button
                    type="button"
                    class="aips-node-pill"
                    :class="{ 'aips-node-pill--active': nodeChoice === 'alt' }"
                    @click="onNodeChange(entry, 'alt')"
                  >{{ entry.baseUrlAltLabel }}</button>
                </div>
              </div>
              <input
                v-model="editingBaseUrl"
                type="text"
                class="aips-key-input"
                placeholder="https://..."
                autocomplete="off"
                spellcheck="false"
              />
            </div>

            <!-- API Key -->
            <div v-if="entry.apiKeyRequired" class="aips-field">
              <span class="aips-field-label">API Key</span>
              <div class="aips-key-row">
                <input
                  v-model="editingKey"
                  :type="showKey ? 'text' : 'password'"
                  class="aips-key-input"
                  :placeholder="entry.apiKeyPlaceholder"
                  autocomplete="off"
                />
                <button type="button" class="aips-ghost-btn aips-eye-btn" @click="showKey = !showKey">
                  {{ showKey ? "隐藏" : "显示" }}
                </button>
              </div>
            </div>
            <div v-else class="aips-field">
              <span class="aips-field-label">API Key</span>
              <span class="aips-url-hint">无需密钥，直接应用即可</span>
            </div>

            <!-- 模型列表 -->
            <div class="aips-field">
              <div class="aips-field-label-row">
                <span class="aips-field-label">模型</span>
                <button type="button" class="aips-ghost-btn aips-sm-btn"
                  @click="() => { modelEditMode = !modelEditMode; if (modelEditMode) modelEditText = editedModels(entry).join(', ') }">
                  {{ modelEditMode ? "完成" : "编辑" }}
                </button>
              </div>
              <template v-if="modelEditMode">
                <textarea
                  v-model="modelEditText"
                  class="aips-model-textarea"
                  placeholder="每行或用逗号分隔，如: glm-5, glm-4.7"
                  rows="3"
                />
                <p class="aips-hint">每行或逗号分隔一个模型 ID，点"应用"后写入配置</p>
              </template>
              <template v-else>
                <div class="aips-model-chips">
                  <span
                    v-for="m in editedModels(entry)"
                    :key="m"
                    class="aips-chip"
                    :class="{ 'aips-chip--default': m === entry.defaultModel }"
                  >{{ m }}</span>
                </div>
                <p class="aips-hint">默认主力：<strong>{{ entry.defaultModel }}</strong>（应用后自动设置）</p>
              </template>
            </div>

            <!-- 操作按钮 -->
            <div class="aips-panel-actions">
              <button
                v-if="isConfigured(entry)"
                type="button"
                class="aips-ghost-btn aips-danger-btn"
                :disabled="busy"
                @click="removeProvider(entry)"
              >移除</button>
              <div class="aips-panel-actions-right">
                <button type="button" class="aips-ghost-btn" @click="expandedId = null">取消</button>
                <button
                  v-if="!isPrimary(entry)"
                  type="button"
                  class="aips-primary-btn aips-ghost-btn"
                  :disabled="busy || (entry.apiKeyRequired && !editingKey.trim())"
                  @click="applyProvider(entry, false)"
                >{{ busy ? "保存中…" : "仅保存" }}</button>
                <button
                  type="button"
                  class="aips-apply-btn"
                  :disabled="busy || (entry.apiKeyRequired && !editingKey.trim())"
                  @click="applyProvider(entry, true)"
                >{{ busy ? "应用中…" : isPrimary(entry) ? "更新" : "应用并设为主力" }}</button>
              </div>
            </div>
          </template>
        </template>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.aips {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ── 主力模型状态栏 ── */
.aips-primary-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: var(--lc-radius-sm);
  background: var(--lc-bg-elevated);
  border: 1px solid var(--lc-border);
  font-size: 12px;
}
.aips-primary-bar--set {
  border-color: rgba(6,182,212,0.4);
  background: var(--lc-accent-soft);
}
.aips-primary-label {
  color: var(--lc-text-muted);
  font-weight: 600;
  flex-shrink: 0;
}
.aips-primary-value {
  color: var(--lc-accent);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── 反馈 ── */
.aips-toast {
  font-size: 12px;
  color: #16a34a;
  margin: 0;
  padding: 6px 10px;
  background: rgba(34,197,94,0.08);
  border-radius: var(--lc-radius-sm);
  border: 1px solid rgba(34,197,94,0.25);
}
.aips-error {
  font-size: 12px;
  color: var(--lc-error);
  margin: 0;
  padding: 6px 10px;
  background: var(--lc-error-bg, rgba(239,68,68,0.08));
  border-radius: var(--lc-radius-sm);
  border: 1px solid rgba(239,68,68,0.25);
}

/* ── 卡片网格 ── */
.aips-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
}
.aips-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--lc-border);
  border-left: 3px solid var(--card-color, var(--lc-border));
  border-radius: var(--lc-radius-sm);
  background: var(--lc-bg-raised);
  cursor: pointer;
  transition: box-shadow 0.15s, transform 0.1s, background 0.15s;
  user-select: none;
}
.aips-card:hover {
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  transform: translateY(-1px);
  background: var(--lc-bg-elevated);
}
.aips-card--active {
  border-color: var(--card-color, var(--lc-accent));
  background: var(--lc-bg-elevated);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--card-color, var(--lc-accent)) 20%, transparent);
}
.aips-card--primary {
  border-left-width: 3px;
}
.aips-card-body {
  flex: 1;
  min-width: 0;
}
.aips-card-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--lc-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aips-card-desc {
  font-size: 10px;
  color: var(--lc-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
}
.aips-card-status {
  flex-shrink: 0;
}

/* ── 徽章 ── */
.aips-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 10px;
}
.aips-badge--ok {
  background: rgba(34,197,94,0.12);
  color: #16a34a;
}
.aips-badge--primary {
  background: rgba(6,182,212,0.12);
  color: var(--lc-accent);
}
[data-theme="dark"] .aips-badge--ok { color: #4ade80; }
[data-theme="dark"] .aips-badge--primary { color: #67e8f9; }

/* ── 配置面板 ── */
.aips-panel {
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  padding: 14px 16px;
  background: var(--lc-bg-elevated);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.aips-panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 2px solid var(--lc-border);
}
.aips-panel-title {
  flex: 1;
  font-weight: 700;
  font-size: 14px;
}
.aips-panel-docs {
  font-size: 11px;
  color: var(--lc-accent);
  text-decoration: none;
}
.aips-panel-docs:hover { text-decoration: underline; }
.aips-panel-close {
  background: transparent;
  border: none;
  color: var(--lc-text-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 2px 6px;
  border-radius: 4px;
}
.aips-panel-close:hover { color: var(--lc-text); background: var(--lc-bg-raised); }

/* ── 字段 ── */
.aips-field, .aips-url-line {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.aips-field-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.aips-field-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--lc-text-muted);
}
.aips-url-hint {
  font-size: 11px;
  color: var(--lc-text-dim, var(--lc-text-muted));
  font-family: var(--lc-mono);
}

/* ── 节点选择 ── */
.aips-node-pills {
  display: flex;
  gap: 6px;
}
.aips-node-pill {
  font-size: 11px;
  font-weight: 500;
  padding: 3px 10px;
  border-radius: 12px;
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-raised);
  color: var(--lc-text-muted);
  cursor: pointer;
  transition: all 0.15s;
}
.aips-node-pill--active {
  border-color: var(--lc-accent);
  background: var(--lc-accent-soft);
  color: var(--lc-accent);
}

/* ── Key 输入 ── */
.aips-key-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.aips-key-input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  font-size: 12px;
  font-family: var(--lc-mono);
  background: var(--lc-bg-deep, var(--lc-bg-raised));
  color: var(--lc-text);
}
.aips-key-input:focus {
  outline: none;
  border-color: var(--lc-border-strong);
}

/* ── 模型 chips ── */
.aips-model-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.aips-chip {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--lc-bg-raised);
  border: 1px solid var(--lc-border);
  color: var(--lc-text-muted);
  font-family: var(--lc-mono);
}
.aips-chip--default {
  border-color: var(--lc-accent);
  color: var(--lc-accent);
  background: var(--lc-accent-soft);
}
.aips-model-textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  font-size: 12px;
  font-family: var(--lc-mono);
  background: var(--lc-bg-deep, var(--lc-bg-raised));
  color: var(--lc-text);
  resize: vertical;
  box-sizing: border-box;
}
.aips-hint {
  font-size: 11px;
  color: var(--lc-text-muted);
  margin: 0;
}

/* ── 操作按钮 ── */
.aips-panel-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--lc-border);
  margin-top: 4px;
}
.aips-panel-actions-right {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.aips-ghost-btn {
  background: transparent;
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  color: var(--lc-text-muted);
  font-size: 12px;
  font-family: inherit;
  padding: 6px 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.aips-ghost-btn:hover:not(:disabled) {
  border-color: var(--lc-border-strong);
  color: var(--lc-text);
}
.aips-ghost-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.aips-eye-btn { padding: 6px 10px; white-space: nowrap; }
.aips-sm-btn { padding: 3px 8px; font-size: 11px; }
.aips-danger-btn { color: var(--lc-error); border-color: rgba(239,68,68,0.35); }
.aips-danger-btn:hover:not(:disabled) { background: var(--lc-error-bg, rgba(239,68,68,0.08)); }
.aips-primary-btn { color: var(--lc-accent); border-color: rgba(6,182,212,0.4); }
.aips-apply-btn {
  background: linear-gradient(135deg, #0e7490, #0891b2);
  border: none;
  border-radius: var(--lc-radius-sm);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  padding: 6px 14px;
  cursor: pointer;
  transition: opacity 0.15s;
}
.aips-apply-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.aips-apply-btn:hover:not(:disabled) { opacity: 0.9; }

/* ── 面板展开动画 ── */
.aips-panel-enter-active,
.aips-panel-leave-active {
  transition: opacity 0.18s, transform 0.18s;
}
.aips-panel-enter-from,
.aips-panel-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
