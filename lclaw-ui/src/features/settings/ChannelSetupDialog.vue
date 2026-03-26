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

// Feishu streaming install
type FeishuInstallState = "idle" | "running" | "success" | "failed";
const feishuInstallState = ref<FeishuInstallState>("idle");
const feishuInstallLines = ref<string[]>([]);
let unlistenFeishuLine: UnlistenFn | null = null;
let unlistenFeishuDone: UnlistenFn | null = null;
const feishuManualOpen = ref(false);

async function startFeishuInstall(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.startChannelQrFlow) return;

  feishuInstallState.value = "running";
  feishuInstallLines.value = [];

  unlistenFeishuLine?.();
  unlistenFeishuLine = await listen<{ stream: string; line: string }>("channel:line", (e) => {
    feishuInstallLines.value = [...feishuInstallLines.value, e.payload.line];
    if (feishuInstallLines.value.length > 300) {
      feishuInstallLines.value = feishuInstallLines.value.slice(-300);
    }
  });
  unlistenFeishuDone?.();
  unlistenFeishuDone = await listen<{ ok: boolean }>("channel:done", (e) => {
    feishuInstallState.value = e.payload.ok ? "success" : "failed";
    unlistenFeishuLine?.(); unlistenFeishuLine = null;
    unlistenFeishuDone?.(); unlistenFeishuDone = null;
  });

  try {
    const gatewayUrl = gwStore.url.replace("ws://", "http://").replace("wss://", "https://");
    await api.startChannelQrFlow("feishu", gatewayUrl);
  } catch (e) {
    feishuInstallState.value = "failed";
    feishuInstallLines.value = [...feishuInstallLines.value, `Error: ${e}`];
  }
}

const feishuAppId = ref("");
const feishuAppSecret = ref("");
const discordToken = ref("");
const wecomBotId = ref("");
const wecomSecret = ref("");

// WeCom plugin install
const wecomPluginInstalling = ref(false);

const WECOM_PLUGIN_SPEC = "@wecom/wecom-openclaw-plugin";
const WHATSAPP_PLUGIN_SPEC = "@openclaw/whatsapp";

type ChannelReadyMeta = {
  pluginPackageSpec?: string;
  configPatch?: Record<string, unknown>;
  restartGatewayAfterSetup?: boolean;
};

const CHANNEL_READY_META: Record<ChannelId, ChannelReadyMeta> = {
  whatsapp: {
    pluginPackageSpec: WHATSAPP_PLUGIN_SPEC,
    configPatch: { enabled: true },
    restartGatewayAfterSetup: true,
  },
  feishu: {
    configPatch: { enabled: true },
  },
  discord: {
    configPatch: { enabled: true },
  },
  wecom: {
    pluginPackageSpec: WECOM_PLUGIN_SPEC,
    configPatch: { enabled: true },
  },
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withChannelReadyPatch(
  channelKey: ChannelId,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(CHANNEL_READY_META[channelKey].configPatch ?? {}),
    ...payload,
  };
}

async function restartGatewayAndReconnect(toastMessage = "Gateway 重启中，稍等片刻…"): Promise<boolean> {
  const api = getDidClawDesktopApi();
  if (!api?.restartOpenClawGateway) {
    showToast("桌面端不支持重启 Gateway", true);
    return false;
  }
  const result = await api.restartOpenClawGateway();
  if (!result?.ok) {
    showToast(`重启 Gateway 失败：${(result as { error?: string }).error ?? "未知错误"}`, true);
    return false;
  }
  showToast(toastMessage);
  await gwStore.reloadConnection();
  // 必须等 onHello 完成（gwStore.status === "connected"），
  // 而非 ws.readyState === OPEN（connect 握手可能还没发送）
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (gwStore.status === "connected") {
      // 握手完成后再稍等一下，让 Gateway 插件完成初始化
      await delay(800);
      return true;
    }
    await delay(500);
  }
  showToast("Gateway 重启后暂未恢复连接，请稍后重试。", true);
  return false;
}

type EnsureChannelReadyOptions = {
  installPlugin?: boolean;
  writeConfigPatch?: boolean;
  restartGateway?: boolean;
  restartToast?: string;
  installFailureMessage?: string;
  configFailureMessage?: string;
  successToast?: string;
};

async function ensureChannelReady(
  channelKey: ChannelId,
  options: EnsureChannelReadyOptions = {},
): Promise<boolean> {
  const api = getDidClawDesktopApi();
  const meta = CHANNEL_READY_META[channelKey];

  if (options.installPlugin && meta.pluginPackageSpec) {
    if (!api?.openclawPluginsInstall) {
      showToast(options.installFailureMessage ?? "桌面端不支持插件安装", true);
      return false;
    }
    const result = await api.openclawPluginsInstall({ packageSpec: meta.pluginPackageSpec });
    if (!result.ok) {
      showToast(
        (options.installFailureMessage ?? t("channel.pluginInstallFail")) +
          ((result as { error?: string }).error ? `：${(result as { error?: string }).error}` : ""),
        true,
      );
      return false;
    }
  }

  if (options.writeConfigPatch && meta.configPatch) {
    if (!api?.writeChannelConfig) {
      showToast(options.configFailureMessage ?? "桌面端不支持写入渠道配置", true);
      return false;
    }
    const result = await api.writeChannelConfig(channelKey, meta.configPatch);
    if (!result.ok) {
      showToast(
        (options.configFailureMessage ?? t("channel.saveFail")) +
          `：${(result as { error?: string }).error ?? "未知错误"}`,
        true,
      );
      return false;
    }
  }

  const shouldRestartGateway = options.restartGateway ?? meta.restartGatewayAfterSetup ?? false;
  if (shouldRestartGateway) {
    const restarted = await restartGatewayAndReconnect(options.restartToast);
    if (!restarted) {
      return false;
    }
  }

  if (options.successToast) {
    showToast(options.successToast);
  }
  return true;
}

async function installWecomPlugin(): Promise<void> {
  wecomPluginInstalling.value = true;
  try {
    await ensureChannelReady("wecom", {
      installPlugin: true,
      successToast: t("channel.pluginInstallOk"),
    });
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

  payload = withChannelReadyPatch(channelKey, payload);

  busy.value = true;
  try {
    if (channelKey === "wecom") {
      wecomPluginInstalling.value = true;
      const ready = await ensureChannelReady("wecom", {
        installPlugin: true,
      });
      wecomPluginInstalling.value = false;
      if (!ready) {
        return;
      }
    }
    const r = await api.writeChannelConfig(channelKey, payload);
    if (r.ok) {
      showToast(t("channel.saveOk"));
    } else {
      showToast(t("channel.saveFail") + `：${(r as { error: string }).error}`, true);
    }
  } catch (e) {
    showToast(t("channel.saveFail") + `：${e}`, true);
  } finally {
    wecomPluginInstalling.value = false;
    busy.value = false;
  }
}

// ── WhatsApp QR flow ──────────────────────────────────────────────────────────
// 双路径：①  Gateway RPC web.login.start（插件可用时直接获取 qrDataUrl）
//         ② CLI openclaw channels login --channel whatsapp（插件未加载时降级）

type QrState = "idle" | "running" | "waiting" | "success" | "failed";
const qrState = ref<QrState>("idle");
const qrReconnecting = ref(false);
const qrUrl = ref<string | null>(null);
const qrImgError = ref(false);
const qrNoScanNeeded = ref(false);
const qrWaitMessage = ref<string | null>(null);
const qrPluginMissing = ref(false);
const qrErrorMessage = ref<string | null>(null);
const qrProgressMessage = ref<string | null>(null);
const qrMode = ref<"rpc" | "cli" | null>(null);
// CLI 降级路径的终端输出
const qrLines = ref<string[]>([]);

let unlistenWaLine: UnlistenFn | null = null;
let unlistenWaDone: UnlistenFn | null = null;

function cleanupListeners(): void {
  unlistenWaLine?.();  unlistenWaLine = null;
  unlistenWaDone?.();  unlistenWaDone = null;
  unlistenFeishuLine?.(); unlistenFeishuLine = null;
  unlistenFeishuDone?.(); unlistenFeishuDone = null;
}

/** CLI 降级：openclaw channels login --channel whatsapp → 流式输出 */
async function startWhatsAppCli(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.startChannelQrFlow) {
    qrState.value = "failed";
    qrErrorMessage.value = "桌面端 API 不可用";
    return;
  }

  qrLines.value = [];
  qrMode.value = "cli";
  qrProgressMessage.value = "正在切换到命令行登录…";

  const hasCliPluginPrompt = (): boolean =>
    qrLines.value.some((line) => /install .*plugin|use local plugin path|skip for now/i.test(line));
  const hasCliLoginSuccess = (): boolean =>
    qrLines.value.some((line) => /linked|login successful|already linked|ready|登录成功|已绑定/i.test(line));

  // 注册 Tauri 事件监听
  unlistenWaLine?.(); unlistenWaLine = null;
  unlistenWaDone?.(); unlistenWaDone = null;

  unlistenWaLine = await listen<{ stream: string; line: string }>("channel:line", (e) => {
    qrLines.value = [...qrLines.value, e.payload.line];
    if (qrLines.value.length > 300) qrLines.value = qrLines.value.slice(-300);
  });
  unlistenWaDone = await listen<{ ok: boolean }>("channel:done", (e) => {
    const exitedAtPrompt = hasCliPluginPrompt() && !hasCliLoginSuccess();
    if (e.payload.ok && !exitedAtPrompt) {
      qrState.value = "success";
      qrWaitMessage.value = hasCliLoginSuccess()
        ? "CLI 登录完成，重启 Gateway 后生效"
        : "CLI 已完成，若 WhatsApp 仍未在线，请重启 Gateway 生效";
      qrProgressMessage.value = null;
    } else {
      qrState.value = "failed";
      qrErrorMessage.value = exitedAtPrompt
        ? "CLI 停在插件安装/选择提示，尚未真正开始 WhatsApp 登录"
        : "命令已退出，但未完成 WhatsApp 登录";
      qrProgressMessage.value = null;
    }
    unlistenWaLine?.(); unlistenWaLine = null;
    unlistenWaDone?.(); unlistenWaDone = null;
  });

  try {
    const gatewayUrl = gwStore.url.replace("ws://", "http://").replace("wss://", "https://");
    await api.startChannelQrFlow("whatsapp", gatewayUrl);
    if (qrState.value === "running") {
      qrState.value = "failed";
      qrErrorMessage.value = "命令未返回二维码，也未完成登录";
      qrProgressMessage.value = null;
    }
  } catch (e: unknown) {
    qrState.value = "failed";
    qrErrorMessage.value = String((e as Error)?.message ?? e);
    qrProgressMessage.value = null;
  } finally {
    unlistenWaLine?.(); unlistenWaLine = null;
    unlistenWaDone?.(); unlistenWaDone = null;
  }
}

function isWhatsAppProviderMissingError(message: string): boolean {
  return /not available|not supported|provider is not available/i.test(message);
}

async function tryStartWhatsAppRpc(): Promise<"done" | "provider-missing" | "failed"> {
  // 必须等 onHello 完成的"connected"状态，而非仅 WebSocket OPEN
  if (gwStore.status !== "connected") {
    qrState.value = "failed";
    qrErrorMessage.value = t("channel.gatewayNotConnected");
    return "failed";
  }
  const gc = gwStore.client;
  if (!gc) {
    qrState.value = "failed";
    qrErrorMessage.value = t("channel.gatewayNotConnected");
    return "failed";
  }
  try {
    const startResult = await gc.request<{ qrDataUrl?: string; message?: string }>(
      "web.login.start",
      { force: false },
    );
    qrMode.value = "rpc";
    if (!startResult?.qrDataUrl) {
      qrState.value = "success";
      qrNoScanNeeded.value = true;
      qrWaitMessage.value = startResult?.message ?? null;
      qrProgressMessage.value = null;
      return "done";
    }
    qrUrl.value = startResult.qrDataUrl;
    qrState.value = "waiting";
    qrProgressMessage.value = null;
    const waitResult = await gc.request<{ connected?: boolean; message?: string }>(
      "web.login.wait",
      { timeoutMs: 120000 },
    );
    qrState.value = waitResult?.connected ? "success" : "failed";
    qrWaitMessage.value = waitResult?.message ?? null;
    return "done";
  } catch (e: unknown) {
    const msg = String((e as Error)?.message ?? e);
    if (isWhatsAppProviderMissingError(msg)) {
      return "provider-missing";
    }
    qrState.value = "failed";
    qrErrorMessage.value = msg;
    qrProgressMessage.value = null;
    return "failed";
  }
}

async function startWhatsAppQr(): Promise<void> {
  qrState.value = "running";
  qrUrl.value = null;
  qrImgError.value = false;
  qrNoScanNeeded.value = false;
  qrWaitMessage.value = null;
  qrPluginMissing.value = false;
  qrErrorMessage.value = null;
  qrProgressMessage.value = "正在请求二维码…";
  qrMode.value = null;
  qrLines.value = [];

  // ① 优先尝试 Gateway RPC（插件已加载时直接返回 qrDataUrl）
  const firstRpcAttempt = await tryStartWhatsAppRpc();
  if (firstRpcAttempt === "done" || firstRpcAttempt === "failed") {
    return;
  }

  qrProgressMessage.value = "检测到 WhatsApp 插件未启用，正在自动安装并启用渠道…";
  const ready = await ensureChannelReady("whatsapp", {
    installPlugin: true,
    writeConfigPatch: true,
    restartGateway: true,
    restartToast: "正在启用 WhatsApp 渠道并重连 Gateway…",
    installFailureMessage: "自动安装 WhatsApp 插件失败",
    configFailureMessage: "启用 WhatsApp 渠道失败",
  });
  if (!ready) {
    qrState.value = "failed";
    qrProgressMessage.value = null;
    return;
  }

  qrProgressMessage.value = "Gateway 已更新，正在重试二维码请求…";
  const secondRpcAttempt = await tryStartWhatsAppRpc();
  if (secondRpcAttempt === "done" || secondRpcAttempt === "failed") {
    return;
  }

  qrPluginMissing.value = true;
  qrProgressMessage.value = "WhatsApp 插件仍未就绪，已切换到命令行登录…";

  // ② CLI 降级：openclaw channels login --channel whatsapp
  await startWhatsAppCli();
}

async function restartGateway(): Promise<void> {
  await restartGatewayAndReconnect();
}

/** 触发 WhatsApp 重连：re-call web.login.start，让插件从 stopped/disconnected 状态恢复 */
async function reconnectWhatsApp(): Promise<void> {
  if (gwStore.status !== "connected") {
    showToast(t("channel.gatewayNotConnected"), true);
    return;
  }
  const gc = gwStore.client;
  if (!gc) {
    showToast(t("channel.gatewayNotConnected"), true);
    return;
  }
  qrReconnecting.value = true;
  try {
    await gc.request("web.login.start", { force: false });
    showToast("重新连接请求已发送，请从手机发一条消息验证是否正常接收");
  } catch (e) {
    showToast(`重新连接失败：${(e as Error)?.message ?? String(e)}`, true);
  } finally {
    qrReconnecting.value = false;
  }
}

function resetQr(): void {
  qrState.value = "idle";
  qrUrl.value = null;
  qrLines.value = [];
  qrWaitMessage.value = null;
  qrPluginMissing.value = false;
  qrErrorMessage.value = null;
  qrNoScanNeeded.value = false;
  qrProgressMessage.value = null;
  qrMode.value = null;
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

            <!-- QR image（Gateway RPC 路径） -->
            <div v-if="qrUrl && !qrImgError" class="ch-qr-wrap">
              <img
                :src="qrUrl"
                class="ch-qr-img"
                alt="WhatsApp QR code"
                @error="qrImgError = true"
              />
            </div>

            <!-- CLI 降级提示 -->
            <div v-if="qrPluginMissing && (qrState === 'running' || qrState === 'waiting' || qrState === 'success' || qrLines.length > 0)" class="ch-plugin-warn">
              <span>插件运行时不可用，已切换到命令行配对模式（<code>openclaw channels login --channel whatsapp</code>）</span>
            </div>

            <!-- Status -->
            <div class="ch-qr-status">
              <span v-if="qrState === 'idle'" class="ch-status-idle">准备就绪</span>
              <span v-else-if="qrState === 'running'" class="ch-status-running">
                {{ qrProgressMessage ?? (qrLines.length ? t('channel.qrWaiting') : '正在请求二维码…') }}
              </span>
              <span v-else-if="qrState === 'waiting'" class="ch-status-running">{{ qrWaitMessage ?? t('channel.qrWaiting') }}</span>
              <template v-else-if="qrState === 'success'">
                <div v-if="qrNoScanNeeded" class="ch-session-exists">
                  <span class="ch-status-ok">✓ WhatsApp 已有绑定会话，无需重新扫码</span>
                  <span class="ch-session-hint">若消息未正常到达（Gateway 重启后常见），点「重新连接」唤醒插件</span>
                  <span class="ch-session-hint">若需切换账号，请在终端运行：<code>openclaw channels logout --channel whatsapp</code>，再点「开始扫码登录」</span>
                </div>
                <span v-else class="ch-status-ok">✓ {{ qrWaitMessage ?? t('channel.qrSuccess') }}</span>
              </template>
              <span v-else-if="qrState === 'failed'" class="ch-status-err">✗ {{ qrWaitMessage ?? qrErrorMessage ?? t('channel.qrFail') }}</span>
            </div>

            <!-- CLI 终端输出（扫码区） -->
            <div v-if="qrLines.length" class="ch-terminal ch-terminal--qr">
              <div class="ch-terminal-head">{{ t('channel.qrOutputLabel') }}（二维码在下方，用手机扫描）</div>
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
                v-if="qrState === 'running' || qrState === 'waiting'"
                type="button"
                class="ch-btn"
                disabled
              >{{ t('channel.qrStarting') }}</button>
              <template v-if="qrState === 'success' && qrNoScanNeeded">
                <button
                  type="button"
                  class="ch-btn ch-btn--primary"
                  :disabled="qrReconnecting"
                  @click="reconnectWhatsApp"
                >{{ qrReconnecting ? '重连中…' : '重新连接' }}</button>
                <button type="button" class="ch-btn" @click="restartGateway">
                  🔄 重启 Gateway
                </button>
                <button type="button" class="ch-btn" @click="resetQr">{{ t('common.refresh') }}</button>
              </template>
              <template v-else-if="qrState === 'success' && qrMode === 'cli'">
                <button type="button" class="ch-btn ch-btn--primary" @click="restartGateway">
                  🔄 重启 Gateway 立即生效
                </button>
                <button type="button" class="ch-btn" @click="resetQr">{{ t('common.refresh') }}</button>
              </template>
              <button
                v-else-if="qrState === 'success'"
                type="button"
                class="ch-btn"
                @click="resetQr"
              >{{ t('common.refresh') }}</button>
              <button
                v-if="qrState === 'failed'"
                type="button"
                class="ch-btn"
                @click="resetQr"
              >{{ t('common.refresh') }}</button>
            </div>
          </div>

          <!-- ── Feishu ── -->
          <div v-else-if="activeTab === 'feishu'" class="ch-panel">
            <p class="ch-hint">{{ t('channel.feishu.hint') }}
              <a :href="t('channel.feishu.docLink')" target="_blank" rel="noopener" class="ch-link">官方文档 ↗</a>
            </p>

            <!-- Install wizard (primary path) -->
            <div class="ch-install-card">
              <div class="ch-install-cmd-row">
                <code class="ch-code ch-code--block">{{ t('channel.feishu.installCmd') }}</code>
              </div>
              <div class="ch-qr-status" style="margin-top: 6px;">
                <span v-if="feishuInstallState === 'idle'" class="ch-status-idle">准备就绪</span>
                <span v-else-if="feishuInstallState === 'running'" class="ch-status-running">{{ t('channel.feishu.installRunning') }}</span>
                <span v-else-if="feishuInstallState === 'success'" class="ch-status-ok">✓ {{ t('channel.feishu.installSuccess') }}</span>
                <span v-else class="ch-status-err">✗ {{ t('channel.feishu.installFail') }}</span>
              </div>

              <!-- Terminal output -->
              <div v-if="feishuInstallLines.length" class="ch-terminal" style="margin-top: 8px;">
                <div class="ch-terminal-head">{{ t('channel.qrOutputLabel') }}</div>
                <pre class="ch-terminal-body"><template v-for="(ln, i) in feishuInstallLines" :key="i">{{ ln }}
</template></pre>
              </div>

              <div class="ch-actions" style="margin-top: 8px;">
                <button
                  v-if="feishuInstallState === 'idle' || feishuInstallState === 'failed'"
                  type="button"
                  class="ch-btn ch-btn--primary"
                  @click="startFeishuInstall"
                >{{ t('channel.feishu.startInstallBtn') }}</button>
                <button v-if="feishuInstallState === 'running'" type="button" class="ch-btn" disabled>
                  {{ t('channel.feishu.installRunning') }}
                </button>
                <button v-if="feishuInstallState === 'success'" type="button" class="ch-btn ch-btn--primary" @click="restartGateway">
                  🔄 重启 Gateway 立即生效
                </button>
              </div>
            </div>

            <!-- Manual credentials (collapsible fallback) -->
            <button type="button" class="ch-toggle-manual" @click="feishuManualOpen = !feishuManualOpen">
              {{ feishuManualOpen ? '▾' : '▸' }} {{ t('channel.feishu.orManual') }}
            </button>
            <template v-if="feishuManualOpen">
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
            </template>
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
              <code class="ch-code">{{ WECOM_PLUGIN_SPEC }}</code>
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
.ch-install-card {
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  padding: 10px 12px;
  background: var(--lc-bg-raised);
  display: flex;
  flex-direction: column;
}
.ch-install-cmd-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ch-code--block {
  flex: 1;
  display: block;
  padding: 6px 8px;
  background: var(--lc-bg-elevated);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  font-size: 12px;
  color: var(--lc-accent);
  user-select: all;
}
.ch-toggle-manual {
  background: none;
  border: none;
  padding: 4px 0;
  font: inherit;
  font-size: 12px;
  color: var(--lc-text-muted);
  cursor: pointer;
  text-align: left;
}
.ch-toggle-manual:hover { color: var(--lc-text); }
.ch-session-exists {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ch-session-hint {
  font-size: 11px;
  color: var(--lc-text-muted);
}
.ch-session-hint code {
  font-family: var(--lc-font-mono, monospace);
  color: var(--lc-text);
  background: var(--lc-bg-elevated);
  padding: 1px 4px;
  border-radius: 3px;
}
.ch-status-idle   { color: var(--lc-text-muted); }
.ch-status-running { color: var(--lc-accent); animation: pulse 1.4s ease-in-out infinite; }
.ch-status-ok     { color: var(--lc-success, #059669); }
.ch-status-err    { color: var(--lc-error, #dc2626); }
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}

.ch-plugin-warn {
  font-size: 12px;
  color: var(--lc-warning, #d97706);
  background: color-mix(in srgb, var(--lc-warning, #d97706) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--lc-warning, #d97706) 30%, transparent);
  border-radius: var(--lc-radius-sm);
  padding: 8px 10px;
  line-height: 1.5;
}
.ch-plugin-warn code {
  font-family: var(--lc-font-mono, monospace);
  background: color-mix(in srgb, var(--lc-warning, #d97706) 15%, transparent);
  padding: 1px 4px;
  border-radius: 3px;
}

.ch-terminal {
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  overflow: hidden;
  max-height: 240px;
  display: flex;
  flex-direction: column;
}
/* QR ASCII art 需要更大的显示区域 */
.ch-terminal--qr {
  max-height: 400px;
}
.ch-terminal--qr .ch-terminal-body {
  font-size: 9px;
  line-height: 1.2;
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
