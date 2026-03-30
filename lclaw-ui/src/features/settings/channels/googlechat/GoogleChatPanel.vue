<script setup lang="ts">
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useChannelContext } from "../base/useChannelContext";

const { t } = useI18n();
const { busy, showToast, restartGatewayAndReconnect, onSuccess } = useChannelContext();

const serviceAccountFile = ref("");
const audience = ref("");

async function save(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.writeChannelConfig) return;
  const saf = serviceAccountFile.value.trim();
  const aud = audience.value.trim();
  if (!saf) {
    showToast(t("channel.googlechat.missingCredentials"), true);
    return;
  }
  busy.value = true;
  try {
    const r = await api.writeChannelConfig("googlechat", {
      enabled: true,
      serviceAccountFile: saf,
      audienceType: "project-number",
      ...(aud ? { audience: aud } : {}),
    });
    if (!r.ok) {
      showToast(t("channel.saveFail") + `：${(r as { error: string }).error}`, true);
      return;
    }
    const restarted = await restartGatewayAndReconnect(t("channel.googlechat.restarting"));
    if (restarted) onSuccess?.();
  } catch (e) {
    showToast(t("channel.saveFail") + `：${e}`, true);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="ch-panel">
    <p class="ch-hint">
      {{ t('channel.googlechat.hint') }}
      <a
        :href="t('channel.googlechat.docLink')"
        target="_blank"
        rel="noopener"
        class="ch-link"
      >{{ t('common.docs') }} ↗</a>
    </p>
    <div class="ch-form">
      <label class="ch-label">{{ t('channel.googlechat.serviceAccountFile') }}</label>
      <input
        v-model="serviceAccountFile"
        type="text"
        class="ch-input"
        :placeholder="t('channel.googlechat.serviceAccountFilePlh')"
      >
      <label class="ch-label">{{ t('channel.googlechat.audience') }}</label>
      <input
        v-model="audience"
        type="text"
        class="ch-input"
        :placeholder="t('channel.googlechat.audiencePlh')"
      >
    </div>
    <p class="ch-restart-hint">{{ t('channel.restartHint') }}</p>
    <div class="ch-actions">
      <button
        type="button"
        class="ch-btn ch-btn--primary"
        :disabled="busy"
        @click="save"
      >
        {{ busy ? t('common.saving') : t('channel.saveBtn') }}
      </button>
    </div>
  </div>
</template>
