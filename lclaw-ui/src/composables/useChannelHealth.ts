import { useGatewayStore } from "@/stores/gateway";
import { ref, watch, readonly } from "vue";

export type WhatsAppHealth = {
  linked: boolean;
  running: boolean;
  connected: boolean;
  lastError: string | null;
};

const POLL_INTERVAL_MS = 30_000;

const whatsAppHealth = ref<WhatsAppHealth | null>(null);
const polling = ref(false);

let pollTimer: number | null = null;
let initialized = false;
let autoRecoveryAttempted = false;

async function fetchHealth(): Promise<WhatsAppHealth | null> {
  const gw = useGatewayStore();
  const gc = gw.client;
  if (!gc || gw.status !== "connected") return null;
  try {
    const res = await gc.request<{ channels?: Record<string, unknown> } | null>(
      "channels.status",
      { probe: false, timeoutMs: 8000 },
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

async function tryAutoRecovery(): Promise<void> {
  if (autoRecoveryAttempted) return;
  const gw = useGatewayStore();
  const gc = gw.client;
  if (!gc || gw.status !== "connected") return;
  autoRecoveryAttempted = true;
  try {
    await gc.request("web.login.start", { force: false });
    await new Promise((r) => setTimeout(r, 4000));
    const h = await fetchHealth();
    whatsAppHealth.value = h;
    if (h && h.running) return;

    const { getDidClawDesktopApi } = await import("@/lib/electron-bridge");
    const api = getDidClawDesktopApi();
    if (!api?.restartOpenClawGateway) return;
    const result = await api.restartOpenClawGateway();
    if (!result?.ok) return;
    await gw.reloadConnection();
    await new Promise((r) => setTimeout(r, 6000));
    whatsAppHealth.value = await fetchHealth();
  } catch {
    // Silently ignore — recovery is best-effort
  }
}

async function pollOnce(): Promise<void> {
  const health = await fetchHealth();
  whatsAppHealth.value = health;
  if (health && health.linked && !health.running) {
    void tryAutoRecovery();
  }
  if (health?.running) {
    autoRecoveryAttempted = false;
  }
}

function startPolling(): void {
  if (polling.value) return;
  polling.value = true;
  autoRecoveryAttempted = false;
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
  autoRecoveryAttempted = false;
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

/** Trigger an immediate health refresh (e.g. after QR link completes). */
export async function queryChannelHealthNow(): Promise<WhatsAppHealth | null> {
  const health = await fetchHealth();
  whatsAppHealth.value = health;
  return health;
}

export function useChannelHealth() {
  init();
  return {
    whatsAppHealth: readonly(whatsAppHealth),
  };
}
