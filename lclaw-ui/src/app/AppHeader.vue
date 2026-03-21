<script setup lang="ts">
import GatewayLocalDialog from "@/features/settings/GatewayLocalDialog.vue";
import { buildDiagnosticsSnapshot, diagnosticsToPrettyJson } from "@/lib/diagnostics";
import { isLclawElectron } from "@/lib/electron-bridge";
import { useChatStore } from "@/stores/chat";
import { useGatewayStore } from "@/stores/gateway";
import { useSessionStore } from "@/stores/session";
import { storeToRefs } from "pinia";
import { ref } from "vue";
import { RouterLink } from "vue-router";

const gw = useGatewayStore();
const session = useSessionStore();
const chat = useChatStore();
const { status, lastError, helloInfo, url } = storeToRefs(gw);
const { sessions, error: sessionsError, activeSessionKey } = storeToRefs(session);
const { messages, lastError: chatError } = storeToRefs(chat);

const copiedDiag = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;
const showGatewayLocal = ref(false);

async function copyDiagnostics(): Promise<void> {
  let tokenConfigured = !!import.meta.env.VITE_GATEWAY_TOKEN?.trim();
  let passwordConfigured = !!import.meta.env.VITE_GATEWAY_PASSWORD?.trim();
  if (isLclawElectron() && window.lclawElectron?.readGatewayLocalConfig) {
    try {
      const c = await window.lclawElectron.readGatewayLocalConfig();
      if (c.token?.trim()) {
        tokenConfigured = true;
      }
      if (c.password?.trim()) {
        passwordConfigured = true;
      }
    } catch {
      /* 忽略 */
    }
  }
  const snapshot = buildDiagnosticsSnapshot({
    version: __APP_VERSION__,
    gatewayWsUrl: url.value,
    connectionStatus: status.value,
    helloInfo: helloInfo.value,
    gatewayLastError: lastError.value,
    sessionListError: sessionsError.value,
    activeSessionKey: activeSessionKey.value,
    sessionCount: sessions.value.length,
    chatLastError: chatError.value,
    messageCount: messages.value.length,
    gatewayTokenConfigured: tokenConfigured,
    gatewayPasswordConfigured: passwordConfigured,
  });
  const text = diagnosticsToPrettyJson(snapshot);
  try {
    await navigator.clipboard.writeText(text);
    copiedDiag.value = true;
    if (copyTimer !== null) {
      clearTimeout(copyTimer);
    }
    copyTimer = window.setTimeout(() => {
      copiedDiag.value = false;
      copyTimer = null;
    }, 2000);
  } catch {
    window.alert("复制失败：请在 https 或 localhost 下打开，并允许浏览器剪贴板权限。");
  }
}
</script>

<template>
  <header class="top">
    <div class="brand-row">
      <div class="brand">
        <span class="brand-glyph" aria-hidden="true" />
        <h1 class="brand-title"><span class="brand-name">LCLAW</span> UI</h1>
      </div>
      <div class="brand-actions">
        <p class="brand-tagline">Gateway 会话 · 预览 · 诊断</p>
        <RouterLink to="/about" class="lc-btn lc-btn-ghost lc-btn-sm about-link">关于</RouterLink>
      </div>
    </div>
    <div class="conn">
      <code class="url">{{ url }}</code>
      <span class="pill" :data-s="status">{{ status }}</span>
      <button
        v-if="status === 'disconnected' || status === 'error'"
        type="button"
        class="lc-btn"
        @click="gw.connect()"
      >
        连接
      </button>
      <button v-if="status === 'connected'" type="button" class="lc-btn lc-btn-ghost" @click="gw.disconnect()">
        断开
      </button>
      <button
        type="button"
        class="lc-btn lc-btn-ghost diag"
        title="复制脱敏 JSON，便于贴到工单/聊天排查"
        @click="copyDiagnostics"
      >
        复制诊断信息
      </button>
      <button
        v-if="isLclawElectron()"
        type="button"
        class="lc-btn lc-btn-ghost"
        title="将 Token 等保存到本机（打包版无 .env 时使用）"
        @click="showGatewayLocal = true"
      >
        网关本地设置
      </button>
      <span v-if="copiedDiag" class="copied">已复制</span>
    </div>
    <p v-if="helloInfo" class="meta">{{ helloInfo }}</p>
    <p v-if="lastError" class="err">{{ lastError }}</p>

    <GatewayLocalDialog v-model="showGatewayLocal" />
  </header>
</template>

<style scoped>
.top {
  flex: 0 0 auto;
  padding: 14px 20px 16px;
  border-bottom: 1px solid var(--lc-border);
  background: var(--lc-surface-top);
  backdrop-filter: blur(12px);
  box-shadow: var(--lc-shadow-sm);
  position: relative;
}
.top::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 1px;
  background: var(--lc-header-line);
  opacity: 0.85;
}
.brand-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px 16px;
  margin-bottom: 10px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}
.brand-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
}
.about-link {
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}
.brand-glyph {
  display: block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: linear-gradient(135deg, var(--lc-accent), #6366f1);
  box-shadow: 0 0 16px var(--lc-accent-glow);
  transform: rotate(45deg);
}
.brand-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--lc-text);
}
.brand-name {
  background: linear-gradient(105deg, #0e7490 0%, var(--lc-accent) 42%, #4f46e5 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.brand-tagline {
  margin: 0;
  font-size: 12px;
  color: var(--lc-text-muted);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.conn {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.url {
  font-family: var(--lc-mono);
  font-size: 11px;
  background: var(--lc-bg-elevated);
  padding: 5px 10px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  color: var(--lc-accent);
  max-width: min(520px, 100%);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pill {
  text-transform: uppercase;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-raised);
  color: var(--lc-text-muted);
}
.pill[data-s="connected"] {
  border-color: rgba(5, 150, 105, 0.35);
  background: var(--lc-success-bg);
  color: var(--lc-success);
  box-shadow: none;
}
.pill[data-s="error"] {
  border-color: rgba(248, 113, 113, 0.5);
  background: var(--lc-error-bg);
  color: var(--lc-error);
}
.pill[data-s="disconnected"] {
  color: var(--lc-warning);
  border-color: rgba(251, 191, 36, 0.35);
  background: var(--lc-warning-bg);
}
.meta {
  margin: 8px 0 0;
  color: var(--lc-text-muted);
  font-size: 12px;
}
.err {
  color: var(--lc-error);
  margin: 8px 0 0;
}
.diag {
  font-size: 12px;
}
.copied {
  font-size: 12px;
  color: var(--lc-success);
  font-weight: 500;
  animation: lc-fade-in 0.25s ease;
}
@keyframes lc-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
