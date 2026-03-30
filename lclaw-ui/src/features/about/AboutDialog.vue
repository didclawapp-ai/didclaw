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

          <!-- close -->
          <button
            type="button"
            class="about-close"
            :aria-label="t('about.close')"
            @click="open = false"
          >✕</button>

          <!-- hero -->
          <div class="about-hero">
            <span class="about-hero-glyph" aria-hidden="true" />
            <h1 class="about-hero-name">DidClaw</h1>
            <p class="about-hero-tagline">{{ t('about.desc') }}</p>
          </div>

          <!-- versions -->
          <div class="about-versions">
            <div class="about-ver-row">
              <span class="about-ver-label">{{ t('about.appVersion') }}</span>
              <code class="about-ver-badge">{{ appVersion }}</code>
            </div>
            <div class="about-ver-row">
              <span class="about-ver-label">{{ t('about.gatewayVersion') }}</span>
              <code
                class="about-ver-badge"
                :class="{ 'about-ver-badge--dim': !gatewayVersion }"
              >{{ gatewayVersion ?? t('about.gatewayNotConnected') }}</code>
            </div>
          </div>

          <!-- tech stack -->
          <div class="about-stack">
            <a
              v-for="item in techStack"
              :key="item.name"
              :href="item.href"
              target="_blank"
              rel="noopener noreferrer"
              class="about-stack-chip"
            >{{ item.name }}</a>
          </div>

          <!-- links -->
          <div class="about-links">
            <a href="https://github.com/OpenClaw-AI/didclaw" target="_blank" rel="noopener noreferrer" class="about-link-btn">
              GitHub
            </a>
            <a href="https://openclaw.ai" target="_blank" rel="noopener noreferrer" class="about-link-btn">
              openclaw.ai
            </a>
            <a href="https://docs.openclaw.ai" target="_blank" rel="noopener noreferrer" class="about-link-btn">
              {{ t('about.docs') }}
            </a>
          </div>

          <!-- copyright -->
          <p class="about-copyright">© {{ currentYear }} DidClaw · Open source, built with ❤️</p>
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
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.about-dialog {
  position: relative;
  background: var(--lc-surface-panel, var(--lc-surface, #1e1e1e));
  border: 1px solid var(--lc-border);
  border-radius: 16px;
  box-shadow: 0 24px 72px rgba(0, 0, 0, 0.35);
  width: 100%;
  max-width: 360px;
  overflow: hidden;
  font-family: var(--lc-font);
  color: var(--lc-text);
}

/* close button */
.about-close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  border: none;
  background: transparent;
  color: var(--lc-text-muted);
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s, color 0.12s;
  z-index: 1;
}
.about-close:hover {
  background: var(--lc-bg-hover);
  color: var(--lc-text);
}

/* hero */
.about-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 24px 24px;
  background: linear-gradient(160deg,
    color-mix(in srgb, var(--lc-accent) 14%, transparent) 0%,
    transparent 70%
  );
  border-bottom: 1px solid var(--lc-border);
  text-align: center;
  gap: 8px;
}
.about-hero-glyph {
  display: block;
  width: 52px;
  height: 52px;
  background: var(--lc-brand-glyph-url, url('/favicon.svg')) center / contain no-repeat;
  margin-bottom: 4px;
  filter: drop-shadow(0 4px 12px color-mix(in srgb, var(--lc-accent) 40%, transparent));
}
.about-hero-name {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--lc-text);
}
.about-hero-tagline {
  margin: 0;
  font-size: 12px;
  color: var(--lc-text-muted);
  line-height: 1.5;
  max-width: 260px;
}

/* versions */
.about-versions {
  margin: 16px 20px 0;
  background: var(--lc-bg-raised);
  border: 1px solid var(--lc-border);
  border-radius: 10px;
  overflow: hidden;
}
.about-ver-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 14px;
}
.about-ver-row + .about-ver-row {
  border-top: 1px solid var(--lc-border);
}
.about-ver-label {
  font-size: 13px;
  color: var(--lc-text-muted);
}
.about-ver-badge {
  font-family: var(--lc-mono, monospace);
  font-size: 12px;
  color: var(--lc-accent);
  background: color-mix(in srgb, var(--lc-accent) 12%, transparent);
  padding: 2px 8px;
  border-radius: 5px;
  letter-spacing: 0.01em;
}
.about-ver-badge--dim {
  color: var(--lc-text-dim);
  background: transparent;
}

/* tech stack */
.about-stack {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 14px 20px 0;
}
.about-stack-chip {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 20px;
  border: 1px solid var(--lc-border);
  color: var(--lc-text-muted);
  background: transparent;
  text-decoration: none;
  transition: border-color 0.12s, color 0.12s, background 0.12s;
}
.about-stack-chip:hover {
  border-color: var(--lc-accent);
  color: var(--lc-accent);
  background: color-mix(in srgb, var(--lc-accent) 8%, transparent);
}

/* external links */
.about-links {
  display: flex;
  gap: 8px;
  padding: 12px 20px 0;
}
.about-link-btn {
  flex: 1;
  text-align: center;
  font-size: 12px;
  font-weight: 500;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--lc-border);
  color: var(--lc-text-muted);
  background: transparent;
  text-decoration: none;
  transition: border-color 0.12s, color 0.12s, background 0.12s;
  font-family: inherit;
}
.about-link-btn:hover {
  border-color: var(--lc-border-strong);
  color: var(--lc-text);
  background: var(--lc-bg-elevated);
}

/* copyright */
.about-copyright {
  font-size: 11px;
  color: var(--lc-text-dim);
  text-align: center;
  padding: 14px 20px 18px;
  margin: 0;
}

/* animation */
.about-fade-enter-active,
.about-fade-leave-active {
  transition: opacity 0.18s ease;
}
.about-fade-enter-active .about-dialog,
.about-fade-leave-active .about-dialog {
  transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.18s ease;
}
.about-fade-enter-from,
.about-fade-leave-to {
  opacity: 0;
}
.about-fade-enter-from .about-dialog {
  transform: scale(0.93) translateY(10px);
  opacity: 0;
}
.about-fade-leave-to .about-dialog {
  transform: scale(0.96);
  opacity: 0;
}
</style>
