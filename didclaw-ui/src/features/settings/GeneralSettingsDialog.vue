<script setup lang="ts">
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import { translateTauriInvokeError } from "@/lib/tauri-i18n";
import { onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [v: boolean] }>();

const { t } = useI18n();
const api = getDidClawDesktopApi();

const autostartEnabled = ref(false);
const preventSleepEnabled = ref(false);
const autostartBusy = ref(false);
const preventSleepBusy = ref(false);
const autostartError = ref<string | null>(null);
const preventSleepError = ref<string | null>(null);

const shortcutKey = ref("");
const shortcutInput = ref("");
const shortcutBusy = ref(false);
const shortcutError = ref<string | null>(null);
const shortcutSuccess = ref(false);
let shortcutSuccessTimer: number | null = null;

type ToolsProfile = "full" | "coding" | "messaging" | "minimal";
const TOOLS_PROFILES: ToolsProfile[] = ["full", "coding", "messaging", "minimal"];
const toolsProfile = ref<ToolsProfile | null>(null);
const toolsProfileBusy = ref(false);
const toolsProfileError = ref<string | null>(null);
const toolsProfileSaved = ref(false);
const toolsProfileExecSyncWarn = ref<string | null>(null);
let toolsProfileSavedTimer: number | null = null;

async function loadSettings(): Promise<void> {
  try {
    autostartEnabled.value = (await api?.getAutostartEnabled?.()) ?? false;
  } catch {
    autostartEnabled.value = false;
  }
  try {
    preventSleepEnabled.value = (await api?.getPreventSleepEnabled?.()) ?? false;
  } catch {
    preventSleepEnabled.value = false;
  }
  try {
    shortcutKey.value = (await api?.getGlobalShortcutKey?.()) ?? "Ctrl+Shift+D";
    shortcutInput.value = shortcutKey.value;
  } catch {
    shortcutKey.value = "Ctrl+Shift+D";
    shortcutInput.value = "Ctrl+Shift+D";
  }
  try {
    const r = await api?.readOpenClawToolsProfile?.();
    toolsProfile.value = (r?.ok ? r.profile : null) as ToolsProfile | null;
  } catch {
    toolsProfile.value = null;
  }
}

async function applyShortcut(): Promise<void> {
  if (shortcutBusy.value) return;
  shortcutError.value = null;
  shortcutBusy.value = true;
  try {
    await api?.setGlobalShortcutKey?.(shortcutInput.value.trim());
    shortcutKey.value = shortcutInput.value.trim();
    shortcutSuccess.value = true;
    if (shortcutSuccessTimer !== null) clearTimeout(shortcutSuccessTimer);
    shortcutSuccessTimer = window.setTimeout(() => {
      shortcutSuccess.value = false;
      shortcutSuccessTimer = null;
    }, 2000);
  } catch (e) {
    shortcutError.value = translateTauriInvokeError(e);
  } finally {
    shortcutBusy.value = false;
  }
}

function resetShortcut(): void {
  shortcutInput.value = "Ctrl+Shift+D";
}

async function selectToolsProfile(p: ToolsProfile): Promise<void> {
  if (toolsProfileBusy.value || toolsProfile.value === p) return;
  toolsProfileError.value = null;
  toolsProfileExecSyncWarn.value = null;
  toolsProfileBusy.value = true;
  try {
    const r = await api?.writeOpenClawToolsProfile?.(p);
    if (r && !r.ok) {
      toolsProfileError.value = r.error;
      return;
    }
    toolsProfile.value = p;
    toolsProfileSaved.value = true;
    const sync = r && "execApprovalsSync" in r ? r.execApprovalsSync : undefined;
    if (sync && sync.ok === false) {
      toolsProfileExecSyncWarn.value = t("generalSettings.toolsProfileExecSyncWarn", {
        msg: sync.error,
      });
    }
    if (toolsProfileSavedTimer !== null) clearTimeout(toolsProfileSavedTimer);
    toolsProfileSavedTimer = window.setTimeout(() => {
      toolsProfileSaved.value = false;
      toolsProfileSavedTimer = null;
    }, 2000);
  } catch (e) {
    toolsProfileError.value = String(e);
  } finally {
    toolsProfileBusy.value = false;
  }
}

async function toggleAutostart(): Promise<void> {
  autostartError.value = null;
  autostartBusy.value = true;
  const next = !autostartEnabled.value;
  try {
    await api?.setAutostartEnabled?.(next);
    autostartEnabled.value = next;
  } catch (e) {
    autostartError.value = String(e);
  } finally {
    autostartBusy.value = false;
  }
}

async function togglePreventSleep(): Promise<void> {
  preventSleepError.value = null;
  preventSleepBusy.value = true;
  const next = !preventSleepEnabled.value;
  try {
    await api?.setPreventSleepEnabled?.(next);
    preventSleepEnabled.value = next;
  } catch (e) {
    preventSleepError.value = String(e);
  } finally {
    preventSleepBusy.value = false;
  }
}

watch(
  () => props.modelValue,
  (v) => { if (v) void loadSettings(); },
);

onMounted(() => {
  if (props.modelValue) void loadSettings();
});

function close(): void {
  emit("update:modelValue", false);
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") close();
}
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="gs-backdrop" @click.self="close" @keydown="onKeydown">
      <div class="gs-panel" role="dialog" aria-modal="true" aria-labelledby="gs-title" tabindex="-1">
        <div class="gs-head">
          <h2 id="gs-title">{{ t('generalSettings.title') }}</h2>
          <button type="button" class="gs-close" :aria-label="t('common.close')" @click="close">✕</button>
        </div>

        <!-- Autostart -->
        <div class="gs-card">
          <div class="gs-card-body">
            <div class="gs-card-text">
              <div class="gs-card-label">{{ t('generalSettings.autostartLabel') }}</div>
              <div class="gs-card-desc muted">{{ t('generalSettings.autostartDesc') }}</div>
            </div>
            <button
              type="button"
              class="gs-toggle"
              :class="{ 'gs-toggle--on': autostartEnabled }"
              :disabled="autostartBusy"
              :aria-checked="autostartEnabled"
              role="switch"
              @click="toggleAutostart"
            >
              <span class="gs-toggle-thumb" />
            </button>
          </div>
          <p v-if="autostartError" class="gs-err small">{{ autostartError }}</p>
        </div>

        <!-- Prevent Sleep -->
        <div class="gs-card">
          <div class="gs-card-body">
            <div class="gs-card-text">
              <div class="gs-card-label">{{ t('generalSettings.preventSleepLabel') }}</div>
              <div class="gs-card-desc muted">{{ t('generalSettings.preventSleepDesc') }}</div>
            </div>
            <button
              type="button"
              class="gs-toggle"
              :class="{ 'gs-toggle--on': preventSleepEnabled }"
              :disabled="preventSleepBusy"
              :aria-checked="preventSleepEnabled"
              role="switch"
              @click="togglePreventSleep"
            >
              <span class="gs-toggle-thumb" />
            </button>
          </div>
          <p v-if="preventSleepError" class="gs-err small">{{ preventSleepError }}</p>
        </div>

        <!-- Global Shortcut -->
        <div class="gs-card">
          <div class="gs-card-text" style="margin-bottom: 10px;">
            <div class="gs-card-label">{{ t('generalSettings.globalShortcutLabel') }}</div>
            <div class="gs-card-desc muted">{{ t('generalSettings.globalShortcutDesc') }}</div>
          </div>
          <div class="gs-shortcut-row">
            <input
              v-model="shortcutInput"
              type="text"
              class="gs-shortcut-input"
              :placeholder="t('generalSettings.globalShortcutPlaceholder')"
              :disabled="shortcutBusy"
              @keydown.enter="applyShortcut"
            >
            <button
              type="button"
              class="gs-shortcut-btn"
              :class="{ 'gs-shortcut-btn--success': shortcutSuccess }"
              :disabled="shortcutBusy || shortcutInput.trim() === shortcutKey"
              @click="applyShortcut"
            >
              {{ shortcutBusy ? t('generalSettings.globalShortcutApplying') : shortcutSuccess ? '✓' : t('generalSettings.globalShortcutApply') }}
            </button>
            <button
              type="button"
              class="gs-shortcut-btn gs-shortcut-btn--reset"
              :disabled="shortcutBusy"
              @click="resetShortcut"
            >
              {{ t('generalSettings.globalShortcutReset') }}
            </button>
          </div>
          <p v-if="shortcutError" class="gs-err small">{{ shortcutError }}</p>
        </div>

        <!-- Tools Profile -->
        <div class="gs-card">
          <div class="gs-card-text" style="margin-bottom: 10px;">
            <div class="gs-card-label">{{ t('generalSettings.toolsProfileLabel') }}</div>
            <div class="gs-card-desc muted">{{ t('generalSettings.toolsProfileDesc') }}</div>
          </div>
          <div class="gs-profile-grid">
            <button
              v-for="p in TOOLS_PROFILES"
              :key="p"
              type="button"
              class="gs-profile-btn"
              :class="{ 'gs-profile-btn--active': toolsProfile === p }"
              :disabled="toolsProfileBusy"
              @click="selectToolsProfile(p)"
            >
              <span class="gs-profile-name">{{ t(`generalSettings.toolsProfile${p.charAt(0).toUpperCase() + p.slice(1)}`) }}</span>
              <span class="gs-profile-desc muted">{{ t(`generalSettings.toolsProfile${p.charAt(0).toUpperCase() + p.slice(1)}Desc`) }}</span>
            </button>
          </div>
          <p v-if="toolsProfileSaved" class="gs-ok small">✓ {{ t('generalSettings.toolsProfileSaved') }}</p>
          <p v-if="toolsProfileError" class="gs-err small">{{ toolsProfileError }}</p>
          <p v-if="toolsProfileExecSyncWarn" class="gs-warn small">{{ toolsProfileExecSyncWarn }}</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.gs-backdrop {
  position: fixed;
  inset: 0;
  z-index: 12000;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  box-sizing: border-box;
}
.gs-panel {
  width: min(480px, 100%);
  background: var(--lc-surface-panel);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  box-shadow: var(--lc-shadow-sm);
  padding: 20px 22px 24px;
  box-sizing: border-box;
}
.gs-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}
.gs-head h2 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
}
.gs-close {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--lc-text-muted);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.gs-close:hover {
  background: var(--lc-error-bg);
  color: var(--lc-error);
}
.gs-card {
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  padding: 14px 16px;
  margin-bottom: 10px;
  background: var(--lc-bg-elevated);
}
.gs-card-body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.gs-card-text {
  flex: 1;
  min-width: 0;
}
.gs-card-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--lc-text);
  margin-bottom: 3px;
}
.gs-card-desc {
  font-size: 12px;
  line-height: 1.45;
}
.muted { color: var(--lc-text-muted); }
.small { font-size: 12px; }
.gs-err {
  color: var(--lc-error);
  margin: 8px 0 0;
}
.gs-warn {
  color: var(--lc-warning, #d97706);
  margin: 8px 0 0;
}

/* Toggle switch */
.gs-toggle {
  flex-shrink: 0;
  width: 44px;
  height: 24px;
  border-radius: 12px;
  border: none;
  background: var(--lc-border-strong, #cbd5e1);
  cursor: pointer;
  position: relative;
  transition: background 0.2s;
  padding: 0;
}
.gs-toggle:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.gs-toggle--on {
  background: var(--lc-accent, #2563eb);
}
.gs-toggle-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  transition: transform 0.2s;
}
.gs-toggle--on .gs-toggle-thumb {
  transform: translateX(20px);
}

/* Shortcut row */
.gs-shortcut-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.gs-shortcut-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--lc-border);
  border-radius: 6px;
  background: var(--lc-bg-raised);
  color: var(--lc-text);
  font-size: 13px;
  font-family: ui-monospace, monospace;
  outline: none;
  transition: border-color 0.15s;
}
.gs-shortcut-input:focus {
  border-color: var(--lc-accent);
}
.gs-shortcut-input:disabled {
  opacity: 0.5;
}
.gs-shortcut-btn {
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--lc-border);
  border-radius: 6px;
  background: var(--lc-bg-raised);
  color: var(--lc-text);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.gs-shortcut-btn:hover:not(:disabled) {
  background: var(--lc-accent, #2563eb);
  color: #fff;
  border-color: transparent;
}
.gs-shortcut-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.gs-shortcut-btn--success {
  background: rgba(5, 150, 105, 0.12);
  border-color: rgba(5, 150, 105, 0.3);
  color: #059669;
}
.gs-shortcut-btn--reset {
  color: var(--lc-text-muted);
}

/* Tools profile grid */
.gs-profile-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.gs-profile-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 10px 12px;
  border: 1px solid var(--lc-border);
  border-radius: 6px;
  background: var(--lc-bg-raised);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, background 0.15s;
}
.gs-profile-btn:hover:not(:disabled) {
  border-color: var(--lc-accent, #2563eb);
}
.gs-profile-btn--active {
  border-color: var(--lc-accent, #2563eb);
  background: rgba(37, 99, 235, 0.08);
}
.gs-profile-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.gs-profile-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--lc-text);
}
.gs-profile-desc {
  font-size: 11px;
  line-height: 1.4;
}
.gs-ok {
  color: #059669;
  margin: 8px 0 0;
}
</style>
