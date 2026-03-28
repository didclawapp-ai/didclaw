<script setup lang="ts">
import { i18n, type LocaleCode } from "@/i18n";
import { useGatewayStore } from "@/stores/gateway";
import { useLocalSettingsStore } from "@/stores/localSettings";
import { useThemeStore } from "@/stores/theme";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const gw = useGatewayStore();
const localSettings = useLocalSettingsStore();
const themeStore = useThemeStore();
const { status, lastError, url } = storeToRefs(gw);

const inlineError = ref<string | null>(null);
let errorTimer: number | null = null;

const connSwitchOn = computed(
  () => status.value === "connected" || status.value === "connecting",
);

const connSwitchLabel = computed(() => {
  switch (status.value) {
    case "connected":  return t("conn.connected");
    case "connecting": return t("conn.connecting");
    case "error":      return t("conn.error");
    default:           return t("conn.disconnected");
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
  const base = `${url.value}\n`;
  switch (status.value) {
    case "connected":  return base + t("conn.statusConnected");
    case "connecting": return base + t("conn.statusConnecting");
    case "error":      return base + t("conn.statusError");
    default:           return base + t("conn.statusDisconnected");
  }
});

const connLedClass = computed(() => {
  switch (status.value) {
    case "connected":  return "conn-led--ok";
    case "connecting": return "conn-led--pending";
    default:           return "conn-led--bad";
  }
});

const connLedAriaLabel = computed(() => {
  switch (status.value) {
    case "connected":  return t("conn.ledConnected", { url: url.value });
    case "connecting": return t("conn.ledConnecting", { url: url.value });
    case "error":      return t("conn.ledError", { url: url.value });
    default:           return t("conn.ledDisconnected", { url: url.value });
  }
});

const currentLocale = computed({
  get: () => (i18n.global.locale as { value: LocaleCode }).value,
  set: (v: LocaleCode) => localSettings.switchLocale(v),
});

function showInlineError(msg: string): void {
  inlineError.value = msg;
  if (errorTimer !== null) clearTimeout(errorTimer);
  errorTimer = window.setTimeout(() => {
    inlineError.value = null;
    errorTimer = null;
  }, 6000);
}

defineExpose({ showInlineError });
</script>

<template>
  <header class="top">
    <div class="top-row">
      <div class="left-group">
        <button
          type="button"
          class="conn-led"
          :class="connLedClass"
          :title="connLedTitle"
          :aria-label="connLedAriaLabel"
        />
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
        <div class="brand">
          <span class="brand-glyph" aria-hidden="true" />
          <h1 class="brand-title">
            <span class="brand-d">D</span><span class="brand-mid">idCl</span><span class="brand-tail">aw</span>
          </h1>
        </div>
        <div class="header-quick-tools">
          <button
            type="button"
            class="header-theme-btn"
            :title="themeStore.mode === 'dark' ? t('header.switchToLight') : t('header.switchToDark')"
            @click="themeStore.toggle()"
          >
            <span aria-hidden="true">{{ themeStore.mode === 'dark' ? '☀' : '☾' }}</span>
            <span>{{ themeStore.mode === 'dark' ? t('header.switchToLight') : t('header.switchToDark') }}</span>
          </button>
          <div class="header-locale-switcher" :aria-label="t('settings.languageLabel')">
            <button
              type="button"
              class="header-locale-btn"
              :class="{ active: currentLocale === 'zh' }"
              @click="currentLocale = 'zh'"
            >
              中
            </button>
            <button
              type="button"
              class="header-locale-btn"
              :class="{ active: currentLocale === 'en' }"
              @click="currentLocale = 'en'"
            >
              EN
            </button>
          </div>
        </div>
      </div>
    </div>

    <transition name="err-fade">
      <p v-if="inlineError" class="inline-err" role="alert">
        {{ inlineError }}
        <button type="button" class="inline-err-close" :aria-label="t('common.close')" @click="inlineError = null">&#x2715;</button>
      </p>
      <p v-else-if="lastError" class="inline-err inline-err--conn" role="alert">{{ lastError }}</p>
    </transition>
  </header>
</template>

<style scoped>
.top {
  flex: 0 0 auto;
  padding: 0 var(--lc-spacing-md) 0;
  border-bottom: 1px solid var(--lc-border);
  background: var(--lc-surface-top);
  backdrop-filter: blur(12px);
  box-shadow: var(--lc-shadow-sm);
  position: relative;
  z-index: 100;
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
.top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 42px;
}
.left-group {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

/* Brand */
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
}
.brand-glyph {
  display: block;
  width: 9px;
  height: 9px;
  border-radius: 2px;
  background: #dc2626;
  box-shadow: 0 1px 5px rgba(220, 38, 38, 0.4);
  transform: rotate(45deg);
  flex-shrink: 0;
}
.brand-title {
  margin: 0;
  font-family: "Righteous", system-ui, sans-serif;
  font-size: 1.2rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  line-height: 1;
  color: var(--lc-text);
  white-space: nowrap;
}
.brand-d    { color: #dc2626; }
.brand-mid  { color: #22d3ee; }
.brand-tail {
  background: linear-gradient(90deg, #22d3ee 0%, #3b82f6 55%, #6366f1 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.header-quick-tools {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: 10px;
}
.header-theme-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--lc-border);
  background: transparent;
  color: var(--lc-text-muted);
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}
.header-theme-btn:hover {
  border-color: var(--lc-border-strong);
  background: var(--lc-bg-hover);
  color: var(--lc-text);
}
.header-locale-switcher {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 999px;
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-raised);
}
.header-locale-btn {
  padding: 2px 8px;
  border-radius: 999px;
  border: none;
  background: transparent;
  color: var(--lc-text-muted);
  font-size: 11px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  line-height: 1.6;
  transition: background 0.12s, color 0.12s;
}
.header-locale-btn.active {
  background: var(--lc-accent-soft);
  color: var(--lc-accent);
}
.header-locale-btn:hover:not(.active) {
  color: var(--lc-text);
}

/* Connection LED */
.conn-led {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.12);
  cursor: default;
  transition: background 0.2s ease, box-shadow 0.2s ease;
}
.conn-led:focus-visible {
  outline: 2px solid var(--lc-accent);
  outline-offset: 2px;
}
.conn-led--ok {
  background: var(--lc-success);
  border-color: rgba(5, 150, 105, 0.55);
  box-shadow: 0 0 6px rgba(5, 150, 105, 0.5);
}
.conn-led--bad {
  background: var(--lc-error);
  border-color: rgba(220, 38, 38, 0.55);
  box-shadow: 0 0 5px rgba(220, 38, 38, 0.3);
}
.conn-led--pending {
  background: var(--lc-warning);
  border-color: rgba(217, 119, 6, 0.55);
  animation: led-pulse 1s ease-in-out infinite;
}
@keyframes led-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.7; }
}

/* Connection Switch */
.conn-switch {
  display: inline-flex;
  align-items: center;
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
  width: 30px;
  height: 16px;
  border-radius: 999px;
  background: var(--lc-bg-raised);
  border: 1px solid var(--lc-border);
  transition: background 0.18s ease, border-color 0.18s ease;
}
.conn-switch--on .conn-switch-track {
  background: rgba(5, 150, 105, 0.22);
  border-color: rgba(5, 150, 105, 0.45);
}
.conn-switch--busy .conn-switch-track {
  animation: switch-pulse 1.1s ease-in-out infinite;
}
@keyframes switch-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.7; }
}
.conn-switch-thumb {
  position: absolute;
  top: 1px;
  left: 1px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--lc-text-muted);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: transform 0.18s ease, background 0.18s ease;
}
.conn-switch--on .conn-switch-thumb {
  transform: translateX(14px);
  background: var(--lc-success);
}

/* Inline error */
.inline-err {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 0;
  padding: 6px var(--lc-spacing-md);
  font-size: 12px;
  line-height: 1.4;
  color: var(--lc-error);
  background: var(--lc-error-bg);
  border-top: 1px solid rgba(220, 38, 38, 0.15);
}
.inline-err--conn {
  color: var(--lc-error);
}
.inline-err-close {
  flex-shrink: 0;
  padding: 0 4px;
  border: none;
  background: transparent;
  font-size: 11px;
  color: var(--lc-error);
  cursor: pointer;
  opacity: 0.7;
}
.inline-err-close:hover { opacity: 1; }

/* Transitions */
.err-fade-enter-active,
.err-fade-leave-active {
  transition: opacity 0.2s ease, max-height 0.2s ease;
  max-height: 60px;
  overflow: hidden;
}
.err-fade-enter-from,
.err-fade-leave-to {
  opacity: 0;
  max-height: 0;
}
</style>
