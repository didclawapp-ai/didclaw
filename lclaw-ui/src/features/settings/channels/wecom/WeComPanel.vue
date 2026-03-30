<script setup lang="ts">
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useChannelContext } from "../base/useChannelContext";

const { t } = useI18n();
const { busy, showToast, ensureChannelReady, restartGatewayAndReconnect, onSuccess } = useChannelContext();

const botId = ref("");
const secret = ref("");

const pluginInstalling = ref(false);
const pluginInstalled = ref<boolean | null>(null);
const pluginChecking = ref(false);

const primaryActionLabel = computed(() => {
  if (busy.value || pluginInstalling.value) return t("common.saving");
  return pluginInstalled.value === true
    ? t("channel.wecom.saveAndEnableBtn")
    : t("channel.wecom.installAndSaveBtn");
});

async function refreshPluginInstalled(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.checkChannelPluginInstalled) {
    pluginInstalled.value = null;
    return;
  }
  pluginChecking.value = true;
  try {
    const result = await api.checkChannelPluginInstalled("wecom");
    pluginInstalled.value = result.ok ? result.installed : null;
  } catch {
    pluginInstalled.value = null;
  } finally {
    pluginChecking.value = false;
  }
}

/** Returns true when plugin is installed; installs it first if missing. */
async function ensurePluginInstalled(): Promise<boolean> {
  const api = getDidClawDesktopApi();
  if (api?.checkChannelPluginInstalled) {
    try {
      const state = await api.checkChannelPluginInstalled("wecom");
      if (state.ok) {
        pluginInstalled.value = state.installed;
        if (state.installed) return true;
      }
    } catch {
      /* fall through to install path */
    }
  }
  pluginInstalling.value = true;
  try {
    const ready = await ensureChannelReady("wecom", {
      installPlugin: true,
      installFailureMessage: t("channel.wecom.installFail"),
    });
    if (ready) pluginInstalled.value = true;
    return ready;
  } finally {
    pluginInstalling.value = false;
  }
}

async function save(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.writeChannelConfig) return;
  const bid = botId.value.trim();
  const sec = secret.value.trim();
  if (!bid || !sec) {
    showToast(t("channel.wecom.missingCredentials"), true);
    return;
  }
  busy.value = true;
  try {
    const ready = await ensurePluginInstalled();
    if (!ready) return;

    const r = await api.writeChannelConfig("wecom", {
      enabled: true,
      botId: bid,
      secret: sec,
    });
    if (!r.ok) {
      showToast(t("channel.saveFail") + `：${(r as { error: string }).error}`, true);
      return;
    }

    pluginInstalled.value = true;
    // Gateway must restart to apply new credentials and start the WeCom WebSocket.
    const restarted = await restartGatewayAndReconnect(t("channel.wecom.restarting"));
    if (restarted) {
      onSuccess?.();
    }
  } catch (e) {
    showToast(t("channel.saveFail") + `：${e}`, true);
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  void refreshPluginInstalled();
});
</script>

<template>
  <div class="ch-panel">
    <p class="ch-hint">
      {{ t('channel.wecom.hint') }}
      <a
        :href="t('channel.wecom.docLink')"
        target="_blank"
        rel="noopener"
        class="ch-link"
      >文档 ↗</a>
    </p>

    <div class="ch-install-card">
      <div class="ch-qr-status" style="margin-top: 8px;">
        <span v-if="pluginInstalling" class="ch-status-running">{{ t('channel.pluginInstalling') }}</span>
        <span v-else-if="pluginChecking" class="ch-status-idle">{{ t('channel.wecom.pluginChecking') }}</span>
        <span v-else-if="pluginInstalled === true" class="ch-status-ok">✓ {{ t('channel.wecom.pluginInstalled') }}</span>
        <span v-else-if="pluginInstalled === false" class="ch-status-idle">{{ t('channel.wecom.pluginMissing') }}</span>
        <span v-else class="ch-status-idle">{{ t('channel.wecom.pluginAutoInstall') }}</span>
      </div>
      <p class="ch-restart-hint" style="margin-top: 8px;">
        {{ t('channel.wecom.quickHint') }}
      </p>
    </div>

    <div class="ch-form">
      <label class="ch-label">{{ t('channel.wecom.botId') }}</label>
      <input
        v-model="botId"
        type="text"
        class="ch-input"
        :placeholder="t('channel.wecom.botIdPlh')"
      >
      <label class="ch-label">{{ t('channel.wecom.secret') }}</label>
      <input
        v-model="secret"
        type="password"
        class="ch-input"
        :placeholder="t('channel.wecom.secretPlh')"
      >
    </div>
    <p class="ch-restart-hint">{{ t('channel.restartHint') }}</p>
    <div class="ch-actions">
      <button
        type="button"
        class="ch-btn ch-btn--primary"
        :disabled="busy || pluginInstalling"
        @click="save"
      >
        {{ primaryActionLabel }}
      </button>
    </div>
  </div>
</template>
