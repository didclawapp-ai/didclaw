<script setup lang="ts">
import { resetFirstRunWizardLocalState } from "@/composables/modelConfigDeferred";
import AboutDialog from "@/features/about/AboutDialog.vue";
import CronJobsDialog from "@/features/cron/CronJobsDialog.vue";
import GatewayLocalDialog from "@/features/settings/GatewayLocalDialog.vue";
import SkillsManagerDialog from "@/features/skills/SkillsManagerDialog.vue";
import { buildDiagnosticsSnapshot, diagnosticsToPrettyJson } from "@/lib/diagnostics";
import { getDidClawDesktopApi, isDidClawElectron } from "@/lib/electron-bridge";
import { useChatStore } from "@/stores/chat";
import { useGatewayStore } from "@/stores/gateway";
import { useLocalSettingsStore } from "@/stores/localSettings";
import { useSessionStore } from "@/stores/session";
import { useThemeStore } from "@/stores/theme";
import { storeToRefs } from "pinia";
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { i18n, type LocaleCode } from "@/i18n";

const { t } = useI18n();
const gw = useGatewayStore();
const session = useSessionStore();
const chat = useChatStore();
const { status, lastError, helloInfo, url } = storeToRefs(gw);
const { sessions, error: sessionsError, activeSessionKey } = storeToRefs(session);
const { messages, lastError: chatError } = storeToRefs(chat);

const themeStore = useThemeStore();
const skillsDialogOpen = ref(false);
const cronDialogOpen = ref(false);
const aboutDialogOpen = ref(false);
const copiedDiag = ref(false);
const restartGatewayBusy = ref(false);
const moreMenuOpen = ref(false);
const moreWrapRef = ref<HTMLElement | null>(null);
/** 内联操作错误（替代 window.alert） */
const inlineError = ref<string | null>(null);
let copyTimer: ReturnType<typeof setTimeout> | null = null;
let errorTimer: ReturnType<typeof setTimeout> | null = null;
const localSettings = useLocalSettingsStore();
const showGatewayLocal = computed({
  get: () => localSettings.visible,
  set: (v: boolean) => {
    if (!v) localSettings.close();
  },
});

const currentLocale = computed({
  get: () => (i18n.global.locale as { value: LocaleCode }).value,
  set: (v: LocaleCode) => localSettings.switchLocale(v),
});

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

function showInlineError(msg: string): void {
  inlineError.value = msg;
  if (errorTimer !== null) clearTimeout(errorTimer);
  errorTimer = window.setTimeout(() => {
    inlineError.value = null;
    errorTimer = null;
  }, 6000);
}

async function onRestartGateway(): Promise<void> {
  const desktop = getDidClawDesktopApi();
  if (!desktop?.restartOpenClawGateway || restartGatewayBusy.value) return;
  restartGatewayBusy.value = true;
  moreMenuOpen.value = false;
  try {
    const r = await desktop.restartOpenClawGateway();
    if (r && "ok" in r && r.ok === false) {
      showInlineError((r as { error?: string }).error ?? t("header.restartFailed"));
      return;
    }
    await gw.reloadConnection();
  } catch (e) {
    showInlineError(e instanceof Error ? e.message : String(e));
  } finally {
    restartGatewayBusy.value = false;
  }
}

async function copyDiagnostics(): Promise<void> {
  moreMenuOpen.value = false;
  let tokenConfigured = !!import.meta.env.VITE_GATEWAY_TOKEN?.trim();
  let passwordConfigured = !!import.meta.env.VITE_GATEWAY_PASSWORD?.trim();
  const desktop = getDidClawDesktopApi();
  if (isDidClawElectron() && desktop?.readGatewayLocalConfig) {
    try {
      const c = await desktop.readGatewayLocalConfig();
      if (c.token?.trim()) tokenConfigured = true;
      if (c.password?.trim()) passwordConfigured = true;
    } catch { /* ignore */ }
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
    if (copyTimer !== null) clearTimeout(copyTimer);
    copyTimer = window.setTimeout(() => {
      copiedDiag.value = false;
      copyTimer = null;
    }, 2000);
  } catch {
    showInlineError(t("header.copyFailed"));
  }
}

function onRedoFirstRunWizard(): void {
  moreMenuOpen.value = false;
  if (!window.confirm(t("header.redoOnboardingConfirm"))) return;
  resetFirstRunWizardLocalState();
  window.dispatchEvent(new CustomEvent("didclaw-first-run-recheck"));
}

function toggleMoreMenu(): void {
  moreMenuOpen.value = !moreMenuOpen.value;
}

function handleMoreMenuOutsideClick(e: MouseEvent): void {
  if (!moreWrapRef.value?.contains(e.target as Node)) {
    moreMenuOpen.value = false;
  }
}

watch(moreMenuOpen, (open) => {
  if (open) {
    // nextTick 防止开启菜单的同一次 click 事件立即触发关闭
    void nextTick(() => document.addEventListener("click", handleMoreMenuOutsideClick));
  } else {
    document.removeEventListener("click", handleMoreMenuOutsideClick);
  }
});

onUnmounted(() => {
  document.removeEventListener("click", handleMoreMenuOutsideClick);
});

function closeMoreMenu(): void {
  moreMenuOpen.value = false;
}
</script>

<template>
  <header class="top">
    <div class="top-row">
      <!-- 左侧：连接状态 + 品牌 -->
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
        <span v-if="helloInfo" class="conn-version" :title="helloInfo">{{ helloInfo }}</span>
      </div>

      <!-- 右侧：主功能 + 更多菜单 -->
      <div class="right-group" role="toolbar" :aria-label="t('header.toolbarLabel')">
        <button
          type="button"
          class="lc-btn lc-btn-ghost lc-btn-xs"
          :title="t('header.cronTitle')"
          :aria-expanded="cronDialogOpen"
          @click="cronDialogOpen = true"
        >
          {{ t('header.cronBtn') }}
        </button>
        <button
          type="button"
          class="lc-btn lc-btn-ghost lc-btn-xs"
          :aria-expanded="skillsDialogOpen"
          @click="skillsDialogOpen = true"
        >
          {{ t('header.skillsBtn') }}
        </button>

        <!-- 夜间模式切换 -->
        <button
          type="button"
          class="lc-btn lc-btn-ghost theme-toggle"
          :title="themeStore.mode === 'dark' ? t('header.switchToLight') : t('header.switchToDark')"
          :aria-label="themeStore.mode === 'dark' ? t('header.switchToLight') : t('header.switchToDark')"
          :aria-pressed="themeStore.mode === 'dark'"
          @click="themeStore.toggle()"
        >
          <span class="theme-icon" aria-hidden="true">{{ themeStore.mode === 'dark' ? '☀' : '🌙' }}</span>
        </button>

        <!-- 语言切换 -->
        <div class="locale-switcher" :aria-label="t('settings.languageLabel')">
          <button
            type="button"
            class="locale-btn"
            :class="{ active: currentLocale === 'zh' }"
            :aria-pressed="currentLocale === 'zh'"
            @click="currentLocale = 'zh'"
          >中</button>
          <button
            type="button"
            class="locale-btn"
            :class="{ active: currentLocale === 'en' }"
            :aria-pressed="currentLocale === 'en'"
            @click="currentLocale = 'en'"
          >EN</button>
        </div>

        <!-- 更多菜单 -->
        <div ref="moreWrapRef" class="more-wrap">
          <button
            type="button"
            class="lc-btn lc-btn-ghost lc-btn-xs more-btn"
            :class="{ 'more-btn--open': moreMenuOpen }"
            :aria-label="t('header.moreOptions')"
            :aria-expanded="moreMenuOpen"
            @click="toggleMoreMenu"
          >
            ···
          </button>
          <transition name="menu-fade">
            <div
              v-if="moreMenuOpen"
              class="more-menu"
              role="menu"
              @keydown.escape="closeMoreMenu"
            >
              <ul class="more-menu-list">
                <li role="none">
                  <button
                    type="button"
                    role="menuitem"
                    class="more-menu-item"
                    @click="copyDiagnostics"
                  >
                    <span class="more-menu-icon" aria-hidden="true">📋</span>
                    {{ copiedDiag ? t('header.copyDiagDone') : t('header.copyDiag') }}
                  </button>
                </li>
                <li v-if="isDidClawElectron()" role="none">
                  <button
                    type="button"
                    role="menuitem"
                    class="more-menu-item"
                    :disabled="restartGatewayBusy"
                    @click="onRestartGateway"
                  >
                    <span class="more-menu-icon" aria-hidden="true">🔄</span>
                    {{ restartGatewayBusy ? t('header.restartingGateway') : t('header.restartGateway') }}
                  </button>
                </li>
                <li v-if="isDidClawElectron()" role="none">
                  <button
                    type="button"
                    role="menuitem"
                    class="more-menu-item"
                    :title="t('header.redoOnboardingTitle')"
                    @click="onRedoFirstRunWizard"
                  >
                    <span class="more-menu-icon" aria-hidden="true">🔧</span>
                    {{ t('header.redoOnboarding') }}
                  </button>
                </li>
                <li class="more-menu-sep" role="separator" />
                <li role="none">
                  <button
                    type="button"
                    role="menuitem"
                    class="more-menu-item"
                    @click="closeMoreMenu(); aboutDialogOpen = true"
                  >
                    <span class="more-menu-icon" aria-hidden="true">ℹ</span>
                    {{ t('header.aboutApp') }}
                  </button>
                </li>
              </ul>
            </div>
          </transition>
        </div>
      </div>
    </div>


    <!-- 内联错误/状态提示 -->
    <transition name="err-fade">
      <p v-if="inlineError" class="inline-err" role="alert">
        {{ inlineError }}
        <button type="button" class="inline-err-close" :aria-label="t('common.close')" @click="inlineError = null">✕</button>
      </p>
      <p v-else-if="lastError" class="inline-err inline-err--conn" role="alert">{{ lastError }}</p>
    </transition>

    <GatewayLocalDialog v-model="showGatewayLocal" />
    <CronJobsDialog v-model="cronDialogOpen" />
    <SkillsManagerDialog v-model="skillsDialogOpen" />
    <AboutDialog v-model="aboutDialogOpen" />
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
  height: 52px;
}
.left-group {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.right-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
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
.conn-version {
  font-size: 11px;
  color: var(--lc-text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
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

/* Theme toggle */
.theme-toggle {
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: unset;
  transition:
    background 0.2s ease,
    transform 0.3s ease,
    border-color 0.2s ease;
}
.theme-toggle:hover:not(:disabled) {
  transform: rotate(20deg) translateY(-1px);
}
.theme-icon {
  font-size: 15px;
  line-height: 1;
  display: block;
  transition: transform 0.35s ease;
}

/* 语言切换 */
.locale-switcher {
  display: flex;
  gap: 2px;
}
.locale-btn {
  padding: 2px 7px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: transparent;
  color: var(--lc-text-muted);
  font-size: 11px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  line-height: 1.6;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.locale-btn.active {
  background: var(--lc-accent-soft);
  border-color: var(--lc-accent);
  color: var(--lc-accent);
}
.locale-btn:hover:not(.active) {
  border-color: var(--lc-border-strong);
  color: var(--lc-text);
}

/* More menu */
.more-wrap {
  position: relative;
}
.more-btn {
  letter-spacing: 0.1em;
  padding-inline: 10px;
  font-size: 14px;
  line-height: 1;
}
.more-btn--open {
  background: var(--lc-bg-hover);
  border-color: var(--lc-border-strong);
}
.more-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 10; /* 在 header 层叠上下文（z-index:100）内部，任意正值即可 */
}
.more-menu-list {
  min-width: 200px;
  margin: 0;
  padding: 6px 0;
  list-style: none;
  background: var(--lc-surface, #fff);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  box-shadow: var(--lc-shadow-md);
  backdrop-filter: blur(12px);
}
.more-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 16px;
  border: none;
  background: transparent;
  font: inherit;
  font-size: 13px;
  text-align: left;
  color: var(--lc-text);
  cursor: pointer;
  text-decoration: none;
  transition: background 0.12s ease;
}
.more-menu-item:hover:not(:disabled) {
  background: var(--lc-accent-soft);
}
.more-menu-item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.more-menu-icon {
  font-size: 14px;
  line-height: 1;
  flex-shrink: 0;
}
.more-menu-sep {
  height: 1px;
  margin: 5px 10px;
  background: var(--lc-border);
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
.menu-fade-enter-active,
.menu-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.menu-fade-enter-from,
.menu-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
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
