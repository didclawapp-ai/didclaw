import { useGatewayStore } from "@/stores/gateway";
import { ref, watch, readonly } from "vue";

export type ChannelHealth = {
  linked: boolean;
  running: boolean;
  connected: boolean;
  lastError: string | null;
};

/** @deprecated Use ChannelHealth */
export type WhatsAppHealth = ChannelHealth;

const POLL_INTERVAL_MS = 30_000;

const whatsAppHealth = ref<ChannelHealth | null>(null);
const wechatHealth = ref<ChannelHealth | null>(null);
const polling = ref(false);

let pollTimer: number | null = null;
let initialized = false;
let waAutoRecoveryAttempted = false;

function parseChannelEntry(ch: unknown): ChannelHealth | null {
  if (!ch || typeof ch !== "object") return null;
  const c = ch as Record<string, unknown>;
  return {
    linked: c.linked === true,
    running: c.running === true,
    connected: c.connected === true,
    lastError: (c.lastError as string | null | undefined) ?? null,
  };
}

async function fetchAllHealth(): Promise<void> {
  const gw = useGatewayStore();
  const gc = gw.client;
  if (!gc || gw.status !== "connected") return;
  try {
    const res = await gc.request<{ channels?: Record<string, unknown> } | null>(
      "channels.status",
      { probe: false, timeoutMs: 8000 },
    );
    whatsAppHealth.value = parseChannelEntry(res?.channels?.whatsapp);
    // WeChat personal channel is registered by plugin id `openclaw-weixin`.
    // Keep a legacy `wechat` fallback in case an older gateway aliases it.
    wechatHealth.value = parseChannelEntry(
      res?.channels?.["openclaw-weixin"] ?? res?.channels?.wechat,
    );
  } catch {
    // leave values unchanged on error
  }
}

async function tryWaAutoRecovery(): Promise<void> {
  if (waAutoRecoveryAttempted) return;
  const gw = useGatewayStore();
  const gc = gw.client;
  if (!gc || gw.status !== "connected") return;
  waAutoRecoveryAttempted = true;
  try {
    await gc.request("web.login.start", { force: false });
    await new Promise((r) => setTimeout(r, 4000));
    await fetchAllHealth();
    if (whatsAppHealth.value?.running) return;

    const { getDidClawDesktopApi } = await import("@/lib/electron-bridge");
    const api = getDidClawDesktopApi();
    if (!api?.restartOpenClawGateway) return;
    const result = await api.restartOpenClawGateway();
    if (!result?.ok) return;
    await gw.reloadConnection();
    await new Promise((r) => setTimeout(r, 6000));
    await fetchAllHealth();
  } catch {
    // Silently ignore — recovery is best-effort
  }
}

async function pollOnce(): Promise<void> {
  const prevWa = whatsAppHealth.value;
  await fetchAllHealth();

  const wa = whatsAppHealth.value;
  if (wa && wa.linked && !wa.running) {
    void tryWaAutoRecovery();
  }
  if (wa?.running && !prevWa?.running) {
    waAutoRecoveryAttempted = false;
  }
}

function startPolling(): void {
  if (polling.value) return;
  polling.value = true;
  waAutoRecoveryAttempted = false;
  void pollOnce();
  pollTimer = window.setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
}

function stopPolling(): void {
  polling.value = false;
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  whatsAppHealth.value = null;
  wechatHealth.value = null;
  waAutoRecoveryAttempted = false;
}

function init(): void {
  if (initialized) return;
  initialized = true;
  const gw = useGatewayStore();
  watch(
    () => gw.status,
    (s) => {
      if (s === "connected") {
        startPolling();
      } else {
        stopPolling();
      }
    },
    { immediate: true },
  );
}

/** Trigger an immediate health refresh for all channels. */
export async function queryChannelHealthNow(): Promise<ChannelHealth | null> {
  await fetchAllHealth();
  return whatsAppHealth.value;
}

/** Trigger an immediate health refresh and return wechat health. */
export async function queryWechatHealthNow(): Promise<ChannelHealth | null> {
  await fetchAllHealth();
  return wechatHealth.value;
}

export function useChannelHealth() {
  init();
  return {
    whatsAppHealth: readonly(whatsAppHealth),
    wechatHealth: readonly(wechatHealth),
  };
}
