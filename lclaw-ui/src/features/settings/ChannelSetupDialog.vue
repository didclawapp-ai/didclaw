<script setup lang="ts">
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import { useGatewayStore } from "@/stores/gateway";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { computed, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [v: boolean] }>();
const { t } = useI18n();
const gwStore = useGatewayStore();

const open = computed({
  get: () => props.modelValue,
  set: (v) => emit("update:modelValue", v),
});

// ── Tab state ────────────────────────────────────────────────────────────────

type ChannelId = "whatsapp" | "feishu" | "discord" | "wecom";
const activeTab = ref<ChannelId>("whatsapp");

const tabs: { id: ChannelId; icon: string }[] = [
  { id: "whatsapp", icon: "💬" },
  { id: "feishu",   icon: "🪶" },
  { id: "discord",  icon: "🎮" },
  { id: "wecom",    icon: "💼" },
];

// ── Shared ────────────────────────────────────────────────────────────────────

const busy = ref(false);
const toast = ref<string | null>(null);
const toastError = ref(false);

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(msg: string, error = false): void {
  toast.value = msg;
  toastError.value = error;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = null; }, 5000);
}

function closeDialog(): void { open.value = false; }

// ── Credential channels (Feishu, Discord, WeCom) ─────────────────────────────

const feishuAppId = ref("");
const feishuAppSecret = ref("");
const discordToken = ref("");
const wecomBotId = ref("");
const wecomSecret = ref("");

// WeCom plugin install
const wecomPluginInstalling = ref(false);

async function installWecomPlugin(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.openclawPluginsInstall) return;
  wecomPluginInstalling.value = true;
  try {
    const r = await api.openclawPluginsInstall({ packageSpec: t("channel.wecom.pluginSpec") });
    if (r.ok) {
      showToast(t("channel.pluginInstallOk"));
    } else {
      showToast(t("channel.pluginInstallFail") + (r.error ? `：${r.error}` : ""), true);
    }
  } catch (e) {
    showToast(t("channel.pluginInstallFail") + `：${e}`, true);
  } finally {
    wecomPluginInstalling.value = false;
  }
}

async function saveCredentialChannel(channelKey: ChannelId): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.writeChannelConfig) return;

  let payload: Record<string, unknown> = {};
  if (channelKey === "feishu") {
    const appId = feishuAppId.value.trim();
    const appSecret = feishuAppSecret.value.trim();
    if (!appId || !appSecret) { showToast("请填写 App ID 和 App Secret", true); return; }
    payload = { accounts: { main: { appId, appSecret } } };
  } else if (channelKey === "discord") {
    const token = discordToken.value.trim();
    if (!token) { showToast("请填写 Bot Token", true); return; }
    payload = { accounts: { main: { token } } };
  } else if (channelKey === "wecom") {
    const botId = wecomBotId.value.trim();
    const secret = wecomSecret.value.trim();
    if (!botId || !secret) { showToast("请填写 Bot ID 和 Secret", true); return; }
    payload = { accounts: { main: { botId, secret } } };
  }

  busy.value = true;
  try {
    const r = await api.writeChannelConfig(channelKey, payload);
    if (r.ok) {
      showToast(t("channel.saveOk"));
    } else {
      showToast(t("channel.saveFail") + `：${(r as { error: string }).error}`, true);
    }
  } catch (e) {
    showToast(t("channel.saveFail") + `：${e}`, true);
  } finally {
    busy.value = false;
  }
}

// ── WhatsApp QR flow ──────────────────────────────────────────────────────────

type QrState = "idle" | "running" | "success" | "failed";
const qrState = ref<QrState>("idle");
const qrLines = ref<string[]>([]);
const qrUrl = ref<string | null>(null);
const qrImgError = ref(false);

let unlistenLine: UnlistenFn | null = null;
let unlistenQr: UnlistenFn | null = null;
let unlistenDone: UnlistenFn | null = null;

async function setupListeners(): Promise<void> {
  cleanupListeners();
  unlistenLine = await listen<{ stream: string; line: string }>("channel:line", (e) => {
    qrLines.value = [...qrLines.value, e.payload.line];
    // Auto-scroll: keep last 200 lines
    if (qrLines.value.length > 200) {
      qrLines.value = qrLines.value.slice(-200);
    }
  });
  unlistenQr = await listen<{ url: string }>("channel:qr", (e) => {
    qrUrl.value = e.payload.url;
    qrImgError.value = false;
  });
  unlistenDone = await listen<{ ok: boolean; exitCode?: number; error?: string }>(
    "channel:done",
    (e) => {
      qrState.value = e.payload.ok ? "success" : "failed";
    },
  );
}

function cleanupListeners(): void {
  unlistenLine?.(); unlistenLine = null;
  unlistenQr?.(); unlistenQr = null;
  unlistenDone?.(); unlistenDone = null;
}

async function startWhatsAppQr(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.startChannelQrFlow) return;

  qrState.value = "running";
  qrLines.value = [];
  qrUrl.value = null;
  qrImgError.value = false;

  await setupListeners();

  try {
    const gatewayUrl = gwStore.url.replace("ws://", "http://").replace("wss://", "https://");
    await api.startChannelQrFlow("whatsapp", gatewayUrl);
  } catch (e) {
    qrState.value = "failed";
    qrLines.value = [...qrLines.value, `Error: ${e}`];
  } finally {
    cleanupListeners();
  }
}

function resetQr(): void {
  qrState.value = "idle";
  qrLines.value = [];
  qrUrl.value = null;
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

watch(
  () => props.modelValue,
  (v) => {
    if (!v) {
      cleanupListeners();
      toast.value = null;
      resetQr();
    }
  },
);

onUnmounted(() => {
  cleanupListeners();
  if (toastTimer) clearTimeout(toastTimer);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="ch-fade">
      <div v-if="open" class="ch-backdrop" @click.self="closeDialog">
        <div class="ch-dialog" role="dialog" :aria-label="t('channel.title')">
          <!-- Header -->
          <div class="ch-header">
            <span class="ch-title">{{ t('channel.title') }}</span>
            <button type="button" class="ch-close" :aria-label="t('common.close')" @click="closeDialog">×</button>
          </div>
          <p class="ch-desc">{{ t('channel.desc') }}</p>

          <!-- Tabs -->
          <div class="ch-tabs" role="tablist">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              type="button"
              role="tab"
              class="ch-tab"
              :class="{ 'ch-tab--active': activeTab === tab.id }"
              :aria-selected="activeTab === tab.id"
              @click="activeTab = tab.id"
            >
              <span aria-hidden="true">{{ tab.icon }}</span>
              {{ t(`channel.${tab.id}.name`) }}
            </button>
          </div>

          <!-- Toast -->
          <p v-if="toast" class="ch-toast" :class="{ 'ch-toast--error': toastError }">{{ toast }}</p>

          <!-- ── WhatsApp ── -->
          <div v-if="activeTab === 'whatsapp'" class="ch-panel">
            <p class="ch-hint">{{ t('channel.whatsapp.hint') }}
              <a :href="t('channel.whatsapp.docLink')" target="_blank" rel="noopener" class="ch-link">文档 ↗</a>
            </p>

            <!-- QR image (if URL found in output) -->
            <div v-if="qrUrl && !qrImgError" class="ch-qr-wrap">
              <img
                :src="qrUrl"
                class="ch-qr-img"
                alt="WhatsApp QR code"
                @error="qrImgError = true"
              />
            </div>

            <!-- Status -->
            <div class="ch-qr-status">
              <span v-if="qrState === 'idle'" class="ch-status-idle">准备就绪</span>
              <span v-else-if="qrState === 'running'" class="ch-status-running">{{ t('channel.qrWaiting') }}</span>
              <span v-else-if="qrState === 'success'" class="ch-status-ok">✓ {{ t('channel.qrSuccess') }}</span>
              <span v-else class="ch-status-err">✗ {{ t('channel.qrFail') }}</span>
            </div>

            <!-- Terminal output -->
            <div v-if="qrLines.length" class="ch-terminal">
              <div class="ch-terminal-head">{{ t('channel.qrOutputLabel') }}</div>
              <pre class="ch-terminal-body"><template v-for="(ln, i) in qrLines" :key="i">{{ ln }}
</template></pre>
            </div>

            <div class="ch-actions">
              <button
                v-if="qrState === 'idle' || qrState === 'failed'"
                type="button"
                class="ch-btn ch-btn--primary"
                @click="startWhatsAppQr"
              >{{ t('channel.qrStartBtn') }}</button>
              <button
                v-if="qrState === 'running'"
                type="button"
                class="ch-btn"
                disabled
              >{{ t('channel.qrStarting') }}</button>
              <button
                v-if="qrState === 'success' || qrState === 'failed'"
                type="button"
                class="ch-btn"
                @click="resetQr"
              >{{ t('common.refresh') }}</button>
            </div>
          </div>

          <!-- ── Feishu ── -->
          <div v-else-if="activeTab === 'feishu'" class="ch-panel">
            <p class="ch-hint">{{ t('channel.feishu.hint') }}
              <a :href="t('channel.feishu.docLink')" target="_blank" rel="noopener" class="ch-link">文档 ↗</a>
            </p>
            <div class="ch-form">
              <label class="ch-label">{{ t('channel.feishu.appId') }}</label>
              <input v-model="feishuAppId" type="text" class="ch-input" :placeholder="t('channel.feishu.appIdPlh')" />
              <label class="ch-label">{{ t('channel.feishu.appSecret') }}</label>
              <input v-model="feishuAppSecret" type="password" class="ch-input" :placeholder="t('channel.feishu.appSecretPlh')" />
            </div>
            <p class="ch-restart-hint">{{ t('channel.restartHint') }}</p>
            <div class="ch-actions">
              <button type="button" class="ch-btn ch-btn--primary" :disabled="busy" @click="saveCredentialChannel('feishu')">
                {{ busy ? t('common.saving') : t('channel.saveBtn') }}
              </button>
            </div>
          </div>

          <!-- ── Discord ── -->
          <div v-else-if="activeTab === 'discord'" class="ch-panel">
            <p class="ch-hint">{{ t('channel.discord.hint') }}
              <a :href="t('channel.discord.docLink')" target="_blank" rel="noopener" class="ch-link">文档 ↗</a>
            </p>
            <div class="ch-form">
              <label class="ch-label">{{ t('channel.discord.token') }}</label>
              <input v-model="discordToken" type="password" class="ch-input" :placeholder="t('channel.discord.tokenPlh')" />
            </div>
            <p class="ch-restart-hint">{{ t('channel.restartHint') }}</p>
            <div class="ch-actions">
              <button type="button" class="ch-btn ch-btn--primary" :disabled="busy" @click="saveCredentialChannel('discord')">
                {{ busy ? t('common.saving') : t('channel.saveBtn') }}
              </button>
            </div>
          </div>

          <!-- ── WeCom ── -->
          <div v-else-if="activeTab === 'wecom'" class="ch-panel">
            <p class="ch-hint">{{ t('channel.wecom.hint') }}
              <a :href="t('channel.wecom.docLink')" target="_blank" rel="noopener" class="ch-link">文档 ↗</a>
            </p>

            <!-- Plugin install -->
            <div class="ch-plugin-row">
              <code class="ch-code">{{ t('channel.wecom.pluginSpec') }}</code>
              <button
                type="button"
                class="ch-btn ch-btn--sm"
                :disabled="wecomPluginInstalling"
                @click="installWecomPlugin"
              >{{ wecomPluginInstalling ? t('channel.pluginInstalling') : t('channel.pluginInstallBtn') }}</button>
            </div>

            <div class="ch-form">
              <label class="ch-label">{{ t('channel.wecom.botId') }}</label>
              <input v-model="wecomBotId" type="text" class="ch-input" :placeholder="t('channel.wecom.botIdPlh')" />
              <label class="ch-label">{{ t('channel.wecom.secret') }}</label>
              <input v-model="wecomSecret" type="password" class="ch-input" :placeholder="t('channel.wecom.secretPlh')" />
            </div>
            <p class="ch-restart-hint">{{ t('channel.restartHint') }}</p>
            <div class="ch-actions">
              <button type="button" class="ch-btn ch-btn--primary" :disabled="busy" @click="saveCredentialChannel('wecom')">
                {{ busy ? t('common.saving') : t('channel.saveBtn') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ch-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10060;
}

.ch-dialog {
  background: var(--lc-surface);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-lg, 12px);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.25);
  width: 500px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--lc-text);
}

.ch-header {
  display: flex;
  align-items: center;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--lc-border);
  flex-shrink: 0;
}

.ch-title {
  flex: 1;
  font-size: 15px;
  font-weight: 600;
}

.ch-close {
  background: none;
  border: none;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  color: var(--lc-text-muted);
  padding: 0 2px;
}
.ch-close:hover { color: var(--lc-text); }

.ch-desc {
  font-size: 12px;
  color: var(--lc-text-muted);
  margin: 0;
  padding: 8px 16px 0;
  flex-shrink: 0;
}

.ch-tabs {
  display: flex;
  gap: 2px;
  padding: 8px 16px 0;
  border-bottom: 1px solid var(--lc-border);
  flex-shrink: 0;
}

.ch-tab {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border: none;
  border-radius: var(--lc-radius-sm) var(--lc-radius-sm) 0 0;
  background: transparent;
  color: var(--lc-text-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color 0.12s, border-color 0.12s, background 0.12s;
}
.ch-tab:hover:not(.ch-tab--active) {
  color: var(--lc-text);
  background: var(--lc-bg-hover);
}
.ch-tab--active {
  color: var(--lc-accent);
  border-bottom-color: var(--lc-accent);
  background: var(--lc-accent-soft);
}

.ch-toast {
  margin: 8px 16px 0;
  padding: 6px 10px;
  border-radius: var(--lc-radius-sm);
  font-size: 12px;
  background: var(--lc-accent-soft);
  color: var(--lc-accent);
  flex-shrink: 0;
}
.ch-toast--error {
  background: color-mix(in srgb, var(--lc-error, #dc2626) 10%, transparent);
  color: var(--lc-error, #dc2626);
}

.ch-panel {
  flex: 1;
  overflow-y: auto;
  padding: 14px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ch-hint {
  font-size: 12px;
  color: var(--lc-text-muted);
  margin: 0;
  line-height: 1.5;
}

.ch-link {
  color: var(--lc-accent);
  text-decoration: none;
  margin-left: 6px;
}
.ch-link:hover { text-decoration: underline; }

.ch-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ch-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--lc-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.ch-input {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  background: var(--lc-bg-raised);
  color: var(--lc-text);
  font: inherit;
  font-size: 13px;
  box-sizing: border-box;
}
.ch-input:focus {
  outline: none;
  border-color: var(--lc-accent);
}

.ch-restart-hint {
  font-size: 11px;
  color: var(--lc-text-dim, var(--lc-text-muted));
  margin: 0;
  padding: 6px 10px;
  border-left: 2px solid var(--lc-warning, #d97706);
  background: color-mix(in srgb, var(--lc-warning, #d97706) 8%, transparent);
  border-radius: 0 var(--lc-radius-sm) var(--lc-radius-sm) 0;
}

.ch-plugin-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--lc-bg-elevated);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
}

.ch-code {
  flex: 1;
  font-family: var(--lc-font-mono, monospace);
  font-size: 12px;
  color: var(--lc-accent);
}

.ch-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.ch-btn {
  padding: 7px 16px;
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  background: var(--lc-bg-elevated);
  color: var(--lc-text);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.ch-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.ch-btn:hover:not(:disabled) { background: var(--lc-bg-hover); border-color: var(--lc-border-strong); }
.ch-btn--primary {
  background: linear-gradient(135deg, #0e7490, #0891b2);
  border-color: rgba(8, 145, 178, 0.5);
  color: #fff;
}
.ch-btn--primary:hover:not(:disabled) { opacity: 0.9; }
.ch-btn--sm { padding: 4px 10px; font-size: 11px; }

/* WhatsApp QR */
.ch-qr-wrap {
  display: flex;
  justify-content: center;
}
.ch-qr-img {
  width: 200px;
  height: 200px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: #fff;
}
.ch-qr-status {
  font-size: 12px;
  font-weight: 500;
}
.ch-status-idle   { color: var(--lc-text-muted); }
.ch-status-running { color: var(--lc-accent); animation: pulse 1.4s ease-in-out infinite; }
.ch-status-ok     { color: var(--lc-success, #059669); }
.ch-status-err    { color: var(--lc-error, #dc2626); }
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}

.ch-terminal {
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  overflow: hidden;
  max-height: 240px;
  display: flex;
  flex-direction: column;
}
.ch-terminal-head {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--lc-text-muted);
  padding: 4px 10px;
  background: var(--lc-bg-elevated);
  border-bottom: 1px solid var(--lc-border);
  flex-shrink: 0;
}
.ch-terminal-body {
  flex: 1;
  overflow-y: auto;
  margin: 0;
  padding: 8px 10px;
  font-family: var(--lc-font-mono, monospace);
  font-size: 11px;
  line-height: 1.5;
  background: var(--lc-bg-raised);
  color: var(--lc-text);
  white-space: pre-wrap;
  word-break: break-all;
}

/* Dialog transition */
.ch-fade-enter-active, .ch-fade-leave-active {
  transition: opacity 0.15s ease;
}
.ch-fade-enter-active .ch-dialog,
.ch-fade-leave-active .ch-dialog {
  transition: transform 0.15s ease;
}
.ch-fade-enter-from, .ch-fade-leave-to { opacity: 0; }
.ch-fade-enter-from .ch-dialog, .ch-fade-leave-to .ch-dialog { transform: scale(0.97) translateY(-6px); }
</style>
