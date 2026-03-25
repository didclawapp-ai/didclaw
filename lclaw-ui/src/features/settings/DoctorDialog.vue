<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import DoctorPanel from "@/features/settings/DoctorPanel.vue";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [v: boolean] }>();

const { t } = useI18n();

const open = computed({
  get: () => props.modelValue,
  set: (v) => emit("update:modelValue", v),
});
</script>

<template>
  <Teleport to="body">
    <Transition name="doctor-fade">
      <div v-if="open" class="doctor-backdrop" @click.self="open = false">
        <div class="doctor-dialog" role="dialog" :aria-label="t('doctor.title')">
          <div class="doctor-dialog-header">
            <span class="doctor-dialog-title">🩺 {{ t('doctor.title') }}</span>
            <button
              type="button"
              class="doctor-dialog-close"
              :aria-label="t('common.close')"
              @click="open = false"
            >✕</button>
          </div>
          <div class="doctor-dialog-body">
            <DoctorPanel />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.doctor-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10060;
}

.doctor-dialog {
  /* 与 AboutDialog 一致：勿用未定义的 --lc-bg，否则背景无效呈透明 */
  background: var(--lc-surface, #ffffff);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-lg, 12px);
  box-shadow: var(--lc-shadow-xl, 0 20px 60px rgba(0, 0, 0, 0.25));
  width: 480px;
  max-width: calc(100vw - 32px);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--lc-text);
}

.doctor-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--lc-border);
  flex-shrink: 0;
}

.doctor-dialog-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--lc-text);
}

.doctor-dialog-close {
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
.doctor-dialog-close:hover {
  background: var(--lc-red-soft, color-mix(in srgb, var(--lc-red) 12%, transparent));
  color: var(--lc-red);
}

.doctor-dialog-body {
  padding: 16px;
  overflow-y: auto;
  flex: 1;
}

/* 过渡动画 */
.doctor-fade-enter-active,
.doctor-fade-leave-active {
  transition: opacity 0.15s ease;
}
.doctor-fade-enter-from,
.doctor-fade-leave-to {
  opacity: 0;
}
</style>
