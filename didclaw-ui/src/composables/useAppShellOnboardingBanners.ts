import { getDidClawDesktopApi, isDidClawElectron } from "@/lib/electron-bridge";
import {
  isFirstRunModelStepComplete,
  markFirstRunModelStepComplete,
  readModelWizardSnoozeExpired,
  setModelConfigDeferred,
  showDeferredModelBanner,
  snoozeModelWizard24h,
  syncDeferredModelBannerFromStorage,
} from "@/composables/modelConfigDeferred";
import type { useLocalSettingsStore } from "@/stores/localSettings";
import { ref, watch, type Ref } from "vue";

type LocalSettingsStore = ReturnType<typeof useLocalSettingsStore>;

/**
 * 首跑模型未完成横幅 + 延迟配置横幅（与设置关闭 / KV 联动）。
 */
export function useAppShellOnboardingBanners(localSettings: LocalSettingsStore): {
  showOnboardingResumeBanner: Ref<boolean>;
  refreshOnboardingResumeBanner: () => Promise<void>;
  onResumeOnboarding: () => void;
  onSnoozeOnboardingResume: () => void;
  onFirstRunStatusChanged: () => void;
  onDeferredBannerOpenSettings: () => void;
  onDeferredBannerDismiss: () => void;
} {
  const showOnboardingResumeBanner = ref(false);

  async function refreshOnboardingResumeBanner(): Promise<void> {
    if (!isDidClawElectron() || showDeferredModelBanner.value || !readModelWizardSnoozeExpired()) {
      showOnboardingResumeBanner.value = false;
      return;
    }
    const api = getDidClawDesktopApi();
    if (!api?.getOpenClawSetupStatus) {
      showOnboardingResumeBanner.value = !isFirstRunModelStepComplete();
      return;
    }
    try {
      const s = await api.getOpenClawSetupStatus();
      const envReady = s.openclawConfigState !== "missing";
      if (!envReady) {
        showOnboardingResumeBanner.value = false;
        return;
      }
      let modelReady = isFirstRunModelStepComplete();
      if (!modelReady && api.readOpenClawModelConfig) {
        try {
          const mc = await api.readOpenClawModelConfig();
          const primary = mc.ok ? mc.model?.primary : null;
          if (typeof primary === "string" && primary.trim().length > 0) {
            markFirstRunModelStepComplete();
            modelReady = true;
          }
        } catch {
          /* ignore */
        }
      }
      showOnboardingResumeBanner.value = !modelReady;
    } catch {
      showOnboardingResumeBanner.value = !isFirstRunModelStepComplete();
    }
  }

  function onDeferredBannerOpenSettings(): void {
    localSettings.open("providers");
  }

  function onDeferredBannerDismiss(): void {
    setModelConfigDeferred(false);
    syncDeferredModelBannerFromStorage();
  }

  function onResumeOnboarding(): void {
    showOnboardingResumeBanner.value = false;
    window.dispatchEvent(new Event("didclaw-first-run-recheck"));
  }

  function onSnoozeOnboardingResume(): void {
    showOnboardingResumeBanner.value = false;
    snoozeModelWizard24h();
  }

  function onFirstRunStatusChanged(): void {
    void refreshOnboardingResumeBanner();
  }

  watch(
    () => localSettings.visible,
    (now, prev) => {
      if (prev === true && now === false) {
        void refreshOnboardingResumeBanner();
      }
    },
  );

  watch(showDeferredModelBanner, () => {
    void refreshOnboardingResumeBanner();
  });

  return {
    showOnboardingResumeBanner,
    refreshOnboardingResumeBanner,
    onResumeOnboarding,
    onSnoozeOnboardingResume,
    onFirstRunStatusChanged,
    onDeferredBannerOpenSettings,
    onDeferredBannerDismiss,
  };
}
