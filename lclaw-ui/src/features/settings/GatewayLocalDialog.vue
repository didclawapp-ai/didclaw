<script setup lang="ts">
import {
  afterOpenClawModelConfigSaved,
  afterOpenClawProvidersSaved,
} from "@/composables/modelConfigDeferred";
import { getLclawDesktopApi, isLclawElectron } from "@/lib/electron-bridge";
import {
  PRIMARY_MODEL_QUICK_PICKS,
  PROVIDER_SETUP_PRESETS,
  type ProviderSetupPreset,
} from "@/lib/openclaw-presets";
import { describeOpenClawPrimaryModelIncompatibility } from "@/lib/openclaw-model-guards";
import { OPENCLAW_PROVIDER_ID_RE } from "@/lib/openclaw-provider-id";
import { gatewayUrlFromEnv, useGatewayStore } from "@/stores/gateway";
import { useChatStore } from "@/stores/chat";
import { useLocalSettingsStore } from "@/stores/localSettings";
import { computed, ref, watch } from "vue";

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [v: boolean];
}>();

const gw = useGatewayStore();
const localSettings = useLocalSettingsStore();
const chat = useChatStore();

type TabId = "gateway" | "model" | "providers";

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
  const api = getLclawDesktopApi();
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

function rowFromModels(models: Record<string, unknown>): AliasRow[] {
  return Object.keys(models)
    .sort()
    .map((k) => {
      const v = models[k];
      let alias = "";
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const a = (v as { alias?: unknown }).alias;
        if (typeof a === "string") {
          alias = a;
        }
      }
      return { ref: k, alias };
    });
}

async function loadModelForm(): Promise<void> {
  modelError.value = null;
  modelToast.value = null;
  const api = getLclawDesktopApi();
  if (!api?.readOpenClawModelConfig) {
    return;
  }
  try {
    const r = await api.readOpenClawModelConfig();
    if (!r.ok) {
      modelError.value = r.error;
      primaryModel.value = "";
      aliasRows.value = [];
      return;
    }
    const p = r.model?.primary;
    primaryModel.value = typeof p === "string" ? p : "";
    aliasRows.value = rowFromModels(r.models as Record<string, unknown>);
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

function readProviderBaseUrl(s: Record<string, unknown>): string {
  const a = s.baseUrl;
  const b = s.baseURL;
  if (typeof a === "string") {
    return a;
  }
  if (typeof b === "string") {
    return b;
  }
  return "";
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

function readProviderApiKey(s: Record<string, unknown>): string {
  const k = s.apiKey;
  return typeof k === "string" ? k : "";
}

function modelIdsFromProviderModels(m: unknown): string[] {
  if (Array.isArray(m)) {
    const ids: string[] = [];
    for (const x of m) {
      if (x && typeof x === "object" && !Array.isArray(x)) {
        const id = (x as { id?: unknown }).id;
        if (typeof id === "string" && id.trim()) {
          ids.push(id.trim());
        }
      }
    }
    return [...new Set(ids)].sort();
  }
  if (m && typeof m === "object" && !Array.isArray(m)) {
    return Object.keys(m as Record<string, unknown>).sort();
  }
  return [];
}

function extractProviderExtras(s: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!s) {
    return {};
  }
  const out: Record<string, unknown> = {};
  if (typeof s.api === "string" && s.api.trim()) {
    out.api = s.api.trim();
  }
  if (s.authHeader === true) {
    out.authHeader = true;
  }
  return out;
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
  const s = providerSnapshots.value[k];
  pvBaseUrl.value = readProviderBaseUrl(s);
  pvApiKey.value = readProviderApiKey(s);
  pvModelRows.value = modelIdsFromProviderModels(s.models).map((id) => ({ id }));
  pvProviderExtras.value = extractProviderExtras(s);
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
    ? `已套用「${preset.label}」到表单（密钥未改），满意请点「保存」。`
    : `已填入「${preset.label}」：请粘贴密钥后点「保存」。`;
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
  const api = getLclawDesktopApi();
  if (!api?.readOpenClawProviders) {
    return;
  }
  try {
    const r = await api.readOpenClawProviders();
    if (!r.ok) {
      provError.value = r.error;
      providerSnapshots.value = {};
      selectedProviderKey.value = "";
      syncProviderFormFromSelection();
      return;
    }
    const next: Record<string, Record<string, unknown>> = {};
    for (const [key, v] of Object.entries(r.providers)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        next[key] = { ...(v as Record<string, unknown>) };
      }
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
    bits.push(`配置备份（模型）：${r.agentModelsBackupPath}`);
  }
  if (r.authProfilesBackupPath) {
    bits.push(`配置备份（登录信息）：${r.authProfilesBackupPath}`);
  }
  if (r.backupPath) {
    bits.push(`总配置备份：${r.backupPath}`);
  }
  bits.push("若看不懂，可把整段文字复制给客服。");
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
  const head = `「${id}」已保存。若对话仍提示无密钥或连不上，可先重启助手网关再试。`;
  const tails: string[] = [];
  if (r.agentModelsBackupPath || r.authProfilesBackupPath || r.backupPath) {
    tails.push("原配置已自动备份到同文件夹（文件名含「备份」）");
  }
  return tails.length > 0 ? `${head} ${tails.join("。")}。` : head;
}

async function onSaveProvider(): Promise<void> {
  provError.value = null;
  provToast.value = null;
  const api = getLclawDesktopApi();
  if (!api?.writeOpenClawProvidersPatch) {
    provError.value = "请使用桌面版打开本设置。";
    return;
  }
  const id = creatingNewProvider.value ? newProviderKeyDraft.value.trim() : selectedProviderKey.value;
  if (!OPENCLAW_PROVIDER_ID_RE.test(id)) {
    provError.value =
      "服务代号只能用小写英文、数字和短横线（例如 minimax、moonshot），不要用中文或空格。";
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
      provError.value =
        "「模型 ID」里不要写斜杠 /。下面每一行只填模型名字（如 MiniMax-M2.7、OpenRouter 免费路由填 free）；斜杠前面的服务代号在左侧列表里已经选好了。";
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
    await chat.refreshOpenClawModelPicker();
    chat.flashOpenClawConfigHint();
    void afterOpenClawProvidersSaved();
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
    !window.confirm(
      `确定删除「${id}」这项 AI 服务配置？删除后无法用该线路的模型，除非重新添加。已自动备份原配置。`,
    )
  ) {
    return;
  }
  provError.value = null;
  provToast.value = null;
  const api = getLclawDesktopApi();
  if (!api?.writeOpenClawProvidersPatch) {
    provError.value = "请使用桌面版打开本设置。";
    return;
  }
  provBusy.value = true;
  try {
    const r = await api.writeOpenClawProvidersPatch({ patch: { [id]: null } });
    if (!r.ok) {
      provError.value = formatProvidersWriteError(r);
      return;
    }
    provToast.value = `已删除「${id}」。若列表没更新，可稍等或重启助手后再看。`;
    selectedProviderKey.value = "";
    await loadProvidersForm();
    await chat.refreshOpenClawModelPicker();
    chat.flashOpenClawConfigHint();
  } catch (e) {
    provError.value = e instanceof Error ? e.message : String(e);
  } finally {
    provBusy.value = false;
  }
}

watch(
  () => props.modelValue,
  (v) => {
    if (v && isLclawElectron()) {
      tab.value = localSettings.initialTab;
      creatingNewProvider.value = false;
      void loadAll();
    }
  },
);

watch(tab, (t) => {
  if (props.modelValue && isLclawElectron() && t === "providers") {
    void loadProvidersForm();
  }
});

async function onSaveGateway(): Promise<void> {
  saveError.value = null;
  const api = getLclawDesktopApi();
  if (!api?.writeGatewayLocalConfig) {
    saveError.value = "请使用桌面版保存连接设置。";
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
    gw.connect();
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
  const api = getLclawDesktopApi();
  if (!api?.writeOpenClawModelConfig) {
    modelError.value = "请使用桌面版保存模型设置。";
    return;
  }
  const p = primaryModel.value.trim();
  if (!p) {
    modelError.value = "请先填写「默认使用的模型」那一栏。";
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
      ? "已保存。上一份配置已自动备份（文件名含「备份」）。"
      : "已保存。";
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
  const api = getLclawDesktopApi();
  if (!api?.restoreOpenClawConfigToLatestBackup) {
    modelError.value = "请使用桌面版恢复备份。";
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
    modelToast.value = `已从备份恢复：${r.backupUsed}`;
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
        :class="{ 'panel--wide': tab === 'providers' }"
        role="dialog"
        aria-labelledby="local-settings-title"
      >
        <h2 id="local-settings-title">本机设置</h2>
        <p class="dialog-lead muted small">
          按 ①→②→③ 完成连接与账号。
          <span
            class="help-tip"
            title="① 连接本机助手；② 填写各 AI 的接口与密钥；③ 选择默认对话模型。保存在本机，无需手写配置文件。"
            tabindex="0"
            role="note"
          >?</span>
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
            ① 连助手
          </button>
          <button
            type="button"
            role="tab"
            class="tab"
            :class="{ active: tab === 'providers' }"
            :aria-selected="tab === 'providers'"
            @click="tab = 'providers'"
          >
            ② AI 账号
          </button>
          <button
            type="button"
            role="tab"
            class="tab"
            :class="{ active: tab === 'model' }"
            :aria-selected="tab === 'model'"
            @click="tab = 'model'"
          >
            ③ 选模型
          </button>
        </div>

        <div v-show="tab === 'gateway'" class="tab-panel">
          <p class="help-intro muted small">
            一般无需修改。
            <span
              class="help-tip"
              title="装好助手后地址与口令通常已正确；仅当教程或客服要求时再改。"
              tabindex="0"
              role="note"
            >?</span>
          </p>
          <label class="field">
            <span class="field-label-row">
              连接地址
              <span class="help-tip" title="WebSocket 地址，多为 ws://127.0.0.1:端口" tabindex="0" role="note">?</span>
            </span>
            <input v-model="wsUrl" type="text" autocomplete="off" placeholder="ws://127.0.0.1:18789">
          </label>
          <label class="field">
            <span class="field-label-row">
              口令（Token）
              <span
                class="help-tip"
                title="与下方密码二选一。留空时启动连接会自动读取 ~/.openclaw/openclaw.json 中 gateway.auth.token（mode 为 token 时）。"
                tabindex="0"
                role="note"
              >?</span>
            </span>
            <input v-model="token" type="password" autocomplete="off" placeholder="可选（可自动从 openclaw.json 读取）">
          </label>
          <label class="field">
            <span>密码</span>
            <input v-model="password" type="password" autocomplete="off" placeholder="可选">
          </label>
          <label class="field field--checkbox-row">
            <input v-model="autoStartOpenClaw" type="checkbox">
            <span>连接时自动在后台启动本机 OpenClaw 网关（无黑窗）</span>
          </label>
          <p class="hint small muted gateway-auto-hint">
            仅当地址为 127.0.0.1 / localhost 且对应端口尚未监听时，由本应用代为执行
            <code>openclaw gateway</code>。远程网关不受影响。
          </p>
          <label class="field field--checkbox-row">
            <input v-model="stopManagedGatewayOnQuit" type="checkbox">
            <span>退出本应用时，结束由本应用启动的网关进程</span>
          </label>
          <label class="field">
            <span class="field-label-row">
              openclaw 可执行文件
              <span
                class="help-tip"
                title="一般留空即可。若终端能运行 openclaw 但此处找不到，可填 npm 全局目录下的 openclaw.cmd 完整路径。"
                tabindex="0"
                role="note"
              >?</span>
            </span>
            <input
              v-model="openclawExecutable"
              type="text"
              autocomplete="off"
              placeholder="留空则从 PATH 查找（Windows 可用 where openclaw 看路径）"
            >
          </label>
          <p v-if="saveError" class="err">{{ saveError }}</p>
          <div class="actions">
            <button type="button" class="ghost" @click="open = false">关闭</button>
            <button type="button" :disabled="saving" @click="onSaveGateway">
              {{ saving ? "保存中…" : "保存并重新连接" }}
            </button>
          </div>
        </div>

        <div v-show="tab === 'model'" class="tab-panel">
          <p class="help-intro muted small">
            选好默认模型后点保存。
            <span
              class="help-tip"
              title="格式为「服务名/模型名」，须与②中已添加的服务一致，例如 minimax/MiniMax-M2.5。"
              tabindex="0"
              role="note"
            >?</span>
          </p>
          <div class="preset-dropdown-row">
            <label class="field preset-field">
              <span class="field-label-row">
                国内快捷
                <span
                  class="help-tip"
                  title="选一项填入下方「默认模型」，再点保存。"
                  tabindex="0"
                  role="note"
                >?</span>
              </span>
              <select aria-label="国内默认模型模板" @change="onModelPresetSelect('cn', $event)">
                <option value="">选择…</option>
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
                国外快捷
                <span
                  class="help-tip"
                  title="与 OpenClaw 常见默认 ref 一致；选后填入下方并保存。"
                  tabindex="0"
                  role="note"
                >?</span>
              </span>
              <select aria-label="国外默认模型模板" @change="onModelPresetSelect('intl', $event)">
                <option value="">选择…</option>
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
              默认模型
              <span
                class="help-tip"
                title="须与② 左侧列表中的服务名对应，中间为英文斜杠 /。"
                tabindex="0"
                role="note"
              >?</span>
            </span>
            <input
              v-model="primaryModel"
              type="text"
              autocomplete="off"
              placeholder="如 minimax/MiniMax-M2.5"
            >
          </label>

          <p class="subhead field-label-row">
            显示别名（可选）
            <span
              class="help-tip"
              title="在会话侧下拉框里显示更好记的名称；不填则显示完整模型名。"
              tabindex="0"
              role="note"
            >?</span>
          </p>
          <div class="alias-toolbar">
            <button type="button" class="add-model-btn" @click="addAliasRow">添加一行</button>
          </div>
          <div class="alias-list">
            <div v-for="(row, i) in aliasRows" :key="i" class="alias-row">
              <input
                v-model="row.ref"
                type="text"
                placeholder="与上面格式相同，如 minimax/MiniMax-M2.5"
                class="mono"
              >
              <input v-model="row.alias" type="text" placeholder="例如：我的 MiniMax">
              <button type="button" class="ghost sm" @click="removeAliasRow(i)">删</button>
            </div>
          </div>

          <p v-if="modelError" class="err">{{ modelError }}</p>
          <p v-if="modelToast" class="toast">{{ modelToast }}</p>

          <div class="actions wrap">
            <button type="button" class="ghost" :disabled="modelBusy" @click="onRestoreModel">
              用备份还原模型设置
            </button>
            <button type="button" :disabled="modelBusy" @click="onSaveModel">
              {{ modelBusy ? "处理中…" : "保存" }}
            </button>
          </div>
        </div>

        <div v-show="tab === 'providers'" class="tab-panel providers-tab">
          <p class="help-intro muted small">
            填密钥后保存。
            <span
              class="help-tip"
              title="可从下方下拉选模板，自动填写接口地址与模型列表；密钥需在服务商网站获取。保存后写入本机。"
              tabindex="0"
              role="note"
            >?</span>
          </p>
          <div class="preset-dropdown-row">
            <label class="field preset-field">
              <span class="field-label-row">
                国内模板
                <span
                  class="help-tip"
                  title="自动填写国内节点地址与常用模型；已有同名服务时会保留原密钥，只更新地址与模型行。"
                  tabindex="0"
                  role="note"
                >?</span>
              </span>
              <select aria-label="国内服务商模板" @change="onProviderPresetSelect('cn', $event)">
                <option value="">选择…</option>
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
                国外模板
                <span
                  class="help-tip"
                  title="与 OpenClaw 安装向导中的国际节点配置一致。"
                  tabindex="0"
                  role="note"
                >?</span>
              </span>
              <select aria-label="国外服务商模板" @change="onProviderPresetSelect('intl', $event)">
                <option value="">选择…</option>
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
                <span class="subhead tight">已添加的服务</span>
                <button type="button" class="ghost sm" :disabled="provBusy" @click="startNewProvider">
                  ＋ 新建
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
              <p v-if="providerKeyList.length === 0" class="hint small muted">还没有，点「新建」按教程加一个。</p>
            </aside>

            <div class="providers-editor">
              <template v-if="creatingNewProvider">
                <label class="field">
                  <span class="field-label-row">
                    服务代号
                    <span
                      class="help-tip"
                      title="英文小写与数字、短横线，与教程一致，如 minimax、moonshot。"
                      tabindex="0"
                      role="note"
                    >?</span>
                  </span>
                  <input
                    v-model="newProviderKeyDraft"
                    type="text"
                    autocomplete="off"
                    placeholder="如 minimax"
                    class="mono"
                  >
                </label>
              </template>
              <template v-else-if="selectedProviderKey">
                <p class="subhead tight">编辑：{{ selectedProviderKey }}</p>
              </template>
              <template v-else>
                <p class="hint small">左侧选择服务，或「新建」。</p>
              </template>

              <template v-if="creatingNewProvider || selectedProviderKey">
                <label class="field">
                  <span class="field-label-row">
                    接口地址
                    <span
                      class="help-tip"
                      title="服务商提供的 API 根地址，按官网或教程复制。"
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
                    密钥
                    <span
                      class="help-tip"
                      :title="
                        isEditingOllamaProvider
                          ? '本机 Ollama 通常无真实 API Key，可留空；保存后本应用会写入网关所需的占位凭据（ollama-local）。若使用需密钥的 Ollama 云端再粘贴。'
                          : '在服务商控制台创建 API Key 后粘贴；高级用法可填环境变量引用。'
                      "
                      tabindex="0"
                      role="note"
                    >?</span>
                  </span>
                  <div class="api-key-row">
                    <input
                      v-model="pvApiKey"
                      :type="showPvApiKey ? 'text' : 'password'"
                      autocomplete="off"
                      :placeholder="isEditingOllamaProvider ? '本机可留空' : '粘贴 API Key'"
                    >
                    <button type="button" class="ghost sm" @click="showPvApiKey = !showPvApiKey">
                      {{ showPvApiKey ? "隐藏" : "显示" }}
                    </button>
                  </div>
                </label>

                <p class="subhead tight field-label-row">
                  模型 ID（每行一个）
                  <span
                    class="help-tip"
                    title="只填模型名，不要带斜杠 /，例如 MiniMax-M2.5。"
                    tabindex="0"
                    role="note"
                  >?</span>
                </p>
                <div class="pv-models">
                  <div v-for="(row, i) in pvModelRows" :key="i" class="pv-model-row">
                    <input v-model="row.id" type="text" class="mono" placeholder="如 MiniMax-M2.5">
                    <button type="button" class="ghost sm" @click="removePvModelRow(i)">删</button>
                  </div>
                </div>
                <button type="button" class="ghost add-row-inline" @click="addPvModelRow">＋ 再加一个模型</button>

                <p v-if="provError" class="err">{{ provError }}</p>
                <p v-if="provToast" class="toast">{{ provToast }}</p>

                <div class="actions wrap">
                  <button
                    type="button"
                    class="ghost danger"
                    :disabled="provBusy || creatingNewProvider || !selectedProviderKey"
                    @click="onDeleteProvider"
                  >
                    删除这项服务
                  </button>
                  <button type="button" :disabled="provBusy" @click="onSaveProvider">
                    {{ provBusy ? "保存中…" : "保存" }}
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
  margin: -6px 0 14px;
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
