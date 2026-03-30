import { ref } from "vue";
import { useGatewayStore } from "@/stores/gateway";
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import { delay } from "./useChannelContext";

export type OAuthFlowStatus = "idle" | "pending" | "complete" | "failed";

const POLL_INTERVAL_MS = 2500;
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Handles the OAuth 2.0 authorization flow:
 *   1. Calls Gateway oauth.start RPC to get auth URL + sessionId
 *   2. Opens system browser
 *   3. Polls Gateway oauth.status until complete or timed out
 *
 * Requires Gateway to implement oauth.start and oauth.status RPCs.
 * Falls back gracefully if not available.
 */
export function useOAuthFlow(channelId: string) {
  const status = ref<OAuthFlowStatus>("idle");
  const error = ref<string | null>(null);
  const gwStore = useGatewayStore();

  let aborted = false;

  async function startAuth(): Promise<boolean> {
    const gc = gwStore.client;
    if (!gc || gwStore.status !== "connected") {
      error.value = "Gateway not connected";
      status.value = "failed";
      return false;
    }

    aborted = false;
    status.value = "pending";
    error.value = null;

    try {
      const startRes = await gc.request<{ authUrl: string; sessionId: string } | null>(
        "oauth.start",
        { channelId, timeoutMs: 8000 },
      );
      if (!startRes?.authUrl || !startRes?.sessionId) {
        throw new Error("Gateway did not return a valid OAuth URL");
      }

      const api = getDidClawDesktopApi();
      if (api?.openExternalUrl) {
        await api.openExternalUrl(startRes.authUrl);
      } else {
        window.open(startRes.authUrl, "_blank");
      }

      const { sessionId } = startRes;
      const deadline = Date.now() + OAUTH_TIMEOUT_MS;

      while (Date.now() < deadline && !aborted) {
        await delay(POLL_INTERVAL_MS);
        if (aborted) break;

        const pollRes = await gc.request<{
          status: "pending" | "complete" | "failed";
          error?: string;
        } | null>("oauth.status", { sessionId, timeoutMs: 5000 });

        if (pollRes?.status === "complete") {
          status.value = "complete";
          return true;
        }
        if (pollRes?.status === "failed") {
          error.value = pollRes.error ?? "Authorization failed";
          status.value = "failed";
          return false;
        }
      }

      if (aborted) {
        status.value = "idle";
        return false;
      }

      error.value = "Authorization timed out";
      status.value = "failed";
      return false;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      status.value = "failed";
      return false;
    }
  }

  function cancel(): void {
    aborted = true;
    status.value = "idle";
    error.value = null;
  }

  function reset(): void {
    aborted = true;
    status.value = "idle";
    error.value = null;
  }

  return { status, error, startAuth, cancel, reset };
}
