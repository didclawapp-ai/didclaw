<script setup lang="ts">
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import { useGatewayStore } from "@/stores/gateway";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { computed, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  delay,
  provideChannelContext,
} from "./channels/base/useChannelContext";
import DiscordPanel from "./channels/discord/DiscordPanel.vue";
import FeishuPanel from "./channels/feishu/FeishuPanel.vue";
import WeComPanel from "./channels/wecom/WeComPanel.vue";
import WechatPanel from "./channels/wechat/WechatPanel.vue";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [v: boolean] }>();
const { t } = useI18n();
const gwStore = useGatewayStore();

const open = computed({
  get: () => props.modelValue,
  set: (v) => emit("update:modelValue", v),
});

// ── Tab state ────────────────────────────────────────────────────────────────

type ChannelId = "whatsapp" | "feishu" | "discord" | "wecom" | "wechat";
const activeTab = ref<ChannelId>("whatsapp");

const tabs: { id: ChannelId; icon: string }[] = [
  { id: "whatsapp", icon: "💬" },
  { id: "wechat",   icon: "🟢" },
  { id: "feishu",   icon: "🪶" },
  { id: "wecom",    icon: "💼" },
];

// ── Auto-close ────────────────────────────────────────────────────────────────

let autoCloseTimer: number | null = null;

function scheduleAutoClose(): void {
  if (autoCloseTimer !== null) return;
  autoCloseTimer = window.setTimeout(() => {
    autoCloseTimer = null;
    if (open.value) closeDialog();
  }, 1800);
}

// ── Shared context (provided to all channel panel components) ─────────────────

const { toast, toastError, showToast, ensureGatewayConnected, restartGatewayAndReconnect, ensureChannelReady } =
  provideChannelContext({ onSuccess: scheduleAutoClose });

function closeDialog(): void { open.value = false; }



type WhatsAppChannelHealth = {
  linked: boolean;
  running: boolean;
  connected: boolean;
  lastError?: string | null;
};

/**
 * Query gateway channels.status RPC and return full WhatsApp health.
 * Mirrors the official Control UI's loadChannels(probe:true) response shape.
 */
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


// ── WhatsApp QR flow ──────────────────────────────────────────────────────────
// 双路径：①  Gateway RPC web.login.start（插件可用时直接获取 qrDataUrl）
//         ② CLI openclaw channels login --channel whatsapp（插件未加载时降级）

type QrState = "idle" | "running" | "waiting" | "reconnecting" | "success" | "failed";
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
// CLI 降级路径的终端输出
const qrLines = ref<string[]>([]);

let unlistenWaLine: UnlistenFn | null = null;
let unlistenWaDone: UnlistenFn | null = null;

function cleanupListeners(): void {
  unlistenWaLine?.();  unlistenWaLine = null;
  unlistenWaDone?.();  unlistenWaDone = null;
  // Feishu and WeChat listeners are cleaned up in their own panel onUnmounted
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

  const waFlowId = crypto.randomUUID();

  unlistenWaLine = await listen<{ flowId?: string; stream: string; line: string }>("channel:line", (e) => {
    if (e.payload.flowId !== waFlowId) return;
    qrLines.value = [...qrLines.value, e.payload.line];
    if (qrLines.value.length > 300) qrLines.value = qrLines.value.slice(-300);
  });
  unlistenWaDone = await listen<{ flowId?: string; ok: boolean }>("channel:done", (e) => {
    if (e.payload.flowId !== waFlowId) return;
    unlistenWaLine?.(); unlistenWaLine = null;
    unlistenWaDone?.(); unlistenWaDone = null;
    const exitedAtPrompt = hasCliPluginPrompt() && !hasCliLoginSuccess();
    if (!e.payload.ok || exitedAtPrompt) {
      qrState.value = "failed";
      qrErrorMessage.value = exitedAtPrompt
        ? "配对流程未完成，请点「重新开始」再试"
        : "配对流程未完成，请重试";
      qrProgressMessage.value = null;
      return;
    }
    // CLI 以 0 退出：软重连网关，再用 channels.status 确认真实 linked 状态
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
  });

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
      qrNoScanNeeded.value = true;
      qrProgressMessage.value = "正在验证连接状态…";
      const health = await queryWhatsAppHealth();
      waHealth.value = health;
      if (health && health.linked && !health.running) {
        qrState.value = "success";
        qrWaitMessage.value = health.lastError
          ? `WhatsApp 已绑定，但当前未在运行（${health.lastError}）。请点「重新连接」唤醒，或重启 AI 服务。`
          : "WhatsApp 已绑定，但当前未在运行。请点「重新连接」唤醒，或重启 AI 服务。";
        qrProgressMessage.value = null;
        return "done";
      }
      if (health && health.linked && !health.connected) {
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
    // web.login.wait 返回 connected:true 后，通过 channels.status 确认真实 linked 状态
    // （与官方 Control UI loadChannels(probe:true) 一致）
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
      // 无法确认（网关断连等），给一个宽松的成功态但附带提示
      qrState.value = "success";
      qrWaitMessage.value = "扫码完成，若消息未同步请重启 AI 服务";
    }
    qrProgressMessage.value = null;
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
  waHealth.value = null;
}

watch(
  () => [qrState.value, qrMode.value] as const,
  ([wa, mode]) => {
    // WhatsApp RPC path: auto-close when linked and channel is healthy
    // CLI fallback path: no auto-close (user must restart Gateway manually)
    const healthy = !waHealth.value || (waHealth.value.running && waHealth.value.connected);
    if (wa === "success" && mode === "rpc" && healthy) {
      scheduleAutoClose();
    }
    // WeChat: auto-close triggered by WechatPanel via onContextSuccess()
  },
);

// ── Lifecycle ────────────────────────────────────────────────────────────────

watch(
  () => props.modelValue,
  (v) => {
    if (!v) {
      // 清理定时器
      if (autoCloseTimer !== null) {
        clearTimeout(autoCloseTimer);
        autoCloseTimer = null;
      }
      cleanupListeners();
      toast.value = null;
      resetQr();
      // 关闭窗口时若 Gateway 未连接则自动重连（兜底：用户手动关或意外断开时）
      if (gwStore.status !== "connected") {
        void gwStore.reloadConnection();
      }
    }
  },
);


onUnmounted(() => {
  if (autoCloseTimer !== null) {
    clearTimeout(autoCloseTimer);
    autoCloseTimer = null;
  }
  cleanupListeners();
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
            <p class="ch-hint">
              {{ t('channel.whatsapp.hint') }}
              <a :href="t('channel.whatsapp.docLink')" target="_blank" rel="noopener" class="ch-link">文档 ↗</a>
            </p>

            <!-- QR image（Gateway RPC 路径） -->
            <div v-if="qrUrl && !qrImgError" class="ch-qr-wrap">
              <img
                :src="qrUrl"
                class="ch-qr-img"
                alt="WhatsApp QR code"
                @error="qrImgError = true"
              >
            </div>

            <!-- CLI 降级提示 -->
            <div v-if="qrPluginMissing && (qrState === 'running' || qrState === 'waiting' || qrState === 'success' || qrLines.length > 0)" class="ch-plugin-warn">
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
                <div v-if="qrNoScanNeeded && waHealth && waHealth.linked && (!waHealth.running || !waHealth.connected)" class="ch-session-exists">
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

          <!-- ── Feishu ── -->
          <FeishuPanel v-else-if="activeTab === 'feishu'" />

          <!-- ── WeChat (Personal) ── -->
          <WechatPanel v-else-if="activeTab === 'wechat'" @close="closeDialog" />

          <!-- ── Discord ── -->
          <DiscordPanel v-else-if="activeTab === 'discord'" />

          <!-- ── WeCom ── -->
          <WeComPanel v-else-if="activeTab === 'wecom'" />
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
.ch-install-info-row {
  display: flex;
  align-items: center;
  padding: 7px 10px;
  background: var(--lc-bg-elevated);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
}
.ch-install-info-text {
  font-size: 12px;
  color: var(--lc-text-muted);
  line-height: 1.4;
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
.ch-status-warn   { color: var(--lc-warning-text, #b45309); }
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

/* WeChat prerequisite card */
.ch-prereq-card {
  background: var(--lc-bg-elevated);
  border: 1px solid var(--lc-border);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 12px;
}
.ch-prereq-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--lc-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 8px;
}
.ch-prereq-steps {
  margin: 0 0 8px 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--lc-text);
}
.ch-prereq-note {
  margin: 0;
  font-size: 12px;
  color: var(--lc-text-secondary);
}

/* WeChat QR URL highlight box */
.ch-wechat-qr-box {
  background: var(--lc-bg-elevated);
  border: 1px solid var(--lc-accent, #06b6d4);
  border-radius: 8px;
  padding: 10px 12px;
  margin-top: 8px;
}
.ch-wechat-qr-hint {
  margin: 0 0 6px 0;
  font-size: 12px;
  color: var(--lc-text-secondary);
}
.ch-wechat-qr-link {
  font-size: 12px;
  word-break: break-all;
}

.ch-wechat-ticker {
  margin-top: 8px;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
  background: #0b0b0b;
  color: #d4d4d4;
  overflow: hidden;
  padding: 8px 0;
}

.ch-wechat-ticker__track {
  display: flex;
  width: max-content;
  min-width: 100%;
  white-space: nowrap;
  will-change: transform;
  animation: wechatTickerScroll 28s linear infinite;
}

.ch-wechat-ticker__text {
  display: inline-block;
  padding-left: 16px;
  padding-right: 32px;
  font-family: var(--lc-font-mono, monospace);
  font-size: 11px;
  line-height: 1.4;
}

@keyframes wechatTickerScroll {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
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
