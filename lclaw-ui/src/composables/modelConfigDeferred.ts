import { ref } from "vue";

import { didclawKvReadSync, didclawKvWriteSync } from "@/lib/didclaw-kv";
import { getDidClawDesktopApi } from "@/lib/electron-bridge";

const LS_MODEL_COMPLETE = "didclaw_first_run_model_complete";
const LS_DEFERRED = "didclaw_model_config_deferred";
const LS_MODEL_SNOOZE = "didclaw_model_wizard_snooze_until";
const LS_ENV_SNOOZE = "didclaw_setup_wizard_snooze_until";

const SNOOZE_MS = 24 * 60 * 60 * 1000;

/** 主界面「稍后配置模型」提示条是否显示（与 DidClaw KV / localStorage 同步） */
export const showDeferredModelBanner = ref(false);

export function syncDeferredModelBannerFromStorage(): void {
  try {
    showDeferredModelBanner.value = didclawKvReadSync(LS_DEFERRED) === "1";
  } catch {
    showDeferredModelBanner.value = false;
  }
}

export function setModelConfigDeferred(v: boolean): void {
  try {
    if (v) {
      didclawKvWriteSync(LS_DEFERRED, "1");
    } else {
      didclawKvWriteSync(LS_DEFERRED, null);
    }
  } catch {
    /* ignore */
  }
  syncDeferredModelBannerFromStorage();
}

export function isFirstRunModelStepComplete(): boolean {
  try {
    return didclawKvReadSync(LS_MODEL_COMPLETE) === "1";
  } catch {
    return false;
  }
}

export function markFirstRunModelStepComplete(): void {
  try {
    didclawKvWriteSync(LS_MODEL_COMPLETE, "1");
    didclawKvWriteSync(LS_MODEL_SNOOZE, null);
  } catch {
    /* ignore */
  }
}

export function readModelWizardSnoozeExpired(): boolean {
  try {
    const raw = didclawKvReadSync(LS_MODEL_SNOOZE);
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
    didclawKvWriteSync(LS_MODEL_SNOOZE, String(Date.now() + SNOOZE_MS));
  } catch {
    /* ignore */
  }
}

/** 测试/排错：清除首次引导相关状态并刷新横幅 */
export function resetFirstRunWizardLocalState(): void {
  try {
    didclawKvWriteSync(LS_MODEL_COMPLETE, null);
    didclawKvWriteSync(LS_DEFERRED, null);
    didclawKvWriteSync(LS_MODEL_SNOOZE, null);
    didclawKvWriteSync(LS_ENV_SNOOZE, null);
  } catch {
    /* ignore */
  }
  syncDeferredModelBannerFromStorage();
}

/** 在「② AI 账号」保存成功后：去掉「稍后配置」横幅；若已存在默认 primary 则标记模型步完成 */
export async function afterOpenClawProvidersSaved(): Promise<void> {
  setModelConfigDeferred(false);
  syncDeferredModelBannerFromStorage();
  const api = getDidClawDesktopApi();
  if (!api?.readOpenClawModelConfig) {
    return;
  }
  try {
    const mc = await api.readOpenClawModelConfig();
    if (mc.ok) {
      const primary = mc.model?.primary;
      if (typeof primary === "string" && primary.trim().length > 0) {
        markFirstRunModelStepComplete();
      }
    }
  } catch {
    /* ignore */
  }
}

/** 在「③ 选模型」保存成功后：标记首次引导模型步完成并清除稍后配置 */
export function afterOpenClawModelConfigSaved(): void {
  markFirstRunModelStepComplete();
  setModelConfigDeferred(false);
  syncDeferredModelBannerFromStorage();
}
