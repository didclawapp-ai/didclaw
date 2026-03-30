<script setup lang="ts">
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useChannelContext } from "../base/useChannelContext";

const { t } = useI18n();
const { busy, showToast, restartGatewayAndReconnect, onSuccess } = useChannelContext();

const botToken = ref("");
const appToken = ref("");

async function save(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.writeChannelConfig) return;
  const bt = botToken.value.trim();
  const at = appToken.value.trim();
  if (!bt || !at) {
    showToast(t("channel.slack.missingCredentials"), true);
    return;
  }
  busy.value = true;
  try {
    const r = await api.writeChannelConfig("slack", {
      enabled: true,
      botToken: bt,
      appToken: at,
    });
    if (!r.ok) {
      showToast(t("channel.saveFail") + `：${(r as { error: string }).error}`, true);
      return;
    }
    const restarted = await restartGatewayAndReconnect(t("channel.slack.restarting"));
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
      {{ t('channel.slack.hint') }}
      <a
        :href="t('channel.slack.docLink')"
        target="_blank"
        rel="noopener"
        class="ch-link"
      >{{ t('common.docs') }} ↗</a>
    </p>
    <div class="ch-form">
      <label class="ch-label">{{ t('channel.slack.botToken') }}</label>
      <input
        v-model="botToken"
        type="password"
        class="ch-input"
        :placeholder="t('channel.slack.botTokenPlh')"
      >
      <label class="ch-label">{{ t('channel.slack.appToken') }}</label>
      <input
        v-model="appToken"
        type="password"
        class="ch-input"
        :placeholder="t('channel.slack.appTokenPlh')"
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
