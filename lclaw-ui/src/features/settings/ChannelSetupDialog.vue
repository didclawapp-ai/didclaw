<script setup lang="ts">
import { computed, defineAsyncComponent, onUnmounted, ref, watch } from "vue";
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

// ── Dynamic plugin channels ───────────────────────────────────────────────

const { channels: dynamicChannels, fetchInstalledPlugins } = useInstalledPlugins();

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

// ── Card / bottom-panel state ─────────────────────────────────────────────

const activeCardId = ref<string | null>(null);

const activeEntry = computed<ChannelEntry | undefined>(() =>
  allChannels.value.find((c) => c.id === activeCardId.value),
);

// ── Connected channel statuses (queried from Gateway) ─────────────────────

const connectedIds = ref<Set<string>>(new Set());

async function refreshChannelStatuses(): Promise<void> {
  const gc = gwStore.client;
  if (!gc || (gwStore.status as string) !== "connected") return;
  try {
    type Resp = { channels?: Record<string, { connected?: boolean }> } | null;
    const res = await gc.request<Resp>("channels.status", {
      probe: true,
      timeoutMs: 8000,
    });
    if (res?.channels) {
      connectedIds.value = new Set(
        Object.entries(res.channels)
          .filter(([, v]) => (v as { connected?: boolean })?.connected === true)
          .map(([k]) => k),
      );
    }
  } catch {
    /* Gateway may not yet implement this RPC – degrade gracefully */
  }
}

// ── Auto-close ────────────────────────────────────────────────────────────

let autoCloseTimer: number | null = null;

function scheduleAutoClose(): void {
  if (autoCloseTimer !== null) return;
  void refreshChannelStatuses(); // update card dots on success
  autoCloseTimer = window.setTimeout(() => {
    autoCloseTimer = null;
    if (open.value) closeDialog();
  }, 1800);
}

// ── Shared context (provided to all panel components) ─────────────────────

const { busy, toast, toastError } = provideChannelContext({
  onSuccess: scheduleAutoClose,
});

// ── Card interaction ──────────────────────────────────────────────────────

function onCardClick(ch: ChannelEntry): void {
  if (busy.value && activeCardId.value === ch.id) return;
  if (activeCardId.value === ch.id) {
    // Toggle: clicking active card collapses the panel
    activeCardId.value = null;
    return;
  }
  activeCardId.value = ch.id;
  // Ensure selected card is visible (it might scroll out when panel opens)
  requestAnimationFrame(() => {
    document
      .getElementById(`ch-card-${ch.id}`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
}

function closePanel(): void {
  if (busy.value) return;
  activeCardId.value = null;
}

function closeDialog(): void {
  open.value = false;
}

// ── Plugin installed callback (from InstallChannelPanel) ──────────────────

function handlePluginInstalled(channelId: string): void {
  void fetchInstalledPlugins().then(() => {
    const found = dynamicChannels.value.find((c) => c.id === channelId);
    if (found) activeCardId.value = channelId;
    void refreshChannelStatuses();
  });
}

// ── Dynamic channel polling (picks up user-installed plugins) ────────────

let pollTimer: number | null = null;

function startPolling(): void {
  stopPolling();
  // Poll every 8 s so newly-installed plugins appear without manual refresh
  pollTimer = window.setInterval(() => {
    void fetchInstalledPlugins();
  }, 8000);
}

function stopPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────

watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      void fetchInstalledPlugins();
      void refreshChannelStatuses();
      startPolling();
    } else {
      stopPolling();
      activeCardId.value = null;
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
  stopPolling();
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
          <!-- ── Header ── -->
          <div class="ch-header">
            <div class="ch-header-text">
              <span class="ch-title">{{ t('channel.title') }}</span>
              <p class="ch-desc">{{ t('channel.desc') }}</p>
            </div>
            <button
              type="button"
              class="ch-close"
              :aria-label="t('common.close')"
              @click="closeDialog"
            >
              ×
            </button>
          </div>

          <!-- ── Scrollable card grid ── -->
          <div class="ch-grid-area">
            <div class="ch-card-grid">
              <button
                v-for="ch in allChannels"
                :id="`ch-card-${ch.id}`"
                :key="ch.id"
                type="button"
                class="ch-card"
                :class="{
                  'ch-card--selected': activeCardId === ch.id,
                  'ch-card--add': ch.id === '__install__',
                }"
                :data-chstatus="
                  (busy && activeCardId === ch.id) ? 'busy' :
                  connectedIds.has(ch.id) ? 'connected' : 'idle'
                "
                @click="onCardClick(ch)"
              >
                <div class="ch-card-icon-wrap">
                  <span class="ch-card-icon" aria-hidden="true">{{ ch.icon }}</span>
                  <div class="ch-card-spin" aria-hidden="true" />
                  <div class="ch-card-dot" aria-hidden="true" />
                </div>
                <span class="ch-card-name">{{ ch.displayName ?? t(ch.nameKey) }}</span>
                <span
                  v-if="ch.id !== '__install__'"
                  class="ch-card-badge"
                  :class="{
                    'ch-card-badge--connected': connectedIds.has(ch.id) && !(busy && activeCardId === ch.id),
                    'ch-card-badge--busy': busy && activeCardId === ch.id,
                  }"
                >
                  {{ (busy && activeCardId === ch.id) ? t('channel.card.busy') :
                    connectedIds.has(ch.id) ? t('channel.card.connected') :
                    t('channel.card.idle') }}
                </span>
              </button>
            </div>
          </div>

          <!-- ── Bottom detail panel (slides up) ── -->
          <div
            class="ch-bottom"
            :class="{ 'ch-bottom--open': activeCardId !== null }"
            :aria-hidden="activeCardId === null ? 'true' : undefined"
          >
            <div class="ch-bottom-inner">
              <!-- Panel header row -->
              <div v-if="activeEntry" class="ch-bottom-head">
                <span class="ch-bottom-icon" aria-hidden="true">{{ activeEntry.icon }}</span>
                <span class="ch-bottom-title">
                  {{ activeEntry.displayName ?? t(activeEntry.nameKey) }}
                </span>
                <span
                  v-if="activeEntry.id !== '__install__'"
                  class="ch-bottom-pill"
                  :class="{
                    'ch-bottom-pill--connected': connectedIds.has(activeEntry.id) && !busy,
                    'ch-bottom-pill--busy': busy,
                  }"
                >
                  {{ busy ? t('channel.card.busy') :
                    connectedIds.has(activeEntry.id) ? t('channel.card.connected') :
                    t('channel.card.idle') }}
                </span>
                <button
                  type="button"
                  class="ch-bottom-close"
                  :disabled="busy"
                  :aria-label="t('common.close')"
                  @click="closePanel"
                >
                  ×
                </button>
              </div>

              <!-- Toast (scoped to bottom panel) -->
              <p
                v-if="toast"
                class="ch-toast"
                :class="{ 'ch-toast--error': toastError }"
              >
                {{ toast }}
              </p>

              <!-- Active channel panel component -->
              <component
                :is="activeEntry?.panel"
                v-if="activeEntry"
                v-bind="
                  activeEntry.source === 'plugin' && activeEntry.id !== '__install__'
                    ? { channelDef: activeEntry }
                    : {}
                "
                @close="closeDialog"
                @plugin-installed="handlePluginInstalled"
              />
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ── Backdrop & dialog shell ─────────────────────────────────────────────── */

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
  /* Fixed total height so the dialog never grows */
  height: 480px;
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--lc-text);
}

/* ── Header ──────────────────────────────────────────────────────────────── */

.ch-header {
  display: flex;
  align-items: flex-start;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--lc-border);
  flex-shrink: 0;
  gap: 8px;
}

.ch-header-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ch-title {
  font-size: 14px;
  font-weight: 600;
}

.ch-desc {
  font-size: 11px;
  color: var(--lc-text-muted);
  margin: 0;
  line-height: 1.4;
}

.ch-close {
  background: none;
  border: none;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  color: var(--lc-text-muted);
  padding: 0 2px;
  flex-shrink: 0;
}
.ch-close:hover { color: var(--lc-text); }

/* ── Scrollable card grid area ───────────────────────────────────────────── */

.ch-grid-area {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px 8px;
  scrollbar-width: thin;
  scrollbar-color: var(--lc-border) transparent;
}
.ch-grid-area::-webkit-scrollbar { width: 4px; }
.ch-grid-area::-webkit-scrollbar-track { background: transparent; }
.ch-grid-area::-webkit-scrollbar-thumb {
  background: var(--lc-border);
  border-radius: 4px;
}

.ch-card-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 9px;
}

/* ── Channel card ────────────────────────────────────────────────────────── */

.ch-card {
  background: var(--lc-bg-raised);
  border: 1.5px solid var(--lc-border);
  border-radius: 10px;
  padding: 12px 6px 9px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  position: relative;
  font: inherit;
  text-align: center;
  transition: border-color 0.12s, background 0.12s, transform 0.1s;
}
.ch-card:hover {
  background: var(--lc-bg-hover);
  border-color: var(--lc-border-strong);
  transform: translateY(-1px);
}
.ch-card:active { transform: translateY(0); }
.ch-card--selected {
  border-color: var(--lc-accent);
  background: var(--lc-accent-soft);
}
.ch-card--add {
  border-style: dashed;
  opacity: 0.55;
}

/* icon wrapper with spinning ring + status dot */
.ch-card-icon-wrap {
  position: relative;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ch-card-icon {
  font-size: 22px;
  line-height: 1;
  position: relative;
  z-index: 1;
}

.ch-card-spin {
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 2px solid transparent;
  display: none;
}
[data-chstatus="busy"] .ch-card-spin {
  display: block;
  border-top-color: var(--lc-accent);
  border-right-color: var(--lc-accent);
  animation: ch-spin 0.7s linear infinite;
}

.ch-card-dot {
  position: absolute;
  bottom: 1px;
  right: 1px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1.5px solid var(--lc-surface);
  background: var(--lc-border);
  z-index: 2;
}
[data-chstatus="connected"] .ch-card-dot {
  background: var(--lc-success, #22c55e);
}
[data-chstatus="busy"] .ch-card-dot { display: none; }

@keyframes ch-spin { to { transform: rotate(360deg); } }

.ch-card-name {
  font-size: 11px;
  font-weight: 500;
  color: var(--lc-text);
  line-height: 1.2;
}

.ch-card-badge {
  font-size: 9.5px;
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 500;
  background: rgba(148, 163, 184, 0.07);
  color: var(--lc-text-muted);
}
.ch-card-badge--connected {
  background: color-mix(in srgb, var(--lc-success, #22c55e) 12%, transparent);
  color: var(--lc-success, #22c55e);
}
.ch-card-badge--busy {
  background: color-mix(in srgb, var(--lc-accent) 12%, transparent);
  color: var(--lc-accent);
  animation: ch-blink 0.6s ease-in-out infinite alternate;
}

@keyframes ch-blink { from { opacity: 0.5; } to { opacity: 1; } }

/* ── Bottom detail panel ─────────────────────────────────────────────────── */

.ch-bottom {
  flex-shrink: 0;
  height: 0;
  overflow: hidden;
  background: var(--lc-bg-raised);
  /* Animate height, border appears only when open */
  transition: height 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}
.ch-bottom--open {
  height: 230px;
  border-top: 1px solid var(--lc-border);
}

.ch-bottom-inner {
  height: 230px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Bottom panel header row */
.ch-bottom-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 14px 7px;
  border-bottom: 1px solid var(--lc-border);
  flex-shrink: 0;
}
.ch-bottom-icon { font-size: 17px; line-height: 1; }
.ch-bottom-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--lc-text);
}
.ch-bottom-pill {
  font-size: 9.5px;
  padding: 1px 6px;
  border-radius: 10px;
  font-weight: 500;
  background: rgba(148, 163, 184, 0.07);
  color: var(--lc-text-muted);
}
.ch-bottom-pill--connected {
  background: color-mix(in srgb, var(--lc-success, #22c55e) 10%, transparent);
  color: var(--lc-success, #22c55e);
}
.ch-bottom-pill--busy {
  background: color-mix(in srgb, var(--lc-accent) 10%, transparent);
  color: var(--lc-accent);
  animation: ch-blink 0.6s ease-in-out infinite alternate;
}
.ch-bottom-close {
  margin-left: auto;
  background: none;
  border: none;
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
  color: var(--lc-text-muted);
  padding: 0 2px;
}
.ch-bottom-close:hover:not(:disabled) { color: var(--lc-text); }
.ch-bottom-close:disabled { opacity: 0.3; cursor: not-allowed; }

/* ── Toast ───────────────────────────────────────────────────────────────── */

.ch-toast {
  margin: 0;
  padding: 5px 14px;
  font-size: 11.5px;
  background: color-mix(in srgb, var(--lc-accent) 10%, transparent);
  color: var(--lc-accent);
  flex-shrink: 0;
  border-bottom: 1px solid var(--lc-border);
}
.ch-toast--error {
  background: color-mix(in srgb, var(--lc-error, #dc2626) 10%, transparent);
  color: var(--lc-error, #dc2626);
}

/* ── Child panel styles (used by panel components rendered inside .ch-bottom) */
/* :deep() ensures these apply to elements inside async child components      */

:deep(.ch-panel) {
  flex: 1;
  overflow-y: auto;
  padding: 10px 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  scrollbar-width: thin;
  scrollbar-color: var(--lc-border) transparent;
}

:deep(.ch-hint) {
  font-size: 12px;
  color: var(--lc-text-muted);
  margin: 0;
  line-height: 1.5;
}

:deep(.ch-link) {
  color: var(--lc-accent);
  text-decoration: none;
  margin-left: 4px;
}
:deep(.ch-link:hover) { text-decoration: underline; }

:deep(.ch-form) {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

:deep(.ch-label) {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--lc-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

:deep(.ch-input) {
  width: 100%;
  padding: 6px 9px;
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  background: var(--lc-bg-elevated);
  color: var(--lc-text);
  font: inherit;
  font-size: 12.5px;
  box-sizing: border-box;
}
:deep(.ch-input:focus) {
  outline: none;
  border-color: var(--lc-accent);
}

:deep(.ch-restart-hint) {
  font-size: 11px;
  color: var(--lc-text-dim, var(--lc-text-muted));
  margin: 0;
  padding: 5px 8px;
  border-left: 2px solid var(--lc-warning, #d97706);
  background: color-mix(in srgb, var(--lc-warning, #d97706) 8%, transparent);
  border-radius: 0 var(--lc-radius-sm) var(--lc-radius-sm) 0;
}

:deep(.ch-actions) {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
}

:deep(.ch-btn) {
  padding: 6px 14px;
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  background: var(--lc-bg-elevated);
  color: var(--lc-text);
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
:deep(.ch-btn:disabled) { opacity: 0.5; cursor: not-allowed; }
:deep(.ch-btn:hover:not(:disabled)) {
  background: var(--lc-bg-hover);
  border-color: var(--lc-border-strong);
}
:deep(.ch-btn--primary) {
  background: linear-gradient(135deg, #0e7490, #0891b2);
  border-color: rgba(8, 145, 178, 0.5);
  color: #fff;
}
:deep(.ch-btn--primary:hover:not(:disabled)) { opacity: 0.9; }
:deep(.ch-btn--sm) { padding: 3px 9px; font-size: 11px; }

:deep(.ch-qr-wrap) {
  display: flex;
  justify-content: center;
}
:deep(.ch-qr-img) {
  width: 130px;
  height: 130px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: #fff;
}
:deep(.ch-qr-status) {
  font-size: 12px;
  font-weight: 500;
}

:deep(.ch-install-card) {
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  padding: 8px 10px;
  background: var(--lc-bg-raised);
  display: flex;
  flex-direction: column;
}
:deep(.ch-install-cmd-row) {
  display: flex;
  align-items: center;
  gap: 7px;
}
:deep(.ch-install-info-row) {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  background: var(--lc-bg-elevated);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
}
:deep(.ch-install-info-text) {
  font-size: 11.5px;
  color: var(--lc-text-muted);
  line-height: 1.4;
}

:deep(.ch-plugin-row) {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 9px;
  background: var(--lc-bg-elevated);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
}
:deep(.ch-code) {
  flex: 1;
  font-family: var(--lc-font-mono, monospace);
  font-size: 11.5px;
  color: var(--lc-accent);
}
:deep(.ch-code--block) {
  flex: 1;
  display: block;
  padding: 5px 7px;
  background: var(--lc-bg-elevated);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  font-size: 11.5px;
  color: var(--lc-accent);
  user-select: all;
}
:deep(.ch-toggle-manual) {
  background: none;
  border: none;
  padding: 3px 0;
  font: inherit;
  font-size: 11.5px;
  color: var(--lc-text-muted);
  cursor: pointer;
  text-align: left;
}
:deep(.ch-toggle-manual:hover) { color: var(--lc-text); }

:deep(.ch-plugin-warn) {
  font-size: 11.5px;
  color: var(--lc-warning, #d97706);
  background: color-mix(in srgb, var(--lc-warning, #d97706) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--lc-warning, #d97706) 30%, transparent);
  border-radius: var(--lc-radius-sm);
  padding: 6px 9px;
  line-height: 1.5;
}
:deep(.ch-plugin-warn code) {
  font-family: var(--lc-font-mono, monospace);
  background: color-mix(in srgb, var(--lc-warning, #d97706) 15%, transparent);
  padding: 1px 3px;
  border-radius: 3px;
}

:deep(.ch-terminal) {
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  overflow: hidden;
  max-height: 120px;
  display: flex;
  flex-direction: column;
}
:deep(.ch-terminal--qr) { max-height: 160px; }
:deep(.ch-terminal--qr .ch-terminal-body) { font-size: 8px; line-height: 1.15; }
:deep(.ch-terminal-head) {
  font-size: 9.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--lc-text-muted);
  padding: 3px 8px;
  background: var(--lc-bg-elevated);
  border-bottom: 1px solid var(--lc-border);
  flex-shrink: 0;
}
:deep(.ch-terminal-body) {
  flex: 1;
  overflow-y: auto;
  margin: 0;
  padding: 5px 8px;
  font-family: var(--lc-font-mono, monospace);
  font-size: 10px;
  line-height: 1.4;
  background: var(--lc-bg-raised);
  color: var(--lc-text);
  white-space: pre-wrap;
  word-break: break-all;
}

:deep(.ch-prereq-card) {
  background: var(--lc-bg-elevated);
  border: 1px solid var(--lc-border);
  border-radius: 7px;
  padding: 8px 10px;
}
:deep(.ch-prereq-title) {
  font-size: 11px;
  font-weight: 600;
  color: var(--lc-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 5px;
}
:deep(.ch-prereq-steps) {
  margin: 0 0 5px 0;
  padding-left: 16px;
  font-size: 12px;
  line-height: 1.6;
}
:deep(.ch-prereq-note) {
  margin: 0;
  font-size: 11px;
  color: var(--lc-text-secondary);
}

:deep(.ch-wechat-qr-box) {
  background: var(--lc-bg-elevated);
  border: 1px solid var(--lc-accent, #06b6d4);
  border-radius: 7px;
  padding: 7px 10px;
}
:deep(.ch-wechat-qr-hint) {
  margin: 0 0 4px 0;
  font-size: 11.5px;
  color: var(--lc-text-secondary);
}
:deep(.ch-wechat-qr-link) {
  font-size: 11.5px;
  word-break: break-all;
}

:deep(.ch-wechat-ticker) {
  margin-top: 5px;
  border: 1px solid #2a2a2a;
  border-radius: 7px;
  background: #0b0b0b;
  color: #d4d4d4;
  overflow: hidden;
  padding: 5px 0;
}
:deep(.ch-wechat-ticker__track) {
  display: flex;
  width: max-content;
  min-width: 100%;
  white-space: nowrap;
  will-change: transform;
  animation: wechatTickerScroll 28s linear infinite;
}
:deep(.ch-wechat-ticker__text) {
  display: inline-block;
  padding-left: 14px;
  padding-right: 28px;
  font-family: var(--lc-font-mono, monospace);
  font-size: 10px;
  line-height: 1.4;
}
@keyframes wechatTickerScroll {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}

:deep(.ch-session-exists) {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
:deep(.ch-session-hint) {
  font-size: 10.5px;
  color: var(--lc-text-muted);
}
:deep(.ch-session-hint code) {
  font-family: var(--lc-font-mono, monospace);
  color: var(--lc-text);
  background: var(--lc-bg-elevated);
  padding: 1px 3px;
  border-radius: 3px;
}

:deep(.ch-status-idle)    { color: var(--lc-text-muted); }
:deep(.ch-status-running) {
  color: var(--lc-accent);
  animation: pulse 1.4s ease-in-out infinite;
}
:deep(.ch-status-ok)   { color: var(--lc-success, #059669); }
:deep(.ch-status-err)  { color: var(--lc-error, #dc2626); }
:deep(.ch-status-warn) { color: var(--lc-warning-text, #b45309); }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}

/* ── Generic plugin panel (rendered inside .ch-bottom) ───────────────────── */

:deep(.ch-plugin-field) {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
:deep(.ch-plugin-field label) {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--lc-text-muted);
  letter-spacing: 0.04em;
}

/* ── Dialog transition ───────────────────────────────────────────────────── */

.ch-fade-enter-active,
.ch-fade-leave-active { transition: opacity 0.15s ease; }
.ch-fade-enter-active .ch-dialog,
.ch-fade-leave-active .ch-dialog { transition: transform 0.15s ease; }
.ch-fade-enter-from,
.ch-fade-leave-to { opacity: 0; }
.ch-fade-enter-from .ch-dialog,
.ch-fade-leave-to .ch-dialog { transform: scale(0.97) translateY(-6px); }
</style>
