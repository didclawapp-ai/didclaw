import { getLclawDesktopApi, isLclawElectron } from "@/lib/electron-bridge";
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
  /** Electron 下最近一次尝试预览的 file://，用于无 LibreOffice 时用系统应用打开 / 重试 */
  const pendingLocalFileUrl = ref<string | null>(null);
  const pendingLocalLabel = ref<string | null>(null);
  const internalBlobUrl = ref<string | null>(null);
  /** Markdown / 纯文本正文（本地解码或 http(s) fetch） */
  const previewTextBody = ref<string | null>(null);
  const previewTextError = ref<string | null>(null);
  const previewTextLoading = ref(false);
  const chatMessagePreview = ref<ChatMessagePreviewState | null>(null);

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

  /**
   * 当 `listText`（左侧列表）与 `text`（完整正文）不一致时展开右栏显示全文，
   * 与 `buildListPreview` 中「点选本行可在右侧预览查看全文」一致。
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
    pendingLocalFileUrl.value = null;
    pendingLocalLabel.value = null;
    localError.value = null;
    localLoading.value = false;
    chatMessagePreview.value = {
      title: line.role === "assistant" ? "助手消息（全文）" : "用户消息（全文）",
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

    if (isLclawElectron() && u.startsWith("file:")) {
      revokeBlobIfNeeded();
      clearTextPreview();
      pendingLocalFileUrl.value = u;
      pendingLocalLabel.value = short;
      localLoading.value = true;
      localError.value = null;
      try {
        const api = getLclawDesktopApi();
        if (!api) {
          throw new Error("桌面 API 不可用");
        }
        const r = await api.openLocalPreview(u);
        if (!r.ok) {
          throw new Error(r.error || "预览失败");
        }
        if (r.displayKind === "markdown" || r.displayKind === "text") {
          previewTextBody.value = base64Utf8ToString(r.base64);
          target.value = {
            url: u,
            label: short,
            kind: r.displayKind === "markdown" ? "markdown" : "text",
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
    if (kind === "markdown" || kind === "text") {
      target.value = { url: u, label: short, kind };
      previewTextLoading.value = true;
      previewTextError.value = null;
      previewTextBody.value = null;
      try {
        const res = await fetch(u, { credentials: "omit" });
        if (!res.ok) {
          throw new Error(`无法加载文本（HTTP ${res.status}）`);
        }
        previewTextBody.value = await res.text();
      } catch (e) {
        previewTextError.value =
          e instanceof Error
            ? `${e.message}。若为跨域资源，请改用本地文件或在新窗口打开链接。`
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
    const api = getLclawDesktopApi();
    if (!u || !api?.openFileUrlInSystem) {
      return;
    }
    const r = await api.openFileUrlInSystem(u);
    if (!r.ok) {
      localError.value = r.error || "系统打开失败";
    }
  }

  async function openLibreOfficeDownloadPage(): Promise<void> {
    await getLclawDesktopApi()?.openLibreOfficeDownloadPage?.();
  }

  async function showLibreOfficeInstallDialog(): Promise<void> {
    await getLclawDesktopApi()?.showLibreOfficeInstallDialog?.();
  }

  /** 安装 LibreOffice 后：先检测再重新走本地预览 */
  async function retryPendingLocalPreview(): Promise<void> {
    const u = pendingLocalFileUrl.value;
    const label = pendingLocalLabel.value ?? undefined;
    const api = getLclawDesktopApi();
    if (!u || !api?.getLibreOfficeStatus) {
      return;
    }
    const st = await api.getLibreOfficeStatus();
    if (!st.available) {
      localError.value =
        "仍未检测到 LibreOffice。若已安装，请重启本应用，或设置环境变量 LIBREOFFICE_PATH 指向 soffice.exe。";
      return;
    }
    await openUrl(u, label);
  }

  function clear(): void {
    revokeBlobIfNeeded();
    clearTextPreview();
    clearChatMessagePreview();
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
