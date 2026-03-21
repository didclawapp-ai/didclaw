<script setup lang="ts">
import { isLclawElectron } from "@/lib/electron-bridge";
import { gatewayUrlFromEnv, useGatewayStore } from "@/stores/gateway";
import { computed, ref, watch } from "vue";

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [v: boolean];
}>();

const gw = useGatewayStore();

const wsUrl = ref("");
const token = ref("");
const password = ref("");
const saveError = ref<string | null>(null);
const saving = ref(false);

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit("update:modelValue", v),
});

async function loadForm(): Promise<void> {
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

watch(
  () => props.modelValue,
  (v) => {
    if (v && isLclawElectron()) {
      void loadForm();
    }
  },
);

async function onSave(): Promise<void> {
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
</script>

<template>
  <div v-if="open" class="backdrop" @click.self="open = false">
    <div class="panel" role="dialog" aria-labelledby="gw-local-title">
      <h2 id="gw-local-title">网关本地设置（桌面版）</h2>
      <p class="hint">
        保存到本机用户目录下的 <code>gateway-local.json</code>（明文存储，勿分享）。打包后的 exe 不会自动带上开发机
        <code>.env</code>，请在此填写 token 或密码。
      </p>
      <label class="field">
        <span>WebSocket URL</span>
        <input v-model="wsUrl" type="text" autocomplete="off" placeholder="ws://127.0.0.1:18789">
      </label>
      <label class="field">
        <span>Token（与网关 dashboard / openclaw 配置一致）</span>
        <input v-model="token" type="password" autocomplete="off" placeholder="可选，与密码二选一">
      </label>
      <label class="field">
        <span>密码</span>
        <input v-model="password" type="password" autocomplete="off" placeholder="可选">
      </label>
      <p v-if="saveError" class="err">{{ saveError }}</p>
      <div class="actions">
        <button type="button" class="ghost" @click="open = false">取消</button>
        <button type="button" :disabled="saving" @click="onSave">{{ saving ? "保存中…" : "保存并重连" }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(15, 23, 42, 0.25);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.panel {
  width: min(440px, 100%);
  max-height: 90vh;
  overflow: auto;
  background: var(--lc-bg-raised);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius);
  padding: 22px 22px 20px;
  box-shadow: var(--lc-shadow-md);
  color: var(--lc-text);
}
h2 {
  margin: 0 0 12px;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.02em;
  background: linear-gradient(105deg, #e0f7ff, var(--lc-accent));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.hint {
  margin: 0 0 18px;
  font-size: 12px;
  line-height: 1.55;
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
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.field input::placeholder {
  color: var(--lc-text-dim);
}
.field input:focus {
  outline: none;
  border-color: var(--lc-border-strong);
  box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.2);
}
.err {
  color: var(--lc-error);
  font-size: 12px;
  margin: 0 0 12px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 10px;
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
