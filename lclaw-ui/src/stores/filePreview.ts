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

export const useFilePreviewStore = defineStore("filePreview", () => {
  const target = ref<FilePreviewTarget | null>(null);

  function openUrl(url: string, label?: string): void {
    const u = url.trim();
    if (!isSafePreviewUrl(u)) {
      return;
    }
    const kind = previewKindFromUrl(u);
    const short =
      label?.trim() ||
      (() => {
        try {
          return decodeURIComponent(new URL(u).pathname.split("/").pop() || u);
        } catch {
          return u.slice(-40);
        }
      })();
    target.value = { url: u, label: short, kind };
  }

  function clear(): void {
    target.value = null;
  }

  return { target, openUrl, clear };
});
