<script setup lang="ts">
import { afterOpenClawModelConfigSaved, afterOpenClawProvidersSaved } from "@/composables/modelConfigDeferred";
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import {
  buildAiProviderViews,
  buildFallbackSuggestions,
  buildProviderEditorState,
  readOpenClawAiSnapshot,
  stripProviderModelRefs,
  type OpenClawAiProviderView,
  type OpenClawAiSnapshot,
} from "@/lib/openclaw-ai-config";
import {
  findCatalogEntry,
  IMAGE_GEN_CATALOG,
  type ImageGenCatalogEntry,
} from "@/lib/provider-catalog";
import { useChatStore } from "@/stores/chat";
import { computed, ref, watch } from "vue";

const props = defineProps<{ open: boolean }>();

const chat = useChatStore();

const aiSnapshot = ref<OpenClawAiSnapshot>({
  defaultAgentId: "main",
  providers: {},
  model: {},
  models: {},
  primaryModel: "",
  fallbacks: [],
  modelRefs: [],
  imageGenerationModel: "",
});
const fallbackModels = ref<string[]>([]);
const fallbackInput = ref("");
const fallbackBusy = ref(false);

const expandedId = ref<string | null>(null);
const editingKey = ref("");
const showKey = ref(false);
const nodeChoice = ref<"main" | "alt">("main");
const editingBaseUrl = ref("");
const modelEditMode = ref(false);
const modelEditText = ref("");

/** 展开面板时，用户对图片生成的选择（嵌入式，已废弃，保留以防编译错误） */
const imageModelChoice = ref<string>("");

/** 当前展开的图片生成卡 id */
const expandedImgId = ref<string | null>(null);
/** 图片生成卡编辑中的 API Key */
const imgEditingKey = ref("");
const imgShowKey = ref(false);
const imgBusy = ref(false);

const busy = ref(false);
const toast = ref<string | null>(null);
const toastTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const error = ref<string | null>(null);

function setToast(msg: string) {
  toast.value = msg;
  error.value = null;
  if (toastTimer.value) {
    clearTimeout(toastTimer.value);
  }
  toastTimer.value = setTimeout(() => {
    toast.value = null;
  }, 5000);
}

const providerGroups = computed(() => buildAiProviderViews(aiSnapshot.value));
const recommendedProviders = computed(() => providerGroups.value.recommended);
const detectedProviders = computed(() => providerGroups.value.detected);
const allProviders = computed(() => providerGroups.value.all);
const currentPrimary = computed(() => aiSnapshot.value.primaryModel);
const availableFallbackSuggestions = computed(() => buildFallbackSuggestions({
  ...aiSnapshot.value,
  fallbacks: fallbackModels.value,
}));
const expandedProvider = computed<OpenClawAiProviderView | null>(() =>
  allProviders.value.find((item) => item.id === expandedId.value) ?? null,
);

watch(
  () => props.open,
  (v) => {
    if (v) {
      void loadAll();
    } else {
      expandedId.value = null;
      toast.value = null;
      error.value = null;
    }
  },
  { immediate: true },
);

async function loadAll() {
  try {
    const snapshot = await readOpenClawAiSnapshot();
    aiSnapshot.value = snapshot;
    fallbackModels.value = [...snapshot.fallbacks];
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

function addFallback(model: string): void {
  const v = model.trim();
  if (!v || fallbackModels.value.includes(v)) {
    return;
  }
  fallbackModels.value = [...fallbackModels.value, v];
  fallbackInput.value = "";
}

function removeFallback(model: string): void {
  fallbackModels.value = fallbackModels.value.filter((m) => m !== model);
}

async function saveFallbacks(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.writeOpenClawModelConfig) {
    return;
  }
  fallbackBusy.value = true;
  try {
    const r = await api.writeOpenClawModelConfig({ model: { fallbacks: fallbackModels.value } });
    if (!r.ok) {
      error.value = String(r.error || "保存失败");
      return;
    }
    aiSnapshot.value = {
      ...aiSnapshot.value,
      fallbacks: [...fallbackModels.value],
      model: { ...aiSnapshot.value.model, fallbacks: [...fallbackModels.value] },
    };
    setToast("备用模型已保存");
    afterOpenClawModelConfigSaved();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    fallbackBusy.value = false;
  }
}

function currentPrimaryLabel(): string {
  if (!currentPrimary.value) {
    return "未设置";
  }
  const provider = allProviders.value.find((item) => currentPrimary.value.startsWith(`${item.id}/`));
  if (!provider) {
    return currentPrimary.value;
  }
  const modelId = currentPrimary.value.slice(provider.id.length + 1);
  return `${provider.icon} ${provider.displayName} · ${modelId}`;
}

function activeBaseUrl(view: OpenClawAiProviderView): string {
  if (nodeChoice.value === "alt" && view.baseUrlAlt) {
    return view.baseUrlAlt;
  }
  return view.catalog?.baseUrl ?? view.baseUrl;
}

function useMainNode(): void {
  if (!expandedProvider.value) {
    return;
  }
  nodeChoice.value = "main";
  editingBaseUrl.value = expandedProvider.value.catalog?.baseUrl ?? expandedProvider.value.baseUrl;
}

function useAltNode(): void {
  if (!expandedProvider.value?.baseUrlAlt) {
    return;
  }
  nodeChoice.value = "alt";
  editingBaseUrl.value = expandedProvider.value.baseUrlAlt;
}

function resolveProviderModels(view: OpenClawAiProviderView): string[] {
  if (modelEditMode.value || modelEditText.value.trim()) {
    return modelEditText.value
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return view.models;
}

function expandCard(view: OpenClawAiProviderView) {
  if (expandedId.value === view.id) {
    expandedId.value = null;
    return;
  }
  expandedId.value = view.id;
  showKey.value = false;
  modelEditMode.value = false;

  const editor = buildProviderEditorState(view.id, aiSnapshot.value);
  editingKey.value = editor.apiKey;
  editingBaseUrl.value = editor.baseUrl || view.baseUrl || view.catalog?.baseUrl || "";
  nodeChoice.value =
    view.baseUrlAlt && editingBaseUrl.value.trim() === view.baseUrlAlt.trim() ? "alt" : "main";
  modelEditText.value = (editor.modelIds.length > 0 ? editor.modelIds : view.models).join(", ");

  // Initialize image model choice from current snapshot or provider default
  const currentImgModel = aiSnapshot.value.imageGenerationModel;
  if (view.catalog?.imageModels?.length) {
    const providerOwnsCurrentImg = view.catalog.imageModels.includes(currentImgModel);
    imageModelChoice.value = providerOwnsCurrentImg ? currentImgModel : "";
  } else {
    imageModelChoice.value = "";
  }
}

function preferredPrimaryRef(view: OpenClawAiProviderView, modelIds: string[]): string {
  const current = currentPrimary.value;
  if (current.startsWith(`${view.id}/`)) {
    const currentModel = current.slice(view.id.length + 1);
    if (modelIds.includes(currentModel)) {
      return current;
    }
  }
  if (view.defaultModel && modelIds.includes(view.defaultModel)) {
    return `${view.id}/${view.defaultModel}`;
  }
  return `${view.id}/${modelIds[0]}`;
}

function expandedProviderModels(): string[] {
  return expandedProvider.value ? resolveProviderModels(expandedProvider.value) : [];
}

function expandedProviderDefaultModel(): string {
  return expandedProvider.value?.defaultModel || "未设置";
}

function providerModelsSummary(view: OpenClawAiProviderView): string {
  if (!view.models.length) {
    return "尚未检测到模型";
  }
  return view.modelsSource === "configured"
    ? `${view.models.length} 个已配置模型`
    : `${view.models.length} 个推荐模型`;
}

async function applyProvider(view: OpenClawAiProviderView, setPrimary: boolean) {
  const api = getDidClawDesktopApi();
  if (!api?.writeOpenClawProvidersPatch || !api?.writeOpenClawModelConfig) {
    return;
  }

  const modelIds = resolveProviderModels(view);
  if (modelIds.length === 0) {
    error.value = "至少保留一个模型 ID。";
    return;
  }

  error.value = null;
  busy.value = true;
  try {
    const models: Record<string, Record<string, unknown>> = {};
    for (const mid of modelIds) {
      models[mid] = {};
    }

    const providerBody: Record<string, unknown> = {
      baseUrl: editingBaseUrl.value.trim() || activeBaseUrl(view),
      models,
      ...view.extras,
    };
    const keyToWrite = editingKey.value.trim();
    // Reject masked placeholder values (e.g. "sk-a****") returned by the read API
    const isRealKey = keyToWrite && !keyToWrite.endsWith("****");
    if (view.apiKeyRequired || isRealKey) {
      if (isRealKey) providerBody.apiKey = keyToWrite;
    }

    const pr = await api.writeOpenClawProvidersPatch({ patch: { [view.id]: providerBody } });
    if (!pr.ok) {
      error.value = String(pr.error || "保存失败");
      return;
    }

    const existingModels: Record<string, Record<string, unknown>> = {};
    for (const [ref, body] of Object.entries(aiSnapshot.value.models)) {
      if (!ref.startsWith(`${view.id}/`)) {
        existingModels[ref] = { ...body };
      }
    }
    for (const modelId of modelIds) {
      const ref = `${view.id}/${modelId}`;
      const previous = aiSnapshot.value.models[ref];
      existingModels[ref] = previous ? { ...previous } : {};
    }

    const nextPrimaryRef = preferredPrimaryRef(view, modelIds);
    const modelPatch: Record<string, unknown> = {};
    if (setPrimary) modelPatch.primary = nextPrimaryRef;
    const mr = await api.writeOpenClawModelConfig({
      model: Object.keys(modelPatch).length > 0 ? modelPatch : undefined,
      models: existingModels,
    });
    if (!mr.ok) {
      error.value = String(mr.error || "设置模型失败");
      return;
    }

    // If this provider has image generation capability, also sync the env var
    // so image generation plugins can find the key without manual setup
    const savedKey = editingKey.value.trim();
    if (savedKey && view.catalog?.imageModels?.length && api.writeOpenClawEnv) {
      const imgEntry = IMAGE_GEN_CATALOG.find((e) => e.providerId === view.id);
      if (imgEntry) {
        await api.writeOpenClawEnv({ patch: { [imgEntry.envKey]: savedKey } });
      }
    }

    await loadAll();
    expandedId.value = null;
    modelEditMode.value = false;
    void chat.refreshOpenClawModelPicker();
    chat.flashOpenClawConfigHint();
    afterOpenClawProvidersSaved();
    afterOpenClawModelConfigSaved();
    setToast(
      setPrimary
        ? `✓ 已保存并将 ${view.displayName} 设为主力模型`
        : `✓ ${view.displayName} 配置已保存`,
    );
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

async function removeProvider(view: OpenClawAiProviderView) {
  if (!window.confirm(`确定移除「${view.displayName}」的配置？`)) {
    return;
  }
  const api = getDidClawDesktopApi();
  if (!api?.writeOpenClawProvidersPatch || !api.writeOpenClawModelConfig) {
    return;
  }
  busy.value = true;
  try {
    const r = await api.writeOpenClawProvidersPatch({ patch: { [view.id]: null } });
    if (!r.ok) {
      error.value = String(r.error || "移除失败");
      return;
    }
    const trimmed = stripProviderModelRefs(aiSnapshot.value, view.id);
    const mr = await api.writeOpenClawModelConfig({
      model: {
        primary: trimmed.primaryModel,
        fallbacks: trimmed.fallbacks,
      },
      models: trimmed.models,
    });
    if (!mr.ok) {
      error.value = String(mr.error || "清理模型引用失败");
      return;
    }
    // Clean up env var if this provider had image generation
    if (view.catalog?.imageModels?.length && api.writeOpenClawEnv) {
      const imgEntry = IMAGE_GEN_CATALOG.find((e) => e.providerId === view.id);
      if (imgEntry) {
        await api.writeOpenClawEnv({ patch: { [imgEntry.envKey]: null } });
      }
    }

    await loadAll();
    expandedId.value = null;
    void chat.refreshOpenClawModelPicker();
    chat.flashOpenClawConfigHint();
    afterOpenClawProvidersSaved();
    afterOpenClawModelConfigSaved();
    setToast(`已移除 ${view.displayName}`);
  } finally {
    busy.value = false;
  }
}

// ── 图片生成卡 ────────────────────────────────────────────────

/** 展开 / 折叠图片生成卡，并预填 Key */
function toggleImgCard(entry: ImageGenCatalogEntry) {
  if (expandedImgId.value === entry.id) {
    expandedImgId.value = null;
    imgEditingKey.value = "";
    imgShowKey.value = false;
    return;
  }
  expandedImgId.value = entry.id;
  imgShowKey.value = false;
  // 预填：若对应聊天 provider 已配置，从 providers 里取 key
  const providerData = aiSnapshot.value.providers?.[entry.providerId] as
    | Record<string, unknown>
    | undefined;
  imgEditingKey.value = typeof providerData?.apiKey === "string"
    ? providerData.apiKey
    : "";
}

async function applyImageGen(entry: ImageGenCatalogEntry) {
  const api = getDidClawDesktopApi();
  if (!api?.writeOpenClawModelConfig) return;

  imgBusy.value = true;
  try {
    // If key is given, also ensure provider is configured with all required fields
    const keyTrimmed = imgEditingKey.value.trim();
    if (keyTrimmed && api.writeOpenClawProvidersPatch) {
      const existing = aiSnapshot.value.providers?.[entry.providerId] as
        | Record<string, unknown>
        | undefined;
      const provEntry = findCatalogEntry(entry.providerId);
      const models: Record<string, Record<string, unknown>> = {};
      if (existing?.models && typeof existing.models === "object") {
        Object.assign(models, existing.models);
      } else if (provEntry?.models) {
        for (const m of provEntry.models) models[m] = {};
      }
      // Ensure catalog defaults (baseUrl, api, authHeader etc.) are always present
      // so the provider is fully valid even when user configures image gen first
      const providerPatch: Record<string, unknown> = {
        ...(provEntry?.baseUrl ? { baseUrl: provEntry.baseUrl } : {}),
        ...(provEntry?.extras ?? {}),
        ...existing,
        apiKey: keyTrimmed,
        models,
      };
      await api.writeOpenClawProvidersPatch({
        patch: { [entry.providerId]: providerPatch },
      });
    }

    // Write imageGenerationModel at agents.defaults level (NOT inside agents.defaults.model)
    const mr = await api.writeOpenClawModelConfig({
      imageGenerationModel: { primary: entry.modelRef },
    });
    if (!mr.ok) {
      error.value = String(mr.error || "保存图片生成模型失败");
      return;
    }

    // Write env var so the image generation plugin can find the key
    // Exclude masked placeholder values (e.g. "sk-a****") from the read API
    const resolvedKey = (() => {
      const typed = imgEditingKey.value.trim();
      if (typed && !typed.endsWith("****")) return typed;
      const pd = aiSnapshot.value.providers?.[entry.providerId] as Record<string, unknown> | undefined;
      const stored = typeof pd?.apiKey === "string" ? pd.apiKey : "";
      return stored.endsWith("****") ? "" : stored;
    })();
    if (resolvedKey && api.writeOpenClawEnv) {
      await api.writeOpenClawEnv({ patch: { [entry.envKey]: resolvedKey } });
    }

    await loadAll();
    expandedImgId.value = null;
    imgEditingKey.value = "";
    afterOpenClawModelConfigSaved();
    setToast(`✓ 图片生成已开启（${entry.modelLabel}）— 请重启网关后生效`);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    imgBusy.value = false;
  }
}

async function removeImageGen() {
  const api = getDidClawDesktopApi();
  if (!api?.writeOpenClawModelConfig) return;
  const mr = await api.writeOpenClawModelConfig({ imageGenerationModel: null });
  if (mr.ok) {
    await loadAll();
    setToast("已关闭图片生成");
  }
}
</script>

<template>
  <div class="aips">
    <div class="aips-primary-bar" :class="{ 'aips-primary-bar--set': currentPrimary }">
      <span class="aips-primary-label">当前主力模型</span>
      <span class="aips-primary-value">{{ currentPrimaryLabel() }}</span>
    </div>

    <div class="aips-fallback">
      <div class="aips-fallback-head">
        <span class="aips-fallback-title">备用模型（故障切换）</span>
        <span class="aips-fallback-hint">主力不可用时依序尝试</span>
      </div>
      <div class="aips-fallback-chips">
        <template v-if="fallbackModels.length">
          <span
            v-for="m in fallbackModels"
            :key="m"
            class="aips-fallback-chip"
          >
            {{ m }}
            <button type="button" class="aips-fallback-chip-del" :aria-label="`移除 ${m}`" @click.stop="removeFallback(m)">×</button>
          </span>
        </template>
        <span v-else class="aips-fallback-empty">未配置</span>
      </div>
      <div class="aips-fallback-add">
        <select
          v-if="availableFallbackSuggestions.length"
          class="aips-fallback-select"
          @change="(e) => { addFallback((e.target as HTMLSelectElement).value); (e.target as HTMLSelectElement).value = '' }"
        >
          <option value="">+ 从已配置模型选择…</option>
          <option v-for="s in availableFallbackSuggestions" :key="s" :value="s">{{ s }}</option>
        </select>
        <div class="aips-fallback-manual">
          <input
            v-model="fallbackInput"
            type="text"
            class="aips-key-input"
            placeholder="或手动输入 provider/model…"
            @keydown.enter.prevent="addFallback(fallbackInput)"
          />
          <button
            type="button"
            class="aips-ghost-btn aips-sm-btn"
            :disabled="!fallbackInput.trim()"
            @click="addFallback(fallbackInput)"
          >添加</button>
        </div>
        <button
          type="button"
          class="aips-ghost-btn aips-sm-btn aips-fallback-save"
          :disabled="fallbackBusy"
          @click="saveFallbacks"
        >{{ fallbackBusy ? "保存中…" : "保存" }}</button>
      </div>
    </div>

    <!-- 反馈 -->
    <p v-if="toast" class="aips-toast">{{ toast }}</p>
    <p v-if="error" class="aips-error">{{ error }}</p>

    <div class="aips-section">
      <div class="aips-section-head">
        <h3 class="aips-section-title">推荐服务</h3>
        <p class="aips-section-hint">保留适合普通用户的推荐卡片，但优先显示 OpenClaw 当前真实配置。</p>
      </div>
      <div class="aips-grid">
        <div
          v-for="provider in recommendedProviders"
          :key="provider.id"
          class="aips-card"
          :class="{
            'aips-card--active': expandedId === provider.id,
            'aips-card--configured': provider.isConfigured,
            'aips-card--primary': provider.isPrimary,
          }"
          :style="{ '--card-color': provider.color }"
          @click="expandCard(provider)"
        >
          <div class="aips-card-body">
            <div class="aips-card-name">{{ provider.displayName }}</div>
            <div class="aips-card-desc">{{ provider.description }}</div>
            <div class="aips-card-meta">
              <span>{{ providerModelsSummary(provider) }}</span>
              <span v-if="provider.baseUrl" class="aips-card-meta-mono">{{ provider.baseUrl }}</span>
            </div>
          </div>
          <div class="aips-card-status">
            <span v-if="provider.catalog?.imageModels?.length" class="aips-badge aips-badge--img" title="此服务商支持 AI 图片生成">🎨</span>
            <span v-if="provider.isPrimary" class="aips-badge aips-badge--primary">主力</span>
            <span v-else-if="provider.authState === 'configured'" class="aips-badge aips-badge--ok">已配置</span>
            <span v-else-if="provider.authState === 'notRequired'" class="aips-badge aips-badge--neutral">免密钥</span>
            <span v-else class="aips-badge aips-badge--warn">待配置</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ── 图片生成 ──────────────────────────────────────────── -->
    <div class="aips-section">
      <div class="aips-section-head">
        <h3 class="aips-section-title">图片生成</h3>
        <p class="aips-section-hint">
          开启后，在聊天中描述想要的图片，AI 会直接绘图并显示在对话里。
          <template v-if="aiSnapshot.imageGenerationModel">
            当前：<strong>{{ aiSnapshot.imageGenerationModel }}</strong>
            <button type="button" class="aips-img-off-btn" @click="removeImageGen">关闭</button>
          </template>
        </p>
      </div>
      <div class="aips-grid">
        <template v-for="imgEntry in IMAGE_GEN_CATALOG" :key="imgEntry.id">
          <!-- Collapsed card -->
          <div
            v-if="expandedImgId !== imgEntry.id"
            class="aips-card aips-card--img"
            :class="{ 'aips-card--configured': aiSnapshot.imageGenerationModel === imgEntry.modelRef }"
            :style="{ '--card-color': imgEntry.color }"
            @click="toggleImgCard(imgEntry)"
          >
            <div class="aips-card-head">
              <span class="aips-card-icon" :style="{ background: imgEntry.color + '22', color: imgEntry.color }">
                {{ imgEntry.icon }}
              </span>
              <div class="aips-card-meta">
                <span class="aips-card-name">{{ imgEntry.name }}</span>
                <span class="aips-card-desc">{{ imgEntry.description }}</span>
                <span class="aips-card-model-hint">{{ imgEntry.modelLabel }}</span>
              </div>
            </div>
            <div class="aips-card-footer">
              <span
                class="aips-status-tag"
                :class="aiSnapshot.imageGenerationModel === imgEntry.modelRef ? 'aips-status-tag--on' : 'aips-status-tag--off'"
              >
                {{ aiSnapshot.imageGenerationModel === imgEntry.modelRef ? '已开启' : '未开启' }}
              </span>
            </div>
          </div>

          <!-- Expanded card -->
          <div
            v-else
            class="aips-card aips-card--img aips-card--active aips-card--expanded"
            :style="{ '--card-color': imgEntry.color }"
          >
            <div class="aips-panel-header">
              <span class="aips-panel-icon" :style="{ background: imgEntry.color + '22', color: imgEntry.color }">{{ imgEntry.icon }}</span>
              <span class="aips-panel-name">{{ imgEntry.name }}</span>
              <span class="aips-panel-model">{{ imgEntry.modelLabel }}</span>
            </div>
            <p class="aips-hint" style="margin-bottom:12px;">
              开启后在对话中直接描述图片，AI 即可绘制并嵌入对话。图片生成使用与对话相同的 API Key，已在上方配置过则自动预填。
            </p>
            <div class="aips-field">
              <label class="aips-field-label">API Key</label>
              <div class="aips-key-row">
                <input
                  v-model="imgEditingKey"
                  :type="imgShowKey ? 'text' : 'password'"
                  class="aips-input"
                  :placeholder="imgEntry.apiKeyPlaceholder"
                  autocomplete="off"
                />
                <button type="button" class="aips-ghost-btn" @click="imgShowKey = !imgShowKey">
                  {{ imgShowKey ? '隐藏' : '显示' }}
                </button>
              </div>
              <p class="aips-hint">不填则直接复用已配置的 Key，填写后会同步更新。</p>
            </div>
            <div class="aips-panel-actions">
              <button type="button" class="aips-ghost-btn" :disabled="imgBusy" @click="toggleImgCard(imgEntry)">取消</button>
              <button
                type="button"
                class="aips-primary-btn"
                :disabled="imgBusy"
                @click="applyImageGen(imgEntry)"
              >
                {{ imgBusy ? '保存中…' : '开启图片生成' }}
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>

    <div v-if="detectedProviders.length" class="aips-section">
      <div class="aips-section-head">
        <h3 class="aips-section-title">检测到的其他配置</h3>
        <p class="aips-section-hint">这些 Provider 来自你当前的 OpenClaw 配置，未纳入推荐卡片目录。</p>
      </div>
      <div class="aips-grid">
        <div
          v-for="provider in detectedProviders"
          :key="provider.id"
          class="aips-card"
          :class="{
            'aips-card--active': expandedId === provider.id,
            'aips-card--configured': provider.isConfigured,
            'aips-card--primary': provider.isPrimary,
          }"
          :style="{ '--card-color': provider.color }"
          @click="expandCard(provider)"
        >
          <div class="aips-card-body">
            <div class="aips-card-name">{{ provider.displayName }}</div>
            <div class="aips-card-desc">{{ provider.description }}</div>
            <div class="aips-card-meta">
              <span>{{ provider.id }}</span>
              <span v-if="provider.models.length">{{ providerModelsSummary(provider) }}</span>
            </div>
          </div>
          <div class="aips-card-status">
            <span class="aips-badge aips-badge--neutral">已检测</span>
          </div>
        </div>
      </div>
    </div>

    <Transition name="aips-panel">
      <div v-if="expandedProvider" class="aips-panel">
        <div class="aips-panel-head" :style="{ borderColor: expandedProvider.color }">
          <span class="aips-panel-title">{{ expandedProvider.displayName }}</span>
          <span class="aips-panel-source">{{ expandedProvider.source === "recommended" ? "推荐服务" : "检测到的配置" }}</span>
          <a
            v-if="expandedProvider.docsUrl"
            :href="expandedProvider.docsUrl"
            target="_blank"
            rel="noopener"
            class="aips-panel-docs"
          >文档 ↗</a>
          <button type="button" class="aips-panel-close" @click="expandedId = null">✕</button>
        </div>

        <div class="aips-field">
          <div class="aips-field-label-row">
            <span class="aips-field-label">接口地址</span>
            <div v-if="expandedProvider.baseUrlAlt" class="aips-node-pills">
              <button
                type="button"
                class="aips-node-pill"
                :class="{ 'aips-node-pill--active': nodeChoice === 'main' }"
                @click="useMainNode()"
              >{{ expandedProvider.baseUrlLabel }}</button>
              <button
                type="button"
                class="aips-node-pill"
                :class="{ 'aips-node-pill--active': nodeChoice === 'alt' }"
                @click="useAltNode()"
              >{{ expandedProvider.baseUrlAltLabel }}</button>
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

        <div v-if="expandedProvider.apiKeyRequired" class="aips-field">
          <span class="aips-field-label">API Key</span>
          <div class="aips-key-row">
            <input
              v-model="editingKey"
              :type="showKey ? 'text' : 'password'"
              class="aips-key-input"
              :placeholder="expandedProvider.catalog?.apiKeyPlaceholder || '粘贴 API Key'"
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

        <div class="aips-field">
          <div class="aips-field-label-row">
            <span class="aips-field-label">模型</span>
            <button
              type="button"
              class="aips-ghost-btn aips-sm-btn"
              @click="() => { modelEditMode = !modelEditMode; if (modelEditMode) modelEditText = expandedProviderModels().join(', '); }"
            >
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
            <p class="aips-hint">每行或逗号分隔一个模型 ID，点“应用”后写入配置。</p>
          </template>
          <template v-else>
            <div class="aips-model-chips">
              <span
                v-for="m in expandedProviderModels()"
                :key="m"
                class="aips-chip"
                :class="{ 'aips-chip--default': m === expandedProviderDefaultModel() }"
              >{{ m }}</span>
            </div>
            <p class="aips-hint">
              默认主力：<strong>{{ expandedProviderDefaultModel() }}</strong>
              （应用并设为主力时优先使用）
            </p>
            <p v-if="expandedProvider.modelsSource === 'recommended'" class="aips-hint">
              当前这里展示的是推荐默认模型；一旦保存，会同步写入 OpenClaw 配置。
            </p>
          </template>
        </div>

        <div class="aips-panel-actions">
          <button
            v-if="expandedProvider.raw"
            type="button"
            class="aips-ghost-btn aips-danger-btn"
            :disabled="busy"
            @click="removeProvider(expandedProvider)"
          >移除</button>
          <div class="aips-panel-actions-right">
            <button type="button" class="aips-ghost-btn" @click="expandedId = null">取消</button>
            <button
              v-if="!expandedProvider.isPrimary"
              type="button"
              class="aips-primary-btn aips-ghost-btn"
              :disabled="busy || (expandedProvider.apiKeyRequired && !editingKey.trim())"
              @click="applyProvider(expandedProvider, false)"
            >{{ busy ? "保存中…" : "仅保存" }}</button>
            <button
              type="button"
              class="aips-apply-btn"
              :disabled="busy || (expandedProvider.apiKeyRequired && !editingKey.trim())"
              @click="applyProvider(expandedProvider, true)"
            >{{ busy ? "应用中…" : expandedProvider.isPrimary ? "更新" : "应用并设为主力" }}</button>
          </div>
        </div>
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

.aips-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.aips-section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.aips-section-title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
}
.aips-section-hint {
  margin: 0;
  font-size: 11px;
  color: var(--lc-text-muted);
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
.aips-card-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
  font-size: 10px;
  color: var(--lc-text-dim, var(--lc-text-muted));
}
.aips-card-meta-mono {
  font-family: var(--lc-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
.aips-badge--warn {
  background: rgba(245, 158, 11, 0.12);
  color: #d97706;
}
.aips-badge--neutral {
  background: rgba(100, 116, 139, 0.12);
  color: #475569;
}
[data-theme="dark"] .aips-badge--ok { color: #4ade80; }
[data-theme="dark"] .aips-badge--primary { color: #67e8f9; }
[data-theme="dark"] .aips-badge--warn { color: #fbbf24; }
[data-theme="dark"] .aips-badge--neutral { color: #cbd5e1; }

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
.aips-panel-source {
  font-size: 11px;
  color: var(--lc-text-muted);
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

/* ── 备用模型 ── */
.aips-fallback {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--lc-radius-sm);
  background: var(--lc-bg-elevated);
  border: 1px solid var(--lc-border);
  font-size: 12px;
}
.aips-fallback-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.aips-fallback-title {
  font-weight: 600;
  color: var(--lc-text);
}
.aips-fallback-hint {
  color: var(--lc-text-muted);
}
.aips-fallback-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  min-height: 22px;
}
.aips-fallback-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--lc-accent-soft);
  color: var(--lc-accent);
  font-size: 11px;
  font-weight: 500;
  font-family: var(--lc-font-mono, monospace);
}
.aips-fallback-chip-del {
  background: none;
  border: none;
  color: var(--lc-text-muted);
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  padding: 0;
}
.aips-fallback-chip-del:hover { color: var(--lc-error); }
.aips-fallback-empty {
  color: var(--lc-text-dim, var(--lc-text-muted));
  font-style: italic;
}
.aips-fallback-add {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.aips-fallback-select {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  background: var(--lc-bg-raised);
  color: var(--lc-text);
  font-size: 12px;
  font-family: inherit;
}
.aips-fallback-manual {
  display: flex;
  gap: 6px;
}
.aips-fallback-manual .aips-key-input {
  flex: 1;
  padding: 5px 8px;
  font-size: 12px;
}
.aips-fallback-save {
  align-self: flex-start;
  color: var(--lc-accent);
  border-color: rgba(6,182,212,0.4);
}

/* ── 图片生成 ── */
.aips-badge--img {
  font-size: 13px;
  padding: 0 2px;
  background: transparent;
  border: none;
}
.aips-field--img {
  background: rgba(139, 92, 246, 0.04);
  border: 1px solid rgba(139, 92, 246, 0.18);
  border-radius: var(--lc-radius-sm);
  padding: 10px 12px;
  gap: 6px;
}
.aips-img-badge-new {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(139, 92, 246, 0.15);
  color: #7c3aed;
  letter-spacing: 0.04em;
}
.aips-img-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}
.aips-img-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-raised);
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
}
.aips-img-option:hover {
  border-color: rgba(139, 92, 246, 0.35);
  background: rgba(139, 92, 246, 0.06);
}
.aips-img-option--active {
  border-color: rgba(139, 92, 246, 0.5);
  background: rgba(139, 92, 246, 0.08);
}
.aips-img-radio {
  accent-color: #7c3aed;
  flex-shrink: 0;
}
.aips-img-option-label {
  font-size: 13px;
  color: var(--lc-text);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.aips-img-model-id {
  font-family: var(--lc-mono);
  font-size: 11px;
  color: var(--lc-text-muted);
  background: var(--lc-bg-elevated);
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--lc-border);
}
.aips-hint--ok {
  color: #16a34a;
  font-size: 11px;
}

/* ── 独立图片生成卡 ── */
.aips-card--img {
  cursor: pointer;
  align-items: flex-start;
  flex-direction: column;
  gap: 6px;
}
.aips-card--img .aips-card-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  min-width: 0;
}
.aips-card--img .aips-card-meta {
  flex: 1;
  min-width: 0;
}
.aips-card--img .aips-card-name {
  white-space: normal;
  overflow: visible;
}
.aips-card--img .aips-card-desc {
  white-space: normal;
  overflow: visible;
  text-overflow: unset;
  line-height: 1.4;
}
.aips-card--img .aips-card-model-hint {
  font-family: var(--lc-mono);
  font-size: 10px;
  color: var(--lc-text-muted);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.aips-status-tag {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  letter-spacing: 0.03em;
}
.aips-status-tag--on {
  background: rgba(22, 163, 74, 0.12);
  color: #15803d;
}
.aips-status-tag--off {
  background: var(--lc-bg-elevated);
  color: var(--lc-text-muted);
}
.aips-img-off-btn {
  border: none;
  background: none;
  color: var(--lc-text-muted);
  font-size: 11px;
  cursor: pointer;
  text-decoration: underline;
  padding: 0 4px;
  margin-left: 4px;
}
.aips-img-off-btn:hover {
  color: #dc2626;
}
.aips-card--expanded {
  grid-column: 1 / -1;
}
</style>
