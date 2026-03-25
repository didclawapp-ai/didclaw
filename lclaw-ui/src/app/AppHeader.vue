<script setup lang="ts">
import { resetFirstRunWizardLocalState } from "@/composables/modelConfigDeferred";
import CronJobsDialog from "@/features/cron/CronJobsDialog.vue";
import GatewayLocalDialog from "@/features/settings/GatewayLocalDialog.vue";
import SkillsManagerDialog from "@/features/skills/SkillsManagerDialog.vue";
import { buildDiagnosticsSnapshot, diagnosticsToPrettyJson } from "@/lib/diagnostics";
import { getDidClawDesktopApi, isDidClawElectron } from "@/lib/electron-bridge";
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

const skillsDialogOpen = ref(false);
const cronDialogOpen = ref(false);
const copiedDiag = ref(false);
const restartGatewayBusy = ref(false);
const moreMenuOpen = ref(false);
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

const connSwitchOn = computed(
  () => status.value === "connected" || status.value === "connecting",
);

const connSwitchLabel = computed(() => {
  switch (status.value) {
    case "connected":  return "已连接网关，点击断开";
    case "connecting": return "正在连接，点击取消";
    case "error":      return "连接异常，点击重连";
    default:           return "未连接，点击连接";
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
    case "connected":  return base + "状态：已连接";
    case "connecting": return base + "状态：正在连接…";
    case "error":      return base + "状态：连接异常";
    default:           return base + "状态：未连接";
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
    case "connected":  return `网关已连接，${url.value}`;
    case "connecting": return `正在连接网关，${url.value}`;
    case "error":      return `网关连接异常，${url.value}`;
    default:           return `网关未连接，${url.value}`;
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
      showInlineError((r as { error?: string }).error ?? "重启网关失败");
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
    showInlineError("复制失败：请在 https 或 localhost 下打开，并允许浏览器剪贴板权限。");
  }
}

function onRedoFirstRunWizard(): void {
  moreMenuOpen.value = false;
  if (!window.confirm("将清除「首次引导」本地记录并重新检测，是否继续？")) return;
  resetFirstRunWizardLocalState();
  window.dispatchEvent(new CustomEvent("didclaw-first-run-recheck"));
}

function toggleMoreMenu(): void {
  moreMenuOpen.value = !moreMenuOpen.value;
}

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
      <div class="right-group" role="toolbar" aria-label="快捷功能">
        <button
          type="button"
          class="lc-btn lc-btn-ghost lc-btn-xs"
          title="定时任务：一次性与周期性本机任务"
          :aria-expanded="cronDialogOpen"
          @click="cronDialogOpen = true"
        >
          定时任务
        </button>
        <button
          type="button"
          class="lc-btn lc-btn-ghost lc-btn-xs"
          :aria-expanded="skillsDialogOpen"
          @click="skillsDialogOpen = true"
        >
          技能
        </button>
        <button
          v-if="isDidClawElectron()"
          type="button"
          class="lc-btn lc-btn-ghost lc-btn-xs"
          title="本机设置：连接助手、AI 账号与密钥、默认模型"
          @click="localSettings.open('gateway')"
        >
          ⚙ 设置
        </button>

        <!-- 更多菜单 -->
        <div class="more-wrap">
          <button
            type="button"
            class="lc-btn lc-btn-ghost lc-btn-xs more-btn"
            :class="{ 'more-btn--open': moreMenuOpen }"
            aria-label="更多选项"
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
              <div
                class="more-menu-scrim"
                aria-hidden="true"
                @pointerdown="closeMoreMenu"
              />
              <ul class="more-menu-list">
                <li role="none">
                  <button
                    type="button"
                    role="menuitem"
                    class="more-menu-item"
                    @click="copyDiagnostics"
                  >
                    <span class="more-menu-icon" aria-hidden="true">📋</span>
                    {{ copiedDiag ? "已复制！" : "复制诊断信息" }}
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
                    {{ restartGatewayBusy ? "重启中…" : "重启网关" }}
                  </button>
                </li>
                <li v-if="isDidClawElectron()" role="none">
                  <button
                    type="button"
                    role="menuitem"
                    class="more-menu-item"
                    title="清除首次引导状态，重新检测（便于测试安装流程）"
                    @click="onRedoFirstRunWizard"
                  >
                    <span class="more-menu-icon" aria-hidden="true">🔧</span>
                    重新引导
                  </button>
                </li>
                <li class="more-menu-sep" role="separator" />
                <li role="none">
                  <RouterLink
                    to="/about"
                    role="menuitem"
                    class="more-menu-item"
                    @click="closeMoreMenu"
                  >
                    <span class="more-menu-icon" aria-hidden="true">ℹ</span>
                    关于 DidClaw
                  </RouterLink>
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
        <button type="button" class="inline-err-close" aria-label="关闭" @click="inlineError = null">✕</button>
      </p>
      <p v-else-if="lastError" class="inline-err inline-err--conn" role="alert">{{ lastError }}</p>
    </transition>

    <GatewayLocalDialog v-model="showGatewayLocal" />
    <CronJobsDialog v-model="cronDialogOpen" />
    <SkillsManagerDialog v-model="skillsDialogOpen" />
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
  z-index: 9999;
}
.more-menu-scrim {
  position: fixed;
  inset: 0;
  z-index: -1;
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
