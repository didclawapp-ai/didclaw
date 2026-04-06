import { getDidClawDesktopApi } from "@/lib/electron-bridge";

export type EnsureDesktopGatewayResult =
  | { kind: "ok"; gatewayWasFreshlyStarted: boolean }
  | { kind: "error"; message: string }
  | { kind: "stale" };

/**
 * 桌面壳在建立 WebSocket 前确保 OpenClaw Gateway 进程已就绪（Rust 侧已 sleep；此处再留缓冲给 4.x 慢启）。
 * Web / 无 `ensureOpenClawGateway` 时直接视为已就绪。
 */
export async function ensureDesktopOpenClawGatewayForConnect(params: {
  wsUrl: string;
  isStale: () => boolean;
  delayMs: (ms: number) => Promise<void>;
}): Promise<EnsureDesktopGatewayResult> {
  const desktop = getDidClawDesktopApi();
  if (!desktop?.ensureOpenClawGateway) {
    return { kind: "ok", gatewayWasFreshlyStarted: false };
  }
  const ensured = await desktop.ensureOpenClawGateway({ wsUrl: params.wsUrl });
  if (params.isStale()) {
    return { kind: "stale" };
  }
  if (!ensured.ok) {
    return { kind: "error", message: ensured.error };
  }
  if (ensured.started) {
    await params.delayMs(2800);
    if (params.isStale()) {
      return { kind: "stale" };
    }
    return { kind: "ok", gatewayWasFreshlyStarted: true };
  }
  return { kind: "ok", gatewayWasFreshlyStarted: false };
}
