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
  shouldPatchProviderApiKey,
  shouldWriteEnvVar,
} from "@/lib/ai-provider-write-policy";
import {
  findCatalogEntry,
  IMAGE_GEN_CATALOG,
  type ImageGenCatalogEntry,
} from "@/lib/provider-catalog";
import { useChatStore } from "@/stores/chat";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

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
  envVars: {},
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

/** user image model choice when panel open (deprecated inline field, kept to avoid compile errors) */
const imageModelChoice = ref<string>("");

/** id of the currently expanded image generation card */
const expandedImgId = ref<string | null>(null);
/** API key being edited in the image gen card */
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

/** known CN provider IDs for region filter */
const CN_PROVIDER_IDS = new Set([
  "kimi", "moonshot", "deepseek", "zhipu", "minimax", "qwen", "tongyi",
  "baidu", "ernie", "mimo", "xiaomi", "baichuan", "hunyuan", "spark", "yi",
  "siliconflow", "stepfun", "doubao", "volcengine", "lingyiwanwu",
]);
/** known local/self-hosted provider IDs */
const LOCAL_PROVIDER_IDS = new Set([
  "ollama", "lmstudio", "oobabooga", "jan", "koboldcpp", "localai", "xinference",
]);

const providerSearchQuery = ref("");
const providerTagFilter = ref("all");
const showFallbackEditor = ref(false);

const filteredProviders = computed(() => {
  const q = providerSearchQuery.value.toLowerCase().trim();
  const tag = providerTagFilter.value;
  return allProviders.value.filter((p) => {
    if (tag === "configured" && !p.isConfigured) return false;
    if (tag === "recommended" && p.source !== "recommended") return false;
    if (tag === "cn" && !CN_PROVIDER_IDS.has(p.id)) return false;
    if (tag === "intl" && (CN_PROVIDER_IDS.has(p.id) || LOCAL_PROVIDER_IDS.has(p.id))) return false;
    if (tag === "local" && !LOCAL_PROVIDER_IDS.has(p.id)) return false;
    if (q && !p.displayName.toLowerCase().includes(q) && !p.id.toLowerCase().includes(q)
        && !(p.description?.toLowerCase().includes(q))) return false;
    return true;
  });
});

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
      error.value = String(r.error || t('aiProvider.saveFailed'));
      return;
    }
    aiSnapshot.value = {
      ...aiSnapshot.value,
      fallbacks: [...fallbackModels.value],
      model: { ...aiSnapshot.value.model, fallbacks: [...fallbackModels.value] },
    };
    setToast(t('aiProvider.fallbackSaved'));
    afterOpenClawModelConfigSaved();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    fallbackBusy.value = false;
  }
}

function currentPrimaryLabel(): string {
  if (!currentPrimary.value) {
    return t('aiProvider.notSet');
  }
  const provider = allProviders.value.find((item) => currentPrimary.value.startsWith(`${item.id}/`));
  if (!provider) {
    return currentPrimary.value;
  }
  const modelId = currentPrimary.value.slice(provider.id.length + 1);
  return `${provider.displayName} · ${modelId}`;
}

function focusPrimaryProvider(): void {
  if (!currentPrimary.value) {
    return;
  }
  const provider = allProviders.value.find((item) => currentPrimary.value.startsWith(`${item.id}/`));
  if (provider) {
    expandCard(provider);
  }
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
  // MiniMax portal token plans may not include the highspeed tier.
  // Prefer the standard M2.7 model when switching this provider back to primary.
  if ((view.id === "minimax-portal" || view.id === "minimax-portal-cn") && modelIds.includes("MiniMax-M2.7")) {
    return `${view.id}/MiniMax-M2.7`;
  }

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
  return expandedProvider.value?.defaultModel || t('aiProvider.notSet');
}

async function applyProvider(view: OpenClawAiProviderView, setPrimary: boolean) {
  const api = getDidClawDesktopApi();
  if (!api?.writeOpenClawProvidersPatch || !api?.writeOpenClawModelConfig) {
    return;
  }

  const modelIds = resolveProviderModels(view);
  if (modelIds.length === 0) {
    error.value = t('aiProvider.needOneModel');
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
    const isRealKey = Boolean(keyToWrite && !keyToWrite.endsWith("****"));
    if (view.apiKeyRequired || isRealKey) {
      if (isRealKey && shouldPatchProviderApiKey(aiSnapshot.value, view.id, keyToWrite)) {
        providerBody.apiKey = keyToWrite;
      }
    }

    const pr = await api.writeOpenClawProvidersPatch({ patch: { [view.id]: providerBody } });
    if (!pr.ok) {
      error.value = String(pr.error || t('aiProvider.saveFailed'));
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
      error.value = String(mr.error || t('aiProvider.setModelFailed'));
      return;
    }

    // If this provider has image generation capability, also sync the env var
    // so image generation plugins can find the key without manual setup.
    // Only use a confirmed real key (not a masked placeholder).
    if (isRealKey && view.catalog?.imageModels?.length && api.writeOpenClawEnv) {
      const imgEntry = IMAGE_GEN_CATALOG.find((e) => e.providerId === view.id);
      if (imgEntry && shouldWriteEnvVar(aiSnapshot.value, imgEntry.envKey, keyToWrite)) {
        await api.writeOpenClawEnv({ patch: { [imgEntry.envKey]: keyToWrite } });
      }
    }
    if (isRealKey && view.id === "zai" && api.writeOpenClawEnv) {
      if (shouldWriteEnvVar(aiSnapshot.value, "ZHIPU_API_KEY", keyToWrite)) {
        await api.writeOpenClawEnv({ patch: { ZHIPU_API_KEY: keyToWrite } });
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
        ? t('aiProvider.savedAsPrimary', { name: view.displayName })
        : t('aiProvider.configSaved', { name: view.displayName }),
    );
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

async function removeProvider(view: OpenClawAiProviderView) {
  if (!window.confirm(t('aiProvider.confirmRemove', { name: view.displayName }))) {
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
      error.value = String(r.error || t('aiProvider.removeFailed'));
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
      error.value = String(mr.error || t('aiProvider.cleanupFailed'));
      return;
    }
    // Clean up env var if this provider had image generation
    if (view.catalog?.imageModels?.length && api.writeOpenClawEnv) {
      const imgEntry = IMAGE_GEN_CATALOG.find((e) => e.providerId === view.id);
      if (imgEntry) {
        await api.writeOpenClawEnv({ patch: { [imgEntry.envKey]: null } });
      }
    }
    if (view.id === "zai" && api.writeOpenClawEnv) {
      await api.writeOpenClawEnv({ patch: { ZHIPU_API_KEY: null } });
    }

    await loadAll();
    expandedId.value = null;
    void chat.refreshOpenClawModelPicker();
    chat.flashOpenClawConfigHint();
    afterOpenClawProvidersSaved();
    afterOpenClawModelConfigSaved();
    setToast(t('aiProvider.removed', { name: view.displayName }));
  } finally {
    busy.value = false;
  }
}

// ── 图片生成卡 ────────────────────────────────────────────────

/** toggle image gen card open/closed and pre-fill the API key */
function toggleImgCard(entry: ImageGenCatalogEntry) {
  if (expandedImgId.value === entry.id) {
    expandedImgId.value = null;
    imgEditingKey.value = "";
    imgShowKey.value = false;
    return;
  }
  expandedImgId.value = entry.id;
  imgShowKey.value = false;
  // prefill: read key from providers if the corresponding chat provider is already configured
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
        models,
      };
      // Remove any masked placeholder spread from `existing` before policy check.
      delete providerPatch.apiKey;
      if (shouldPatchProviderApiKey(aiSnapshot.value, entry.providerId, keyTrimmed)) {
        providerPatch.apiKey = keyTrimmed;
      }
      await api.writeOpenClawProvidersPatch({
        patch: { [entry.providerId]: providerPatch },
      });
    }

    // Write imageGenerationModel at agents.defaults level (NOT inside agents.defaults.model)
    const mr = await api.writeOpenClawModelConfig({
      imageGenerationModel: { primary: entry.modelRef },
    });
    if (!mr.ok) {
      error.value = String(mr.error || t('aiProvider.imgSaveFailed'));
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
    if (resolvedKey && api.writeOpenClawEnv && shouldWriteEnvVar(aiSnapshot.value, entry.envKey, resolvedKey)) {
      await api.writeOpenClawEnv({ patch: { [entry.envKey]: resolvedKey } });
    }

    await loadAll();
    expandedImgId.value = null;
    imgEditingKey.value = "";
    afterOpenClawModelConfigSaved();
    setToast(t('aiProvider.imgEnabled', { model: entry.modelLabel }));
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
    setToast(t('aiProvider.imgDisabled'));
  }
}
</script>


<template>
  <div class="aips">
    <!-- Primary model banner -->
    <div
      class="aips-banner"
      :class="{
        'aips-banner--set': currentPrimary,
        'aips-banner--interactive': currentPrimary,
      }"
      :role="currentPrimary ? 'button' : undefined"
      :tabindex="currentPrimary ? 0 : undefined"
      @click="focusPrimaryProvider"
      @keydown.enter.prevent="focusPrimaryProvider"
    >
      <span class="aips-banner-label">{{ t('aiProvider.primaryLabel') }}</span>
      <span class="aips-banner-sep" aria-hidden="true" />
      <span class="aips-banner-value">{{ currentPrimaryLabel() }}</span>
      <span class="aips-banner-switch">{{ t('aiProvider.switchHint') }}</span>
    </div>

    <!-- Fallback row (compact) -->
    <div class="aips-fallback-bar">
      <span class="aips-fallback-bar-label">{{ t('aiProvider.fallbackTitle') }}</span>
      <div class="aips-fallback-bar-chips">
        <span v-if="!fallbackModels.length" class="aips-fallback-bar-empty">{{ t('aiProvider.notConfigured') }}</span>
        <span
          v-for="m in fallbackModels"
          :key="m"
          class="aips-fallback-chip"
        >{{ m }}<button type="button" class="aips-fallback-chip-del" :aria-label="t('aiProvider.removeModel', { m })" @click.stop="removeFallback(m)">×</button></span>
      </div>
      <span
        class="aips-fallback-add-link"
        :class="{ 'aips-fallback-add-link--active': showFallbackEditor }"
        role="button"
        tabindex="0"
        @click="showFallbackEditor = !showFallbackEditor"
        @keydown.enter.prevent="showFallbackEditor = !showFallbackEditor"
      >{{ showFallbackEditor ? t('aiProvider.done') : t('aiProvider.addFallback') }}</span>
    </div>

    <!-- Fallback editor (expandable) -->
    <div v-if="showFallbackEditor" class="aips-fallback-editor">
      <select
        v-if="availableFallbackSuggestions.length"
        class="aips-select"
        @change="(e) => { addFallback((e.target as HTMLSelectElement).value); (e.target as HTMLSelectElement).value = '' }"
      >
        <option value="">{{ t('aiProvider.pickFromConfigured') }}</option>
        <option v-for="s in availableFallbackSuggestions" :key="s" :value="s">{{ s }}</option>
      </select>
      <div class="aips-fallback-manual-row">
        <input
          v-model="fallbackInput"
          type="text"
          class="aips-key-input"
          :placeholder="t('aiProvider.manualInput')"
          @keydown.enter.prevent="addFallback(fallbackInput)"
        >
        <button type="button" class="aips-ghost-btn aips-sm-btn" :disabled="!fallbackInput.trim()" @click="addFallback(fallbackInput)">
          {{ t('aiProvider.add') }}
        </button>
        <button type="button" class="aips-save-btn" :disabled="fallbackBusy" @click="saveFallbacks">
          {{ fallbackBusy ? t('aiProvider.saving') : t('aiProvider.save') }}
        </button>
      </div>
    </div>

    <!-- Feedback -->
    <p v-if="toast" class="aips-toast">{{ toast }}</p>
    <p v-if="error" class="aips-error">{{ error }}</p>

    <!-- Search row -->
    <div class="aips-search-row">
      <div class="aips-search-wrap">
        <span class="aips-search-icon" aria-hidden="true">&#128269;</span>
        <input
          v-model="providerSearchQuery"
          type="search"
          class="aips-search-input"
          :placeholder="t('aiProvider.searchPlaceholder')"
        >
      </div>
    </div>

    <!-- Tag filter pills -->
    <div class="aips-tags-row">
      <button
        v-for="tag in [
          { id: 'all', label: t('aiProvider.tagAll') },
          { id: 'configured', label: t('aiProvider.tagConfigured') },
          { id: 'recommended', label: t('aiProvider.tagRecommended') },
          { id: 'cn', label: t('aiProvider.tagCN') },
          { id: 'intl', label: t('aiProvider.tagIntl') },
          { id: 'local', label: t('aiProvider.tagLocal') },
        ]"
        :key="tag.id"
        type="button"
        class="aips-tag-pill"
        :class="{ 'aips-tag-pill--active': providerTagFilter === tag.id }"
        @click="providerTagFilter = tag.id"
      >
        {{ tag.label }}
      </button>
    </div>

    <!-- Provider grid (scrollable) -->
    <div
      class="aips-grid-wrap"
      :class="{ 'aips-grid-wrap--panel-open': expandedProvider !== null || expandedImgId !== null }"
    >
      <!-- Empty state -->
      <div v-if="filteredProviders.length === 0 && !IMAGE_GEN_CATALOG.length" class="aips-empty">
        <span class="aips-empty-icon" aria-hidden="true">&#128269;</span>
        <span>{{ t('aiProvider.noMatch') }}</span>
      </div>

      <!-- Provider cards -->
      <div v-if="filteredProviders.length" class="aips-providers-grid">
        <div
          v-for="provider in filteredProviders"
          :key="provider.id"
          class="aips-pcard"
          :class="{
            'aips-pcard--active': expandedId === provider.id,
            'aips-pcard--primary': provider.isPrimary,
          }"
          @click="expandCard(provider)"
        >
          <div class="aips-pcard-top">
            <div class="aips-pcard-name">{{ provider.displayName }}</div>
          </div>
          <div class="aips-pcard-footer">
            <span
              class="aips-pcard-badge"
              :class="{
                'aips-pcard-badge--primary': provider.isPrimary,
                'aips-pcard-badge--ok': !provider.isPrimary && provider.isConfigured,
                'aips-pcard-badge--free': !provider.isPrimary && !provider.isConfigured && !provider.apiKeyRequired,
                'aips-pcard-badge--pending': !provider.isPrimary && !provider.isConfigured && provider.apiKeyRequired,
              }"
            >
              {{
                provider.isPrimary ? t('aiProvider.primary')
                : provider.isConfigured ? t('aiProvider.configured')
                  : !provider.apiKeyRequired ? t('aiProvider.noKeyNeeded')
                    : t('aiProvider.pendingConfig')
              }}
            </span>
          </div>
        </div>
      </div>

      <!-- Image gen sub-section -->
      <template v-if="providerTagFilter === 'all' || providerTagFilter === 'recommended'">
        <div v-if="IMAGE_GEN_CATALOG.length" class="aips-sub-section">
          <div class="aips-sub-title">&#127912; {{ t('aiProvider.imgGen') }}</div>
          <div class="aips-img-grid">
            <div
              v-for="imgEntry in IMAGE_GEN_CATALOG"
              :key="imgEntry.id"
              class="aips-pcard aips-pcard--img"
              :class="{ 'aips-pcard--active': expandedImgId === imgEntry.id }"
              @click="toggleImgCard(imgEntry)"
            >
              <div class="aips-pcard-top">
                <div class="aips-pcard-name">{{ imgEntry.name }}</div>
              </div>
              <div class="aips-pcard-footer">
                <span
                  class="aips-pcard-badge"
                  :class="aiSnapshot.imageGenerationModel === imgEntry.modelRef ? 'aips-pcard-badge--ok' : 'aips-pcard-badge--pending'"
                >
                  {{ aiSnapshot.imageGenerationModel === imgEntry.modelRef ? t('aiProvider.on') : t('aiProvider.off') }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- Detected providers sub-section -->
      <template v-if="providerTagFilter === 'all' || providerTagFilter === 'configured'">
        <div v-if="detectedProviders.length" class="aips-sub-section">
          <div class="aips-sub-title">{{ t('aiProvider.detected') }}</div>
          <div class="aips-providers-grid">
            <div
              v-for="provider in detectedProviders"
              :key="`detected:${provider.id}`"
              class="aips-pcard"
              :class="{ 'aips-pcard--active': expandedId === provider.id }"
              @click="expandCard(provider)"
            >
              <div class="aips-pcard-top">
                <div class="aips-pcard-name">{{ provider.displayName }}</div>
              </div>
              <div class="aips-pcard-footer">
                <span class="aips-pcard-badge aips-pcard-badge--free">{{ t('aiProvider.detectedBadge') }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Bottom config panel (absolute overlay) -->
    <div
      class="aips-bottom"
      :class="{ 'aips-bottom--open': expandedProvider !== null || expandedImgId !== null }"
    >
      <div class="aips-bottom-inner">
        <!-- Provider config panel -->
        <template v-if="expandedProvider && expandedImgId === null">
          <div class="aips-bottom-head">
            <div class="aips-bottom-info">
              <div class="aips-bottom-name">{{ expandedProvider.displayName }}</div>
              <div class="aips-bottom-url">{{ editingBaseUrl || expandedProvider.baseUrl }}</div>
            </div>
            <div class="aips-bottom-head-actions">
              <a
                v-if="expandedProvider.docsUrl"
                :href="expandedProvider.docsUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="aips-bottom-docs"
              >{{ t('aiProvider.docs') }}</a>
              <button type="button" class="aips-bottom-close" @click="expandedId = null">×</button>
            </div>
          </div>

          <div class="aips-bottom-fields">
            <div class="aips-bottom-field">
              <div class="aips-field-label-row">
                <label class="aips-field-label">API Key</label>
              </div>
              <div class="aips-key-row">
                <input
                  v-model="editingKey"
                  :type="showKey ? 'text' : 'password'"
                  class="aips-key-input"
                  :placeholder="expandedProvider.apiKeyRequired ? (expandedProvider.catalog?.apiKeyPlaceholder || t('aiProvider.pasteApiKey')) : t('aiProvider.noKeyRequired')"
                  :disabled="!expandedProvider.apiKeyRequired"
                  autocomplete="off"
                >
                <button
                  v-if="expandedProvider.apiKeyRequired"
                  type="button"
                  class="aips-ghost-btn aips-eye-btn"
                  @click="showKey = !showKey"
                >
                  {{ showKey ? t('aiProvider.hide') : t('aiProvider.show') }}
                </button>
              </div>
            </div>

            <div class="aips-bottom-field">
              <div class="aips-field-label-row">
                <label class="aips-field-label">{{ t('aiProvider.baseUrl') }}</label>
                <div v-if="expandedProvider.baseUrlAlt" class="aips-node-pills">
                  <button
                    type="button"
                    class="aips-node-pill"
                    :class="{ 'aips-node-pill--active': nodeChoice === 'main' }"
                    @click="useMainNode()"
                  >
                    {{ expandedProvider.baseUrlLabel }}
                  </button>
                  <button
                    type="button"
                    class="aips-node-pill"
                    :class="{ 'aips-node-pill--active': nodeChoice === 'alt' }"
                    @click="useAltNode()"
                  >
                    {{ expandedProvider.baseUrlAltLabel }}
                  </button>
                </div>
              </div>
              <input
                v-model="editingBaseUrl"
                type="text"
                class="aips-key-input"
                placeholder="https://..."
                autocomplete="off"
                spellcheck="false"
              >
            </div>
          </div>

          <div class="aips-bottom-models">
            <div class="aips-field-label-row">
              <span class="aips-field-label">{{ t('aiProvider.models') }}</span>
              <button
                type="button"
                class="aips-ghost-btn aips-sm-btn"
                @click="() => { modelEditMode = !modelEditMode; if (modelEditMode) modelEditText = expandedProviderModels().join(', '); }"
              >
                {{ modelEditMode ? t('aiProvider.done') : t('aiProvider.edit') }}
              </button>
            </div>
            <textarea
              v-if="modelEditMode"
              v-model="modelEditText"
              class="aips-model-textarea"
              :placeholder="t('aiProvider.modelPlaceholder')"
              rows="2"
            />
            <div v-else class="aips-model-chips">
              <span
                v-for="m in expandedProviderModels()"
                :key="m"
                class="aips-chip"
                :class="{ 'aips-chip--default': m === expandedProviderDefaultModel() }"
              >{{ m }}</span>
            </div>
          </div>

          <div class="aips-bottom-footer">
            <button
              v-if="expandedProvider.raw"
              type="button"
              class="aips-ghost-btn aips-danger-btn"
              :disabled="busy"
              @click="removeProvider(expandedProvider)"
            >
              {{ t('aiProvider.remove') }}
            </button>
            <div class="aips-footer-right">
              <button type="button" class="aips-ghost-btn" @click="expandedId = null">{{ t('aiProvider.cancel') }}</button>
              <button
                v-if="!expandedProvider.isPrimary"
                type="button"
                class="aips-ghost-btn"
                :disabled="busy || (expandedProvider.apiKeyRequired && !editingKey.trim())"
                @click="applyProvider(expandedProvider, false)"
              >
                {{ busy ? t('aiProvider.saving') : t('aiProvider.saveOnly') }}
              </button>
              <button
                type="button"
                class="aips-apply-btn"
                :disabled="busy || (expandedProvider.apiKeyRequired && !editingKey.trim())"
                @click="applyProvider(expandedProvider, true)"
              >
                {{ busy ? t('aiProvider.applying') : expandedProvider.isPrimary ? t('aiProvider.update') : t('aiProvider.applyAsPrimary') }}
              </button>
            </div>
          </div>
        </template>

        <!-- Image gen config panel -->
        <template v-else-if="expandedImgId !== null">
          <template v-for="imgEntry in IMAGE_GEN_CATALOG" :key="imgEntry.id">
            <template v-if="expandedImgId === imgEntry.id">
              <div class="aips-bottom-head">
                <div class="aips-bottom-info">
                  <div class="aips-bottom-name">{{ imgEntry.name }}</div>
                  <code class="aips-bottom-url">{{ imgEntry.modelLabel }}</code>
                </div>
                <div class="aips-bottom-head-actions">
                  <button type="button" class="aips-bottom-close" @click="toggleImgCard(imgEntry)">×</button>
                </div>
              </div>
              <div class="aips-bottom-fields">
                <div class="aips-bottom-field" style="grid-column: 1 / -1">
                  <label class="aips-field-label">API Key</label>
                  <div class="aips-key-row">
                    <input
                      v-model="imgEditingKey"
                      :type="imgShowKey ? 'text' : 'password'"
                      class="aips-key-input"
                      :placeholder="imgEntry.apiKeyPlaceholder"
                      autocomplete="off"
                    >
                    <button type="button" class="aips-ghost-btn aips-eye-btn" @click="imgShowKey = !imgShowKey">
                      {{ imgShowKey ? t('aiProvider.hide') : t('aiProvider.show') }}
                    </button>
                  </div>
                  <p class="aips-hint">{{ t('aiProvider.imgKeyHint') }}</p>
                </div>
              </div>
              <div class="aips-bottom-footer">
                <button
                  v-if="aiSnapshot.imageGenerationModel === imgEntry.modelRef"
                  type="button"
                  class="aips-ghost-btn aips-danger-btn"
                  @click="removeImageGen"
                >
                  {{ t('aiProvider.disable') }}
                </button>
                <div class="aips-footer-right">
                  <button type="button" class="aips-ghost-btn" :disabled="imgBusy" @click="toggleImgCard(imgEntry)">{{ t('aiProvider.cancel') }}</button>
                  <button type="button" class="aips-apply-btn" :disabled="imgBusy" @click="applyImageGen(imgEntry)">
                    {{ imgBusy ? t('aiProvider.saving') : t('aiProvider.imgEnable') }}
                  </button>
                </div>
              </div>
            </template>
          </template>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.aips {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.aips-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  border-radius: var(--lc-radius-sm);
  background: var(--lc-bg-elevated);
  border: 1px solid var(--lc-border);
  font-size: 12px;
  flex-shrink: 0;
}
.aips-banner--interactive {
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, transform 0.12s;
}
.aips-banner--interactive:hover {
  border-color: color-mix(in srgb, var(--lc-accent) 45%, transparent);
}
.aips-banner--interactive:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--lc-accent) 28%, transparent);
  outline-offset: 2px;
}
.aips-banner--set {
  border-color: color-mix(in srgb, var(--lc-accent) 35%, transparent);
  background: linear-gradient(90deg, color-mix(in srgb, var(--lc-accent) 10%, transparent), transparent);
}
.aips-banner-label {
  color: var(--lc-text-muted);
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
}
.aips-banner-sep {
  width: 1px;
  height: 14px;
  background: var(--lc-border);
  flex-shrink: 0;
}
.aips-banner-value {
  color: var(--lc-accent);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.aips-banner-switch {
  font-size: 11px;
  color: var(--lc-accent);
  white-space: nowrap;
  opacity: 0.7;
  flex-shrink: 0;
}

.aips-fallback-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: var(--lc-radius-sm);
  background: var(--lc-bg-raised);
  border: 1px solid var(--lc-border);
  font-size: 12px;
  flex-shrink: 0;
}
.aips-fallback-bar-label {
  color: var(--lc-text-muted);
  white-space: nowrap;
  flex-shrink: 0;
  font-size: 11px;
}
.aips-fallback-bar-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  flex: 1;
  min-width: 0;
}
.aips-fallback-bar-empty {
  font-size: 11px;
  color: var(--lc-text-dim, var(--lc-text-muted));
}
.aips-fallback-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 5px;
  background: var(--lc-bg-elevated);
  border: 1px solid var(--lc-border);
  color: var(--lc-text-muted);
  font-family: var(--lc-mono);
}
.aips-fallback-chip-del {
  background: none;
  border: none;
  color: var(--lc-text-dim);
  cursor: pointer;
  font-size: 12px;
  padding: 0;
  line-height: 1;
}
.aips-fallback-chip-del:hover { color: var(--lc-error); }
.aips-fallback-add-link {
  font-size: 11px;
  color: var(--lc-accent);
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  user-select: none;
  opacity: 0.8;
  transition: opacity 0.12s;
}
.aips-fallback-add-link:hover,
.aips-fallback-add-link--active {
  opacity: 1;
}

.aips-fallback-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px;
  background: var(--lc-bg-raised);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  flex-shrink: 0;
}
.aips-fallback-manual-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.aips-fallback-manual-row .aips-key-input { flex: 1; }
.aips-select {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  background: var(--lc-bg-raised);
  color: var(--lc-text);
  font-size: 12px;
  font-family: inherit;
}
.aips-save-btn {
  background: color-mix(in srgb, var(--lc-accent) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--lc-accent) 30%, transparent);
  color: var(--lc-accent);
  border-radius: var(--lc-radius-sm);
  font-size: 12px;
  padding: 5px 10px;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  transition: background 0.12s;
}
.aips-save-btn:hover { background: color-mix(in srgb, var(--lc-accent) 20%, transparent); }
.aips-save-btn:disabled { opacity: 0.45; cursor: not-allowed; }

.aips-toast {
  font-size: 12px;
  color: #16a34a;
  margin: 0;
  padding: 5px 10px;
  background: rgba(34,197,94,.08);
  border-radius: var(--lc-radius-sm);
  border: 1px solid rgba(34,197,94,.25);
  flex-shrink: 0;
}
.aips-error {
  font-size: 12px;
  color: var(--lc-error);
  margin: 0;
  padding: 5px 10px;
  background: var(--lc-error-bg, rgba(239,68,68,.08));
  border-radius: var(--lc-radius-sm);
  border: 1px solid rgba(239,68,68,.25);
  flex-shrink: 0;
}

.aips-search-row { flex-shrink: 0; }
.aips-search-wrap { position: relative; }
.aips-search-icon {
  position: absolute; left: 9px; top: 50%; transform: translateY(-50%);
  font-size: 12px; pointer-events: none;
}
.aips-search-input {
  width: 100%;
  background: var(--lc-bg-raised);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  padding: 7px 10px 7px 28px;
  font-size: 13px;
  color: var(--lc-text);
  outline: none;
  font-family: inherit;
  box-sizing: border-box;
  transition: border-color 0.15s;
}
.aips-search-input::placeholder { color: var(--lc-text-dim, var(--lc-text-muted)); }
.aips-search-input:focus { border-color: var(--lc-accent); }

.aips-tags-row {
  display: flex;
  gap: 5px;
  overflow-x: auto;
  flex-shrink: 0;
  scrollbar-width: none;
  padding-bottom: 1px;
}
.aips-tags-row::-webkit-scrollbar { display: none; }
.aips-tag-pill {
  padding: 3px 10px;
  background: var(--lc-bg-raised);
  border: 1px solid var(--lc-border);
  border-radius: 20px;
  font-size: 12px;
  color: var(--lc-text-muted);
  cursor: pointer;
  white-space: nowrap;
  font-family: inherit;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.aips-tag-pill:hover { color: var(--lc-text); border-color: var(--lc-border-strong, var(--lc-border)); }
.aips-tag-pill--active {
  background: color-mix(in srgb, var(--lc-accent) 12%, transparent);
  border-color: var(--lc-accent);
  color: var(--lc-accent);
}

.aips-grid-wrap {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  padding-right: 4px;
  scrollbar-width: thin;
  scrollbar-color: var(--lc-border) transparent;
}
.aips-grid-wrap--panel-open {
  padding-bottom: 300px;
}
.aips-grid-wrap::-webkit-scrollbar { width: 4px; }
.aips-grid-wrap::-webkit-scrollbar-thumb { background: var(--lc-border); border-radius: 2px; }

.aips-providers-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
  align-content: start;
}
.aips-img-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
}

.aips-pcard {
  background: var(--lc-bg-raised);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm, 10px);
  padding: 12px 14px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, transform 0.12s, box-shadow 0.12s;
  display: flex;
  flex-direction: column;
  gap: 4px;
  user-select: none;
  min-height: 104px;
  aspect-ratio: 1 / 0.82;
  min-width: 0;
  overflow: hidden;
}
.aips-pcard:hover {
  border-color: var(--lc-border-strong, var(--lc-accent));
  background: var(--lc-bg-elevated);
  transform: translateY(-1px);
  box-shadow: 0 10px 22px rgba(15, 23, 42, 0.08);
}
.aips-pcard--active {
  border-color: var(--lc-accent);
  background: color-mix(in srgb, var(--lc-accent) 6%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--lc-accent) 18%, transparent);
}
.aips-pcard--primary {
  border-color: color-mix(in srgb, var(--lc-accent) 40%, transparent);
}

.aips-pcard-top {
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 10px;
  min-width: 0;
  width: 100%;
}
.aips-pcard-footer {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  margin-top: auto;
  min-height: 24px;
}
.aips-pcard-badge {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 10px;
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
}
.aips-pcard-badge--primary {
  background: color-mix(in srgb, var(--lc-accent) 18%, transparent);
  color: var(--lc-accent);
}
.aips-pcard-badge--ok {
  background: rgba(52, 199, 89, 0.15);
  color: #34c759;
}
.aips-pcard-badge--free {
  background: var(--lc-bg-elevated);
  color: var(--lc-text-dim, var(--lc-text-muted));
  border: 1px solid var(--lc-border);
}
.aips-pcard-badge--pending {
  background: var(--lc-bg-elevated);
  color: var(--lc-text-muted);
  border: 1px solid var(--lc-border);
}

.aips-pcard-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--lc-text);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  flex: 1;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  white-space: normal;
}

.aips-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 13px;
  color: var(--lc-text-dim, var(--lc-text-muted));
  padding: 40px 0;
}
.aips-empty-icon { font-size: 32px; opacity: 0.4; }

.aips-sub-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.aips-sub-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--lc-text-muted);
  padding-top: 4px;
  border-top: 1px solid var(--lc-border);
}

/* ── Bottom config panel ── */
.aips-bottom {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  background: var(--lc-surface, var(--lc-bg-raised));
  border-top: 1px solid color-mix(in srgb, var(--lc-border) 65%, transparent);
  border-radius: 14px 14px 0 0;
  transform: translateY(100%);
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
  max-height: 320px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 -18px 40px rgba(15, 23, 42, 0.14);
  z-index: 2;
  overflow: hidden;
}
.aips-bottom--open { transform: translateY(0); }

.aips-bottom-inner {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  scrollbar-width: thin;
}

.aips-bottom-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--lc-border);
  flex-shrink: 0;
}
.aips-bottom-info { flex: 1; min-width: 0; }
.aips-bottom-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--lc-text);
  margin-bottom: 2px;
}
.aips-bottom-url {
  font-size: 11px;
  color: var(--lc-text-dim, var(--lc-text-muted));
  font-family: var(--lc-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aips-bottom-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.aips-bottom-docs {
  font-size: 12px;
  color: var(--lc-accent);
  text-decoration: none;
}
.aips-bottom-docs:hover { text-decoration: underline; }
.aips-bottom-close {
  width: 28px; height: 28px;
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-elevated);
  color: var(--lc-text-muted);
  font-size: 14px;
  cursor: pointer;
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.aips-bottom-close:hover {
  background: var(--lc-bg-hover, var(--lc-bg-elevated));
  border-color: var(--lc-border-strong, var(--lc-border));
  color: var(--lc-text);
}

.aips-bottom-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  flex-shrink: 0;
}
.aips-bottom-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.aips-bottom-models {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}

.aips-bottom-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 8px;
  border-top: 1px solid var(--lc-border);
  flex-shrink: 0;
}
.aips-footer-right {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-left: auto;
}

/* ── Shared form inputs ── */
.aips-field-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.aips-field-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--lc-text-muted);
}
.aips-key-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.aips-key-input {
  flex: 1;
  padding: 7px 10px;
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  font-size: 12px;
  font-family: var(--lc-mono);
  background: var(--lc-bg-raised);
  color: var(--lc-text);
  min-width: 0;
}
.aips-key-input:focus { outline: none; border-color: var(--lc-accent); }
.aips-key-input:disabled { opacity: 0.5; }

.aips-node-pills { display: flex; gap: 5px; }
.aips-node-pill {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 12px;
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-raised);
  color: var(--lc-text-muted);
  cursor: pointer;
  font-family: inherit;
  transition: all 0.12s;
}
.aips-node-pill--active {
  border-color: var(--lc-accent);
  background: color-mix(in srgb, var(--lc-accent) 12%, transparent);
  color: var(--lc-accent);
}

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
  background: color-mix(in srgb, var(--lc-accent) 10%, transparent);
}
.aips-model-textarea {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  font-size: 12px;
  font-family: var(--lc-mono);
  background: var(--lc-bg-raised);
  color: var(--lc-text);
  resize: none;
  box-sizing: border-box;
}
.aips-model-textarea:focus { outline: none; border-color: var(--lc-accent); }

.aips-hint {
  font-size: 11px;
  color: var(--lc-text-muted);
  margin: 0;
}

/* ── Buttons ── */
.aips-ghost-btn {
  background: transparent;
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  color: var(--lc-text-muted);
  font-size: 12px;
  padding: 5px 10px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.12s, color 0.12s;
  white-space: nowrap;
}
.aips-ghost-btn:hover { background: var(--lc-bg-elevated); color: var(--lc-text); }
.aips-ghost-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.aips-sm-btn { padding: 3px 8px; font-size: 11px; }
.aips-eye-btn { padding: 5px 8px; flex-shrink: 0; }
.aips-danger-btn { color: var(--lc-error); border-color: rgba(239,68,68,.3); }
.aips-danger-btn:hover { background: var(--lc-error-bg, rgba(239,68,68,.08)); }
.aips-apply-btn {
  background: var(--lc-accent);
  border: none;
  border-radius: var(--lc-radius-sm);
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  padding: 6px 14px;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  transition: opacity 0.12s;
}
.aips-apply-btn:hover:not(:disabled) { opacity: 0.88; }
.aips-apply-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
