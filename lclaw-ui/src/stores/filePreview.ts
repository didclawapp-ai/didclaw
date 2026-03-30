import { i18n } from "@/i18n";
import { getDidClawDesktopApi, isDidClawElectron } from "@/lib/electron-bridge";
import {
  defaultFileNameForImageMime,
  findFirstEmbeddedDataImage,
} from "@/lib/extract-chat-embedded-image";
import { isSafePreviewUrl } from "@/lib/is-safe-preview-url";
import type { PreviewKind } from "@/lib/preview-kind";
import { previewKindFromUrl } from "@/lib/preview-kind";
import { defineStore } from "pinia";
import { ref } from "vue";

export type FilePreviewTarget = {
  url: string;
  label: string;
  kind: PreviewKind;
};

/** 点击左侧消息行：列表摘要与全文不一致时在右侧展示完整正文 */
export type ChatMessagePreviewState = {
  title: string;
  body: string;
  role: "user" | "assistant";
};

/** data:image preview; desktop save-as needs raw base64 */
export type SavableEmbeddedImage = {
  base64Payload: string;
  mimeType: string;
  defaultFileName: string;
};

function labelFromUrl(url: string, label?: string): string {
  const short =
    label?.trim() ||
    (() => {
      try {
        return decodeURIComponent(new URL(url).pathname.split("/").pop() || url);
      } catch {
        return url.slice(-40);
      }
    })();
  return short;
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

function base64Utf8ToString(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export const useFilePreviewStore = defineStore("filePreview", () => {
  const target = ref<FilePreviewTarget | null>(null);
  const localLoading = ref(false);
  const localError = ref<string | null>(null);
  /** Last attempted file:// preview in Electron (system open / retry when no LibreOffice) */
  const pendingLocalFileUrl = ref<string | null>(null);
  const pendingLocalLabel = ref<string | null>(null);
  const internalBlobUrl = ref<string | null>(null);
  /** Markdown / plain text body (local decode or http(s) fetch) */
  const previewTextBody = ref<string | null>(null);
  const previewTextError = ref<string | null>(null);
  const previewTextLoading = ref(false);
  const chatMessagePreview = ref<ChatMessagePreviewState | null>(null);
  const savableEmbeddedImage = ref<SavableEmbeddedImage | null>(null);

  function revokeBlobIfNeeded(): void {
    if (internalBlobUrl.value) {
      URL.revokeObjectURL(internalBlobUrl.value);
      internalBlobUrl.value = null;
    }
  }

  function clearTextPreview(): void {
    previewTextBody.value = null;
    previewTextError.value = null;
    previewTextLoading.value = false;
  }

  function clearChatMessagePreview(): void {
    chatMessagePreview.value = null;
  }

  function clearSavableEmbeddedImage(): void {
    savableEmbeddedImage.value = null;
  }

  /** Clear prior message-embedded image when switching to another line */
  function forgetEmbeddedChatImageIfAny(): void {
    if (!savableEmbeddedImage.value) {
      return;
    }
    revokeBlobIfNeeded();
    clearTextPreview();
    target.value = null;
    clearSavableEmbeddedImage();
    pendingLocalFileUrl.value = null;
    pendingLocalLabel.value = null;
    localError.value = null;
    localLoading.value = false;
  }

  /**
   * If text contains `data:image/...;base64,...`, open image preview and allow save-as.
   * @returns whether preview opened (false if no parseable embedded image)
   */
  function tryOpenEmbeddedDataImageFromText(text: string): boolean {
    const found = findFirstEmbeddedDataImage(text);
    if (!found) {
      return false;
    }
    let blob: Blob;
    try {
      blob = base64ToBlob(found.base64Payload, found.mimeType);
    } catch {
      return false;
    }
    revokeBlobIfNeeded();
    clearTextPreview();
    clearChatMessagePreview();
    pendingLocalFileUrl.value = null;
    pendingLocalLabel.value = null;
    localError.value = null;
    localLoading.value = false;
    const blobUrl = URL.createObjectURL(blob);
    internalBlobUrl.value = blobUrl;
    target.value = {
      url: blobUrl,
      label: i18n.global.t("preview.embeddedImageLabel"),
      kind: "image",
    };
    savableEmbeddedImage.value = {
      base64Payload: found.base64Payload,
      mimeType: found.mimeType,
      defaultFileName: defaultFileNameForImageMime(found.mimeType),
    };
    return true;
  }

  async function saveEmbeddedImageAs(): Promise<
    { ok: true; saved: boolean } | { ok: false; error: string }
  > {
    const s = savableEmbeddedImage.value;
    if (!s) {
      return { ok: false, error: i18n.global.t("preview.noEmbeddedImageToSave") };
    }
    const api = getDidClawDesktopApi();
    if (api?.saveBase64FileAs) {
      try {
        const r = (await api.saveBase64FileAs(
          s.base64Payload,
          s.defaultFileName,
        )) as { ok: boolean; saved?: boolean; error?: string };
        if (!r.ok) {
          return { ok: false, error: r.error ?? i18n.global.t("preview.saveAsFailed") };
        }
        return { ok: true, saved: Boolean(r.saved) };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
    try {
      const blob = base64ToBlob(s.base64Payload, s.mimeType);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = s.defaultFileName;
      a.rel = "noopener";
      a.click();
      URL.revokeObjectURL(url);
      return { ok: true, saved: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * When `listText` differs from full `text`, show full body in the right pane
   * (matches `buildListPreview` “click row for full text” behavior).
   */
  function showChatMessageFullText(line: {
    role: string;
    text: string;
    listText: string;
  }): void {
    if (line.role !== "user" && line.role !== "assistant") {
      clearChatMessagePreview();
      return;
    }
    const full = line.text ?? "";
    const list = line.listText ?? "";
    if (!full.trim()) {
      clearChatMessagePreview();
      return;
    }
    if (list === full) {
      clearChatMessagePreview();
      return;
    }
    revokeBlobIfNeeded();
    clearTextPreview();
    target.value = null;
    clearSavableEmbeddedImage();
    pendingLocalFileUrl.value = null;
    pendingLocalLabel.value = null;
    localError.value = null;
    localLoading.value = false;
    chatMessagePreview.value = {
      title:
        line.role === "assistant"
          ? i18n.global.t("preview.chatFullAssistant")
          : i18n.global.t("preview.chatFullUser"),
      body: full,
      role: line.role as "user" | "assistant",
    };
  }

  async function openUrl(url: string, label?: string): Promise<void> {
    const u = url.trim();
    if (!isSafePreviewUrl(u)) {
      return;
    }
    const short = labelFromUrl(u, label);
    clearChatMessagePreview();
    clearSavableEmbeddedImage();

    if (isDidClawElectron() && u.startsWith("file:")) {
      revokeBlobIfNeeded();
      clearTextPreview();
      pendingLocalFileUrl.value = u;
      pendingLocalLabel.value = short;
      localLoading.value = true;
      localError.value = null;
      try {
        const api = getDidClawDesktopApi();
        if (!api) {
          throw new Error(i18n.global.t("preview.desktopApiUnavailable"));
        }
        const r = await api.openLocalPreview(u);
        if (!r.ok) {
          throw new Error(r.error || i18n.global.t("preview.localPreviewFailed"));
        }
        if (r.displayKind === "markdown" || r.displayKind === "text") {
          previewTextBody.value = base64Utf8ToString(r.base64);
          const inferred = previewKindFromUrl(u);
          const kind =
            r.displayKind === "markdown"
              ? "markdown"
              : inferred === "code"
                ? "code"
                : "text";
          target.value = {
            url: u,
            label: short,
            kind,
          };
          pendingLocalFileUrl.value = null;
          pendingLocalLabel.value = null;
        } else {
          const blob = base64ToBlob(r.base64, r.mimeType);
          const blobUrl = URL.createObjectURL(blob);
          internalBlobUrl.value = blobUrl;
          const kind: PreviewKind = r.displayKind === "pdf" ? "pdf" : "image";
          target.value = { url: blobUrl, label: short, kind };
          pendingLocalFileUrl.value = null;
          pendingLocalLabel.value = null;
        }
      } catch (e) {
        revokeBlobIfNeeded();
        clearTextPreview();
        localError.value = e instanceof Error ? e.message : String(e);
        target.value = null;
      } finally {
        localLoading.value = false;
      }
      return;
    }

    revokeBlobIfNeeded();
    clearTextPreview();
    pendingLocalFileUrl.value = null;
    pendingLocalLabel.value = null;
    localError.value = null;

    let kind = previewKindFromUrl(u);
    if (u.startsWith("blob:") && kind === "other") {
      kind = previewKindFromUrl(`https://preview.local/${encodeURIComponent(short)}`);
    }
    if (kind === "markdown" || kind === "text" || kind === "code") {
      target.value = { url: u, label: short, kind };
      previewTextLoading.value = true;
      previewTextError.value = null;
      previewTextBody.value = null;
      try {
        const res = await fetch(u, { credentials: "omit" });
        if (!res.ok) {
          throw new Error(i18n.global.t("preview.textLoadHttpFailed", { status: res.status }));
        }
        previewTextBody.value = await res.text();
      } catch (e) {
        previewTextError.value =
          e instanceof Error
            ? i18n.global.t("preview.textLoadCrossOrigin", { msg: e.message })
            : String(e);
      } finally {
        previewTextLoading.value = false;
      }
      return;
    }

    target.value = { url: u, label: short, kind };
  }

  async function openPendingLocalInSystemApp(): Promise<void> {
    const u = pendingLocalFileUrl.value;
    const api = getDidClawDesktopApi();
    if (!u || !api?.openFileUrlInSystem) {
      return;
    }
    const r = await api.openFileUrlInSystem(u);
    if (!r.ok) {
      localError.value = r.error || i18n.global.t("preview.openSystemFailed");
    }
  }

  async function openLibreOfficeDownloadPage(): Promise<void> {
    await getDidClawDesktopApi()?.openLibreOfficeDownloadPage?.();
  }

  async function showLibreOfficeInstallDialog(): Promise<void> {
    await getDidClawDesktopApi()?.showLibreOfficeInstallDialog?.();
  }

  /** After installing LibreOffice: re-check then retry local preview */
  async function retryPendingLocalPreview(): Promise<void> {
    const u = pendingLocalFileUrl.value;
    const label = pendingLocalLabel.value ?? undefined;
    const api = getDidClawDesktopApi();
    if (!u || !api?.getLibreOfficeStatus) {
      return;
    }
    const st = await api.getLibreOfficeStatus();
    if (!st.available) {
      localError.value = i18n.global.t("preview.libreOfficeStillMissing");
      return;
    }
    await openUrl(u, label);
  }

  function clear(): void {
    revokeBlobIfNeeded();
    clearTextPreview();
    clearChatMessagePreview();
    clearSavableEmbeddedImage();
    target.value = null;
    localError.value = null;
    pendingLocalFileUrl.value = null;
    pendingLocalLabel.value = null;
    localLoading.value = false;
  }

  return {
    target,
    openUrl,
    clear,
    chatMessagePreview,
    savableEmbeddedImage,
    tryOpenEmbeddedDataImageFromText,
    forgetEmbeddedChatImageIfAny,
    saveEmbeddedImageAs,
    showChatMessageFullText,
    clearChatMessagePreview,
    localLoading,
    localError,
    pendingLocalFileUrl,
    pendingLocalLabel,
    previewTextBody,
    previewTextError,
    previewTextLoading,
    openPendingLocalInSystemApp,
    openLibreOfficeDownloadPage,
    showLibreOfficeInstallDialog,
    retryPendingLocalPreview,
  };
});
