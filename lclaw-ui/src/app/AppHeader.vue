<script setup lang="ts">
import GatewayLocalDialog from "@/features/settings/GatewayLocalDialog.vue";
import { buildDiagnosticsSnapshot, diagnosticsToPrettyJson } from "@/lib/diagnostics";
import { isLclawElectron } from "@/lib/electron-bridge";
import { useChatStore } from "@/stores/chat";
import { useGatewayStore } from "@/stores/gateway";
import { useLocalSettingsStore } from "@/stores/localSettings";
import { useSessionStore } from "@/stores/session";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";

const gw = useGatewayStore();
const session = useSessionStore();
const chat = useChatStore();
const { status, lastError, helloInfo, url } = storeToRefs(gw);
const { sessions, error: sessionsError, activeSessionKey } = storeToRefs(session);
const { messages, lastError: chatError } = storeToRefs(chat);

const copiedDiag = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;
const localSettings = useLocalSettingsStore();
const showGatewayLocal = computed({
  get: () => localSettings.visible,
  set: (v: boolean) => {
    if (!v) {
      localSettings.close();
    }
  },
});

const connSwitchOn = computed(
  () => status.value === "connected" || status.value === "connecting",
);

const connSwitchLabel = computed(() => {
  switch (status.value) {
    case "connected":
      return "已连接网关，点击断开";
    case "connecting":
      return "正在连接，点击取消";
    case "error":
      return "连接异常，点击重连";
    default:
      return "未连接，点击连接";
  }
});

function onConnSwitchClick(): void {
  if (status.value === "connected" || status.value === "connecting") {
    gw.disconnect();
  } else {
    gw.connect();
  }
}

const connLedTitle = computed(() => {
  const lines: string[] = [url.value];
  switch (status.value) {
    case "connected":
      lines.push("状态：已连接");
      break;
    case "connecting":
      lines.push("状态：正在连接…");
      break;
    case "error":
      lines.push("状态：连接异常");
      break;
    default:
      lines.push("状态：未连接");
  }
  return lines.join("\n");
});

const connLedClass = computed(() => {
  switch (status.value) {
    case "connected":
      return "conn-led--ok";
    case "connecting":
      return "conn-led--pending";
    default:
      return "conn-led--bad";
  }
});

const connLedAriaLabel = computed(() => {
  switch (status.value) {
    case "connected":
      return `网关已连接，${url.value}`;
    case "connecting":
      return `正在连接网关，${url.value}`;
    case "error":
      return `网关连接异常，${url.value}`;
    default:
      return `网关未连接，${url.value}`;
  }
});

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
      <button
        type="button"
        class="conn-led"
        :class="connLedClass"
        :title="connLedTitle"
        :aria-label="connLedAriaLabel"
      ></button>
      <div class="conn-toolbar">
        <button
          type="button"
          class="conn-switch"
          :class="{ 'conn-switch--on': connSwitchOn, 'conn-switch--busy': status === 'connecting' }"
          role="switch"
          :aria-checked="connSwitchOn"
          :aria-label="connSwitchLabel"
          @click="onConnSwitchClick"
        >
          <span class="conn-switch-track" aria-hidden="true">
            <span class="conn-switch-thumb" />
          </span>
        </button>
        <button
          type="button"
          class="lc-btn lc-btn-ghost lc-btn-xs conn-tool-btn"
          title="复制脱敏 JSON，便于贴到工单/聊天排查"
          @click="copyDiagnostics"
        >
          诊断
        </button>
        <button
          v-if="isLclawElectron()"
          type="button"
          class="lc-btn lc-btn-ghost lc-btn-xs conn-tool-btn"
          title="网关连接与 openclaw.json 模型（本机设置）"
          @click="localSettings.open('gateway')"
        >
          本机
        </button>
        <span v-if="copiedDiag" class="copied">已复制</span>
      </div>
      <span v-if="helloInfo" class="conn-version">{{ helloInfo }}</span>
    </div>
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
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.conn-led {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  cursor: default;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}
.conn-led:focus-visible {
  outline: 2px solid var(--lc-accent);
  outline-offset: 2px;
}
.conn-led--ok {
  background: var(--lc-success);
  border-color: rgba(5, 150, 105, 0.55);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.2),
    0 0 10px rgba(5, 150, 105, 0.35);
}
.conn-led--bad {
  background: var(--lc-error);
  border-color: rgba(220, 38, 38, 0.55);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.15),
    0 0 8px rgba(220, 38, 38, 0.25);
}
.conn-led--pending {
  background: var(--lc-warning);
  border-color: rgba(217, 119, 6, 0.55);
  animation: conn-led-pulse 1s ease-in-out infinite;
}
@keyframes conn-led-pulse {
  0%,
  100% {
    opacity: 1;
    filter: brightness(1);
  }
  50% {
    opacity: 0.88;
    filter: brightness(1.08);
  }
}
.conn-toolbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
}
.conn-version {
  margin-left: auto;
  flex: 0 1 auto;
  min-width: 0;
  font-size: 11px;
  line-height: 22px;
  color: var(--lc-text-muted);
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.conn-tool-btn {
  padding-inline: 8px;
}
.conn-switch {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  flex-shrink: 0;
}
.conn-switch:focus-visible {
  outline: 2px solid var(--lc-accent);
  outline-offset: 2px;
  border-radius: 999px;
}
.conn-switch-track {
  position: relative;
  width: 34px;
  height: 18px;
  border-radius: 999px;
  background: var(--lc-bg-raised);
  border: 1px solid var(--lc-border);
  transition:
    background 0.18s ease,
    border-color 0.18s ease;
}
.conn-switch--on .conn-switch-track {
  background: rgba(5, 150, 105, 0.22);
  border-color: rgba(5, 150, 105, 0.45);
}
.conn-switch--busy .conn-switch-track {
  animation: conn-switch-pulse 1.1s ease-in-out infinite;
}
.conn-switch-thumb {
  position: absolute;
  top: 1px;
  left: 1px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--lc-text-muted);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition:
    transform 0.18s ease,
    background 0.18s ease;
}
.conn-switch--on .conn-switch-thumb {
  transform: translateX(16px);
  background: var(--lc-success);
}
@keyframes conn-switch-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.72;
  }
}
.err {
  color: var(--lc-error);
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.4;
}
.copied {
  font-size: 11px;
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
