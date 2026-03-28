<script setup lang="ts">
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import { useGatewayStore } from "@/stores/gateway";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import QRCode from "qrcode";
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

type ChannelId = "whatsapp" | "feishu" | "discord" | "wecom" | "wechat";
const activeTab = ref<ChannelId>("whatsapp");

const tabs: { id: ChannelId; icon: string }[] = [
  { id: "whatsapp", icon: "💬" },
  { id: "wechat",   icon: "🟢" },
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

  const feishuFlowId = crypto.randomUUID();

  unlistenFeishuLine?.();
  unlistenFeishuLine = await listen<{ flowId?: string; stream: string; line: string }>("channel:line", (e) => {
    if (e.payload.flowId !== feishuFlowId) return;
    feishuInstallLines.value = [...feishuInstallLines.value, e.payload.line];
    if (feishuInstallLines.value.length > 300) {
      feishuInstallLines.value = feishuInstallLines.value.slice(-300);
    }
  });
  unlistenFeishuDone?.();
  unlistenFeishuDone = await listen<{ flowId?: string; ok: boolean }>("channel:done", (e) => {
    if (e.payload.flowId !== feishuFlowId) return;
    feishuInstallState.value = e.payload.ok ? "success" : "failed";
    unlistenFeishuLine?.(); unlistenFeishuLine = null;
    unlistenFeishuDone?.(); unlistenFeishuDone = null;
  });

  try {
    const gatewayUrl = gwStore.url.replace("ws://", "http://").replace("wss://", "https://");
    await api.startChannelQrFlow("feishu", gatewayUrl, feishuFlowId);
  } catch (e) {
    feishuInstallState.value = "failed";
    feishuInstallLines.value = [...feishuInstallLines.value, `Error: ${e}`];
  }
}

// WeChat (personal) streaming install via ClawBot
type WechatInstallState = "idle" | "running" | "reconnecting" | "success" | "failed" | "pending-restart";
const wechatInstallState = ref<WechatInstallState>("idle");
const wechatInstallLines = ref<string[]>([]);
const wechatQrUrl = ref<string | null>(null);
const wechatQrDataUrl = ref<string | null>(null);
let unlistenWechatLine: UnlistenFn | null = null;
let unlistenWechatDone: UnlistenFn | null = null;
let unlistenWechatQr: UnlistenFn | null = null;
const wechatTickerText = computed(() =>
  wechatInstallLines.value.length
    ? wechatInstallLines.value.join("   •   ")
    : "等待微信绑定日志…",
);

function isMissingTauriCommandError(error: unknown): boolean {
  const message = String((error as Error)?.message ?? error ?? "");
  return /not allowed|command not found|unknown command/i.test(message);
}

function looksLikeWechatPluginAlreadyInstalled(result: {
  ok: boolean;
  error?: string;
  stdout?: string;
  stderr?: string;
}): boolean {
  const combined = [result.error, result.stdout, result.stderr]
    .filter(Boolean)
    .join("\n");
  return /plugin already exists|already at \d+\.\d+\.\d+/i.test(combined);
}

function pushWechatLines(raw?: string | null): void {
  if (!raw) return;
  const chunks = raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  if (!chunks.length) return;
  wechatInstallLines.value = [...wechatInstallLines.value, ...chunks].slice(-300);
}

async function setWechatQrUrl(url: string | null): Promise<void> {
  wechatQrUrl.value = url;
  if (!url) {
    wechatQrDataUrl.value = null;
    return;
  }
  try {
    wechatQrDataUrl.value = await QRCode.toDataURL(url, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: "M",
    });
  } catch (error) {
    console.warn("[didclaw] failed to render WeChat QR image", error);
    wechatQrDataUrl.value = null;
  }
}

async function ensureWechatPluginInstalled(): Promise<boolean> {
  const api = getDidClawDesktopApi();
  if (!api?.checkChannelPluginInstalled) {
    pushWechatLines("当前桌面端未提供微信插件检测能力，回退到直接安装/更新流程…");
  } else {
    try {
      const installedState = await api.checkChannelPluginInstalled("wechat");
      if (!installedState.ok) {
        showToast(`检测微信插件状态失败：${installedState.error}`, true);
        return false;
      }
      if (installedState.installed) {
        pushWechatLines("已检测到本地微信插件，直接启动扫码登录…");
        return true;
      }
    } catch (error) {
      // dev 模式热更新时，前端可能已更新而 Rust 端尚未重启注册新命令。
      if (isMissingTauriCommandError(error)) {
        pushWechatLines("当前运行中的桌面端尚未注册微信插件检测命令，回退到直接安装/更新流程…");
      } else {
        showToast(`检测微信插件状态失败：${String((error as Error)?.message ?? error)}`, true);
        return false;
      }
    }
  }

  if (!api?.openclawPluginsInstall) {
    showToast("桌面端不支持安装微信插件", true);
    return false;
  }

  pushWechatLines(`> openclaw plugins install "${WECHAT_PLUGIN_SPEC}"`);
  pushWechatLines("未检测到本地微信插件，正在自动安装…");

  const result = await api.openclawPluginsInstall({ packageSpec: WECHAT_PLUGIN_SPEC });
  pushWechatLines(result.stdout);
  pushWechatLines(result.stderr);
  if (!result.ok) {
    if (looksLikeWechatPluginAlreadyInstalled(result)) {
      pushWechatLines("检测到微信插件已存在，跳过重复安装，继续启动扫码登录…");
      return true;
    }
    showToast(`自动安装微信插件失败：${result.error}`, true);
    return false;
  }

  pushWechatLines("微信插件安装完成，正在启动扫码登录…");
  return true;
}

async function startWechatInstall(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.startChannelQrFlow) return;

  wechatInstallState.value = "running";
  wechatInstallLines.value = [];
  await setWechatQrUrl(null);

  const ready = await ensureWechatPluginInstalled();
  if (!ready) {
    wechatInstallState.value = "failed";
    return;
  }

  // 插件安装后网关可能自行重启（WS close 1012 "service restart"）。
  // channels login CLI 需要通过 OPENCLAW_GATEWAY_URL 与网关通信，
  // 须等网关恢复后再启动登录流程。
  if (gwStore.status !== "connected") {
    pushWechatLines("网关正在重启，等待恢复连接…");
    const reconnected = await ensureGatewayConnected();
    if (!reconnected) {
      pushWechatLines("网关重连超时，仍将尝试扫码登录…");
    } else {
      pushWechatLines("网关已恢复连接。");
    }
  }

  // 生成本次流程的唯一 ID，所有 channel:* 事件均携带此 ID。
  // 前端只处理 flowId 匹配的事件，彻底避免重试/并发场景下的事件串台。
  const flowId = crypto.randomUUID();

  unlistenWechatLine?.();
  unlistenWechatLine = await listen<{ flowId?: string; stream: string; line: string }>("channel:line", (e) => {
    if (e.payload.flowId !== flowId) return;
    wechatInstallLines.value = [...wechatInstallLines.value, e.payload.line];
    if (wechatInstallLines.value.length > 300) {
      wechatInstallLines.value = wechatInstallLines.value.slice(-300);
    }
    // 从输出行里提取微信扫码 URL（liteapp.weixin.qq.com），允许二维码刷新后更新
    const m = e.payload.line.match(/https:\/\/liteapp\.weixin\.qq\.com\/\S+/);
    if (m) {
      void setWechatQrUrl(m[0].trim());
    }
  });
  unlistenWechatQr?.();
  unlistenWechatQr = await listen<{ flowId?: string; url: string }>("channel:qr", (e) => {
    if (e.payload.flowId !== flowId) return;
    // 允许更新：二维码过期后 CLI 可能输出新 URL
    if (e.payload.url.includes("liteapp.weixin.qq.com") || e.payload.url.includes("weixin")) {
      void setWechatQrUrl(e.payload.url);
    }
  });
  unlistenWechatDone?.();
  unlistenWechatDone = await listen<{ flowId?: string; ok: boolean; exitCode?: number; error?: string }>("channel:done", (e) => {
    if (e.payload.flowId !== flowId) return;
    unlistenWechatLine?.(); unlistenWechatLine = null;
    unlistenWechatQr?.();  unlistenWechatQr = null;
    unlistenWechatDone?.(); unlistenWechatDone = null;
    if (!e.payload.ok) {
      wechatInstallState.value = "failed";
      const exitCode = e.payload.exitCode;
      const errMsg = e.payload.error;
      pushWechatLines(`登录流程结束（exitCode=${exitCode ?? "?"}${errMsg ? `，error=${errMsg}` : ""}），请检查上方日志。`);
      return;
    }
    // 扫码成功后：
    // 1. 显式写入 openclaw.json 的 channels.openclaw-weixin.enabled = true，确保网关加载此渠道
    // 2. 耐心等待 Gateway 自行重载（微信插件加载需要 10-25s），不主动 kill 进程
    //    - 先等 5s 沉淀（CLI 退出后 Gateway 可能正在重启，立刻 reloadConnection 会打断）
    //    - 再轮询最多 35s，Gateway 自行恢复则直接标记成功
    //    - 超时不标记「失败」，而是提示可能已绑定，让用户手动重启 Gateway 验证
    wechatInstallState.value = "reconnecting";
    void (async () => {
      const writeApi = getDidClawDesktopApi();
      if (writeApi?.writeChannelConfig) {
        const writeResult = await writeApi.writeChannelConfig("openclaw-weixin", { enabled: true });
        if (!writeResult.ok) {
          pushWechatLines(`⚠ 写入渠道配置失败（${(writeResult as { error?: string }).error ?? "unknown"}），网关可能不会自动加载微信渠道。`);
        }
      }
      const isGwConnected = () => (gwStore.status as string) === "connected";
      // 先给 Gateway 5s 时间处理微信插件的加载/重启
      await delay(5000);
      if (isGwConnected()) {
        wechatInstallState.value = "success";
        return;
      }
      // 触发一次软重连，然后持续轮询
      void gwStore.reloadConnection();
      const deadline = Date.now() + 35000;
      while (Date.now() < deadline) {
        await delay(800);
        if (isGwConnected()) {
          wechatInstallState.value = "success";
          return;
        }
      }
      // 35s 内未恢复：绑定动作本身可能已成功，但 Gateway 初始化仍在进行
      // 不显示「失败」，给用户清晰的下一步操作提示
      wechatInstallState.value = "pending-restart";
    })();
  });

  try {
    const gatewayUrl = gwStore.url.replace("ws://", "http://").replace("wss://", "https://");
    await api.startChannelQrFlow("wechat", gatewayUrl, flowId);
  } catch (e) {
    wechatInstallState.value = "failed";
    wechatInstallLines.value = [...wechatInstallLines.value, `Error: ${e}`];
    unlistenWechatLine?.(); unlistenWechatLine = null;
    unlistenWechatQr?.(); unlistenWechatQr = null;
    unlistenWechatDone?.(); unlistenWechatDone = null;
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
const WECHAT_PLUGIN_SPEC = "@tencent-weixin/openclaw-weixin";

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
  wechat: {},
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function withChannelReadyPatch(
  channelKey: ChannelId,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(CHANNEL_READY_META[channelKey].configPatch ?? {}),
    ...payload,
  };
}

/**
 * 仅重新建立 WS 连接（不重启网关进程）。
 * 用于网关自行重启（1012 service restart）后，DidClaw 侧恢复 WS 会话。
 * ensureOpenClawGateway 内部会检测端口是否已开放，若网关已在运行则直接连接。
 */
async function ensureGatewayConnected(timeoutMs = 18000): Promise<boolean> {
  const isConnected = () => (gwStore.status as string) === "connected";
  if (isConnected()) return true;
  await delay(2000);
  if (isConnected()) return true;
  await gwStore.reloadConnection();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isConnected()) {
      await delay(800);
      return true;
    }
    await delay(500);
  }
  return false;
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
  const deadline = Date.now() + 20000;
  const isConnected = () => (gwStore.status as string) === "connected";
  while (Date.now() < deadline) {
    if (isConnected()) {
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
  unlistenFeishuLine?.(); unlistenFeishuLine = null;
  unlistenFeishuDone?.(); unlistenFeishuDone = null;
  unlistenWechatLine?.(); unlistenWechatLine = null;
  unlistenWechatQr?.();  unlistenWechatQr = null;
  unlistenWechatDone?.(); unlistenWechatDone = null;
}

function resetWechat(): void {
  wechatInstallState.value = "idle";
  wechatInstallLines.value = [];
  wechatQrUrl.value = null;
  wechatQrDataUrl.value = null;
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
        ? "CLI 停在插件安装/选择提示，尚未真正开始 WhatsApp 登录"
        : "命令已退出，但未完成 WhatsApp 登录";
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
        qrErrorMessage.value = "CLI 已完成，但网关报告 WhatsApp 仍未 linked，请重试或重启 Gateway";
      } else {
        qrState.value = "success";
        qrWaitMessage.value = "CLI 完成，若消息未同步请重启 Gateway";
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
          ? `WhatsApp 会话已绑定，但渠道未运行（${health.lastError}）。请尝试「重新连接」或「重启 Gateway」。`
          : "WhatsApp 会话已绑定，但渠道未运行。请尝试「重新连接」或「重启 Gateway」。";
        qrProgressMessage.value = null;
        return "done";
      }
      if (health && health.linked && !health.connected) {
        qrState.value = "success";
        qrWaitMessage.value = health.lastError
          ? `WhatsApp 会话已绑定，但当前未连接（${health.lastError}）。请尝试「重新连接」。`
          : "WhatsApp 会话已绑定，但当前未连接。请尝试「重新连接」。";
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
      qrErrorMessage.value = "扫码动作已完成，但网关报告 WhatsApp 仍未 linked，请重试或重启 Gateway";
    } else {
      // 无法确认（网关断连等），给一个宽松的成功态但附带提示
      qrState.value = "success";
      qrWaitMessage.value = "扫码完成，若消息未同步请重启 Gateway";
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
  waHealth.value = null;
}

// ── Auto-close after binding success ─────────────────────────────────────────

let autoCloseTimer: number | null = null;

function scheduleAutoClose(): void {
  if (autoCloseTimer !== null) return;
  autoCloseTimer = window.setTimeout(() => {
    autoCloseTimer = null;
    if (open.value) closeDialog();
  }, 1800);
}

watch(
  () => [qrState.value, qrMode.value, wechatInstallState.value] as const,
  ([wa, mode, wc]) => {
    // WhatsApp RPC 路径成功且渠道实际健康 → 自动关闭
    // 若渠道 linked 但未 running/connected，不自动关闭（用户需手动操作）
    // WhatsApp CLI 降级路径不自动关（还需用户手动重启 Gateway）
    const healthy = !waHealth.value || (waHealth.value.running && waHealth.value.connected);
    if (wa === "success" && mode === "rpc" && healthy) {
      scheduleAutoClose();
    }
    // 微信：成功已含 restartGatewayAndReconnect，gateway 已就绪
    if (wc === "success") {
      scheduleAutoClose();
    }
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
      resetWechat();
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
              <span v-else-if="qrState === 'reconnecting'" class="ch-status-running">{{ qrProgressMessage ?? '正在验证连接状态…' }}</span>
              <template v-else-if="qrState === 'success'">
                <div v-if="qrNoScanNeeded && waHealth && waHealth.linked && (!waHealth.running || !waHealth.connected)" class="ch-session-exists">
                  <span class="ch-status-warn">⚠ {{ qrWaitMessage }}</span>
                  <span class="ch-session-hint">若消息未正常到达（Gateway 重启后常见），点「重新连接」唤醒插件</span>
                  <span class="ch-session-hint">若需切换账号，请在终端运行：<code>openclaw channels logout --channel whatsapp</code>，再点「开始扫码登录」</span>
                </div>
                <div v-else-if="qrNoScanNeeded" class="ch-session-exists">
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

          <!-- ── WeChat (Personal) ── -->
          <div v-else-if="activeTab === 'wechat'" class="ch-panel">
            <p class="ch-hint">{{ t('channel.wechat.hint') }}
              <a :href="t('channel.wechat.docLink')" target="_blank" rel="noopener" class="ch-link">文档 ↗</a>
            </p>

            <!-- 前置步骤：需先在微信客户端开启 ClawBot 插件 -->
            <div class="ch-prereq-card">
              <div class="ch-prereq-title">{{ t('channel.wechat.prereqTitle') }}</div>
              <ol class="ch-prereq-steps">
                <li>{{ t('channel.wechat.prereqStep1') }}</li>
                <li>{{ t('channel.wechat.prereqStep2') }}</li>
                <li>{{ t('channel.wechat.prereqStep3') }}</li>
              </ol>
              <p class="ch-prereq-note">⚠ {{ t('channel.wechat.prereqNote') }}</p>
            </div>

            <!-- Install wizard -->
            <div class="ch-install-card">
              <div class="ch-install-cmd-row">
                <code class="ch-code ch-code--block">{{ t('channel.wechat.installCmd') }}</code>
              </div>
              <div class="ch-qr-status" style="margin-top: 6px;">
                <span v-if="wechatInstallState === 'idle'" class="ch-status-idle">准备就绪</span>
                <span v-else-if="wechatInstallState === 'running'" class="ch-status-running">{{ t('channel.wechat.installRunning') }}</span>
                <span v-else-if="wechatInstallState === 'reconnecting'" class="ch-status-running">🔄 微信扫码已完成，等待网关重载微信插件…</span>
                <span v-else-if="wechatInstallState === 'success'" class="ch-status-ok">✓ 微信已绑定，网关已就绪，可以关闭此窗口开始对话。</span>
                <span v-else-if="wechatInstallState === 'pending-restart'" class="ch-status-warn">⚠ 微信绑定已完成，但 Gateway 仍在初始化，请点「重启 Gateway」使配置生效。</span>
                <span v-else class="ch-status-err">✗ {{ t('channel.wechat.installFail') }}</span>
              </div>

              <div v-if="wechatQrDataUrl" class="ch-qr-wrap" style="margin-top: 8px;">
                <img
                  :src="wechatQrDataUrl"
                  class="ch-qr-img"
                  alt="WeChat QR code"
                />
              </div>

              <!-- WeChat QR URL（提取出来单独显示，方便扫码或用浏览器打开） -->
              <div v-if="wechatQrUrl" class="ch-wechat-qr-box">
                <p class="ch-wechat-qr-hint">用微信「扫一扫」扫描，或点链接在浏览器打开后扫码：</p>
                <a :href="wechatQrUrl" target="_blank" rel="noopener" class="ch-link ch-wechat-qr-link">
                  {{ wechatQrUrl }}
                </a>
              </div>

              <!-- WeChat compact ticker -->
              <div v-if="wechatInstallLines.length" class="ch-wechat-ticker">
                <div class="ch-wechat-ticker__track">
                  <span class="ch-wechat-ticker__text">{{ wechatTickerText }}</span>
                  <span class="ch-wechat-ticker__text" aria-hidden="true">{{ wechatTickerText }}</span>
                </div>
              </div>

              <div class="ch-actions" style="margin-top: 8px;">
                <button
                  v-if="wechatInstallState === 'idle'"
                  type="button"
                  class="ch-btn ch-btn--primary"
                  @click="startWechatInstall"
                >{{ t('channel.wechat.startInstallBtn') }}</button>
                <button
                  v-if="wechatInstallState === 'running' || wechatInstallState === 'reconnecting'"
                  type="button"
                  class="ch-btn"
                  disabled
                >{{ wechatInstallState === 'reconnecting' ? '等待网关重载…' : t('channel.wechat.installRunning') }}</button>
                <template v-if="wechatInstallState === 'success'">
                  <button type="button" class="ch-btn ch-btn--primary" @click="closeDialog">
                    ✓ 关闭，开始对话
                  </button>
                  <button type="button" class="ch-btn" @click="resetWechat">重新绑定</button>
                </template>
                <template v-if="wechatInstallState === 'pending-restart'">
                  <button type="button" class="ch-btn ch-btn--primary" @click="restartGateway">🔄 重启 Gateway 使配置生效</button>
                  <button type="button" class="ch-btn" @click="resetWechat">重新绑定</button>
                </template>
                <template v-if="wechatInstallState === 'failed'">
                  <button type="button" class="ch-btn" @click="startWechatInstall">重试</button>
                  <button type="button" class="ch-btn" @click="restartGateway">🔄 手动重启 Gateway</button>
                </template>
              </div>
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
