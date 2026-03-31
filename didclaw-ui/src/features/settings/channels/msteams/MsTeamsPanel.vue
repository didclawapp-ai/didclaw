<script setup lang="ts">
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useChannelContext } from "../base/useChannelContext";

const { t } = useI18n();
const { busy, showToast, restartGatewayAndReconnect, onSuccess } = useChannelContext();

const appId = ref("");
const appPassword = ref("");

async function save(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.writeChannelConfig) return;
  const id = appId.value.trim();
  const pw = appPassword.value.trim();
  if (!id || !pw) {
    showToast(t("channel.msteams.missingCredentials"), true);
    return;
  }
  busy.value = true;
  try {
    const r = await api.writeChannelConfig("msteams", {
      enabled: true,
      appId: id,
      appPassword: pw,
    });
    if (!r.ok) {
      showToast(t("channel.saveFail") + `：${(r as { error: string }).error}`, true);
      return;
    }
    const restarted = await restartGatewayAndReconnect(t("channel.msteams.restarting"));
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
      {{ t('channel.msteams.hint') }}
      <a
        :href="t('channel.msteams.docLink')"
        target="_blank"
        rel="noopener"
        class="ch-link"
      >{{ t('common.docs') }} ↗</a>
    </p>
    <div class="ch-form">
      <label class="ch-label">{{ t('channel.msteams.appId') }}</label>
      <input
        v-model="appId"
        type="text"
        class="ch-input"
        :placeholder="t('channel.msteams.appIdPlh')"
      >
      <label class="ch-label">{{ t('channel.msteams.appPassword') }}</label>
      <input
        v-model="appPassword"
        type="password"
        class="ch-input"
        :placeholder="t('channel.msteams.appPasswordPlh')"
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
