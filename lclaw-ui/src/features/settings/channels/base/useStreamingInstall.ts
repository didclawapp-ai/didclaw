import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import { useGatewayStore } from "@/stores/gateway";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ref } from "vue";

export type InstallState =
  | "idle"
  | "running"
  | "success"
  | "failed";

export interface StreamingInstallOptions {
  channelId: string;
  /**
   * Called for each incoming line from channel:line.
   * Return `{ keep: false }` to suppress the line (not added to buffer).
   * Return `{ keep: true, line }` to push the (optionally transformed) line.
   */
  processLine?: (line: string) => { keep: boolean; line?: string };
  /** Called when a channel:qr URL event arrives. */
  onQrUrl?: (url: string) => Promise<void>;
  /** Called after channel:done reports ok:true, before state → success. */
  onSuccess: () => Promise<void>;
  /**
   * Called after channel:done reports ok:false.
   * If not provided, state is simply set to "failed".
   */
  onFail?: (exitCode: number | undefined, error: string | undefined) => void;
}

export function useStreamingInstall(opts: StreamingInstallOptions) {
  const gwStore = useGatewayStore();

  const state = ref<InstallState>("idle");
  const lines = ref<string[]>([]);

  let unlistenLine: UnlistenFn | null = null;
  let unlistenQr: UnlistenFn | null = null;
  let unlistenDone: UnlistenFn | null = null;

  function cleanup(): void {
    unlistenLine?.(); unlistenLine = null;
    unlistenQr?.();   unlistenQr = null;
    unlistenDone?.(); unlistenDone = null;
  }

  function reset(): void {
    cleanup();
    state.value = "idle";
    lines.value = [];
  }

  function pushLine(raw: string): void {
    if (!raw) return;
    const chunks = raw
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter(Boolean);
    if (!chunks.length) return;

    const next = [...lines.value];
    for (const chunk of chunks) {
      if (opts.processLine) {
        const result = opts.processLine(chunk);
        if (!result.keep) continue;
        const toAdd = result.line ?? chunk;
        if (next[next.length - 1] === toAdd) continue;
        next.push(toAdd);
      } else {
        if (next[next.length - 1] === chunk) continue;
        next.push(chunk);
      }
    }
    lines.value = next.slice(-300);
  }

  async function start(): Promise<void> {
    const api = getDidClawDesktopApi();
    if (!api?.startChannelQrFlow) {
      state.value = "failed";
      return;
    }

    state.value = "running";
    lines.value = [];

    const flowId = crypto.randomUUID();

    cleanup();

    unlistenLine = await listen<{ flowId?: string; line: string }>(
      "channel:line",
      (e) => {
        if (e.payload.flowId !== flowId) return;
        pushLine(e.payload.line);
      },
    );

    unlistenQr = await listen<{ flowId?: string; url: string }>(
      "channel:qr",
      (e) => {
        if (e.payload.flowId !== flowId) return;
        if (opts.onQrUrl) void opts.onQrUrl(e.payload.url);
      },
    );

    unlistenDone = await listen<{
      flowId?: string;
      ok: boolean;
      exitCode?: number;
      error?: string;
    }>("channel:done", (e) => {
      if (e.payload.flowId !== flowId) return;
      cleanup();
      if (!e.payload.ok) {
        state.value = "failed";
        opts.onFail?.(e.payload.exitCode, e.payload.error);
        return;
      }
      void opts.onSuccess().then(() => {
        state.value = "success";
      });
    });

    try {
      const gatewayUrl = gwStore.url
        .replace("ws://", "http://")
        .replace("wss://", "https://");
      await api.startChannelQrFlow(opts.channelId, gatewayUrl, flowId);
    } catch (e) {
      state.value = "failed";
      pushLine(`Error: ${e}`);
      cleanup();
    }
  }

  return { state, lines, start, cleanup, reset, pushLine };
}
