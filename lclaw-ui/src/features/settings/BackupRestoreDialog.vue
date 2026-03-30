<script setup lang="ts">
import { getDidClawDesktopApi } from "@/lib/desktop-api";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [v: boolean] }>();

const { t } = useI18n();

const open = computed({
  get: () => props.modelValue,
  set: (v) => emit("update:modelValue", v),
});

type Status =
  | { kind: "idle" }
  | { kind: "busy"; label: string }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

const status = ref<Status>({ kind: "idle" });
const estimateInfo = ref<{ bytes: number; fileCount: number } | null>(null);
const estimateBusy = ref(false);

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadEstimate(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.estimateOpenclawBackupSize) return;
  estimateBusy.value = true;
  try {
    const r = await api.estimateOpenclawBackupSize();
    if (r.ok) {
      estimateInfo.value = { bytes: r.bytes, fileCount: r.fileCount };
    }
  } catch {
    /* silently ignore estimation errors */
  } finally {
    estimateBusy.value = false;
  }
}

watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      status.value = { kind: "idle" };
      void loadEstimate();
    }
  },
  { immediate: true },
);

async function doBackup(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.backupOpenclawConfig) return;
  status.value = { kind: "busy", label: t("backup.backing") };
  try {
    const r = await api.backupOpenclawConfig();
    if ("cancelled" in r && r.cancelled) {
      status.value = { kind: "idle" };
      return;
    }
    if (r.ok) {
      status.value = {
        kind: "ok",
        message: t("backup.backupDone", { path: (r as { savedPath: string }).savedPath }),
      };
    } else {
      status.value = { kind: "error", message: (r as { error?: string }).error ?? t("backup.unknownError") };
    }
  } catch (e) {
    status.value = { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

async function doRestore(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.restoreOpenclawConfig) return;
  status.value = { kind: "busy", label: t("backup.restoring") };
  try {
    const r = await api.restoreOpenclawConfig();
    if ("cancelled" in r && r.cancelled) {
      status.value = { kind: "idle" };
      return;
    }
    if (r.ok) {
      const count = (r as { fileCount: number }).fileCount;
      status.value = {
        kind: "ok",
        message: t("backup.restoreDone", { count }),
      };
      void loadEstimate();
    } else {
      status.value = { kind: "error", message: (r as { error?: string }).error ?? t("backup.unknownError") };
    }
  } catch (e) {
    status.value = { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="bkup-fade">
      <div v-if="open" class="bkup-backdrop" @click.self="open = false">
        <div class="bkup-dialog" role="dialog" :aria-label="t('backup.title')">
          <!-- header -->
          <div class="bkup-header">
            <span class="bkup-title">💾 {{ t('backup.title') }}</span>
            <button
              type="button"
              class="bkup-close"
              :aria-label="t('common.close')"
              @click="open = false"
            >✕</button>
          </div>

          <!-- body -->
          <div class="bkup-body">
            <!-- description -->
            <p class="bkup-desc">{{ t('backup.desc') }}</p>

            <!-- exclusion hints -->
            <ul class="bkup-excl">
              <li>{{ t('backup.excl1') }}</li>
              <li>{{ t('backup.excl2') }}</li>
              <li>{{ t('backup.excl3') }}</li>
            </ul>

            <!-- size estimate -->
            <div class="bkup-size">
              <template v-if="estimateBusy">
                <span class="bkup-size-loading">{{ t('backup.estimating') }}</span>
              </template>
              <template v-else-if="estimateInfo">
                <span class="bkup-size-label">{{ t('backup.estimateLabel') }}</span>
                <span class="bkup-size-value">
                  {{ formatBytes(estimateInfo.bytes) }}
                  <span class="bkup-size-files">（{{ t('backup.fileCount', { n: estimateInfo.fileCount }) }}）</span>
                </span>
              </template>
            </div>

            <!-- action buttons -->
            <div class="bkup-actions">
              <button
                type="button"
                class="lc-btn lc-btn-primary"
                :disabled="status.kind === 'busy'"
                @click="doBackup"
              >
                <span v-if="status.kind === 'busy'" class="bkup-spinner" aria-hidden="true" />
                {{ status.kind === 'busy' && status.label === t('backup.backing')
                    ? t('backup.backing')
                    : t('backup.backupBtn') }}
              </button>
              <button
                type="button"
                class="lc-btn lc-btn-ghost"
                :disabled="status.kind === 'busy'"
                @click="doRestore"
              >
                <span v-if="status.kind === 'busy' && status.label === t('backup.restoring')" class="bkup-spinner" aria-hidden="true" />
                {{ status.kind === 'busy' && status.label === t('backup.restoring')
                    ? t('backup.restoring')
                    : t('backup.restoreBtn') }}
              </button>
            </div>

            <!-- status feedback -->
            <Transition name="bkup-msg-fade">
              <div
                v-if="status.kind === 'ok' || status.kind === 'error'"
                class="bkup-msg"
                :class="status.kind === 'ok' ? 'bkup-msg--ok' : 'bkup-msg--err'"
                role="status"
              >
                <span class="bkup-msg-icon" aria-hidden="true">
                  {{ status.kind === 'ok' ? '✓' : '✕' }}
                </span>
                <span class="bkup-msg-text">{{ status.message }}</span>
                <button
                  type="button"
                  class="bkup-msg-dismiss"
                  :aria-label="t('common.close')"
                  @click="status = { kind: 'idle' }"
                >✕</button>
              </div>
            </Transition>

            <!-- restore warning -->
            <p class="bkup-warn">⚠ {{ t('backup.restoreWarn') }}</p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.bkup-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10060;
}

.bkup-dialog {
  background: var(--lc-surface, #ffffff);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-lg, 12px);
  box-shadow: var(--lc-shadow-xl, 0 20px 60px rgba(0, 0, 0, 0.25));
  width: 440px;
  max-width: calc(100vw - 32px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--lc-text);
}

.bkup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--lc-border);
  flex-shrink: 0;
}

.bkup-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--lc-text);
}

.bkup-close {
  background: none;
  border: none;
  font-size: 14px;
  color: var(--lc-text-muted);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--lc-radius-sm, 4px);
  line-height: 1;
  transition: background 0.15s, color 0.15s;
}
.bkup-close:hover {
  background: var(--lc-red-soft, color-mix(in srgb, var(--lc-red) 12%, transparent));
  color: var(--lc-red);
}

.bkup-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.bkup-desc {
  margin: 0;
  font-size: 13px;
  color: var(--lc-text);
  line-height: 1.5;
}

.bkup-excl {
  margin: 0;
  padding: 8px 12px;
  background: var(--lc-bg-raised, var(--lc-surface));
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm, 4px);
  font-size: 12px;
  color: var(--lc-text-muted);
  line-height: 1.8;
  list-style: disc inside;
}

.bkup-size {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--lc-text-muted);
  min-height: 20px;
}

.bkup-size-loading {
  font-style: italic;
}

.bkup-size-label {
  font-weight: 500;
}

.bkup-size-value {
  color: var(--lc-text);
  font-weight: 600;
}

.bkup-size-files {
  font-weight: 400;
  color: var(--lc-text-muted);
}

.bkup-actions {
  display: flex;
  gap: 10px;
}

.bkup-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: bkup-spin 0.7s linear infinite;
  vertical-align: middle;
  margin-right: 4px;
}

@keyframes bkup-spin {
  to { transform: rotate(360deg); }
}

.bkup-msg {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--lc-radius-sm, 4px);
  font-size: 12px;
  line-height: 1.5;
  border: 1px solid transparent;
}

.bkup-msg--ok {
  background: color-mix(in srgb, var(--lc-success) 10%, transparent);
  border-color: color-mix(in srgb, var(--lc-success) 30%, transparent);
  color: var(--lc-success, #059669);
}

.bkup-msg--err {
  background: color-mix(in srgb, var(--lc-error) 10%, transparent);
  border-color: color-mix(in srgb, var(--lc-error) 30%, transparent);
  color: var(--lc-error, #dc2626);
}

.bkup-msg-icon {
  font-weight: 700;
  flex-shrink: 0;
  margin-top: 1px;
}

.bkup-msg-text {
  flex: 1;
  word-break: break-all;
}

.bkup-msg-dismiss {
  flex-shrink: 0;
  padding: 0 3px;
  border: none;
  background: transparent;
  font-size: 11px;
  cursor: pointer;
  opacity: 0.6;
  color: inherit;
  line-height: 1;
}
.bkup-msg-dismiss:hover { opacity: 1; }

.bkup-warn {
  margin: 0;
  font-size: 11px;
  color: var(--lc-text-muted);
  line-height: 1.4;
}

/* transitions */
.bkup-fade-enter-active,
.bkup-fade-leave-active {
  transition: opacity 0.15s ease;
}
.bkup-fade-enter-from,
.bkup-fade-leave-to {
  opacity: 0;
}

.bkup-msg-fade-enter-active,
.bkup-msg-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.bkup-msg-fade-enter-from,
.bkup-msg-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
