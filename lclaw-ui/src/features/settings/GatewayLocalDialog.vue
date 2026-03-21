<script setup lang="ts">
import { isLclawElectron } from "@/lib/electron-bridge";
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

const providerKeyList = computed(() => Object.keys(providerSnapshots.value).sort());

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit("update:modelValue", v),
});

async function loadGatewayForm(): Promise<void> {
  saveError.value = null;
  wsUrl.value = gatewayUrlFromEnv();
  token.value = "";
  password.value = "";
  const api = window.lclawElectron;
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
  const api = window.lclawElectron;
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

function syncProviderFormFromSelection(): void {
  const k = selectedProviderKey.value;
  if (!k || !providerSnapshots.value[k]) {
    pvBaseUrl.value = "";
    pvApiKey.value = "";
    pvModelRows.value = [];
    return;
  }
  const s = providerSnapshots.value[k];
  pvBaseUrl.value = readProviderBaseUrl(s);
  pvApiKey.value = readProviderApiKey(s);
  const m = s.models;
  const ids =
    m && typeof m === "object" && !Array.isArray(m)
      ? Object.keys(m as Record<string, unknown>).sort()
      : [];
  pvModelRows.value = ids.map((id) => ({ id }));
}

async function loadProvidersForm(): Promise<void> {
  provError.value = null;
  provToast.value = null;
  const api = window.lclawElectron;
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

async function onSaveProvider(): Promise<void> {
  provError.value = null;
  provToast.value = null;
  const api = window.lclawElectron;
  if (!api?.writeOpenClawProvidersPatch) {
    provError.value = "非 Electron 环境";
    return;
  }
  const id = creatingNewProvider.value ? newProviderKeyDraft.value.trim() : selectedProviderKey.value;
  if (!OPENCLAW_PROVIDER_ID_RE.test(id)) {
    provError.value =
      "供应商 ID 须为小写字母、数字与连字符（如 deepseek、xiaomi），不能以连字符开头或结尾";
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
    const pe = prevModels[mid];
    models[mid] =
      pe && typeof pe === "object" && !Array.isArray(pe)
        ? { ...(pe as Record<string, unknown>) }
        : {};
  }
  const body: Record<string, unknown> = {
    apiKey: pvApiKey.value.trim(),
    models,
  };
  body[urlK] = pvBaseUrl.value.trim();

  provBusy.value = true;
  try {
    const r = await api.writeOpenClawProvidersPatch({ patch: { [id]: body } });
    if (!r.ok) {
      provError.value = r.backupPath ? `${r.error}（备份：${r.backupPath}）` : r.error;
      return;
    }
    provToast.value = r.backupPath
      ? `已保存供应商「${id}」。已备份：${r.backupPath}`
      : `已保存供应商「${id}」`;
    creatingNewProvider.value = false;
    selectedProviderKey.value = id;
    await loadProvidersForm();
    await chat.refreshOpenClawModelPicker();
    chat.flashOpenClawConfigHint();
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
  if (!window.confirm(`确定删除供应商「${id}」？将写回 openclaw.json（保存前自动备份）。`)) {
    return;
  }
  provError.value = null;
  provToast.value = null;
  const api = window.lclawElectron;
  if (!api?.writeOpenClawProvidersPatch) {
    provError.value = "非 Electron 环境";
    return;
  }
  provBusy.value = true;
  try {
    const r = await api.writeOpenClawProvidersPatch({ patch: { [id]: null } });
    if (!r.ok) {
      provError.value = r.backupPath ? `${r.error}（备份：${r.backupPath}）` : r.error;
      return;
    }
    provToast.value = `已删除供应商「${id}」`;
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
  const api = window.lclawElectron;
  if (!api?.writeGatewayLocalConfig) {
    saveError.value = "非 Electron 环境";
    return;
  }
  saving.value = true;
  try {
    const r = await api.writeGatewayLocalConfig({
      url: wsUrl.value.trim() || undefined,
      token: token.value.trim() || undefined,
      password: password.value.trim() || undefined,
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
  const api = window.lclawElectron;
  if (!api?.writeOpenClawModelConfig) {
    modelError.value = "非 Electron 环境";
    return;
  }
  const p = primaryModel.value.trim();
  if (!p) {
    modelError.value = "请填写默认主模型（model ref，如 deepseek/deepseek-reasoner）";
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
      ? `已保存。已备份原文件：${r.backupPath}。网关将按官方说明监视配置。`
      : "已保存（新建配置文件）。网关将按官方说明监视配置。";
    await chat.refreshOpenClawModelPicker();
    chat.flashOpenClawConfigHint();
  } catch (e) {
    modelError.value = e instanceof Error ? e.message : String(e);
  } finally {
    modelBusy.value = false;
  }
}

async function onRestoreModel(): Promise<void> {
  modelError.value = null;
  modelToast.value = null;
  const api = window.lclawElectron;
  if (!api?.restoreOpenClawConfigToLatestBackup) {
    modelError.value = "非 Electron 环境";
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

        <div class="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            class="tab"
            :class="{ active: tab === 'gateway' }"
            :aria-selected="tab === 'gateway'"
            @click="tab = 'gateway'"
          >
            网关连接
          </button>
          <button
            type="button"
            role="tab"
            class="tab"
            :class="{ active: tab === 'model' }"
            :aria-selected="tab === 'model'"
            @click="tab = 'model'"
          >
            模型（agents）
          </button>
          <button
            type="button"
            role="tab"
            class="tab"
            :class="{ active: tab === 'providers' }"
            :aria-selected="tab === 'providers'"
            @click="tab = 'providers'"
          >
            供应商
          </button>
        </div>

        <div v-show="tab === 'gateway'" class="tab-panel">
          <p class="hint">
            保存到本机 <code>gateway-local.json</code>（明文，勿分享）。打包 exe 不含开发机 <code>.env</code> 时请在此填写。
          </p>
          <label class="field">
            <span>WebSocket URL</span>
            <input v-model="wsUrl" type="text" autocomplete="off" placeholder="ws://127.0.0.1:18789">
          </label>
          <label class="field">
            <span>Token</span>
            <input v-model="token" type="password" autocomplete="off" placeholder="可选，与密码二选一">
          </label>
          <label class="field">
            <span>密码</span>
            <input v-model="password" type="password" autocomplete="off" placeholder="可选">
          </label>
          <p v-if="saveError" class="err">{{ saveError }}</p>
          <div class="actions">
            <button type="button" class="ghost" @click="open = false">关闭</button>
            <button type="button" :disabled="saving" @click="onSaveGateway">
              {{ saving ? "保存中…" : "保存并重连" }}
            </button>
          </div>
        </div>

        <div v-show="tab === 'model'" class="tab-panel">
          <div class="model-scope-note">
            <p class="hint tight">
              本页<strong>只</strong>改 OpenClaw 配置里的两层（与官方结构一致）：
            </p>
            <ul class="scope-list">
              <li>
                <strong>①</strong> <code>agents.defaults.model.primary</code>：默认用哪条模型 ref。
              </li>
              <li>
                <strong>②</strong> <code>agents.defaults.models</code>：给已有 ref 起<strong>展示别名</strong>，方便会话栏下拉识别；<strong>不是</strong>填写 API 地址或密钥。
              </li>
              <li>
                <strong>③</strong> <code>models.providers</code>（API 地址、API Key、各 provider 下 <code>models</code>）请在上方 <strong>「供应商」</strong> Tab
                增删改；复杂字段仍可手改 JSON 或使用官方 CLI。
              </li>
            </ul>
            <p class="hint tight bottom">
              <a
                href="https://docs.openclaw.ai/gateway/configuration"
                target="_blank"
                rel="noopener noreferrer"
              >官方 Gateway 配置</a>
              ·
              <a
                href="https://docs.openclaw.ai/concepts/model-providers"
                target="_blank"
                rel="noopener noreferrer"
              >Model providers 概念</a>
            </p>
          </div>
          <label class="field">
            <span>默认主模型 primary</span>
            <input
              v-model="primaryModel"
              type="text"
              autocomplete="off"
              placeholder="如 deepseek/deepseek-reasoner"
            >
          </label>

          <p class="subhead">别名表：provider/model-id → 展示名（②）</p>
          <p class="hint small">
            每行左侧填<strong>已在 ③ 里配置好的</strong> <code>provider/model-id</code>（例如文档里的 <code>xiaomi/mimo-v2-pro</code>）；右侧别名仅用于界面展示。会话栏切换的是 <code>primary</code>；<code>chat.send</code> 不带根级 <code>model</code>。
          </p>
          <div class="alias-toolbar">
            <button type="button" class="add-model-btn" @click="addAliasRow">
              ＋ 添加一行（ref，非 API 密钥）
            </button>
          </div>
          <div class="alias-list">
            <div v-for="(row, i) in aliasRows" :key="i" class="alias-row">
              <input v-model="row.ref" type="text" placeholder="provider/model-id" class="mono">
              <input v-model="row.alias" type="text" placeholder="别名（可选）">
              <button type="button" class="ghost sm" @click="removeAliasRow(i)">删</button>
            </div>
          </div>
          <p v-if="aliasRows.length === 0" class="hint small empty-models">
            当前无别名行；可只改上方 <code>primary</code> 保存，或添加行以扩展 <code>models</code> 注册表。
          </p>

          <p v-if="modelError" class="err">{{ modelError }}</p>
          <p v-if="modelToast" class="toast">{{ modelToast }}</p>

          <div class="actions wrap">
            <button type="button" class="ghost" :disabled="modelBusy" @click="onRestoreModel">
              恢复上次备份
            </button>
            <button type="button" :disabled="modelBusy" @click="onSaveModel">
              {{ modelBusy ? "处理中…" : "保存模型配置" }}
            </button>
          </div>
          <p class="hint small">
            保存前会自动备份当前 <code>openclaw.json</code>；备份文件名为
            <code>openclaw.json.lclaw-backup-时间戳.json</code>，与配置文件同目录。
          </p>
        </div>

        <div v-show="tab === 'providers'" class="tab-panel providers-tab">
          <p class="hint small providers-intro">
            编辑 <code>models.providers</code>。保存时<strong>合并</strong>写入（不整文件覆盖），写前自动备份。供应商 ID 建议与 ref 前缀一致（如
            <code>deepseek</code> 对应 <code>deepseek/…</code>）。API Key 保存在本机 JSON 为<strong>明文</strong>，请勿分享备份文件。
          </p>

          <div class="providers-split">
            <aside class="providers-list-col">
              <div class="providers-list-head">
                <span class="subhead tight">供应商</span>
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
              <p v-if="providerKeyList.length === 0" class="hint small muted">暂无供应商，点击「新建」。</p>
            </aside>

            <div class="providers-editor">
              <template v-if="creatingNewProvider">
                <label class="field">
                  <span>新供应商 ID（小写、数字、连字符）</span>
                  <input
                    v-model="newProviderKeyDraft"
                    type="text"
                    autocomplete="off"
                    placeholder="如 deepseek、xiaomi"
                    class="mono"
                  >
                </label>
              </template>
              <template v-else-if="selectedProviderKey">
                <p class="subhead tight">编辑：{{ selectedProviderKey }}</p>
              </template>
              <template v-else>
                <p class="hint small">请从左侧选择供应商，或新建。</p>
              </template>

              <template v-if="creatingNewProvider || selectedProviderKey">
                <label class="field">
                  <span>API 地址（baseUrl / baseURL）</span>
                  <input
                    v-model="pvBaseUrl"
                    type="text"
                    autocomplete="off"
                    placeholder="https://api.example.com/v1"
                  >
                </label>
                <label class="field api-key-field">
                  <span>API Key</span>
                  <div class="api-key-row">
                    <input
                      v-model="pvApiKey"
                      :type="showPvApiKey ? 'text' : 'password'"
                      autocomplete="off"
                      placeholder="sk-… 或环境变量名（依网关配置）"
                    >
                    <button type="button" class="ghost sm" @click="showPvApiKey = !showPvApiKey">
                      {{ showPvApiKey ? "隐藏" : "显示" }}
                    </button>
                  </div>
                </label>

                <p class="subhead tight">模型 ID 列表（写入该 provider 下 <code>models</code> 的键）</p>
                <p class="hint small">
                  每行一个模型 id（与 <code>provider/model-id</code> 中斜杠后一段一致）。删除行即删除该模型条目；其它 JSON 字段会尽量保留。
                </p>
                <div class="pv-models">
                  <div v-for="(row, i) in pvModelRows" :key="i" class="pv-model-row">
                    <input v-model="row.id" type="text" class="mono" placeholder="如 deepseek-reasoner">
                    <button type="button" class="ghost sm" @click="removePvModelRow(i)">删</button>
                  </div>
                </div>
                <button type="button" class="ghost add-row-inline" @click="addPvModelRow">＋ 添加模型 ID</button>

                <p v-if="provError" class="err">{{ provError }}</p>
                <p v-if="provToast" class="toast">{{ provToast }}</p>

                <div class="actions wrap">
                  <button
                    type="button"
                    class="ghost danger"
                    :disabled="provBusy || creatingNewProvider || !selectedProviderKey"
                    @click="onDeleteProvider"
                  >
                    删除此供应商
                  </button>
                  <button type="button" :disabled="provBusy" @click="onSaveProvider">
                    {{ provBusy ? "保存中…" : "保存供应商" }}
                  </button>
                </div>
              </template>
            </div>
          </div>

          <p class="hint small">
            与「模型（agents）」页共用同一套备份文件；也可用该页的「恢复上次备份」回滚整份配置。
          </p>
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
.providers-intro {
  margin-bottom: 12px;
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
.model-scope-note {
  margin-bottom: 16px;
  padding: 12px 14px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  border-left: 3px solid var(--lc-accent);
  background: var(--lc-bg-elevated);
}
.scope-list {
  margin: 0 0 0 1.1rem;
  padding: 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--lc-text-muted);
}
.scope-list li {
  margin-bottom: 8px;
}
.scope-list li:last-child {
  margin-bottom: 0;
}
.hint.tight {
  margin: 0 0 8px;
}
.hint.tight.bottom {
  margin: 10px 0 0;
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
.empty-models {
  margin-top: 8px;
  margin-bottom: 0;
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
