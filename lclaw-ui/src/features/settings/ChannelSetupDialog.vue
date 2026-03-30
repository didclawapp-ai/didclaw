<script setup lang="ts">
import { defineAsyncComponent, computed, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useGatewayStore } from "@/stores/gateway";
import { provideChannelContext } from "./channels/base/useChannelContext";
import { useInstalledPlugins } from "./channels/base/useInstalledPlugins";
import { BUILTIN_CHANNELS, type ChannelEntry } from "./channels/registry";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [v: boolean] }>();
const { t } = useI18n();
const gwStore = useGatewayStore();

const open = computed({
  get: () => props.modelValue,
  set: (v) => emit("update:modelValue", v),
});

// ── Dynamic plugin channels ───────────────────────────────────────────────────

const { channels: dynamicChannels, fetchInstalledPlugins } = useInstalledPlugins();

// The "+" install tab entry
const INSTALL_ENTRY: ChannelEntry = {
  id: "__install__",
  source: "plugin",
  icon: "➕",
  nameKey: "channel.installNew.tab",
  paradigm: "wizard",
  panel: defineAsyncComponent(
    () => import("./channels/_install/InstallChannelPanel.vue"),
  ),
};

const allChannels = computed<ChannelEntry[]>(() => [
  ...BUILTIN_CHANNELS,
  ...dynamicChannels.value,
  INSTALL_ENTRY,
]);

// ── Tab state ─────────────────────────────────────────────────────────────────

const activeTab = ref<string>("whatsapp");

const activeEntry = computed<ChannelEntry | undefined>(() =>
  allChannels.value.find((c) => c.id === activeTab.value),
);

// ── Auto-close ────────────────────────────────────────────────────────────────

let autoCloseTimer: number | null = null;

function scheduleAutoClose(): void {
  if (autoCloseTimer !== null) return;
  autoCloseTimer = window.setTimeout(() => {
    autoCloseTimer = null;
    if (open.value) closeDialog();
  }, 1800);
}

// ── Shared context (provided to all channel panel components) ─────────────────

const { toast, toastError } =
  provideChannelContext({ onSuccess: scheduleAutoClose });

function closeDialog(): void { open.value = false; }

function handlePluginInstalled(channelId: string): void {
  void fetchInstalledPlugins().then(() => {
    // Switch to the newly installed channel if it appeared in the list
    const found = dynamicChannels.value.find((c) => c.id === channelId);
    if (found) activeTab.value = channelId;
  });
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      // Fetch dynamic channels each time dialog opens
      void fetchInstalledPlugins();
    } else {
      if (autoCloseTimer !== null) {
        clearTimeout(autoCloseTimer);
        autoCloseTimer = null;
      }
      toast.value = null;
      if (gwStore.status !== "connected") {
        void gwStore.reloadConnection();
      }
    }
  },
);

onUnmounted(() => {
  if (autoCloseTimer !== null) {
    clearTimeout(autoCloseTimer);
    autoCloseTimer = null;
  }
});
</script>

<template>
  <Teleport to="body">
    <Transition name="ch-fade">
      <div v-if="open" class="ch-backdrop" @click.self="closeDialog">
        <div class="ch-dialog" role="dialog" :aria-label="t('channel.title')">
          <!-- Header -->
          <div class="ch-header">
            <span class="ch-title">{{ t('channel.title') }}</span>
            <button type="button" class="ch-close" :aria-label="t('common.close')" @click="closeDialog">×</button>
          </div>
          <p class="ch-desc">{{ t('channel.desc') }}</p>

          <!-- Tabs -->
          <div class="ch-tabs" role="tablist">
            <button
              v-for="ch in allChannels"
              :key="ch.id"
              type="button"
              role="tab"
              class="ch-tab"
              :class="{
                'ch-tab--active': activeTab === ch.id,
                'ch-tab--install': ch.id === '__install__',
              }"
              :aria-selected="activeTab === ch.id"
              @click="activeTab = ch.id"
            >
              <span aria-hidden="true">{{ ch.icon }}</span>
              {{ ch.displayName ?? t(`channel.${ch.id}.name`) }}
            </button>
          </div>

          <!-- Toast -->
          <p v-if="toast" class="ch-toast" :class="{ 'ch-toast--error': toastError }">{{ toast }}</p>

          <!-- Active channel panel (data-driven) -->
          <component
            :is="activeEntry?.panel"
            v-if="activeEntry"
            v-bind="activeEntry.source === 'plugin' && activeEntry.id !== '__install__'
              ? { channelDef: activeEntry }
              : {}"
            @close="closeDialog"
            @plugin-installed="handlePluginInstalled"
          />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ch-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10060;
}

.ch-dialog {
  background: var(--lc-surface);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-lg, 12px);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.25);
  width: 500px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--lc-text);
}

.ch-header {
  display: flex;
  align-items: center;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--lc-border);
  flex-shrink: 0;
}

.ch-title {
  flex: 1;
  font-size: 15px;
  font-weight: 600;
}

.ch-close {
  background: none;
  border: none;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  color: var(--lc-text-muted);
  padding: 0 2px;
}
.ch-close:hover { color: var(--lc-text); }

.ch-desc {
  font-size: 12px;
  color: var(--lc-text-muted);
  margin: 0;
  padding: 8px 16px 0;
  flex-shrink: 0;
}

.ch-tabs {
  display: flex;
  gap: 2px;
  padding: 8px 16px 0;
  border-bottom: 1px solid var(--lc-border);
  flex-shrink: 0;
}

.ch-tab {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border: none;
  border-radius: var(--lc-radius-sm) var(--lc-radius-sm) 0 0;
  background: transparent;
  color: var(--lc-text-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color 0.12s, border-color 0.12s, background 0.12s;
}
.ch-tab:hover:not(.ch-tab--active) {
  color: var(--lc-text);
  background: var(--lc-bg-hover);
}
.ch-tab--active {
  color: var(--lc-accent);
  border-bottom-color: var(--lc-accent);
  background: var(--lc-accent-soft);
}
.ch-tab--install {
  margin-left: auto;
  color: var(--lc-text-muted);
  border-left: 1px solid var(--lc-border);
  border-radius: 0;
}
.ch-tab--install.ch-tab--active {
  color: var(--lc-accent);
  border-bottom-color: var(--lc-accent);
  background: var(--lc-accent-soft);
}

.ch-toast {
  margin: 8px 16px 0;
  padding: 6px 10px;
  border-radius: var(--lc-radius-sm);
  font-size: 12px;
  background: var(--lc-accent-soft);
  color: var(--lc-accent);
  flex-shrink: 0;
}
.ch-toast--error {
  background: color-mix(in srgb, var(--lc-error, #dc2626) 10%, transparent);
  color: var(--lc-error, #dc2626);
}

.ch-panel {
  flex: 1;
  overflow-y: auto;
  padding: 14px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ch-hint {
  font-size: 12px;
  color: var(--lc-text-muted);
  margin: 0;
  line-height: 1.5;
}

.ch-link {
  color: var(--lc-accent);
  text-decoration: none;
  margin-left: 6px;
}
.ch-link:hover { text-decoration: underline; }

.ch-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ch-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--lc-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.ch-input {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  background: var(--lc-bg-raised);
  color: var(--lc-text);
  font: inherit;
  font-size: 13px;
  box-sizing: border-box;
}
.ch-input:focus {
  outline: none;
  border-color: var(--lc-accent);
}

.ch-restart-hint {
  font-size: 11px;
  color: var(--lc-text-dim, var(--lc-text-muted));
  margin: 0;
  padding: 6px 10px;
  border-left: 2px solid var(--lc-warning, #d97706);
  background: color-mix(in srgb, var(--lc-warning, #d97706) 8%, transparent);
  border-radius: 0 var(--lc-radius-sm) var(--lc-radius-sm) 0;
}

.ch-plugin-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--lc-bg-elevated);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
}

.ch-code {
  flex: 1;
  font-family: var(--lc-font-mono, monospace);
  font-size: 12px;
  color: var(--lc-accent);
}

.ch-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.ch-btn {
  padding: 7px 16px;
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  background: var(--lc-bg-elevated);
  color: var(--lc-text);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.ch-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.ch-btn:hover:not(:disabled) { background: var(--lc-bg-hover); border-color: var(--lc-border-strong); }
.ch-btn--primary {
  background: linear-gradient(135deg, #0e7490, #0891b2);
  border-color: rgba(8, 145, 178, 0.5);
  color: #fff;
}
.ch-btn--primary:hover:not(:disabled) { opacity: 0.9; }
.ch-btn--sm { padding: 4px 10px; font-size: 11px; }

/* WhatsApp QR */
.ch-qr-wrap {
  display: flex;
  justify-content: center;
}
.ch-qr-img {
  width: 200px;
  height: 200px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: #fff;
}
.ch-qr-status {
  font-size: 12px;
  font-weight: 500;
}
.ch-install-card {
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  padding: 10px 12px;
  background: var(--lc-bg-raised);
  display: flex;
  flex-direction: column;
}
.ch-install-cmd-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ch-install-info-row {
  display: flex;
  align-items: center;
  padding: 7px 10px;
  background: var(--lc-bg-elevated);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
}
.ch-install-info-text {
  font-size: 12px;
  color: var(--lc-text-muted);
  line-height: 1.4;
}
.ch-code--block {
  flex: 1;
  display: block;
  padding: 6px 8px;
  background: var(--lc-bg-elevated);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  font-size: 12px;
  color: var(--lc-accent);
  user-select: all;
}
.ch-toggle-manual {
  background: none;
  border: none;
  padding: 4px 0;
  font: inherit;
  font-size: 12px;
  color: var(--lc-text-muted);
  cursor: pointer;
  text-align: left;
}
.ch-toggle-manual:hover { color: var(--lc-text); }
.ch-session-exists {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ch-session-hint {
  font-size: 11px;
  color: var(--lc-text-muted);
}
.ch-session-hint code {
  font-family: var(--lc-font-mono, monospace);
  color: var(--lc-text);
  background: var(--lc-bg-elevated);
  padding: 1px 4px;
  border-radius: 3px;
}
.ch-status-idle   { color: var(--lc-text-muted); }
.ch-status-running { color: var(--lc-accent); animation: pulse 1.4s ease-in-out infinite; }
.ch-status-ok     { color: var(--lc-success, #059669); }
.ch-status-err    { color: var(--lc-error, #dc2626); }
.ch-status-warn   { color: var(--lc-warning-text, #b45309); }
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}

.ch-plugin-warn {
  font-size: 12px;
  color: var(--lc-warning, #d97706);
  background: color-mix(in srgb, var(--lc-warning, #d97706) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--lc-warning, #d97706) 30%, transparent);
  border-radius: var(--lc-radius-sm);
  padding: 8px 10px;
  line-height: 1.5;
}
.ch-plugin-warn code {
  font-family: var(--lc-font-mono, monospace);
  background: color-mix(in srgb, var(--lc-warning, #d97706) 15%, transparent);
  padding: 1px 4px;
  border-radius: 3px;
}

.ch-terminal {
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  overflow: hidden;
  max-height: 240px;
  display: flex;
  flex-direction: column;
}
/* QR ASCII art 需要更大的显示区域 */
.ch-terminal--qr {
  max-height: 400px;
}
.ch-terminal--qr .ch-terminal-body {
  font-size: 9px;
  line-height: 1.2;
}
.ch-terminal-head {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--lc-text-muted);
  padding: 4px 10px;
  background: var(--lc-bg-elevated);
  border-bottom: 1px solid var(--lc-border);
  flex-shrink: 0;
}
.ch-terminal-body {
  flex: 1;
  overflow-y: auto;
  margin: 0;
  padding: 8px 10px;
  font-family: var(--lc-font-mono, monospace);
  font-size: 11px;
  line-height: 1.5;
  background: var(--lc-bg-raised);
  color: var(--lc-text);
  white-space: pre-wrap;
  word-break: break-all;
}

/* WeChat prerequisite card */
.ch-prereq-card {
  background: var(--lc-bg-elevated);
  border: 1px solid var(--lc-border);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 12px;
}
.ch-prereq-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--lc-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 8px;
}
.ch-prereq-steps {
  margin: 0 0 8px 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--lc-text);
}
.ch-prereq-note {
  margin: 0;
  font-size: 12px;
  color: var(--lc-text-secondary);
}

/* WeChat QR URL highlight box */
.ch-wechat-qr-box {
  background: var(--lc-bg-elevated);
  border: 1px solid var(--lc-accent, #06b6d4);
  border-radius: 8px;
  padding: 10px 12px;
  margin-top: 8px;
}
.ch-wechat-qr-hint {
  margin: 0 0 6px 0;
  font-size: 12px;
  color: var(--lc-text-secondary);
}
.ch-wechat-qr-link {
  font-size: 12px;
  word-break: break-all;
}

.ch-wechat-ticker {
  margin-top: 8px;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
  background: #0b0b0b;
  color: #d4d4d4;
  overflow: hidden;
  padding: 8px 0;
}

.ch-wechat-ticker__track {
  display: flex;
  width: max-content;
  min-width: 100%;
  white-space: nowrap;
  will-change: transform;
  animation: wechatTickerScroll 28s linear infinite;
}

.ch-wechat-ticker__text {
  display: inline-block;
  padding-left: 16px;
  padding-right: 32px;
  font-family: var(--lc-font-mono, monospace);
  font-size: 11px;
  line-height: 1.4;
}

@keyframes wechatTickerScroll {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}

/* Dialog transition */
.ch-fade-enter-active, .ch-fade-leave-active {
  transition: opacity 0.15s ease;
}
.ch-fade-enter-active .ch-dialog,
.ch-fade-leave-active .ch-dialog {
  transition: transform 0.15s ease;
}
.ch-fade-enter-from, .ch-fade-leave-to { opacity: 0; }
.ch-fade-enter-from .ch-dialog, .ch-fade-leave-to .ch-dialog { transform: scale(0.97) translateY(-6px); }
</style>
