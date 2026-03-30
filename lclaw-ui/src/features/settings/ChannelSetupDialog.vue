<script setup lang="ts">
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import { useGatewayStore } from "@/stores/gateway";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import QRCode from "qrcode";
import { computed, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  delay,
  provideChannelContext,
} from "./channels/base/useChannelContext";
import DiscordPanel from "./channels/discord/DiscordPanel.vue";
import WeComPanel from "./channels/wecom/WeComPanel.vue";

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

const { busy, toast, toastError, showToast, ensureGatewayConnected, restartGatewayAndReconnect, ensureChannelReady } =
  provideChannelContext({ onSuccess: scheduleAutoClose });

function closeDialog(): void { open.value = false; }

// ── Credential channels (Feishu, Discord, WeCom) ─────────────────────────────

// Feishu streaming install
type FeishuInstallState = "idle" | "running" | "success" | "failed";
const feishuInstallState = ref<FeishuInstallState>("idle");
const feishuInstallLines = ref<string[]>([]);
let unlistenFeishuLine: UnlistenFn | null = null;
let unlistenFeishuQr: UnlistenFn | null = null;
let unlistenFeishuDone: UnlistenFn | null = null;
const feishuManualOpen = ref(false);
const feishuInstallSummary = ref<string | null>(null);
const feishuSuppressedNoiseCount = ref(0);
const feishuDomain = ref<"feishu" | "lark">("feishu");
const feishuNeedsResidueCleanup = ref(false);
const feishuCleanupBusy = ref(false);
const feishuQrDataUrl = ref<string | null>(null);
const feishuTickerText = computed(() =>
  feishuInstallLines.value.length
    ? feishuInstallLines.value.join("   •   ")
    : "等待飞书安装日志…",
);

function isFeishuQrLine(line: string): boolean {
  return line.length >= 16 && /^[█▀▄ ]+$/u.test(line);
}

function extractFeishuQrBlock(lines: string[]): string[] {
  let best: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (isFeishuQrLine(line)) {
      current.push(line);
      continue;
    }
    if (current.length > best.length) {
      best = current;
    }
    current = [];
  }
  if (current.length > best.length) {
    best = current;
  }
  return best.length >= 10 ? best : [];
}

function buildSvgQrDataUrl(block: string[]): string | null {
  if (!block.length) return null;
  const width = Math.max(...block.map((line) => line.length));
  const rows: boolean[][] = [];

  for (const rawLine of block) {
    const line = rawLine.padEnd(width, " ");
    const top: boolean[] = [];
    const bottom: boolean[] = [];
    for (const ch of line) {
      switch (ch) {
        case "█":
          top.push(true);
          bottom.push(true);
          break;
        case "▀":
          top.push(true);
          bottom.push(false);
          break;
        case "▄":
          top.push(false);
          bottom.push(true);
          break;
        default:
          top.push(false);
          bottom.push(false);
          break;
      }
    }
    rows.push(top, bottom);
  }

  if (!rows.length || !rows[0]?.length) return null;

  const height = rows.length;
  const matrixWidth = rows[0].length;
  const margin = 4;
  const scale = 6;
  const svgWidth = (matrixWidth + margin * 2) * scale;
  const svgHeight = (height + margin * 2) * scale;

  const rects: string[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < matrixWidth; x += 1) {
      if (!rows[y]?.[x]) continue;
      rects.push(
        `<rect x="${(x + margin) * scale}" y="${(y + margin) * scale}" width="${scale}" height="${scale}" fill="#000"/>`,
      );
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/>${rects.join("")}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function refreshFeishuQrData(): void {
  feishuQrDataUrl.value = buildSvgQrDataUrl(extractFeishuQrBlock(feishuInstallLines.value));
}

async function setFeishuQrUrl(url: string | null): Promise<void> {
  if (!url) {
    feishuQrDataUrl.value = null;
    return;
  }
  try {
    feishuQrDataUrl.value = await QRCode.toDataURL(url, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: "M",
    });
  } catch {
    feishuQrDataUrl.value = null;
  }
}

function feishuLineSuggestsResidue(line: string): boolean {
  return /plugin already exists|plugin not found:\s*openclaw-lark|delete it first/i.test(line);
}

function shouldSuppressFeishuLine(line: string): boolean {
  return (
    /^npm warn Unknown env config /i.test(line) ||
    /plugins\.entries\.whatsapp: plugin whatsapp: duplicate plugin id detected/i.test(line) ||
    /extensions[\\/](whatsapp)[\\/]/i.test(line)
  );
}

function pushFeishuLines(raw?: string | null): void {
  if (!raw) return;
  const chunks = raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  if (!chunks.length) return;

  const next = [...feishuInstallLines.value];
  for (const line of chunks) {
    if (feishuLineSuggestsResidue(line)) {
      feishuNeedsResidueCleanup.value = true;
    }
    if (shouldSuppressFeishuLine(line)) {
      feishuSuppressedNoiseCount.value += 1;
      continue;
    }
    if (next[next.length - 1] === line) {
      continue;
    }
    next.push(line);
  }
  feishuInstallLines.value = next.slice(-300);
  refreshFeishuQrData();
}

async function ensureOpenClawReadyForFeishu(): Promise<boolean> {
  const api = getDidClawDesktopApi();
  if (!api?.getOpenClawSetupStatus) {
    return true;
  }
  try {
    const s = await api.getOpenClawSetupStatus();
    if (!s.openclawDirExists || !s.openclawCli?.ok) {
      feishuInstallState.value = "failed";
      feishuInstallSummary.value = "请先完成应用初始化设置，重启应用后将自动引导完成配置。";
      return false;
    }
  } catch {
    /* ignore and continue */
  }
  return true;
}

async function finalizeFeishuInstall(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (api?.writeChannelConfig) {
    try {
      const result = await api.writeChannelConfig("feishu", { enabled: true });
      if (!result.ok) {
        pushFeishuLines(
          `⚠ 已完成飞书安装向导，但启用 channels.feishu.enabled 失败：${(result as { error?: string }).error ?? "unknown"}`,
        );
      }
    } catch (e) {
      pushFeishuLines(`⚠ 已完成飞书安装向导，但写入飞书渠道配置失败：${String((e as Error)?.message ?? e)}`);
    }
  }

  feishuManualOpen.value = false;
  feishuNeedsResidueCleanup.value = false;
  feishuInstallState.value = "success";
  feishuInstallSummary.value = "飞书安装向导已完成！点「重启 AI 服务」按钮使配置生效，然后在飞书中向 AI 发一条消息验证是否正常响应。";
}

async function cleanupFeishuResidue(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.cleanupChannelResidue) {
    feishuInstallSummary.value = "自动清理失败，请重新运行安装向导，或重启应用后再试。";
    return;
  }

  feishuCleanupBusy.value = true;
  try {
    const result = await api.cleanupChannelResidue("feishu");
    if (!result.ok) {
      feishuInstallSummary.value = `清理飞书残留失败：${result.error}`;
      return;
    }
    const removedCount = result.removed.length + result.removedDirs.length;
    feishuNeedsResidueCleanup.value = false;
    feishuInstallLines.value = [];
    feishuQrDataUrl.value = null;
    feishuSuppressedNoiseCount.value = 0;
    feishuInstallState.value = "idle";
    feishuInstallSummary.value =
      removedCount > 0
        ? "已清理飞书残留配置，可以重新运行安装向导。"
        : "未发现飞书残留目录；若仍失败，可直接重新运行安装向导。";
  } catch (e) {
    feishuInstallSummary.value = `清理飞书残留失败：${String((e as Error)?.message ?? e)}`;
  } finally {
    feishuCleanupBusy.value = false;
  }
}

async function startFeishuInstall(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.startChannelQrFlow) {
    feishuInstallState.value = "failed";
    feishuInstallSummary.value = "当前桌面端不支持飞书安装向导";
    return;
  }

  feishuInstallState.value = "running";
  feishuInstallLines.value = [];
  feishuQrDataUrl.value = null;
  feishuInstallSummary.value = "正在运行飞书官方安装向导，请按终端提示完成创建/关联机器人。";
  feishuSuppressedNoiseCount.value = 0;
  feishuNeedsResidueCleanup.value = false;

  const envReady = await ensureOpenClawReadyForFeishu();
  if (!envReady) {
    return;
  }

  const feishuFlowId = crypto.randomUUID();

  unlistenFeishuLine?.();
  unlistenFeishuLine = await listen<{ flowId?: string; stream: string; line: string }>("channel:line", (e) => {
    if (e.payload.flowId !== feishuFlowId) return;
    pushFeishuLines(e.payload.line);
  });
  unlistenFeishuQr?.();
  unlistenFeishuQr = await listen<{ flowId?: string; url: string }>("channel:qr", (e) => {
    if (e.payload.flowId !== feishuFlowId) return;
    void setFeishuQrUrl(e.payload.url);
  });
  unlistenFeishuDone?.();
  unlistenFeishuDone = await listen<{ flowId?: string; ok: boolean; exitCode?: number; error?: string }>("channel:done", (e) => {
    if (e.payload.flowId !== feishuFlowId) return;
    unlistenFeishuLine?.(); unlistenFeishuLine = null;
    unlistenFeishuQr?.(); unlistenFeishuQr = null;
    unlistenFeishuDone?.(); unlistenFeishuDone = null;
    if (!e.payload.ok) {
      feishuInstallState.value = "failed";
      feishuInstallSummary.value = feishuNeedsResidueCleanup.value
        ? "检测到旧的飞书插件残留，请先点下方“清理飞书残留”再重新运行安装向导。"
        : `安装向导退出失败（退出码 ${e.payload.exitCode ?? "?"}）`;
      if (e.payload.error) {
        pushFeishuLines(`Error: ${e.payload.error}`);
      }
      return;
    }
    void finalizeFeishuInstall();
  });

  try {
    const gatewayUrl = gwStore.url.replace("ws://", "http://").replace("wss://", "https://");
    await api.startChannelQrFlow("feishu", gatewayUrl, feishuFlowId);
  } catch (e) {
    feishuInstallState.value = "failed";
    feishuInstallSummary.value = "启动飞书安装向导失败";
    pushFeishuLines(`Error: ${e}`);
    unlistenFeishuLine?.(); unlistenFeishuLine = null;
    unlistenFeishuQr?.(); unlistenFeishuQr = null;
    unlistenFeishuDone?.(); unlistenFeishuDone = null;
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
    pushWechatLines("AI 服务正在重启，等待恢复…");
    const reconnected = await ensureGatewayConnected();
    if (!reconnected) {
      pushWechatLines("连接超时，仍将尝试扫码登录…");
    } else {
      pushWechatLines("连接已恢复。");
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
          pushWechatLines(`⚠ 写入渠道配置失败（${(writeResult as { error?: string }).error ?? "unknown"}），AI 服务可能无法自动加载微信配置。`);
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

const WECHAT_PLUGIN_SPEC = "@tencent-weixin/openclaw-weixin";

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


async function saveCredentialChannel(channelKey: ChannelId): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api) return;

  if (channelKey === "feishu") {
    const appId = feishuAppId.value.trim();
    const appSecret = feishuAppSecret.value.trim();
    if (!appId || !appSecret) { showToast("请填写 App ID 和 App Secret", true); return; }
    if (!api.configureFeishuPlugin) {
      showToast("当前桌面端不支持写入飞书官方插件配置，请先重启应用更新桌面端。", true);
      return;
    }
    busy.value = true;
    try {
      const r = await api.configureFeishuPlugin({ appId, appSecret, domain: feishuDomain.value });
      if (r.ok) {
        showToast("已写入飞书官方插件配置");
      } else {
        showToast(`保存失败：${r.error}`, true);
      }
    } catch (e) {
      showToast(t("channel.saveFail") + `：${e}`, true);
    } finally {
      busy.value = false;
    }
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
  unlistenFeishuQr?.(); unlistenFeishuQr = null;
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
          <div v-else-if="activeTab === 'feishu'" class="ch-panel">
            <p class="ch-hint">
              {{ t('channel.feishu.hint') }}
              <a :href="t('channel.feishu.docLink')" target="_blank" rel="noopener" class="ch-link">官方文档 ↗</a>
            </p>

            <!-- Install wizard (primary path) -->
            <div class="ch-install-card">
              <div class="ch-install-info-row">
                <span class="ch-install-info-text">向导将自动创建飞书机器人并完成配置</span>
              </div>
              <div class="ch-qr-status" style="margin-top: 6px;">
                <span v-if="feishuInstallState === 'idle'" class="ch-status-idle">准备就绪</span>
                <span v-else-if="feishuInstallState === 'running'" class="ch-status-running">{{ t('channel.feishu.installRunning') }}</span>
                <span v-else-if="feishuInstallState === 'success'" class="ch-status-ok">✓ {{ t('channel.feishu.installSuccess') }}</span>
                <span v-else class="ch-status-err">✗ {{ t('channel.feishu.installFail') }}</span>
              </div>
              <p v-if="feishuInstallSummary" class="ch-restart-hint" style="margin-top: 8px;">
                {{ feishuInstallSummary }}
              </p>
              <p
                v-if="feishuSuppressedNoiseCount > 0"
                class="muted small"
                style="margin-top: 6px;"
              >
                已省略 {{ feishuSuppressedNoiseCount }} 条与飞书安装无关的重复插件警告，避免干扰查看。
              </p>
              <div v-if="feishuQrDataUrl" class="ch-qr-wrap" style="margin-top: 8px;">
                <img
                  :src="feishuQrDataUrl"
                  class="ch-qr-img"
                  alt="Feishu QR code"
                >
              </div>

              <div v-if="feishuInstallLines.length" class="ch-wechat-ticker" style="margin-top: 8px;">
                <div class="ch-wechat-ticker__track">
                  <span class="ch-wechat-ticker__text">{{ feishuTickerText }}</span>
                  <span class="ch-wechat-ticker__text" aria-hidden="true">{{ feishuTickerText }}</span>
                </div>
              </div>

              <div class="ch-actions" style="margin-top: 8px;">
                <button
                  v-if="feishuInstallState === 'idle' || feishuInstallState === 'failed'"
                  type="button"
                  class="ch-btn ch-btn--primary"
                  @click="startFeishuInstall"
                >
                  {{ t('channel.feishu.startInstallBtn') }}
                </button>
                <button v-if="feishuInstallState === 'running'" type="button" class="ch-btn" disabled>
                  {{ t('channel.feishu.installRunning') }}
                </button>
                <button v-if="feishuInstallState === 'success'" type="button" class="ch-btn ch-btn--primary" @click="restartGateway">
                  🔄 重启 AI 服务
                </button>
                <button
                  v-if="feishuInstallState === 'success'"
                  type="button"
                  class="ch-btn"
                  @click="startFeishuInstall"
                >
                  重新运行向导
                </button>
                <button
                  v-if="feishuNeedsResidueCleanup"
                  type="button"
                  class="ch-btn"
                  :disabled="feishuCleanupBusy"
                  @click="cleanupFeishuResidue"
                >
                  {{ feishuCleanupBusy ? '清理中…' : '清理飞书残留' }}
                </button>
              </div>
            </div>

            <!-- Manual credentials (collapsible fallback) -->
            <button type="button" class="ch-toggle-manual" @click="feishuManualOpen = !feishuManualOpen">
              {{ feishuManualOpen ? '▾' : '▸' }} {{ t('channel.feishu.orManual') }}
            </button>
            <template v-if="feishuManualOpen">
              <div class="ch-form">
                <label class="ch-label">{{ t('channel.feishu.domain') }}</label>
                <select v-model="feishuDomain" class="ch-select">
                  <option value="feishu">{{ t('channel.feishu.domainFeishu') }}</option>
                  <option value="lark">{{ t('channel.feishu.domainLark') }}</option>
                </select>
                <label class="ch-label">{{ t('channel.feishu.appId') }}</label>
                <input v-model="feishuAppId" type="text" class="ch-input" :placeholder="t('channel.feishu.appIdPlh')">
                <label class="ch-label">{{ t('channel.feishu.appSecret') }}</label>
                <input v-model="feishuAppSecret" type="password" class="ch-input" :placeholder="t('channel.feishu.appSecretPlh')">
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
            <p class="ch-hint">
              {{ t('channel.wechat.hint') }}
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
              <div class="ch-install-info-row">
                <span class="ch-install-info-text">点击按钮后自动安装微信官方组件并生成绑定二维码</span>
              </div>
              <div class="ch-qr-status" style="margin-top: 6px;">
                <span v-if="wechatInstallState === 'idle'" class="ch-status-idle">准备就绪</span>
                <span v-else-if="wechatInstallState === 'running'" class="ch-status-running">{{ t('channel.wechat.installRunning') }}</span>
                <span v-else-if="wechatInstallState === 'reconnecting'" class="ch-status-running">🔄 扫码已完成，正在加载微信配置，请稍候…</span>
                <span v-else-if="wechatInstallState === 'success'" class="ch-status-ok">✓ 微信已绑定，可以关闭此窗口开始对话。</span>
                <span v-else-if="wechatInstallState === 'pending-restart'" class="ch-status-warn">⚠ 微信绑定已完成，但 AI 服务尚在初始化中，请点「重启 AI 服务」完成配置。</span>
                <span v-else class="ch-status-err">✗ {{ t('channel.wechat.installFail') }}</span>
              </div>

              <div v-if="wechatQrDataUrl" class="ch-qr-wrap" style="margin-top: 8px;">
                <img
                  :src="wechatQrDataUrl"
                  class="ch-qr-img"
                  alt="WeChat QR code"
                >
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
                >
                  {{ t('channel.wechat.startInstallBtn') }}
                </button>
                <button
                  v-if="wechatInstallState === 'running' || wechatInstallState === 'reconnecting'"
                  type="button"
                  class="ch-btn"
                  disabled
                >
                  {{ wechatInstallState === 'reconnecting' ? '等待 AI 服务重载…' : t('channel.wechat.installRunning') }}
                </button>
                <template v-if="wechatInstallState === 'success'">
                  <button type="button" class="ch-btn ch-btn--primary" @click="closeDialog">
                    ✓ 关闭，开始对话
                  </button>
                  <button type="button" class="ch-btn" @click="resetWechat">重新绑定</button>
                </template>
                <template v-if="wechatInstallState === 'pending-restart'">
                  <button type="button" class="ch-btn ch-btn--primary" @click="restartGateway">🔄 重启 AI 服务</button>
                  <button type="button" class="ch-btn" @click="resetWechat">重新绑定</button>
                </template>
                <template v-if="wechatInstallState === 'failed'">
                  <button type="button" class="ch-btn" @click="startWechatInstall">重试</button>
                  <button type="button" class="ch-btn" @click="restartGateway">🔄 重启 AI 服务</button>
                </template>
              </div>
            </div>
          </div>

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
