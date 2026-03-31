<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useGatewayStore } from "@/stores/gateway";
import { storeToRefs } from "pinia";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
  "update:modelValue": [v: boolean];
  openDiagnostics: [];
  copySupportInfo: [];
}>();

const { t } = useI18n();
const gw = useGatewayStore();
const { helloInfo } = storeToRefs(gw);

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
  { name: "Tauri 2",     href: "https://tauri.app" },
  { name: "Vue 3",       href: "https://vuejs.org" },
  { name: "TypeScript",  href: "https://www.typescriptlang.org" },
  { name: "OpenClaw",    href: "https://openclaw.ai" },
  { name: "Vite",        href: "https://vitejs.dev" },
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

          <!-- ── hero ── -->
          <div class="about-hero">
            <div class="about-hero-logo-wrap">
              <img src="/icon-128.png" class="about-hero-logo" alt="DidClaw" />
            </div>
            <h1 class="about-hero-name">DidClaw</h1>
            <p class="about-hero-tagline">{{ t('about.desc') }}</p>
          </div>

          <div class="about-body">

            <!-- ── versions ── -->
            <div class="about-card">
              <div class="about-row">
                <span class="about-row-label">{{ t('about.appVersion') }}</span>
                <code class="about-badge">{{ appVersion }}</code>
              </div>
              <div class="about-row">
                <span class="about-row-label">{{ t('about.gatewayVersion') }}</span>
                <code class="about-badge" :class="{ 'about-badge--dim': !gatewayVersion }">
                  {{ gatewayVersion ?? t('about.gatewayNotConnected') }}
                </code>
              </div>
            </div>

            <!-- ── contact ── -->
            <div class="about-card">
              <div class="about-row">
                <span class="about-row-label">{{ t('about.website') }}</span>
                <a href="https://didclawapp.com" target="_blank" rel="noopener noreferrer" class="about-row-link">
                  didclawapp.com
                </a>
              </div>
              <div class="about-row">
                <span class="about-row-label">{{ t('about.email') }}</span>
                <a href="mailto:didclawapp@gmail.com" class="about-row-link">
                  didclawapp@gmail.com
                </a>
              </div>
            </div>

            <!-- ── tech stack ── -->
            <div class="about-stack">
              <a
                v-for="item in techStack"
                :key="item.name"
                :href="item.href"
                target="_blank"
                rel="noopener noreferrer"
                class="about-chip"
              >{{ item.name }}</a>
            </div>

            <!-- ── links ── -->
            <div class="about-links">
              <a
                href="https://github.com/OpenClaw-AI/didclaw"
                target="_blank" rel="noopener noreferrer"
                class="about-link-btn"
              >
                <svg viewBox="0 0 24 24" class="about-link-icon" aria-hidden="true" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.5.5.09.68-.22.68-.48v-1.7C6.73 19.91 6.14 18 6.14 18c-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.56 9.56 0 0 1 12 6.8c.85 0 1.71.11 2.51.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.85-2.34 4.7-4.57 4.95.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10.01 10.01 0 0 0 22 12c0-5.52-4.48-10-10-10z"/>
                </svg>
                GitHub
              </a>
              <a
                href="https://didclawapp.com"
                target="_blank" rel="noopener noreferrer"
                class="about-link-btn"
              >
                <svg viewBox="0 0 24 24" class="about-link-icon" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                </svg>
                didclawapp.com
              </a>
              <a
                href="https://docs.openclaw.ai"
                target="_blank" rel="noopener noreferrer"
                class="about-link-btn"
              >
                <svg viewBox="0 0 24 24" class="about-link-icon" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
                </svg>
                {{ t('about.docs') }}
              </a>
            </div>

            <!-- ── diagnostics ── -->
            <div class="about-support">
              <p class="about-support-title">{{ t('about.supportTitle') }}</p>
              <p class="about-support-desc">{{ t('about.supportDesc') }}</p>
              <div class="about-support-actions">
                <button type="button" class="about-support-btn" @click="emit('openDiagnostics')">
                  {{ t('about.runDiagnostics') }}
                </button>
                <button type="button" class="about-support-btn about-support-btn--ghost" @click="emit('copySupportInfo')">
                  {{ t('about.copySupportInfo') }}
                </button>
              </div>
            </div>

          </div><!-- /body -->

          <!-- ── footer ── -->
          <p class="about-footer">© {{ currentYear }} DidClaw · Open source, built with ❤️</p>

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
  border-radius: 18px;
  box-shadow: 0 24px 72px rgba(0, 0, 0, 0.35);
  width: 100%;
  max-width: 380px;
  overflow: hidden;
  font-family: var(--lc-font);
  color: var(--lc-text);
}

/* close */
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
  padding: 28px 24px 20px;
  background: linear-gradient(160deg,
    color-mix(in srgb, var(--lc-accent) 10%, transparent) 0%,
    transparent 65%
  );
  border-bottom: 1px solid var(--lc-border);
  text-align: center;
  gap: 6px;
}
.about-hero-logo-wrap {
  width: 72px;
  height: 72px;
  border-radius: 16px;
  overflow: hidden;
  margin-bottom: 6px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
  flex-shrink: 0;
}
.about-hero-logo {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.about-hero-name {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--lc-text);
}
.about-hero-tagline {
  margin: 0;
  font-size: 12px;
  color: var(--lc-text-muted);
  line-height: 1.55;
  max-width: 260px;
}

/* body padding container */
.about-body {
  padding: 16px 16px 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* generic card */
.about-card {
  background: var(--lc-bg-raised);
  border: 1px solid var(--lc-border);
  border-radius: 11px;
  overflow: hidden;
}
.about-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 14px;
  gap: 8px;
}
.about-row + .about-row {
  border-top: 1px solid var(--lc-border);
}
.about-row-label {
  font-size: 13px;
  color: var(--lc-text-muted);
  flex-shrink: 0;
}
.about-badge {
  font-family: var(--lc-mono, monospace);
  font-size: 12px;
  color: var(--lc-accent);
  background: color-mix(in srgb, var(--lc-accent) 12%, transparent);
  padding: 2px 8px;
  border-radius: 5px;
  letter-spacing: 0.01em;
}
.about-badge--dim {
  color: var(--lc-text-dim, var(--lc-text-muted));
  background: transparent;
}
.about-row-link {
  font-size: 12px;
  color: var(--lc-accent);
  text-decoration: none;
  transition: opacity 0.12s;
  text-align: right;
  word-break: break-all;
}
.about-row-link:hover {
  opacity: 0.75;
  text-decoration: underline;
}

/* tech stack chips */
.about-stack {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.about-chip {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 20px;
  border: 1px solid var(--lc-border);
  color: var(--lc-text-muted);
  background: transparent;
  text-decoration: none;
  transition: border-color 0.12s, color 0.12s, background 0.12s;
}
.about-chip:hover {
  border-color: var(--lc-accent);
  color: var(--lc-accent);
  background: color-mix(in srgb, var(--lc-accent) 8%, transparent);
}

/* links row */
.about-links {
  display: flex;
  gap: 8px;
}
.about-link-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 500;
  padding: 7px 8px;
  border-radius: 9px;
  border: 1px solid var(--lc-border);
  color: var(--lc-text-muted);
  background: transparent;
  text-decoration: none;
  transition: border-color 0.12s, color 0.12s, background 0.12s;
  font-family: inherit;
  white-space: nowrap;
}
.about-link-btn:hover {
  border-color: var(--lc-border-strong);
  color: var(--lc-text);
  background: var(--lc-bg-elevated, var(--lc-bg-raised));
}
.about-link-icon {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}

/* support */
.about-support {
  padding: 14px;
  border: 1px solid var(--lc-border);
  border-radius: 11px;
  background: var(--lc-bg-raised);
}
.about-support-title {
  margin: 0 0 4px;
  font-size: 13px;
  font-weight: 700;
  color: var(--lc-text);
}
.about-support-desc {
  margin: 0 0 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--lc-text-muted);
}
.about-support-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.about-support-btn {
  border: 1px solid color-mix(in srgb, var(--lc-accent) 24%, var(--lc-border));
  background: color-mix(in srgb, var(--lc-accent) 10%, var(--lc-bg-raised));
  color: var(--lc-text);
  border-radius: 9px;
  padding: 7px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
  font-family: inherit;
}
.about-support-btn:hover {
  border-color: var(--lc-accent);
  background: color-mix(in srgb, var(--lc-accent) 18%, var(--lc-bg-raised));
}
.about-support-btn--ghost {
  background: transparent;
  border-color: var(--lc-border);
  color: var(--lc-text-muted);
}
.about-support-btn--ghost:hover {
  border-color: var(--lc-border-strong);
  color: var(--lc-text);
  background: var(--lc-bg-elevated, var(--lc-bg-raised));
}

/* footer */
.about-footer {
  font-size: 11px;
  color: var(--lc-text-dim, var(--lc-text-muted));
  text-align: center;
  padding: 14px 20px 16px;
  margin: 16px 0 0;
  border-top: 1px solid var(--lc-border);
  opacity: 0.6;
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
