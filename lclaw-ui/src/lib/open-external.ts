import { getDidClawDesktopApi, isDidClawDesktop } from "@/lib/desktop-api";

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
      throw new Error(result.error || "打开外链失败");
    }
    return true;
  }
  window.open(trimmed, "_blank", "noopener,noreferrer");
  return true;
}
