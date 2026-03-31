import { i18n } from "@/i18n";
import { getDidClawDesktopApi, isDidClawDesktop } from "@/lib/desktop-api";
import { translateTauriShellResult } from "@/lib/tauri-i18n";

export function isExternalHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

export async function openExternalUrl(url: string): Promise<boolean> {
  const trimmed = url.trim();
  if (!trimmed) {
    return false;
  }
  const api = getDidClawDesktopApi();
  if (isDidClawDesktop() && api?.openExternalUrl) {
    const result = await api.openExternalUrl(trimmed);
    if (!result.ok) {
      const msg =
        translateTauriShellResult(result) || i18n.global.t("openExternal.errOpenFailed");
      throw new Error(msg);
    }
    return true;
  }
  window.open(trimmed, "_blank", "noopener,noreferrer");
  return true;
}
