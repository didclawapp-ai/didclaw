<script setup lang="ts">
import { RouterLink } from "vue-router";
import { useI18n } from "vue-i18n";
import { computed } from "vue";
import { i18n, type LocaleCode } from "@/i18n";
import { useLocalSettingsStore } from "@/stores/localSettings";

const { t } = useI18n();
const appVersion = __APP_VERSION__;
const localSettings = useLocalSettingsStore();
const currentLocale = computed({
  get: () => (i18n.global.locale as { value: LocaleCode }).value,
  set: (v: LocaleCode) => localSettings.switchLocale(v),
});
</script>

<template>
  <div class="about">
    <header class="bar">
      <RouterLink to="/" class="lc-btn lc-btn-ghost lc-btn-sm back">{{ t('about.backToChat') }}</RouterLink>
      <h1 class="title">{{ t('about.title') }}</h1>
      <div class="locale-switcher" :aria-label="t('settings.languageLabel')">
        <button
          type="button"
          class="locale-btn"
          :class="{ active: currentLocale === 'zh' }"
          :aria-pressed="currentLocale === 'zh'"
          @click="currentLocale = 'zh'"
        >中</button>
        <button
          type="button"
          class="locale-btn"
          :class="{ active: currentLocale === 'en' }"
          :aria-pressed="currentLocale === 'en'"
          @click="currentLocale = 'en'"
        >EN</button>
      </div>
    </header>
    <div class="card">
      <p class="ver">{{ t('about.version') }} <code>{{ appVersion }}</code></p>
      <p>
        {{ t('about.desc') }}
      </p>
      <p class="muted">{{ t('about.desktopNote') }}</p>
      <p class="muted">{{ t('about.devNote') }}</p>
      <p class="muted">{{ t('about.envNote') }}</p>
    </div>
  </div>
</template>

<style scoped>
.about {
  min-height: 100vh;
  padding: 20px 24px 32px;
  font-family: var(--lc-font);
  color: var(--lc-text);
  box-sizing: border-box;
}
.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  margin-bottom: 20px;
}
.back {
  text-decoration: none;
}
.title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.card {
  max-width: 640px;
  padding: 20px 22px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-raised);
  line-height: 1.6;
  font-size: 14px;
}
.card p {
  margin: 0 0 12px;
}
.card p:last-child {
  margin-bottom: 0;
}
.ver code {
  font-family: var(--lc-mono);
  font-size: 0.95em;
  color: var(--lc-accent);
}
.muted {
  color: var(--lc-text-muted);
  font-size: 13px;
}
.locale-switcher {
  display: flex;
  gap: 4px;
  margin-left: auto;
}
.locale-btn {
  padding: 3px 10px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: transparent;
  color: var(--lc-text-muted);
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.locale-btn.active {
  background: var(--lc-accent-soft);
  border-color: var(--lc-accent);
  color: var(--lc-accent);
}
.locale-btn:hover:not(.active) {
  border-color: var(--lc-border-strong);
  color: var(--lc-text);
}
.card code {
  font-family: var(--lc-mono);
  font-size: 12px;
  background: var(--lc-bg-elevated);
  padding: 2px 6px;
  border-radius: 4px;
}
</style>
