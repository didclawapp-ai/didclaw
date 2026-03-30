<script setup lang="ts">
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
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
</style>
