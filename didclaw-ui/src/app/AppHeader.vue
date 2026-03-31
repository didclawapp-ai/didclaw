<script setup lang="ts">
import { i18n, type LocaleCode } from "@/i18n";
import { useGatewayStore } from "@/stores/gateway";
import { useLocalSettingsStore } from "@/stores/localSettings";
import { useThemeStore } from "@/stores/theme";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { storeToRefs } from "pinia";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const gw = useGatewayStore();
const localSettings = useLocalSettingsStore();
const themeStore = useThemeStore();
const { status, lastError, url } = storeToRefs(gw);

const inlineError = ref<string | null>(null);
let errorTimer: number | null = null;

// ── Auto-hide ────────────────────────────────────────────────────────────────
const TRIGGER_Y = 8;
const HIDE_DELAY = 1500;
const headerVisible = ref(true);
let hideTimer: number | null = null;

function showHeader(): void {
  if (hideTimer !== null) { clearTimeout(hideTimer); hideTimer = null; }
  headerVisible.value = true;
}

function scheduleHide(): void {
  if (inlineError.value !== null || lastError.value !== null) return;
  if (hideTimer !== null) return;
  hideTimer = window.setTimeout(() => {
    headerVisible.value = false;
    hideTimer = null;
  }, HIDE_DELAY);
}

function onDocMouseMove(e: MouseEvent): void {
  if (e.clientY <= TRIGGER_Y) showHeader();
}

watch([inlineError, lastError], ([err, gwErr]) => {
  if (err !== null || gwErr !== null) showHeader();
});

// ── Window controls (Tauri only) ──────────────────────────────────────────────
const isDesktop = isTauri();
const isMaximized = ref(false);
let unlistenResize: (() => void) | null = null;

async function syncMaximized(): Promise<void> {
  isMaximized.value = await getCurrentWindow().isMaximized();
}

async function minimizeWindow(): Promise<void> {
  await getCurrentWindow().minimize();
}

async function toggleMaximize(): Promise<void> {
  await getCurrentWindow().toggleMaximize();
  await syncMaximized();
}

async function closeWindow(): Promise<void> {
  await getCurrentWindow().close();
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  document.addEventListener("mousemove", onDocMouseMove);
  scheduleHide();
  if (isDesktop) {
    await syncMaximized();
    unlistenResize = await getCurrentWindow().onResized(() => void syncMaximized());
  }
});

onUnmounted(() => {
  document.removeEventListener("mousemove", onDocMouseMove);
  if (hideTimer !== null) clearTimeout(hideTimer);
  unlistenResize?.();
});

// ── Connection state ──────────────────────────────────────────────────────────
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
  <header
    class="top"
    :class="{ 'top--visible': headerVisible }"
    @mouseenter="showHeader"
    @mouseleave="scheduleHide"
  >
    <div class="top-row" data-tauri-drag-region>
      <div class="left-group">
        <div class="brand">
          <img src="/icon-32.png" class="brand-glyph" alt="DidClaw" aria-hidden="true">
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
            class="header-icon-btn header-icon-btn--theme"
            :class="themeStore.mode === 'dark' ? 'header-icon-btn--dark' : 'header-icon-btn--light'"
            :title="themeStore.mode === 'dark' ? t('header.switchToLight') : t('header.switchToDark')"
            :aria-label="themeStore.mode === 'dark' ? t('header.switchToLight') : t('header.switchToDark')"
            @click="themeStore.toggle()"
          >
            <!-- sun: shown when in dark mode (click to go light) -->
            <svg v-if="themeStore.mode === 'dark'" viewBox="0 0 24 24" aria-hidden="true" class="header-icon-svg">
              <circle cx="12" cy="12" r="4" fill="currentColor" />
              <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
            </svg>
            <!-- moon: shown when in light mode (click to go dark) -->
            <svg v-else viewBox="0 0 24 24" aria-hidden="true" class="header-icon-svg">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            class="header-icon-btn header-icon-btn--locale"
            :class="`header-icon-btn--${currentLocale}`"
            :title="localeToggleTitle"
            :aria-label="localeToggleTitle"
            @click="toggleLocale"
          >
            <span class="header-lang-label" aria-hidden="true">{{ currentLocale === 'zh' ? '中' : 'En' }}</span>
          </button>
        </div>
      </div>

      <!-- Window controls: only in Tauri desktop mode -->
      <div v-if="isDesktop" class="win-controls" @mousedown.stop>
        <button
          type="button"
          class="win-btn"
          title="最小化"
          aria-label="最小化"
          @click="minimizeWindow"
        >
          <svg viewBox="0 0 24 24" class="win-btn-svg" aria-hidden="true">
            <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </button>
        <button
          type="button"
          class="win-btn"
          :title="isMaximized ? '还原' : '最大化'"
          :aria-label="isMaximized ? '还原' : '最大化'"
          @click="toggleMaximize"
        >
          <!-- restore icon -->
          <svg v-if="isMaximized" viewBox="0 0 24 24" class="win-btn-svg" aria-hidden="true">
            <rect x="8" y="4" width="11" height="11" rx="1" stroke="currentColor" stroke-width="1.5" fill="none" />
            <path d="M4 8v11a1 1 0 0 0 1 1h11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none" />
          </svg>
          <!-- maximize icon -->
          <svg v-else viewBox="0 0 24 24" class="win-btn-svg" aria-hidden="true">
            <rect x="4" y="4" width="16" height="16" rx="1" stroke="currentColor" stroke-width="1.5" fill="none" />
          </svg>
        </button>
        <button
          type="button"
          class="win-btn win-btn--close"
          title="关闭"
          aria-label="关闭"
          @click="closeWindow"
        >
          <svg viewBox="0 0 24 24" class="win-btn-svg" aria-hidden="true">
            <path d="M6 6 18 18M6 18 18 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </button>
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
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 200;
  padding: 0 0 0 var(--lc-spacing-md);
  border-bottom: 1px solid var(--lc-border);
  background: var(--lc-surface-top);
  backdrop-filter: blur(12px);
  box-shadow: var(--lc-shadow-sm);
  transform: translateY(-100%);
  transition: transform 0.2s ease;
}
.top--visible {
  transform: translateY(0);
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
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  object-fit: contain;
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
.header-icon-svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}
.header-lang-label {
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.01em;
  font-family: system-ui, sans-serif;
}
.header-icon-btn--theme.header-icon-btn--dark {
  color: #fbbf24;
  border-color: rgba(251, 191, 36, 0.35);
}
.header-icon-btn--theme.header-icon-btn--light {
  color: #818cf8;
  border-color: rgba(129, 140, 248, 0.35);
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

/* Window controls */
.win-controls {
  display: flex;
  align-items: stretch;
  height: 42px;
  margin-left: auto;
  flex-shrink: 0;
}
.win-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 100%;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--lc-text-muted);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
  -webkit-app-region: no-drag;
}
.win-btn:hover {
  background: rgba(128, 128, 128, 0.15);
  color: var(--lc-text);
}
.win-btn--close:hover {
  background: #dc2626;
  color: #fff;
}
.win-btn-svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
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
