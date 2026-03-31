<script setup lang="ts">
import { useGatewayStore } from "@/stores/gateway";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import { onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { delay, useChannelContext } from "../base/useChannelContext";

const { t } = useI18n();
const { showToast, ensureGatewayConnected, ensureChannelReady, restartGatewayAndReconnect, onSuccess } =
  useChannelContext();
const gwStore = useGatewayStore();

// ── Types ────────────────────────────────────────────────────────────────────

type QrState = "idle" | "running" | "waiting" | "reconnecting" | "success" | "failed";

type WhatsAppChannelHealth = {
  linked: boolean;
  running: boolean;
  connected: boolean;
  lastError?: string | null;
};

// ── State ────────────────────────────────────────────────────────────────────

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
const waHealth = ref<WhatsAppChannelHealth | null>(null);
const qrLines = ref<string[]>([]);

// ── Listener management ───────────────────────────────────────────────────────

let unlistenWaLine: UnlistenFn | null = null;
let unlistenWaDone: UnlistenFn | null = null;

function cleanupListeners(): void {
  unlistenWaLine?.(); unlistenWaLine = null;
  unlistenWaDone?.(); unlistenWaDone = null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function queryWhatsAppHealth(): Promise<WhatsAppChannelHealth | null> {
  const gc = gwStore.client;
  if (!gc || gwStore.status !== "connected") return null;
  try {
    const res = await gc.request<{ channels?: Record<string, unknown> } | null>(
      "channels.status",
      { probe: true, timeoutMs: 8000 },
    );
    const wa = res?.channels?.whatsapp as {
      linked?: boolean;
      running?: boolean;
      connected?: boolean;
      lastError?: string | null;
    } | undefined;
    if (!wa) return null;
    return {
      linked: wa.linked === true,
      running: wa.running === true,
      connected: wa.connected === true,
      lastError: wa.lastError ?? null,
    };
  } catch {
    return null;
  }
}

async function verifyWhatsAppLinked(): Promise<boolean | null> {
  const health = await queryWhatsAppHealth();
  if (!health) return null;
  return health.linked;
}

function isProviderMissingError(message: string): boolean {
  return /not available|not supported|provider is not available/i.test(message);
}

// ── CLI fallback ──────────────────────────────────────────────────────────────

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

  cleanupListeners();
  const waFlowId = crypto.randomUUID();

  unlistenWaLine = await listen<{ flowId?: string; stream: string; line: string }>(
    "channel:line",
    (e) => {
      if (e.payload.flowId !== waFlowId) return;
      qrLines.value = [...qrLines.value, e.payload.line];
      if (qrLines.value.length > 300) qrLines.value = qrLines.value.slice(-300);
    },
  );

  unlistenWaDone = await listen<{ flowId?: string; ok: boolean }>(
    "channel:done",
    (e) => {
      if (e.payload.flowId !== waFlowId) return;
      cleanupListeners();
      const exitedAtPrompt = hasCliPluginPrompt() && !hasCliLoginSuccess();
      if (!e.payload.ok || exitedAtPrompt) {
        qrState.value = "failed";
        qrErrorMessage.value = exitedAtPrompt
          ? "配对流程未完成，请点「重新开始」再试"
          : "配对流程未完成，请重试";
        qrProgressMessage.value = null;
        return;
      }
      qrState.value = "reconnecting";
      qrProgressMessage.value = "正在重连并验证 WhatsApp 连接状态…";
      void (async () => {
        await ensureGatewayConnected(12000);
        const linked = await verifyWhatsAppLinked();
        if (linked === true) {
          qrState.value = "success";
          qrWaitMessage.value = "WhatsApp 已成功关联";
        } else if (linked === false) {
          qrState.value = "failed";
          qrErrorMessage.value = "配对已完成但状态未更新，请点「重新开始」或重启 AI 服务再试";
        } else {
          qrState.value = "success";
          qrWaitMessage.value = "配对完成，若消息未同步请重启 AI 服务";
        }
        qrProgressMessage.value = null;
      })();
    },
  );

  try {
    const gatewayUrl = gwStore.url.replace("ws://", "http://").replace("wss://", "https://");
    await api.startChannelQrFlow("whatsapp", gatewayUrl, waFlowId);
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
    cleanupListeners();
  }
}

// ── RPC path ──────────────────────────────────────────────────────────────────

async function tryStartWhatsAppRpc(): Promise<"done" | "provider-missing" | "failed"> {
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
      qrNoScanNeeded.value = true;
      qrProgressMessage.value = "正在验证连接状态…";
      const health = await queryWhatsAppHealth();
      waHealth.value = health;
      if (health?.linked && !health.running) {
        qrState.value = "success";
        qrWaitMessage.value = health.lastError
          ? `WhatsApp 已绑定，但当前未在运行（${health.lastError}）。请点「重新连接」唤醒，或重启 AI 服务。`
          : "WhatsApp 已绑定，但当前未在运行。请点「重新连接」唤醒，或重启 AI 服务。";
        qrProgressMessage.value = null;
        return "done";
      }
      if (health?.linked && !health.connected) {
        qrState.value = "success";
        qrWaitMessage.value = health.lastError
          ? `WhatsApp 已绑定，但当前未连接（${health.lastError}）。请点「重新连接」。`
          : "WhatsApp 已绑定，但当前未连接。请点「重新连接」。";
        qrProgressMessage.value = null;
        return "done";
      }
      qrState.value = "success";
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
    if (!waitResult?.connected) {
      qrState.value = "failed";
      qrWaitMessage.value = waitResult?.message ?? null;
      return "done";
    }
    qrProgressMessage.value = "正在验证连接状态…";
    await delay(1500);
    const linked = await verifyWhatsAppLinked();
    if (linked === true) {
      qrState.value = "success";
      qrWaitMessage.value = waitResult.message ?? "WhatsApp 已成功关联";
    } else if (linked === false) {
      qrState.value = "failed";
      qrErrorMessage.value = "扫码已完成，但连接状态未更新，请重试或重启 AI 服务";
    } else {
      qrState.value = "success";
      qrWaitMessage.value = "扫码完成，若消息未同步请重启 AI 服务";
    }
    qrProgressMessage.value = null;
    return "done";
  } catch (e: unknown) {
    const msg = String((e as Error)?.message ?? e);
    if (isProviderMissingError(msg)) return "provider-missing";
    qrState.value = "failed";
    qrErrorMessage.value = msg;
    qrProgressMessage.value = null;
    return "failed";
  }
}

// ── Main entry ────────────────────────────────────────────────────────────────

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

  const firstRpc = await tryStartWhatsAppRpc();
  if (firstRpc === "done" || firstRpc === "failed") return;

  qrProgressMessage.value = "检测到 WhatsApp 插件未启用，正在自动安装并启用渠道…";
  const ready = await ensureChannelReady("whatsapp", {
    installPlugin: true,
    writeConfigPatch: true,
    restartGateway: true,
    restartToast: "正在启用 WhatsApp 渠道，请稍候…",
    installFailureMessage: "自动安装 WhatsApp 插件失败",
    configFailureMessage: "启用 WhatsApp 渠道失败",
  });
  if (!ready) {
    qrState.value = "failed";
    qrProgressMessage.value = null;
    return;
  }

  qrProgressMessage.value = "准备就绪，正在获取二维码…";
  const secondRpc = await tryStartWhatsAppRpc();
  if (secondRpc === "done" || secondRpc === "failed") return;

  qrPluginMissing.value = true;
  qrProgressMessage.value = "WhatsApp 插件仍未就绪，已切换到命令行登录…";
  await startWhatsAppCli();
}

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

async function restartGateway(): Promise<void> {
  await restartGatewayAndReconnect();
}

function resetQr(): void {
  cleanupListeners();
  qrState.value = "idle";
  qrUrl.value = null;
  qrLines.value = [];
  qrWaitMessage.value = null;
  qrPluginMissing.value = false;
  qrErrorMessage.value = null;
  qrNoScanNeeded.value = false;
  qrProgressMessage.value = null;
  qrMode.value = null;
  waHealth.value = null;
}

// Auto-close on RPC success when channel is healthy
watch(
  () => [qrState.value, qrMode.value] as const,
  ([state, mode]) => {
    const healthy = !waHealth.value || (waHealth.value.running && waHealth.value.connected);
    if (state === "success" && mode === "rpc" && healthy) {
      onSuccess();
    }
  },
);

onUnmounted(() => {
  cleanupListeners();
});
</script>

<template>
  <div class="ch-panel">
    <p class="ch-hint">
      {{ t('channel.whatsapp.hint') }}
      <a
        :href="t('channel.whatsapp.docLink')"
        target="_blank"
        rel="noopener"
        class="ch-link"
      >文档 ↗</a>
    </p>

    <!-- QR image (Gateway RPC path) -->
    <div v-if="qrUrl && !qrImgError" class="ch-qr-wrap">
      <img
        :src="qrUrl"
        class="ch-qr-img"
        alt="WhatsApp QR code"
        @error="qrImgError = true"
      >
    </div>

    <!-- CLI fallback warning -->
    <div
      v-if="qrPluginMissing && (qrState === 'running' || qrState === 'waiting' || qrState === 'success' || qrLines.length > 0)"
      class="ch-plugin-warn"
    >
      <span>正在使用备用方式完成 WhatsApp 配对，请稍候…</span>
    </div>

    <!-- Status -->
    <div class="ch-qr-status">
      <span v-if="qrState === 'idle'" class="ch-status-idle">准备就绪</span>
      <span v-else-if="qrState === 'running'" class="ch-status-running">
        {{ qrProgressMessage ?? (qrLines.length ? t('channel.qrWaiting') : '正在请求二维码…') }}
      </span>
      <span v-else-if="qrState === 'waiting'" class="ch-status-running">{{ qrWaitMessage ?? t('channel.qrWaiting') }}</span>
      <span v-else-if="qrState === 'reconnecting'" class="ch-status-running">{{ qrProgressMessage ?? '正在验证连接状态…' }}</span>
      <template v-else-if="qrState === 'success'">
        <div
          v-if="qrNoScanNeeded && waHealth && waHealth.linked && (!waHealth.running || !waHealth.connected)"
          class="ch-session-exists"
        >
          <span class="ch-status-warn">⚠ {{ qrWaitMessage }}</span>
          <span class="ch-session-hint">若消息未正常到达，点「重新连接」唤醒（重启 AI 服务后常见）</span>
          <span class="ch-session-hint">若需更换绑定账号，请参考文档进行解绑操作</span>
        </div>
        <div v-else-if="qrNoScanNeeded" class="ch-session-exists">
          <span class="ch-status-ok">✓ WhatsApp 已有绑定会话，无需重新扫码</span>
          <span class="ch-session-hint">若消息未正常到达，点「重新连接」唤醒（重启 AI 服务后常见）</span>
          <span class="ch-session-hint">若需更换绑定账号，请参考文档进行解绑操作</span>
        </div>
        <span v-else class="ch-status-ok">✓ {{ qrWaitMessage ?? t('channel.qrSuccess') }}</span>
      </template>
      <span v-else-if="qrState === 'failed'" class="ch-status-err">✗ {{ qrWaitMessage ?? qrErrorMessage ?? t('channel.qrFail') }}</span>
    </div>

    <!-- CLI terminal output (QR area) -->
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
      >
        {{ t('channel.qrStartBtn') }}
      </button>
      <button
        v-if="qrState === 'running' || qrState === 'waiting'"
        type="button"
        class="ch-btn"
        disabled
      >
        {{ t('channel.qrStarting') }}
      </button>
      <template v-if="qrState === 'success' && qrNoScanNeeded">
        <button
          type="button"
          class="ch-btn ch-btn--primary"
          :disabled="qrReconnecting"
          @click="reconnectWhatsApp"
        >
          {{ qrReconnecting ? '重连中…' : '重新连接' }}
        </button>
        <button type="button" class="ch-btn" @click="restartGateway">
          🔄 重启 AI 服务
        </button>
        <button type="button" class="ch-btn" @click="resetQr">{{ t('common.refresh') }}</button>
      </template>
      <template v-else-if="qrState === 'success' && qrMode === 'cli'">
        <button type="button" class="ch-btn ch-btn--primary" @click="restartGateway">
          🔄 重启 AI 服务
        </button>
        <button type="button" class="ch-btn" @click="resetQr">{{ t('common.refresh') }}</button>
      </template>
      <button
        v-else-if="qrState === 'success'"
        type="button"
        class="ch-btn"
        @click="resetQr"
      >
        {{ t('common.refresh') }}
      </button>
      <button
        v-if="qrState === 'failed'"
        type="button"
        class="ch-btn"
        @click="resetQr"
      >
        {{ t('common.refresh') }}
      </button>
    </div>
  </div>
</template>
