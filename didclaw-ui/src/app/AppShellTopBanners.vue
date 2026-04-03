<script setup lang="ts">
import { isDidClawElectron } from "@/lib/electron-bridge";
import { showDeferredModelBanner } from "@/composables/modelConfigDeferred";
import { useI18n } from "vue-i18n";

defineProps<{
  showOnboardingResumeBanner: boolean;
}>();

defineEmits<{
  resumeOnboarding: [];
  snoozeOnboarding: [];
  deferredOpenSettings: [];
  deferredDismiss: [];
}>();

const { t } = useI18n();
</script>

<template>
  <div
    v-if="isDidClawElectron() && showOnboardingResumeBanner"
    class="lc-deferred-model-banner"
    role="status"
  >
    <span class="lc-deferred-model-banner__text">
      {{ t('shell.onboardingIncompleteBanner') }}
    </span>
    <div class="lc-deferred-model-banner__actions">
      <button
        type="button"
        class="lc-btn lc-btn-primary lc-btn-xs"
        @click="$emit('resumeOnboarding')"
      >
        {{ t('shell.onboardingResume') }}
      </button>
      <button
        type="button"
        class="lc-btn lc-btn-ghost lc-btn-xs"
        @click="$emit('snoozeOnboarding')"
      >
        {{ t('shell.onboardingRemindLater') }}
      </button>
    </div>
  </div>
  <div
    v-if="isDidClawElectron() && showDeferredModelBanner"
    class="lc-deferred-model-banner"
    role="status"
  >
    <span class="lc-deferred-model-banner__text">
      {{ t('shell.deferredModelBanner') }}
    </span>
    <div class="lc-deferred-model-banner__actions">
      <button
        type="button"
        class="lc-btn lc-btn-primary lc-btn-xs"
        @click="$emit('deferredOpenSettings')"
      >
        {{ t('shell.deferredModelOpenSettings') }}
      </button>
      <button
        type="button"
        class="lc-btn lc-btn-ghost lc-btn-xs"
        @click="$emit('deferredDismiss')"
      >
        {{ t('shell.deferredModelDone') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.lc-deferred-model-banner {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--lc-border);
  background: var(--lc-bg-raised, var(--lc-surface-panel));
  font-size: 12px;
  line-height: 1.45;
}
.lc-deferred-model-banner__text {
  flex: 1;
  min-width: 200px;
  color: var(--lc-text-muted);
}
.lc-deferred-model-banner__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
