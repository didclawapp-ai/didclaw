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

const localeToggleTitle = computed(() =>
  currentLocale.value === "zh" ? "Switch to English" : "切换到中文",
);

function toggleLocale(): void {
  currentLocale.value = currentLocale.value === "zh" ? "en" : "zh";
}

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
        <div class="brand">
          <span class="brand-glyph" aria-hidden="true" />
          <h1 class="brand-title">
            <span class="brand-d">D</span><span class="brand-mid">idCl</span><span class="brand-tail">aw</span>
          </h1>
        </div>
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
        <div class="header-quick-tools">
          <button
            type="button"
            class="header-icon-btn"
            :title="themeStore.mode === 'dark' ? t('header.switchToLight') : t('header.switchToDark')"
            :aria-label="themeStore.mode === 'dark' ? t('header.switchToLight') : t('header.switchToDark')"
            @click="themeStore.toggle()"
          >
            <span class="header-icon-glyph" aria-hidden="true">{{ themeStore.mode === 'dark' ? '☀' : '☾' }}</span>
          </button>
          <button
            type="button"
            class="header-icon-btn header-icon-btn--locale"
            :class="`header-icon-btn--${currentLocale}`"
            :title="localeToggleTitle"
            :aria-label="localeToggleTitle"
            @click="toggleLocale"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" class="header-icon-svg">
              <path
                d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9Zm5.93 8h-3.06a14.9 14.9 0 0 0-1.37-5.02A7.03 7.03 0 0 1 17.93 11Zm-5.93 8c-.8 0-2.12-2.02-2.56-5h5.12c-.44 2.98-1.76 5-2.56 5Zm-2.86-7a12.8 12.8 0 0 1 0-2h5.72a12.8 12.8 0 0 1 0 2H9.14Zm-4.07 0c.12-1.09.5-2.1 1.08-3h2.52a15.7 15.7 0 0 0 0 6H6.15a6.95 6.95 0 0 1-1.08-3Zm6.93-7c.8 0 2.12 2.02 2.56 5H9.44c.44-2.98 1.76-5 2.56-5ZM10.5 5.98A14.9 14.9 0 0 0 9.13 11H6.07a7.03 7.03 0 0 1 4.43-5.02ZM6.07 13h3.06c.24 1.84.72 3.58 1.37 5.02A7.03 7.03 0 0 1 6.07 13Zm7.43 5.02c.65-1.44 1.13-3.18 1.37-5.02h3.06a7.03 7.03 0 0 1-4.43 5.02Z"
                fill="currentColor"
              />
            </svg>
          </button>
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
  --header-item-gap: 12px;
  display: flex;
  align-items: center;
  gap: var(--header-item-gap);
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
  gap: var(--header-item-gap);
  margin-left: 0;
}
.header-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-raised);
  color: var(--lc-text-muted);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease, transform 0.15s ease;
}
.header-icon-btn:hover {
  border-color: var(--lc-border-strong);
  background: var(--lc-bg-hover);
  color: var(--lc-text);
  transform: translateY(-1px);
}
.header-icon-btn:focus-visible {
  outline: 2px solid var(--lc-accent);
  outline-offset: 2px;
}
.header-icon-glyph {
  font-size: 15px;
  line-height: 1;
}
.header-icon-svg {
  width: 15px;
  height: 15px;
}
.header-icon-btn--locale.header-icon-btn--zh {
  color: #22d3ee;
  border-color: rgba(34, 211, 238, 0.35);
}
.header-icon-btn--locale.header-icon-btn--en {
  color: #818cf8;
  border-color: rgba(129, 140, 248, 0.35);
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
