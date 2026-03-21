import { isLclawElectron } from "@/lib/electron-bridge";
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

export const useFilePreviewStore = defineStore("filePreview", () => {
  const target = ref<FilePreviewTarget | null>(null);
  const localLoading = ref(false);
  const localError = ref<string | null>(null);
  const internalBlobUrl = ref<string | null>(null);

  function revokeBlobIfNeeded(): void {
    if (internalBlobUrl.value) {
      URL.revokeObjectURL(internalBlobUrl.value);
      internalBlobUrl.value = null;
    }
  }

  async function openUrl(url: string, label?: string): Promise<void> {
    const u = url.trim();
    if (!isSafePreviewUrl(u)) {
      return;
    }
    const short = labelFromUrl(u, label);

    if (isLclawElectron() && u.startsWith("file:")) {
      revokeBlobIfNeeded();
      localLoading.value = true;
      localError.value = null;
      try {
        const api = window.lclawElectron;
        if (!api) {
          throw new Error("Electron API 不可用");
        }
        const r = await api.openLocalPreview(u);
        if (!r.ok) {
          throw new Error(r.error || "预览失败");
        }
        const blob = base64ToBlob(r.base64, r.mimeType);
        const blobUrl = URL.createObjectURL(blob);
        internalBlobUrl.value = blobUrl;
        const kind: PreviewKind = r.displayKind === "pdf" ? "pdf" : "image";
        target.value = { url: blobUrl, label: short, kind };
      } catch (e) {
        revokeBlobIfNeeded();
        localError.value = e instanceof Error ? e.message : String(e);
        target.value = null;
      } finally {
        localLoading.value = false;
      }
      return;
    }

    revokeBlobIfNeeded();
    localError.value = null;
    const kind = previewKindFromUrl(u);
    target.value = { url: u, label: short, kind };
  }

  function clear(): void {
    revokeBlobIfNeeded();
    target.value = null;
    localError.value = null;
    localLoading.value = false;
  }

  return { target, openUrl, clear, localLoading, localError };
});
