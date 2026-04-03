import { getDidClawDesktopApi, isDidClawElectron } from "@/lib/electron-bridge";
import { scheduleDeferredGatewayConnect } from "@/composables/deferredGatewayConnect";
import { isFirstRunModelStepComplete, syncDeferredModelBannerFromStorage } from "@/composables/modelConfigDeferred";
import { restartGatewayAfterControlUiMerge } from "@/composables/restartGatewayAfterControlUiMerge";
import type { useChatStore } from "@/stores/chat";
import type { useGatewayStore } from "@/stores/gateway";
import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { nextTick, onMounted, onUnmounted } from "vue";

type GatewayStore = ReturnType<typeof useGatewayStore>;
type ChatStore = ReturnType<typeof useChatStore>;

/**
 * 桌面首启、托盘、延迟连网关。键盘与 document 点击由 AppShell 另行注册。
 */
export function useAppShellLifecycle(opts: {
  gw: GatewayStore;
  chat: ChatStore;
  refreshOnboardingResumeBanner: () => void | Promise<void>;
  onFirstRunStatusChanged: () => void;
  handleTrayAction: (action: string) => void;
}): void {
  let unlistenTrayAction: UnlistenFn | undefined;

  onMounted(() => {
    if (isDidClawElectron()) {
      syncDeferredModelBannerFromStorage();
      void opts.chat.refreshOpenClawModelPicker();
      void opts.refreshOnboardingResumeBanner();
      window.addEventListener("didclaw-first-run-status-changed", opts.onFirstRunStatusChanged);
      if (isTauri()) {
        void listen<string>("didclaw-tray-action", (event) => {
          if (typeof event.payload === "string" && event.payload.length > 0) {
            opts.handleTrayAction(event.payload);
          }
        }).then((fn) => {
          unlistenTrayAction = fn;
        });
      }
    }
    void nextTick(() => {
      void (async () => {
        const api = getDidClawDesktopApi();
        if (!isDidClawElectron()) {
          window.setTimeout(() => {
            opts.gw.connect();
          }, 150);
          return;
        }
        if (!api?.getOpenClawSetupStatus) {
          scheduleDeferredGatewayConnect(opts.gw);
          return;
        }
        try {
          const s = await api.getOpenClawSetupStatus();
          if (s.controlUiAllowedOriginsMerged) {
            await restartGatewayAfterControlUiMerge(opts.gw);
          }
          const envReady = s.openclawDirExists && s.openclawConfigState !== "missing";
          const modelReady = isFirstRunModelStepComplete();
          if (!envReady || !modelReady) {
            return;
          }
          scheduleDeferredGatewayConnect(opts.gw);
        } catch {
          scheduleDeferredGatewayConnect(opts.gw);
        }
      })();
    });
  });

  onUnmounted(() => {
    window.removeEventListener("didclaw-first-run-status-changed", opts.onFirstRunStatusChanged);
    unlistenTrayAction?.();
  });
}
