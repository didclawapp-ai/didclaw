<script setup lang="ts">
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useChannelContext } from "../base/useChannelContext";

const { t } = useI18n();
const { busy, showToast } = useChannelContext();

const token = ref("");

async function save(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.writeChannelConfig) return;
  const tok = token.value.trim();
  if (!tok) {
    showToast("请填写 Bot Token", true);
    return;
  }
  busy.value = true;
  try {
    const r = await api.writeChannelConfig("discord", {
      enabled: true,
      accounts: { main: { token: tok } },
    });
    if (r.ok) {
      showToast(t("channel.saveOk"));
    } else {
      showToast(
        t("channel.saveFail") + `：${(r as { error: string }).error}`,
        true,
      );
    }
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
      {{ t('channel.discord.hint') }}
      <a
        :href="t('channel.discord.docLink')"
        target="_blank"
        rel="noopener"
        class="ch-link"
      >文档 ↗</a>
    </p>
    <div class="ch-form">
      <label class="ch-label">{{ t('channel.discord.token') }}</label>
      <input
        v-model="token"
        type="password"
        class="ch-input"
        :placeholder="t('channel.discord.tokenPlh')"
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
