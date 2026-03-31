import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import { useGatewayStore } from "@/stores/gateway";
import { type InjectionKey, inject, onUnmounted, provide, ref } from "vue";
import { useI18n } from "vue-i18n";
import type {
  ChannelContext,
  EnsureChannelReadyOptions,
} from "../types";

const CHANNEL_CTX: InjectionKey<ChannelContext> = Symbol("channelCtx");

// ── Built-in channel metadata ─────────────────────────────────────────────────
// Each entry describes what the shared ensureChannelReady helper should do.
// Channel-specific panels may override individual steps via EnsureChannelReadyOptions.

type ChannelReadyMeta = {
  pluginPackageSpec?: string;
  configPatch?: Record<string, unknown>;
  restartGatewayAfterSetup?: boolean;
};

const BUILTIN_CHANNEL_META: Record<string, ChannelReadyMeta> = {
  whatsapp: {
    pluginPackageSpec: "@openclaw/whatsapp",
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
    pluginPackageSpec: "@wecom/wecom-openclaw-plugin",
    configPatch: { enabled: true },
  },
  wechat: {},
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Context factory ───────────────────────────────────────────────────────────

export interface ProvideChannelContextOptions {
  onSuccess: () => void;
}

/**
 * Creates the shared channel context and provides it to all descendant panels.
 * Call this once from ChannelSetupDialog's setup().
 * Returns the context so the dialog can bind toast state to its own template.
 */
export function provideChannelContext(
  options: ProvideChannelContextOptions,
): ChannelContext {
  const gwStore = useGatewayStore();
  const { t } = useI18n();

  const busy = ref(false);
  const toast = ref<string | null>(null);
  const toastError = ref(false);

  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  function showToast(msg: string, error = false): void {
    toast.value = msg;
    toastError.value = error;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.value = null;
    }, 5000);
  }

  onUnmounted(() => {
    if (toastTimer) clearTimeout(toastTimer);
  });

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

  async function restartGatewayAndReconnect(
    toastMessage = "Gateway 重启中，稍等片刻…",
  ): Promise<boolean> {
    const api = getDidClawDesktopApi();
    if (!api?.restartOpenClawGateway) {
      showToast("当前不支持重启 AI 服务", true);
      return false;
    }
    const result = await api.restartOpenClawGateway();
    if (!result?.ok) {
      showToast(
        `重启 AI 服务失败：${(result as { error?: string }).error ?? "未知错误"}`,
        true,
      );
      return false;
    }
    showToast(toastMessage);
    await gwStore.reloadConnection();
    const isConnected = () => (gwStore.status as string) === "connected";
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (isConnected()) {
        await delay(800);
        return true;
      }
      await delay(500);
    }
    showToast("AI 服务重启后连接未恢复，请稍后重试。", true);
    return false;
  }

  async function ensureChannelReady(
    channelKey: string,
    opts: EnsureChannelReadyOptions = {},
  ): Promise<boolean> {
    const api = getDidClawDesktopApi();
    const meta = BUILTIN_CHANNEL_META[channelKey] ?? {};

    if (opts.installPlugin && meta.pluginPackageSpec) {
      if (!api?.openclawPluginsInstall) {
        showToast(opts.installFailureMessage ?? "桌面端不支持插件安装", true);
        return false;
      }
      const result = await api.openclawPluginsInstall({
        packageSpec: meta.pluginPackageSpec,
      });
      if (!result.ok) {
        showToast(
          (opts.installFailureMessage ?? t("channel.pluginInstallFail")) +
            ((result as { error?: string }).error
              ? `：${(result as { error?: string }).error}`
              : ""),
          true,
        );
        return false;
      }
    }

    if (opts.writeConfigPatch && meta.configPatch) {
      if (!api?.writeChannelConfig) {
        showToast(opts.configFailureMessage ?? "桌面端不支持写入渠道配置", true);
        return false;
      }
      const result = await api.writeChannelConfig(channelKey, meta.configPatch);
      if (!result.ok) {
        showToast(
          (opts.configFailureMessage ?? t("channel.saveFail")) +
            `：${(result as { error?: string }).error ?? "未知错误"}`,
          true,
        );
        return false;
      }
    }

    const shouldRestart =
      opts.restartGateway ?? meta.restartGatewayAfterSetup ?? false;
    if (shouldRestart) {
      const restarted = await restartGatewayAndReconnect(opts.restartToast);
      if (!restarted) return false;
    }

    if (opts.successToast) showToast(opts.successToast);
    return true;
  }

  const ctx: ChannelContext = {
    busy,
    toast,
    toastError,
    showToast,
    ensureGatewayConnected,
    restartGatewayAndReconnect,
    ensureChannelReady,
    onSuccess: options.onSuccess,
  };

  provide(CHANNEL_CTX, ctx);
  return ctx;
}

/**
 * Injects the channel context inside a panel component.
 * Must be called from a component that is a descendant of ChannelSetupDialog.
 */
export function useChannelContext(): ChannelContext {
  const ctx = inject(CHANNEL_CTX);
  if (!ctx) {
    throw new Error(
      "useChannelContext() must be called inside a channel panel (descendant of ChannelSetupDialog)",
    );
  }
  return ctx;
}
