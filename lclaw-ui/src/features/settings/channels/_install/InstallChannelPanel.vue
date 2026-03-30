<script setup lang="ts">
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useChannelContext } from "../base/useChannelContext";

const emit = defineEmits<{ "plugin-installed": [channelId: string] }>();

const { t } = useI18n();
const { showToast } = useChannelContext();

// ── Curated plugin list ───────────────────────────────────────────────────────

interface RecommendedPlugin {
  icon: string;
  name: string;
  packageSpec: string;
  channelId: string;
}

// Verified third-party plugins published on ClawHub.
// Only list packages that are confirmed to exist; common channels (Telegram, Slack,
// Discord, etc.) are built into openclaw core and do not need a separate install.
const RECOMMENDED: RecommendedPlugin[] = [];

// ── Install state ─────────────────────────────────────────────────────────────

type InstallState = "idle" | "installing" | "success" | "failed";

const customPkg = ref("");
const installState = ref<InstallState>("idle");
const installingPkg = ref<string | null>(null);
const installError = ref<string | null>(null);

const PKG_RE = /^[@a-z0-9][\w\-./@]*/i;

function validatePkg(spec: string): boolean {
  return PKG_RE.test(spec.trim());
}

async function installPackage(packageSpec: string, channelId?: string): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.openclawPluginsInstall) {
    showToast(t("channel.installNew.noDesktop"), true);
    return;
  }

  const spec = packageSpec.trim();
  if (!validatePkg(spec)) {
    showToast(t("channel.installNew.invalidPkg"), true);
    return;
  }

  installState.value = "installing";
  installingPkg.value = spec;
  installError.value = null;

  try {
    const result = await api.openclawPluginsInstall({ packageSpec: spec });
    if (!result.ok) {
      installState.value = "failed";
      installError.value = (result as { error?: string }).error ?? "unknown error";
      showToast(t("channel.installNew.installFail") + `: ${installError.value}`, true);
      return;
    }
    installState.value = "success";
    const resolvedId = channelId ?? spec.replace(/^.*\//, "").replace(/^openclaw-/, "");
    showToast(t("channel.installNew.installOk"));
    emit("plugin-installed", resolvedId);
  } finally {
    installingPkg.value = null;
  }
}

async function handleCustomInstall(): Promise<void> {
  await installPackage(customPkg.value);
}

function isInstalling(spec: string): boolean {
  return installState.value === "installing" && installingPkg.value === spec;
}

function resetState(): void {
  installState.value = "idle";
  installError.value = null;
  customPkg.value = "";
}
</script>

<template>
  <div class="ch-panel">
    <p class="ch-hint">{{ t("channel.installNew.desc") }}</p>

    <!-- Manual install -->
    <div class="ch-form">
      <label class="ch-label">{{ t("channel.installNew.pkgLabel") }}</label>
      <div class="ch-install-cmd-row">
        <input
          v-model="customPkg"
          type="text"
          class="ch-input"
          :placeholder="t('channel.installNew.pkgPlaceholder')"
          :disabled="installState === 'installing'"
          @keydown.enter="handleCustomInstall"
        >
        <button
          type="button"
          class="ch-btn ch-btn--primary ch-btn--sm"
          :disabled="!customPkg.trim() || installState === 'installing'"
          @click="handleCustomInstall"
        >
          {{ installState === "installing" && !installingPkg?.length
            ? t("channel.installNew.installing")
            : t("channel.installNew.installBtn") }}
        </button>
      </div>
    </div>

    <!-- Success / error feedback -->
    <p v-if="installState === 'success'" class="ch-status-ok">
      ✓ {{ t("channel.installNew.installOk") }}
      <button type="button" class="ch-toggle-manual" @click="resetState">
        {{ t("channel.installNew.installAnother") }}
      </button>
    </p>
    <p v-else-if="installState === 'failed' && installError" class="ch-status-err">
      {{ installError }}
    </p>

    <!-- Recommended plugins -->
    <div class="ch-section-title">{{ t("channel.installNew.recommended") }}</div>
    <div class="ch-rec-list">
      <div
        v-for="plugin in RECOMMENDED"
        :key="plugin.packageSpec"
        class="ch-rec-row"
      >
        <span class="ch-rec-icon" aria-hidden="true">{{ plugin.icon }}</span>
        <span class="ch-rec-name">{{ plugin.name }}</span>
        <code class="ch-code ch-rec-pkg">{{ plugin.packageSpec }}</code>
        <button
          type="button"
          class="ch-btn ch-btn--sm"
          :disabled="installState === 'installing'"
          @click="installPackage(plugin.packageSpec, plugin.channelId)"
        >
          {{ isInstalling(plugin.packageSpec)
            ? t("channel.installNew.installing")
            : t("channel.installNew.installBtn") }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ch-section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--lc-text-muted);
  margin-top: 8px;
}

.ch-rec-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ch-rec-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  background: var(--lc-bg-elevated);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
}

.ch-rec-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.ch-rec-name {
  font-size: 13px;
  font-weight: 500;
  min-width: 60px;
}

.ch-rec-pkg {
  flex: 1;
}
</style>
