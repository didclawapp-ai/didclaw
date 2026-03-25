<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useGatewayStore } from "@/stores/gateway";
import { storeToRefs } from "pinia";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [v: boolean] }>();

const { t } = useI18n();
const gw = useGatewayStore();
const { helloInfo } = storeToRefs(gw);

/** 从 "Gateway 2026.3.23-2" 提取版本号部分 */
const gatewayVersion = computed(() => {
  const info = helloInfo.value;
  if (!info) return null;
  const m = info.match(/Gateway\s+(.+)/i);
  return m ? m[1].trim() : info;
});

const open = computed({
  get: () => props.modelValue,
  set: (v) => emit("update:modelValue", v),
});

const appVersion = __APP_VERSION__;

const currentYear = new Date().getFullYear();

const techStack = [
  { name: "Tauri 2", href: "https://tauri.app" },
  { name: "Vue 3", href: "https://vuejs.org" },
  { name: "TypeScript", href: "https://www.typescriptlang.org" },
  { name: "OpenClaw", href: "https://openclaw.ai" },
  { name: "Vite", href: "https://vitejs.dev" },
];
</script>

<template>
  <Teleport to="body">
    <Transition name="about-fade">
      <div v-if="open" class="about-backdrop" @click.self="open = false">
        <div class="about-dialog" role="dialog" :aria-label="t('about.title')">
          <!-- 头部 -->
          <div class="about-header">
            <div class="about-brand">
              <span class="about-glyph" aria-hidden="true" />
              <span class="about-name">DidClaw</span>
            </div>
            <button
              type="button"
              class="about-close"
              :aria-label="t('about.close')"
              @click="open = false"
            >✕</button>
          </div>

          <!-- 简介 -->
          <p class="about-desc">{{ t('about.desc') }}</p>

          <!-- 版本信息 -->
          <div class="about-section">
            <div class="about-row">
              <span class="about-label">{{ t('about.appVersion') }}</span>
              <code class="about-value">{{ appVersion }}</code>
            </div>
            <div class="about-row">
              <span class="about-label">{{ t('about.gatewayVersion') }}</span>
              <code
                class="about-value"
                :class="{ 'about-value--muted': !gatewayVersion }"
              >{{ gatewayVersion ?? t('about.gatewayNotConnected') }}</code>
            </div>
          </div>

          <!-- 技术栈 -->
          <div class="about-section">
            <p class="about-section-title">{{ t('about.techStack') }}</p>
            <div class="about-chips">
              <span
                v-for="item in techStack"
                :key="item.name"
                class="about-chip"
              >{{ item.name }}</span>
            </div>
          </div>

          <!-- 版权 -->
          <p class="about-copyright">
            © {{ currentYear }} DidClaw. Open source, built with ❤️
          </p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.about-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10060;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.about-dialog {
  background: var(--lc-surface, #fff);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-md, 12px);
  box-shadow: var(--lc-shadow-xl, 0 20px 60px rgba(0,0,0,0.25));
  width: 100%;
  max-width: 360px;
  padding: 24px 24px 20px;
  font-family: var(--lc-font);
  color: var(--lc-text);
}

/* 头部 */
.about-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.about-brand {
  display: flex;
  align-items: center;
  gap: 8px;
}
.about-glyph {
  display: inline-block;
  width: 28px;
  height: 28px;
  background: var(--lc-brand-glyph-url, url('/favicon.svg')) center / contain no-repeat;
  flex-shrink: 0;
}
.about-name {
  font-size: 1.2rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--lc-accent);
}
.about-close {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--lc-text-muted);
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s, color 0.12s;
}
.about-close:hover {
  background: var(--lc-bg-hover);
  color: var(--lc-text);
}

/* 简介 */
.about-desc {
  font-size: 13px;
  color: var(--lc-text);
  margin: 0 0 16px;
  line-height: 1.6;
}

/* 信息区块 */
.about-section {
  background: var(--lc-bg-secondary, var(--lc-bg-raised));
  border-radius: var(--lc-radius-sm);
  padding: 10px 12px;
  margin-bottom: 12px;
}
.about-section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--lc-text-muted);
  margin: 0 0 8px;
}
.about-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 3px 0;
}
.about-row + .about-row {
  border-top: 1px solid var(--lc-border);
  margin-top: 3px;
  padding-top: 6px;
}
.about-label {
  font-size: 13px;
  color: var(--lc-text-muted);
}
.about-value {
  font-family: var(--lc-mono, monospace);
  font-size: 12px;
  color: var(--lc-accent);
  background: var(--lc-bg-elevated, var(--lc-bg-raised));
  padding: 2px 7px;
  border-radius: 4px;
}
.about-value--muted {
  color: var(--lc-text-muted);
}

/* 技术栈 chips */
.about-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.about-chip {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 20px;
  border: 1px solid var(--lc-border);
  color: var(--lc-text-muted);
  background: transparent;
}

/* 版权 */
.about-copyright {
  font-size: 11px;
  color: var(--lc-text-muted);
  text-align: center;
  margin: 4px 0 0;
}

/* 动画 */
.about-fade-enter-active,
.about-fade-leave-active {
  transition: opacity 0.15s ease;
}
.about-fade-enter-active .about-dialog,
.about-fade-leave-active .about-dialog {
  transition: transform 0.15s ease, opacity 0.15s ease;
}
.about-fade-enter-from,
.about-fade-leave-to {
  opacity: 0;
}
.about-fade-enter-from .about-dialog {
  transform: scale(0.95) translateY(8px);
}
.about-fade-leave-to .about-dialog {
  transform: scale(0.95);
  opacity: 0;
}
</style>
