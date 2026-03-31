<script setup lang="ts">
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useChannelContext } from "../base/useChannelContext";

const { t } = useI18n();
const { busy, showToast, restartGatewayAndReconnect, onSuccess } = useChannelContext();

const channelAccessToken = ref("");
const channelSecret = ref("");

async function save(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.writeChannelConfig) return;
  const cat = channelAccessToken.value.trim();
  const cs = channelSecret.value.trim();
  if (!cat || !cs) {
    showToast(t("channel.line.missingCredentials"), true);
    return;
  }
  busy.value = true;
  try {
    const r = await api.writeChannelConfig("line", {
      enabled: true,
      channelAccessToken: cat,
      channelSecret: cs,
    });
    if (!r.ok) {
      showToast(t("channel.saveFail") + `：${(r as { error: string }).error}`, true);
      return;
    }
    const restarted = await restartGatewayAndReconnect(t("channel.line.restarting"));
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
      {{ t('channel.line.hint') }}
      <a
        :href="t('channel.line.docLink')"
        target="_blank"
        rel="noopener"
        class="ch-link"
      >{{ t('common.docs') }} ↗</a>
    </p>
    <div class="ch-form">
      <label class="ch-label">{{ t('channel.line.accessToken') }}</label>
      <input
        v-model="channelAccessToken"
        type="password"
        class="ch-input"
        :placeholder="t('channel.line.accessTokenPlh')"
      >
      <label class="ch-label">{{ t('channel.line.secret') }}</label>
      <input
        v-model="channelSecret"
        type="password"
        class="ch-input"
        :placeholder="t('channel.line.secretPlh')"
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
