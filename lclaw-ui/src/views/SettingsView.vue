<script setup lang="ts">
import { isLclawElectron } from "@/lib/electron-bridge";
import {
  clearWebGatewayOverrides,
  readWebGatewayStored,
  writeWebGatewayOverrides,
} from "@/lib/gateway-web-storage";
import { gatewayUrlFromEnv, useGatewayStore } from "@/stores/gateway";
import { ref } from "vue";
import { RouterLink } from "vue-router";

const gw = useGatewayStore();

const url = ref("");
const token = ref("");
const password = ref("");
const busy = ref(false);
const toast = ref<string | null>(null);

function initFormFromSources(): void {
  const stored = readWebGatewayStored();
  url.value = stored.url?.trim() || gatewayUrlFromEnv();
  token.value = stored.token?.trim() ?? import.meta.env.VITE_GATEWAY_TOKEN?.trim() ?? "";
  password.value = stored.password?.trim() ?? import.meta.env.VITE_GATEWAY_PASSWORD?.trim() ?? "";
}

initFormFromSources();

async function onSave(): Promise<void> {
  if (!url.value.trim()) {
    toast.value = "请填写 Gateway WebSocket URL";
    return;
  }
  busy.value = true;
  toast.value = null;
  try {
    writeWebGatewayOverrides({
      url: url.value,
      token: token.value,
      password: password.value,
    });
    await gw.reloadConnection();
    toast.value = "已保存并尝试重新连接";
  } catch (e) {
    toast.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

async function onClear(): Promise<void> {
  busy.value = true;
  toast.value = null;
  try {
    clearWebGatewayOverrides();
    initFormFromSources();
    await gw.reloadConnection();
    toast.value = "已清除浏览器覆盖，并尝试按环境变量重连";
  } catch (e) {
    toast.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="settings">
    <header class="bar">
      <RouterLink to="/" class="lc-btn lc-btn-ghost lc-btn-sm back">← 返回会话</RouterLink>
      <h1 class="title">连接设置</h1>
    </header>

    <div v-if="isLclawElectron()" class="card muted-card">
      <p>
        当前为 <strong>Electron 桌面版</strong>：请使用顶栏 <strong>「网关本地设置」</strong> 保存 Gateway 地址与
        Token（写入本机配置文件）。浏览器 localStorage 在此模式下<strong>不会</strong>参与连接。
      </p>
      <RouterLink to="/" class="lc-btn lc-btn-sm">返回会话</RouterLink>
    </div>

    <template v-else>
      <div class="warn card">
        <p>
          <strong>安全提示</strong>：以下值会保存在本机浏览器的 <code>localStorage</code>（明文）。请勿在公共电脑保存
          Token；生产环境优先使用构建时环境变量或反向代理。
        </p>
      </div>

      <form class="card form" @submit.prevent="onSave">
        <label class="field">
          <span class="label">Gateway WebSocket URL</span>
          <input v-model="url" type="text" autocomplete="off" placeholder="ws://127.0.0.1:18789" required>
        </label>
        <label class="field">
          <span class="label">Token（可选）</span>
          <input v-model="token" type="password" autocomplete="new-password" placeholder="留空则使用 .env 中的值（若已配置）">
        </label>
        <label class="field">
          <span class="label">密码（可选，与 Token 二选一）</span>
          <input v-model="password" type="password" autocomplete="new-password" placeholder="留空则使用 .env 中的值（若已配置）">
        </label>
        <p class="hint">
          仅填写需要<strong>覆盖</strong>环境变量的项。保存后若 Token/密码留空且未写入本地覆盖，将继续使用
          <code>VITE_GATEWAY_TOKEN</code> / <code>VITE_GATEWAY_PASSWORD</code>。
        </p>
        <div class="actions">
          <button type="submit" class="lc-btn" :disabled="busy">保存并重新连接</button>
          <button type="button" class="lc-btn lc-btn-ghost" :disabled="busy" @click="onClear">
            清除浏览器覆盖
          </button>
        </div>
        <p v-if="toast" class="toast">{{ toast }}</p>
      </form>
    </template>
  </div>
</template>

<style scoped>
.settings {
  min-height: 100vh;
  padding: 20px 24px 32px;
  font-family: var(--lc-font);
  color: var(--lc-text);
  box-sizing: border-box;
}
.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  margin-bottom: 20px;
}
.back {
  text-decoration: none;
}
.title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.card {
  max-width: 560px;
  padding: 18px 20px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-raised);
  margin-bottom: 16px;
  line-height: 1.55;
  font-size: 14px;
}
.warn {
  border-color: rgba(217, 119, 6, 0.35);
  background: var(--lc-warning-bg);
  color: var(--lc-text);
}
.warn p {
  margin: 0;
  font-size: 13px;
}
.muted-card p {
  margin: 0 0 14px;
  color: var(--lc-text-muted);
  font-size: 14px;
}
.form .field {
  display: block;
  margin-bottom: 14px;
}
.label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--lc-text-muted);
  margin-bottom: 6px;
}
input[type="text"],
input[type="password"] {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-elevated);
  color: var(--lc-text);
  font-family: var(--lc-mono);
  font-size: 13px;
}
input:focus {
  outline: none;
  border-color: var(--lc-border-strong);
  box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.12);
}
.hint {
  margin: 0 0 16px;
  font-size: 12px;
  color: var(--lc-text-muted);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.toast {
  margin: 14px 0 0;
  font-size: 13px;
  color: var(--lc-accent);
}
code {
  font-family: var(--lc-mono);
  font-size: 12px;
  background: var(--lc-bg-elevated);
  padding: 2px 6px;
  border-radius: 4px;
}
</style>
