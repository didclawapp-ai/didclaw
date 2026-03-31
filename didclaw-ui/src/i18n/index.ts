import { invoke, isTauri } from "@tauri-apps/api/core";
import { createI18n } from "vue-i18n";
import zh from "./zh";
import en from "./en";

export type LocaleCode = "zh" | "en";

function normalizeLocaleTag(raw: string | null | undefined): LocaleCode {
  const tag = (raw ?? "").trim().toLowerCase();
  return tag.startsWith("zh") ? "zh" : "en";
}

/** Prefer manual choice; otherwise follow the system language. */
function detectLocale(): LocaleCode {
  const saved = localStorage.getItem("didclaw-locale");
  if (saved === "en" || saved === "zh") {
    return saved;
  }
  const langs = Array.isArray(navigator.languages) ? navigator.languages : [];
  for (const lang of langs) {
    if (typeof lang === "string" && lang.trim()) {
      return normalizeLocaleTag(lang);
    }
  }
  return normalizeLocaleTag(navigator.language);
}

function applyDocumentLanguage(locale: LocaleCode): void {
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
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
  applyDocumentLanguage(locale);
  void syncLocaleToTauriShell(locale);
}

/** Call after `app.use(i18n)` so tray/native dialogs match saved locale. */
export async function syncTauriLocaleAfterI18nReady(): Promise<void> {
  const loc = (i18n.global.locale as { value: LocaleCode }).value;
  applyDocumentLanguage(loc);
  await syncLocaleToTauriShell(loc);
}
