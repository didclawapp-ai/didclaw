import { invoke, isTauri } from "@tauri-apps/api/core";
import { createI18n } from "vue-i18n";
import zh from "./zh";
import en from "./en";

export type LocaleCode = "zh" | "en";

/** 从 localStorage 读取保存的语言，默认中文 */
function detectLocale(): LocaleCode {
  const saved = localStorage.getItem("didclaw-locale");
  if (saved === "en" || saved === "zh") return saved;
  // 跟随系统语言
  const lang = navigator.language ?? "";
  if (lang.startsWith("zh")) return "zh";
  return "en";
}

export const i18n = createI18n({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: "zh",
  messages: { zh, en },
});

async function syncLocaleToTauriShell(locale: LocaleCode): Promise<void> {
  if (!isTauri()) {
    return;
  }
  try {
    await invoke("didclaw_set_app_locale", { locale });
  } catch {
    /* ignore */
  }
}

export function setLocale(locale: LocaleCode): void {
  (i18n.global.locale as { value: LocaleCode }).value = locale;
  localStorage.setItem("didclaw-locale", locale);
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  void syncLocaleToTauriShell(locale);
}

/** Call after `app.use(i18n)` so tray/native dialogs match saved locale. */
export async function syncTauriLocaleAfterI18nReady(): Promise<void> {
  const loc = (i18n.global.locale as { value: LocaleCode }).value;
  await syncLocaleToTauriShell(loc);
}
