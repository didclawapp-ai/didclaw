import { ref } from "vue";

const LS_MODEL_COMPLETE = "lclaw_first_run_model_complete";
const LS_DEFERRED = "lclaw_model_config_deferred";
const LS_MODEL_SNOOZE = "lclaw_model_wizard_snooze_until";

const SNOOZE_MS = 24 * 60 * 60 * 1000;

/** 主界面「稍后配置模型」提示条是否显示（与 localStorage 同步） */
export const showDeferredModelBanner = ref(false);

export function syncDeferredModelBannerFromStorage(): void {
  try {
    showDeferredModelBanner.value = localStorage.getItem(LS_DEFERRED) === "1";
  } catch {
    showDeferredModelBanner.value = false;
  }
}

export function setModelConfigDeferred(v: boolean): void {
  try {
    if (v) {
      localStorage.setItem(LS_DEFERRED, "1");
    } else {
      localStorage.removeItem(LS_DEFERRED);
    }
  } catch {
    /* ignore */
  }
  syncDeferredModelBannerFromStorage();
}

export function isFirstRunModelStepComplete(): boolean {
  try {
    return localStorage.getItem(LS_MODEL_COMPLETE) === "1";
  } catch {
    return false;
  }
}

export function markFirstRunModelStepComplete(): void {
  try {
    localStorage.setItem(LS_MODEL_COMPLETE, "1");
    localStorage.removeItem(LS_MODEL_SNOOZE);
  } catch {
    /* ignore */
  }
}

export function readModelWizardSnoozeExpired(): boolean {
  try {
    const raw = localStorage.getItem(LS_MODEL_SNOOZE);
    if (!raw) {
      return true;
    }
    const until = Number(raw);
    if (!Number.isFinite(until)) {
      return true;
    }
    return Date.now() >= until;
  } catch {
    return true;
  }
}

export function snoozeModelWizard24h(): void {
  try {
    localStorage.setItem(LS_MODEL_SNOOZE, String(Date.now() + SNOOZE_MS));
  } catch {
    /* ignore */
  }
}
