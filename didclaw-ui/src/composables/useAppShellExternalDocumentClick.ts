import { isDidClawElectron } from "@/lib/electron-bridge";
import { isExternalHttpUrl, openExternalUrl } from "@/lib/open-external";
import { useI18n } from "vue-i18n";

/**
 * 桌面壳内：拦截聊天区等处的 `http(s)` 外链点击，用系统浏览器打开（避免在 WebView 内跳外站）。
 */
export function useAppShellExternalDocumentClick(): {
  onGlobalDocumentClick: (event: MouseEvent) => void;
} {
  const { t } = useI18n();

  function onGlobalDocumentClick(event: MouseEvent): void {
    if (!isDidClawElectron()) {
      return;
    }
    if (event.defaultPrevented || event.button !== 0) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const anchor = target.closest("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) {
      return;
    }
    const href = anchor.getAttribute("href")?.trim() || "";
    if (!isExternalHttpUrl(href) || href.startsWith(window.location.origin)) {
      return;
    }
    event.preventDefault();
    void openExternalUrl(href).catch(() => {
      window.alert(t("shell.openExternalFailed"));
    });
  }

  return { onGlobalDocumentClick };
}
