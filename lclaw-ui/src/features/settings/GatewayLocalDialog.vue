<script setup lang="ts">
import { scheduleDeferredGatewayConnect } from "@/composables/deferredGatewayConnect";
import {
  afterOpenClawModelConfigSaved,
  afterOpenClawProvidersSaved,
} from "@/composables/modelConfigDeferred";
import { getDidClawDesktopApi, isDidClawElectron } from "@/lib/electron-bridge";
import { useI18n } from "vue-i18n";
import {
  PRIMARY_MODEL_QUICK_PICKS,
  PROVIDER_SETUP_PRESETS,
  type ProviderSetupPreset,
} from "@/lib/openclaw-presets";
import {
  buildProviderEditorState,
  readOpenClawAiSnapshot,
  snapshotToAliasRows,
  stripProviderModelRefs,
  type OpenClawAiSnapshot,
} from "@/lib/openclaw-ai-config";
import { describeOpenClawPrimaryModelIncompatibility } from "@/lib/openclaw-model-guards";
import { OPENCLAW_PROVIDER_ID_RE } from "@/lib/openclaw-provider-id";
import { gatewayUrlFromEnv, useGatewayStore } from "@/stores/gateway";
import { useChatStore } from "@/stores/chat";
import { useLocalSettingsStore } from "@/stores/localSettings";
import { computed, ref, watch } from "vue";
import AiProviderSetup from "@/features/settings/AiProviderSetup.vue";
const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [v: boolean];
}>();

const { t } = useI18n();
const gw = useGatewayStore();
const localSettings = useLocalSettingsStore();
const chat = useChatStore();

type TabId = "gateway" | "ai" | "model" | "providers";

const tab = ref<TabId>("gateway");
const wsUrl = ref("");
const token = ref("");
const password = ref("");
/** 默认 true：连接开关打开时由主进程无窗口启动本机 openclaw gateway */
const autoStartOpenClaw = ref(true);
/** 为 true 时退出 LCLaw 会结束由本应用 spawn 的网关子进程 */
const stopManagedGatewayOnQuit = ref(false);
const openclawExecutable = ref("");
const saveError = ref<string | null>(null);
const saving = ref(false);

const primaryModel = ref("");
type AliasRow = { ref: string; alias: string };
const aliasRows = ref<AliasRow[]>([]);
const modelError = ref<string | null>(null);
const modelBusy = ref(false);
const modelToast = ref<string | null>(null);

/** models.providers 编辑 */
const providerSnapshots = ref<Record<string, Record<string, unknown>>>({});
const selectedProviderKey = ref("");
const creatingNewProvider = ref(false);
const newProviderKeyDraft = ref("");
const pvBaseUrl = ref("");
const pvApiKey = ref("");
const pvModelRows = ref<Array<{ id: string }>>([]);
const showPvApiKey = ref(false);
const provError = ref<string | null>(null);
const provToast = ref<string | null>(null);
const provBusy = ref(false);
const aiSnapshot = ref<OpenClawAiSnapshot>({
  defaultAgentId: "main",
  providers: {},
  model: {},
  models: {},
  primaryModel: "",
  fallbacks: [],
  modelRefs: [],
});

/** 与 api、authHeader 等一并写入 provider（模板或从已有配置带出） */
const pvProviderExtras = ref<Record<string, unknown>>({});

const providerKeyList = computed(() => Object.keys(providerSnapshots.value).sort());
/** 正在编辑的服务代号（含「新建」时草稿），用于 Ollama 密钥提示等 */
const editingProviderKey = computed(() =>
  creatingNewProvider.value ? newProviderKeyDraft.value.trim() : selectedProviderKey.value,
);
const isEditingOllamaProvider = computed(() => editingProviderKey.value === "ollama");
const providerPresetsCn = computed(() => PROVIDER_SETUP_PRESETS.filter((p) => p.bucket === "cn"));
const providerPresetsIntl = computed(() => PROVIDER_SETUP_PRESETS.filter((p) => p.bucket === "intl"));
const primaryModelQuickPicksCn = computed(() => PRIMARY_MODEL_QUICK_PICKS.filter((p) => p.bucket === "cn"));
const primaryModelQuickPicksIntl = computed(() => PRIMARY_MODEL_QUICK_PICKS.filter((p) => p.bucket === "intl"));

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit("update:modelValue", v),
});

async function loadGatewayForm(): Promise<void> {
  saveError.value = null;
  wsUrl.value = gatewayUrlFromEnv();
  token.value = "";
  password.value = "";
  const api = getDidClawDesktopApi();
  if (!api?.readGatewayLocalConfig) {
    return;
  }
  try {
    const c = await api.readGatewayLocalConfig();
    if (c.url?.trim()) {
      wsUrl.value = c.url.trim();
    }
    if (c.token != null) {
      token.value = c.token;
    }
    if (c.password != null) {
      password.value = c.password;
    }
    autoStartOpenClaw.value = c.autoStartOpenClaw !== false;
    stopManagedGatewayOnQuit.value = c.stopManagedGatewayOnQuit === true;
    openclawExecutable.value =
      typeof c.openclawExecutable === "string" ? c.openclawExecutable : "";
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e);
  }
}

async function loadModelForm(): Promise<void> {
  modelError.value = null;
  modelToast.value = null;
  try {
    const snapshot = await readOpenClawAiSnapshot();
    aiSnapshot.value = snapshot;
    primaryModel.value = snapshot.primaryModel;
    aliasRows.value = snapshotToAliasRows(snapshot);
  } catch (e) {
    modelError.value = e instanceof Error ? e.message : String(e);
    primaryModel.value = "";
    aliasRows.value = [];
  }
}

async function loadAll(): Promise<void> {
  await loadGatewayForm();
  await loadModelForm();
  await loadProvidersForm();
}

function urlFieldForSnapshot(s: Record<string, unknown> | undefined): "baseUrl" | "baseURL" {
  if (!s) {
    return "baseUrl";
  }
  if (
    Object.prototype.hasOwnProperty.call(s, "baseURL") &&
    !Object.prototype.hasOwnProperty.call(s, "baseUrl")
  ) {
    return "baseURL";
  }
  return "baseUrl";
}

function syncProviderFormFromSelection(): void {
  const k = selectedProviderKey.value;
  if (!k || !providerSnapshots.value[k]) {
    pvBaseUrl.value = "";
    pvApiKey.value = "";
    pvModelRows.value = [];
    pvProviderExtras.value = {};
    return;
  }
  const editor = buildProviderEditorState(k, aiSnapshot.value);
  pvBaseUrl.value = editor.baseUrl;
  pvApiKey.value = editor.apiKey;
  pvModelRows.value = editor.modelIds.map((id) => ({ id }));
  pvProviderExtras.value = editor.extras;
}

function applyProviderPreset(preset: ProviderSetupPreset): void {
  provError.value = null;
  tab.value = "providers";
  const exists = Boolean(providerSnapshots.value[preset.id]);
  if (exists) {
    creatingNewProvider.value = false;
    selectedProviderKey.value = preset.id;
    syncProviderFormFromSelection();
  } else {
    creatingNewProvider.value = true;
    selectedProviderKey.value = "";
    newProviderKeyDraft.value = preset.id;
    pvApiKey.value = "";
  }
  pvBaseUrl.value = preset.baseUrl;
  pvModelRows.value =
    preset.modelIds.length > 0 ? preset.modelIds.map((id) => ({ id })) : [{ id: "" }];
  pvProviderExtras.value = { ...preset.extras };
    provToast.value = exists
      ? t("settings.providerPresetApplied", { label: preset.label })
      : t("settings.providerPresetFilled", { label: preset.label });
}

function applyPrimaryModelQuickPick(ref: string): void {
  primaryModel.value = ref;
  modelError.value = null;
}

function resetPresetSelectTarget(target: EventTarget | null): void {
  if (target instanceof HTMLSelectElement) {
    target.selectedIndex = 0;
  }
}

function onProviderPresetSelect(bucket: "cn" | "intl", e: Event): void {
  const sel = e.target as HTMLSelectElement;
  const raw = sel.value;
  resetPresetSelectTarget(sel);
  if (raw === "") {
    return;
  }
  const idx = Number.parseInt(raw, 10);
  if (Number.isNaN(idx)) {
    return;
  }
  const list = bucket === "cn" ? providerPresetsCn.value : providerPresetsIntl.value;
  const preset = list[idx];
  if (preset) {
    applyProviderPreset(preset);
  }
}

function onModelPresetSelect(bucket: "cn" | "intl", e: Event): void {
  const sel = e.target as HTMLSelectElement;
  const raw = sel.value;
  resetPresetSelectTarget(sel);
  if (raw === "") {
    return;
  }
  const idx = Number.parseInt(raw, 10);
  if (Number.isNaN(idx)) {
    return;
  }
  const list = bucket === "cn" ? primaryModelQuickPicksCn.value : primaryModelQuickPicksIntl.value;
  const row = list[idx];
  if (row) {
    applyPrimaryModelQuickPick(row.ref);
  }
}

async function loadProvidersForm(): Promise<void> {
  provError.value = null;
  provToast.value = null;
  try {
    const snapshot = await readOpenClawAiSnapshot();
    aiSnapshot.value = snapshot;
    const next: Record<string, Record<string, unknown>> = {};
    for (const [key, v] of Object.entries(snapshot.providers)) {
      next[key] = { ...v };
    }
    providerSnapshots.value = next;
    if (!creatingNewProvider.value) {
      if (selectedProviderKey.value && !next[selectedProviderKey.value]) {
        selectedProviderKey.value = Object.keys(next).sort()[0] ?? "";
      }
      if (!selectedProviderKey.value && Object.keys(next).length > 0) {
        selectedProviderKey.value = Object.keys(next).sort()[0] ?? "";
      }
      syncProviderFormFromSelection();
    }
  } catch (e) {
    provError.value = e instanceof Error ? e.message : String(e);
  }
}

function onSelectProviderKey(key: string): void {
  creatingNewProvider.value = false;
  selectedProviderKey.value = key;
  syncProviderFormFromSelection();
  provError.value = null;
}

function startNewProvider(): void {
  creatingNewProvider.value = true;
  selectedProviderKey.value = "";
  newProviderKeyDraft.value = "";
  pvBaseUrl.value = "";
  pvApiKey.value = "";
  pvModelRows.value = [{ id: "" }];
  pvProviderExtras.value = {};
  provError.value = null;
  provToast.value = null;
}

function addPvModelRow(): void {
  pvModelRows.value = [...pvModelRows.value, { id: "" }];
}

function removePvModelRow(i: number): void {
  const next = pvModelRows.value.slice();
  next.splice(i, 1);
  pvModelRows.value = next;
}

function formatProvidersWriteError(
  r: {
    error: string;
    backupPath?: string;
    agentModelsBackupPath?: string;
    authProfilesBackupPath?: string;
  },
): string {
  const bits = [r.error];
  if (r.agentModelsBackupPath) {
    bits.push(t("settings.configBackupModel", { path: r.agentModelsBackupPath }));
  }
  if (r.authProfilesBackupPath) {
    bits.push(t("settings.configBackupAuth", { path: r.authProfilesBackupPath }));
  }
  if (r.backupPath) {
    bits.push(t("settings.configBackupTotal", { path: r.backupPath }));
  }
  bits.push(t("settings.configContactSupport"));
  return bits.join(" — ");
}

function formatProviderSaveToast(
  id: string,
  r: {
    backupPath?: string;
    agentModelsBackupPath?: string;
    authProfilesBackupPath?: string;
    defaultAgentId: string;
  },
): string {
  const head = t("settings.providerSaved", { id });
  const tails: string[] = [];
  if (r.agentModelsBackupPath || r.authProfilesBackupPath || r.backupPath) {
    tails.push(t("settings.providerBackupNote"));
  }
  return tails.length > 0 ? `${head} ${tails.join("。")}。` : head;
}

async function onSaveProvider(): Promise<void> {
  provError.value = null;
  provToast.value = null;
  const api = getDidClawDesktopApi();
  if (!api?.writeOpenClawProvidersPatch) {
    provError.value = t("settings.desktopOnlyProviders");
    return;
  }
  const id = creatingNewProvider.value ? newProviderKeyDraft.value.trim() : selectedProviderKey.value;
  if (!OPENCLAW_PROVIDER_ID_RE.test(id)) {
    provError.value = t("settings.providerIdInvalid");
    return;
  }
  const snap = providerSnapshots.value[id];
  const urlK = creatingNewProvider.value ? "baseUrl" : urlFieldForSnapshot(snap);
  const models: Record<string, Record<string, unknown>> = {};
  const prevModels =
    snap?.models && typeof snap.models === "object" && !Array.isArray(snap.models)
      ? (snap.models as Record<string, unknown>)
      : {};
  for (const row of pvModelRows.value) {
    const mid = row.id.trim();
    if (!mid) {
      continue;
    }
    if (mid.includes("/")) {
      provError.value = t("settings.modelIdNoSlash");
      return;
    }
    const pe = prevModels[mid];
    models[mid] =
      pe && typeof pe === "object" && !Array.isArray(pe)
        ? { ...(pe as Record<string, unknown>) }
        : {};
  }
  const body: Record<string, unknown> = {
    apiKey: pvApiKey.value.trim(),
    models,
    ...pvProviderExtras.value,
  };
  body[urlK] = pvBaseUrl.value.trim();

  provBusy.value = true;
  try {
    const r = await api.writeOpenClawProvidersPatch({ patch: { [id]: body } });
    if (!r.ok) {
      provError.value = formatProvidersWriteError(r);
      return;
    }
    provToast.value = formatProviderSaveToast(id, r);
    creatingNewProvider.value = false;
    selectedProviderKey.value = id;
    await loadProvidersForm();
    await loadModelForm();
    await chat.refreshOpenClawModelPicker();
    chat.flashOpenClawConfigHint();
    void afterOpenClawProvidersSaved();
    afterOpenClawModelConfigSaved();
  } catch (e) {
    provError.value = e instanceof Error ? e.message : String(e);
  } finally {
    provBusy.value = false;
  }
}

async function onDeleteProvider(): Promise<void> {
  const id = selectedProviderKey.value;
  if (!id || creatingNewProvider.value) {
    return;
  }
  if (
    !window.confirm(t("settings.deleteProviderConfirm", { id }))
  ) {
    return;
  }
  provError.value = null;
  provToast.value = null;
  const api = getDidClawDesktopApi();
  if (!api?.writeOpenClawProvidersPatch || !api.writeOpenClawModelConfig) {
    provError.value = t("settings.desktopOnlyProviders");
    return;
  }
  provBusy.value = true;
  try {
    const r = await api.writeOpenClawProvidersPatch({ patch: { [id]: null } });
    if (!r.ok) {
      provError.value = formatProvidersWriteError(r);
      return;
    }
    const trimmed = stripProviderModelRefs(aiSnapshot.value, id);
    const modelResult = await api.writeOpenClawModelConfig({
      model: {
        primary: trimmed.primaryModel,
        fallbacks: trimmed.fallbacks,
      },
      models: trimmed.models,
    });
    if (!modelResult.ok) {
      provError.value = modelResult.backupPath
        ? `${modelResult.error}（备份：${modelResult.backupPath}）`
        : modelResult.error;
      return;
    }
    provToast.value = t("settings.providerDeleted", { id });
    selectedProviderKey.value = "";
    await loadProvidersForm();
    await loadModelForm();
    await chat.refreshOpenClawModelPicker();
    chat.flashOpenClawConfigHint();
    void afterOpenClawProvidersSaved();
    afterOpenClawModelConfigSaved();
  } catch (e) {
    provError.value = e instanceof Error ? e.message : String(e);
  } finally {
    provBusy.value = false;
  }
}

watch(
  () => props.modelValue,
  (v) => {
    if (v && isDidClawElectron()) {
      tab.value = localSettings.initialTab;
      creatingNewProvider.value = false;
      void loadAll();
    }
  },
);

watch(tab, (t) => {
  if (props.modelValue && isDidClawElectron() && t === "providers") {
    void loadProvidersForm();
  }
});

async function onSaveGateway(): Promise<void> {
  saveError.value = null;
  const api = getDidClawDesktopApi();
  if (!api?.writeGatewayLocalConfig) {
    saveError.value = t("settings.desktopOnlySave");
    return;
  }
  saving.value = true;
  try {
    const r = await api.writeGatewayLocalConfig({
      url: wsUrl.value.trim(),
      token: token.value.trim(),
      password: password.value.trim(),
      autoStartOpenClaw: autoStartOpenClaw.value,
      stopManagedGatewayOnQuit: stopManagedGatewayOnQuit.value,
      openclawExecutable: openclawExecutable.value.trim(),
    });
    if (!r.ok) {
      saveError.value = r.error;
      return;
    }
    open.value = false;
    gw.disconnect();
    scheduleDeferredGatewayConnect(gw);
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e);
  } finally {
    saving.value = false;
  }
}

function addAliasRow(): void {
  aliasRows.value = [...aliasRows.value, { ref: "", alias: "" }];
}

function removeAliasRow(i: number): void {
  const next = aliasRows.value.slice();
  next.splice(i, 1);
  aliasRows.value = next;
}

async function onSaveModel(): Promise<void> {
  modelError.value = null;
  modelToast.value = null;
  const api = getDidClawDesktopApi();
  if (!api?.writeOpenClawModelConfig) {
    modelError.value = t("settings.desktopOnlyModel");
    return;
  }
  const p = primaryModel.value.trim();
  if (!p) {
    modelError.value = t("settings.primaryModelRequired");
    return;
  }
  const primaryBlock = describeOpenClawPrimaryModelIncompatibility(p);
  if (primaryBlock) {
    modelError.value = primaryBlock;
    return;
  }
  const models: Record<string, Record<string, unknown>> = {};
  for (const row of aliasRows.value) {
    const refKey = row.ref.trim();
    if (!refKey) {
      continue;
    }
    const al = row.alias.trim();
    models[refKey] = al ? { alias: al } : {};
  }
  modelBusy.value = true;
  try {
    const r = await api.writeOpenClawModelConfig({
      model: { primary: p },
      models,
    });
    if (!r.ok) {
      modelError.value = r.backupPath
        ? `${r.error}（备份已生成：${r.backupPath}）`
        : r.error;
      return;
    }
    modelToast.value = r.backupPath
      ? t("settings.modelSavedWithBackup")
      : t("settings.modelSaved");
    await chat.refreshOpenClawModelPicker();
    chat.flashOpenClawConfigHint();
    afterOpenClawModelConfigSaved();
  } catch (e) {
    modelError.value = e instanceof Error ? e.message : String(e);
  } finally {
    modelBusy.value = false;
  }
}

async function onRestoreModel(): Promise<void> {
  modelError.value = null;
  modelToast.value = null;
  const api = getDidClawDesktopApi();
  if (!api?.restoreOpenClawConfigToLatestBackup) {
    modelError.value = t("settings.desktopOnlyRestore");
    return;
  }
  modelBusy.value = true;
  try {
    const r = await api.restoreOpenClawConfigToLatestBackup();
    if (!r.ok) {
      modelError.value = r.backupPath
        ? `${r.error}（当前文件已先备份至：${r.backupPath}）`
        : r.error;
      return;
    }
    modelToast.value = t("settings.modelRestoredFrom", { path: r.backupUsed });
    await loadModelForm();
    await chat.refreshOpenClawModelPicker();
    chat.flashOpenClawConfigHint();
  } catch (e) {
    modelError.value = e instanceof Error ? e.message : String(e);
  } finally {
    modelBusy.value = false;
  }
}
</script>

<template>
  <!-- Teleport 避免遮罩留在 header 内：main 在 DOM 中后绘制，会盖住同层叠上下文中 header 下的 fixed 层 -->
  <Teleport to="body">
    <div v-if="open" class="backdrop" @click.self="open = false">
      <div
        class="panel"
        :class="{ 'panel--wide': tab === 'providers' || tab === 'ai' }"
        role="dialog"
        aria-labelledby="local-settings-title"
      >
        <h2 id="local-settings-title">{{ t('settings.title') }}</h2>
        <p class="dialog-lead muted small">
          {{ t('settings.lead') }}
        </p>

        <div class="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            class="tab"
            :class="{ active: tab === 'gateway' }"
            :aria-selected="tab === 'gateway'"
            @click="tab = 'gateway'"
          >
            {{ t('settings.tabGateway') }}
          </button>
          <button
            type="button"
            role="tab"
            class="tab"
            :class="{ active: tab === 'ai' }"
            :aria-selected="tab === 'ai'"
            @click="tab = 'ai'"
          >
            {{ t('settings.tabAi') }}
          </button>
          <button
            type="button"
            role="tab"
            class="tab tab--advanced"
            :class="{ active: tab === 'providers' || tab === 'model' }"
            :aria-selected="tab === 'providers' || tab === 'model'"
            :title="t('settings.tabAdvancedTitle')"
            @click="tab = tab === 'providers' ? 'model' : 'providers'"
          >
            {{ t('settings.tabAdvanced') }}
          </button>
        </div>

        <!-- ② AI 配置（新卡片式界面） -->
        <div v-if="tab === 'ai'" class="tab-panel">
          <AiProviderSetup :open="open && tab === 'ai'" />
        </div>

        <div v-show="tab === 'gateway'" class="tab-panel">
          <label class="field">
            <span class="field-label-row">
              {{ t('settings.wsUrlLabel') }}
              <span class="help-tip" :title="t('settings.wsUrlTip')" tabindex="0" role="note">?</span>
            </span>
            <input v-model="wsUrl" type="text" autocomplete="off" :placeholder="t('settings.wsUrlPlaceholder')">
          </label>
          <label class="field">
            <span class="field-label-row">
              {{ t('settings.tokenLabel') }}
              <span class="help-tip" :title="t('settings.tokenTip')" tabindex="0" role="note">?</span>
            </span>
            <input v-model="token" type="password" autocomplete="off" :placeholder="t('settings.tokenPlaceholder')">
          </label>
          <label class="field">
            <span>{{ t('settings.passwordLabel') }}</span>
            <input v-model="password" type="password" autocomplete="off" :placeholder="t('settings.passwordPlaceholder')">
          </label>

          <div class="gateway-checkbox-group">
            <label class="field field--checkbox-row">
              <input v-model="autoStartOpenClaw" type="checkbox">
              <span>{{ t('settings.autoStartLabel') }}</span>
            </label>
            <p class="hint small muted gateway-auto-hint">{{ t('settings.autoStartHint') }}</p>
            <label class="field field--checkbox-row">
              <input v-model="stopManagedGatewayOnQuit" type="checkbox">
              <span>{{ t('settings.stopOnQuitLabel') }}</span>
            </label>
          </div>

          <details class="gateway-advanced">
            <summary class="gateway-advanced-summary muted small">{{ t('settings.gatewayAdvanced') }}</summary>
            <label class="field" style="margin-top:10px">
              <span class="field-label-row">
                {{ t('settings.executableLabel') }}
                <span class="help-tip" :title="t('settings.executableTip')" tabindex="0" role="note">?</span>
              </span>
              <input
                v-model="openclawExecutable"
                type="text"
                autocomplete="off"
                :placeholder="t('settings.executablePlaceholder')"
              >
            </label>
          </details>

          <p v-if="saveError" class="err">{{ saveError }}</p>
          <div class="actions">
            <button type="button" class="ghost" @click="open = false">{{ t('common.close') }}</button>
            <button type="button" :disabled="saving" @click="onSaveGateway">
              {{ saving ? t('common.saving') : t('settings.saveAndReconnect') }}
            </button>
          </div>
        </div>

        <div v-show="tab === 'model'" class="tab-panel">
          <p class="help-intro muted small">
            {{ t('settings.modelHelp') }}
            <span
              class="help-tip"
              :title="t('settings.modelHelpTip')"
              tabindex="0"
              role="note"
            >?</span>
          </p>
          <div class="preset-dropdown-row">
            <label class="field preset-field">
              <span class="field-label-row">
                {{ t('settings.presetCn') }}
                <span
                  class="help-tip"
                  :title="t('settings.presetCnTip')"
                  tabindex="0"
                  role="note"
                >?</span>
              </span>
              <select :aria-label="t('settings.presetCnAriaLabel')" @change="onModelPresetSelect('cn', $event)">
                <option value="">{{ t('settings.presetSelectPrompt') }}</option>
                <option
                  v-for="(p, i) in primaryModelQuickPicksCn"
                  :key="p.ref"
                  :value="String(i)"
                >
                  {{ p.label }}
                </option>
              </select>
            </label>
            <label class="field preset-field">
              <span class="field-label-row">
                {{ t('settings.presetIntl') }}
                <span
                  class="help-tip"
                  :title="t('settings.presetIntlTip')"
                  tabindex="0"
                  role="note"
                >?</span>
              </span>
              <select :aria-label="t('settings.presetIntlAriaLabel')" @change="onModelPresetSelect('intl', $event)">
                <option value="">{{ t('settings.presetSelectPrompt') }}</option>
                <option
                  v-for="(p, i) in primaryModelQuickPicksIntl"
                  :key="p.ref"
                  :value="String(i)"
                >
                  {{ p.label }}
                </option>
              </select>
            </label>
          </div>
          <label class="field">
            <span class="field-label-row">
              {{ t('settings.primaryModelLabel') }}
              <span
                class="help-tip"
                :title="t('settings.primaryModelTip')"
                tabindex="0"
                role="note"
              >?</span>
            </span>
            <input
              v-model="primaryModel"
              type="text"
              autocomplete="off"
              :placeholder="t('settings.primaryModelPlaceholder')"
            >
          </label>

          <p class="subhead field-label-row">
            {{ t('settings.aliasTitle') }}
            <span
              class="help-tip"
              :title="t('settings.aliasTip')"
              tabindex="0"
              role="note"
            >?</span>
          </p>
          <div class="alias-toolbar">
            <button type="button" class="add-model-btn" @click="addAliasRow">{{ t('settings.addAliasRow') }}</button>
          </div>
          <div class="alias-list">
            <div v-for="(row, i) in aliasRows" :key="i" class="alias-row">
              <input
                v-model="row.ref"
                type="text"
                :placeholder="t('settings.aliasRefPlaceholder')"
                class="mono"
              >
              <input v-model="row.alias" type="text" :placeholder="t('settings.aliasNamePlaceholder')">
              <button type="button" class="ghost sm" @click="removeAliasRow(i)">{{ t('settings.removeAliasRow') }}</button>
            </div>
          </div>

          <p v-if="modelError" class="err">{{ modelError }}</p>
          <p v-if="modelToast" class="toast">{{ modelToast }}</p>

          <div class="actions wrap">
            <button type="button" class="ghost" :disabled="modelBusy" @click="onRestoreModel">
              {{ t('settings.restoreModel') }}
            </button>
            <button type="button" :disabled="modelBusy" @click="onSaveModel">
              {{ modelBusy ? t('common.processing') : t('common.save') }}
            </button>
          </div>
        </div>

        <div v-show="tab === 'providers'" class="tab-panel providers-tab">
          <p class="help-intro muted small">
            {{ t('settings.providerHelp') }}
            <span
              class="help-tip"
              :title="t('settings.providerHelpTip')"
              tabindex="0"
              role="note"
            >?</span>
          </p>
          <div class="preset-dropdown-row">
            <label class="field preset-field">
              <span class="field-label-row">
                {{ t('settings.presetCnProvider') }}
                <span
                  class="help-tip"
                  :title="t('settings.presetCnProviderTip')"
                  tabindex="0"
                  role="note"
                >?</span>
              </span>
              <select :aria-label="t('settings.presetCnProviderAriaLabel')" @change="onProviderPresetSelect('cn', $event)">
                <option value="">{{ t('settings.presetSelectPrompt') }}</option>
                <option
                  v-for="(preset, i) in providerPresetsCn"
                  :key="preset.label"
                  :value="String(i)"
                >
                  {{ preset.label }}
                </option>
              </select>
            </label>
            <label class="field preset-field">
              <span class="field-label-row">
                {{ t('settings.presetIntlProvider') }}
                <span
                  class="help-tip"
                  :title="t('settings.presetIntlProviderTip')"
                  tabindex="0"
                  role="note"
                >?</span>
              </span>
              <select :aria-label="t('settings.presetIntlProviderAriaLabel')" @change="onProviderPresetSelect('intl', $event)">
                <option value="">{{ t('settings.presetSelectPrompt') }}</option>
                <option
                  v-for="(preset, i) in providerPresetsIntl"
                  :key="preset.label"
                  :value="String(i)"
                >
                  {{ preset.label }}
                </option>
              </select>
            </label>
          </div>
          <div class="providers-split">
            <aside class="providers-list-col">
              <div class="providers-list-head">
                <span class="subhead tight">{{ t('settings.providersAdded') }}</span>
                <button type="button" class="ghost sm" :disabled="provBusy" @click="startNewProvider">
                  {{ t('settings.newProvider') }}
                </button>
              </div>
              <ul class="providers-key-list">
                <li v-for="key in providerKeyList" :key="key">
                  <button
                    type="button"
                    class="prov-key-btn"
                    :class="{ active: !creatingNewProvider && selectedProviderKey === key }"
                    @click="onSelectProviderKey(key)"
                  >
                    {{ key }}
                  </button>
                </li>
              </ul>
              <p v-if="providerKeyList.length === 0" class="hint small muted">{{ t('settings.noProviders') }}</p>
            </aside>

            <div class="providers-editor">
              <template v-if="creatingNewProvider">
                <label class="field">
                  <span class="field-label-row">
                    {{ t('settings.providerCodeLabel') }}
                    <span
                      class="help-tip"
                      :title="t('settings.providerCodeTip')"
                      tabindex="0"
                      role="note"
                    >?</span>
                  </span>
                  <input
                    v-model="newProviderKeyDraft"
                    type="text"
                    autocomplete="off"
                    :placeholder="t('settings.providerCodePlaceholder')"
                    class="mono"
                  >
                </label>
              </template>
              <template v-else-if="selectedProviderKey">
                <p class="subhead tight">{{ t('settings.editingProvider', { key: selectedProviderKey }) }}</p>
              </template>
              <template v-else>
                <p class="hint small">{{ t('settings.selectOrNew') }}</p>
              </template>

              <template v-if="creatingNewProvider || selectedProviderKey">
                <label class="field">
                  <span class="field-label-row">
                    {{ t('settings.baseUrlLabel') }}
                    <span
                      class="help-tip"
                      :title="t('settings.baseUrlTip')"
                      tabindex="0"
                      role="note"
                    >?</span>
                  </span>
                  <input
                    v-model="pvBaseUrl"
                    type="text"
                    autocomplete="off"
                    placeholder="https://…"
                  >
                </label>
                <label class="field api-key-field">
                  <span class="field-label-row">
                    {{ t('settings.apiKeyLabel') }}
                    <span
                      class="help-tip"
                      :title="isEditingOllamaProvider ? t('settings.apiKeyTipOllama') : t('settings.apiKeyTip')"
                      tabindex="0"
                      role="note"
                    >?</span>
                  </span>
                  <div class="api-key-row">
                    <input
                      v-model="pvApiKey"
                      :type="showPvApiKey ? 'text' : 'password'"
                      autocomplete="off"
                      :placeholder="isEditingOllamaProvider ? t('settings.apiKeyPlaceholderOllama') : t('settings.apiKeyPlaceholder')"
                    >
                    <button type="button" class="ghost sm" @click="showPvApiKey = !showPvApiKey">
                      {{ showPvApiKey ? t('common.hide') : t('common.show') }}
                    </button>
                  </div>
                </label>

                <p class="subhead tight field-label-row">
                  {{ t('settings.modelIdsLabel') }}
                  <span
                    class="help-tip"
                    :title="t('settings.modelIdsTip')"
                    tabindex="0"
                    role="note"
                  >?</span>
                </p>
                <div class="pv-models">
                  <div v-for="(row, i) in pvModelRows" :key="i" class="pv-model-row">
                    <input v-model="row.id" type="text" class="mono" :placeholder="t('settings.modelIdPlaceholder')">
                    <button type="button" class="ghost sm" @click="removePvModelRow(i)">{{ t('settings.removeModelRow') }}</button>
                  </div>
                </div>
                <button type="button" class="ghost add-row-inline" @click="addPvModelRow">{{ t('settings.addModelRow') }}</button>

                <p v-if="provError" class="err">{{ provError }}</p>
                <p v-if="provToast" class="toast">{{ provToast }}</p>

                <div class="actions wrap">
                  <button
                    type="button"
                    class="ghost danger"
                    :disabled="provBusy || creatingNewProvider || !selectedProviderKey"
                    @click="onDeleteProvider"
                  >
                    {{ t('settings.deleteProvider') }}
                  </button>
                  <button type="button" :disabled="provBusy" @click="onSaveProvider">
                    {{ provBusy ? t('common.saving') : t('common.save') }}
                  </button>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 10050;
  background: rgba(15, 23, 42, 0.25);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  isolation: isolate;
}
.panel {
  position: relative;
  z-index: 1;
  width: min(520px, 100%);
  max-height: 90vh;
  overflow: auto;
  background: var(--lc-bg-raised);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius);
  padding: 22px 22px 20px;
  box-shadow: var(--lc-shadow-md);
  color: var(--lc-text);
}
.panel--wide {
  width: min(760px, 100%);
}
.dialog-lead {
  margin: 0 0 14px;
  line-height: 1.45;
}
.help-intro {
  margin: 0 0 12px;
  line-height: 1.5;
}
.field-label-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.help-tip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.125rem;
  height: 1.125rem;
  border-radius: 999px;
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-elevated);
  font-size: 0.65rem;
  font-weight: 700;
  line-height: 1;
  color: var(--lc-text-muted);
  cursor: help;
  flex-shrink: 0;
  user-select: none;
}
.help-tip:focus-visible {
  outline: 2px solid var(--lc-accent);
  outline-offset: 2px;
}
.preset-dropdown-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 14px;
}
@media (max-width: 560px) {
  .preset-dropdown-row {
    grid-template-columns: 1fr;
  }
}
.preset-field {
  margin-bottom: 0;
}
.field select {
  padding: 10px 12px;
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  font-size: 13px;
  font-family: inherit;
  background: var(--lc-bg-deep);
  color: var(--lc-text);
  cursor: pointer;
}
.field select:focus {
  outline: none;
  border-color: var(--lc-border-strong);
}
.providers-split {
  display: grid;
  grid-template-columns: minmax(120px, 28%) 1fr;
  gap: 16px;
  align-items: start;
  margin-bottom: 12px;
}
@media (max-width: 640px) {
  .providers-split {
    grid-template-columns: 1fr;
  }
}
.providers-list-col {
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  background: var(--lc-bg-elevated);
  padding: 10px;
  max-height: 320px;
  overflow: auto;
}
.providers-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.subhead.tight {
  margin: 0;
}
.providers-key-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.prov-key-btn {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 10px;
  margin-bottom: 4px;
  border: 1px solid transparent;
  border-radius: var(--lc-radius-sm);
  background: transparent;
  font-family: var(--lc-mono);
  font-size: 12px;
  color: var(--lc-text);
  cursor: pointer;
}
.prov-key-btn:hover {
  background: var(--lc-bg-raised);
}
.prov-key-btn.active {
  border-color: var(--lc-accent);
  background: var(--lc-accent-soft);
  color: #0c4a6e;
}
.providers-editor {
  min-width: 0;
}
.api-key-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.api-key-row input {
  flex: 1;
  min-width: 0;
}
.pv-models {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 8px;
}
.pv-model-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.pv-model-row input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  font-size: 12px;
  background: var(--lc-bg-deep);
  color: var(--lc-text);
}
.add-row-inline {
  margin-bottom: 14px;
  font-size: 12px;
}
button.danger {
  border-color: rgba(220, 38, 38, 0.45);
  color: var(--lc-error);
  background: transparent;
}
button.danger:hover:not(:disabled) {
  background: var(--lc-error-bg);
}
.hint.muted {
  opacity: 0.85;
}
h2 {
  margin: 0 0 14px;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.02em;
  background: linear-gradient(105deg, #e0f7ff, var(--lc-accent));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
  padding: 4px;
  border-radius: var(--lc-radius-sm);
  background: var(--lc-bg-elevated);
  border: 1px solid var(--lc-border);
}
.tab {
  flex: 1;
  cursor: pointer;
  border: none;
  background: transparent;
  color: var(--lc-text-muted);
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  padding: 8px 10px;
  border-radius: calc(var(--lc-radius-sm) - 2px);
}
.tab.active {
  color: var(--lc-text);
  background: var(--lc-bg-raised);
  box-shadow: var(--lc-shadow-sm);
}
.tab--advanced {
  flex: 0 0 auto;
  opacity: 0.6;
  font-weight: 500;
  letter-spacing: 0.05em;
}
.tab--advanced:hover, .tab--advanced.active { opacity: 1; }
.tab-panel {
  min-height: 120px;
}
.hint {
  margin: 0 0 14px;
  font-size: 12px;
  line-height: 1.55;
  color: var(--lc-text-muted);
}
.hint.small {
  font-size: 11px;
  margin-top: 8px;
}
.hint a {
  color: var(--lc-accent);
}
.subhead {
  margin: 16px 0 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--lc-text-muted);
}
.field--checkbox-row {
  flex-direction: row;
  align-items: flex-start;
  gap: 10px;
}
.field--checkbox-row input[type="checkbox"] {
  width: auto;
  margin-top: 3px;
  flex-shrink: 0;
}
.field--checkbox-row span {
  font-weight: 500;
  line-height: 1.45;
}
.gateway-auto-hint {
  margin: 2px 0 6px 22px;
}
.gateway-checkbox-group {
  margin: 4px 0 14px;
  padding: 10px 12px;
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  background: var(--lc-bg-elevated);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.gateway-advanced {
  margin: 4px 0 14px;
}
.gateway-advanced-summary {
  cursor: pointer;
  user-select: none;
  list-style: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 0;
}
.gateway-advanced-summary::-webkit-details-marker {
  display: none;
}
.gateway-advanced[open] > .gateway-advanced-summary::before {
  content: "▼ ";
  font-size: 9px;
}
.gateway-advanced:not([open]) > .gateway-advanced-summary::before {
  content: "▶ ";
  font-size: 9px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
  font-size: 12px;
}
.field span {
  color: var(--lc-text-muted);
  font-weight: 600;
}
.field input {
  padding: 10px 12px;
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  font-size: 13px;
  font-family: var(--lc-mono);
  background: var(--lc-bg-deep);
  color: var(--lc-text);
}
.field input:focus {
  outline: none;
  border-color: var(--lc-border-strong);
}
.alias-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.alias-row {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 8px;
  align-items: center;
}
.alias-row input {
  padding: 8px 10px;
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  font-size: 12px;
  background: var(--lc-bg-deep);
  color: var(--lc-text);
}
.alias-row input.mono {
  font-family: var(--lc-mono);
}
.alias-toolbar {
  margin-bottom: 10px;
}
.add-model-btn {
  width: 100%;
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 600;
  border-radius: var(--lc-radius-sm);
  border: 1px dashed var(--lc-border-strong);
  background: var(--lc-bg-elevated);
  color: var(--lc-accent);
  cursor: pointer;
  font-family: inherit;
}
.add-model-btn:hover {
  border-style: solid;
  background: var(--lc-bg-raised);
}
.err {
  color: var(--lc-error);
  font-size: 12px;
  margin: 0 0 10px;
}
.toast {
  color: var(--lc-accent);
  font-size: 12px;
  margin: 0 0 10px;
  line-height: 1.45;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 12px;
}
.actions.wrap {
  flex-wrap: wrap;
  justify-content: flex-start;
}
button {
  cursor: pointer;
  padding: 8px 16px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid rgba(6, 182, 212, 0.45);
  background: linear-gradient(165deg, #0e7490 0%, #0891b2 48%, #6366f1 160%);
  color: #f8fafc;
  font-size: 13px;
  font-weight: 500;
}
button.ghost {
  background: transparent;
  border-color: var(--lc-border);
  color: var(--lc-text-muted);
}
button.ghost.sm {
  padding: 6px 10px;
  font-size: 12px;
}
button.ghost:hover {
  border-color: var(--lc-border-strong);
  color: var(--lc-text);
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
code {
  font-family: var(--lc-mono);
  font-size: 11px;
  background: #f1f5f9;
  border: 1px solid var(--lc-border);
  padding: 2px 6px;
  border-radius: 4px;
  color: #0e7490;
}
</style>
