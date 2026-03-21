/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_GATEWAY_URL?: string;
  readonly VITE_GATEWAY_TOKEN?: string;
  readonly VITE_GATEWAY_PASSWORD?: string;
  readonly VITE_LINK_ALLOWLIST?: string;
  /** 逗号分隔的模型标识，用于会话栏「模型」下拉（需与网关 chat.send 的 model 字段一致） */
  readonly VITE_CHAT_MODEL_OPTIONS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Electron preload 注入；仅桌面壳存在 */
interface LclawElectronApi {
  readonly isElectron: true;
  openLocalPreview(
    fileUrl: string,
  ): Promise<
    | {
        ok: true;
        mimeType: string;
        base64: string;
        displayKind: "image" | "pdf" | "markdown" | "text";
      }
    | { ok: false; error: string }
  >;
  /** 用系统默认程序打开本地 file://（如已装 Word，无需 LibreOffice） */
  openFileUrlInSystem(fileUrl: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** 本地文件另存为（复制到新路径） */
  saveLocalFileCopyAs(
    fileUrl: string,
  ): Promise<{ ok: true; saved: boolean } | { ok: false; error: string }>;
  /** 在文件夹中显示并复制路径，便于作为邮件附件 */
  prepareEmailWithLocalFile(fileUrl: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** 复制文件名、路径与 file URL 到剪贴板 */
  copyLocalFileForShare(
    fileUrl: string,
    label?: string,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  getLibreOfficeStatus(): Promise<{ available: boolean }>;
  openLibreOfficeDownloadPage(): Promise<void>;
  showLibreOfficeInstallDialog(): Promise<{ openedDownload: boolean }>;
  pickLocalFile(): Promise<string | null>;
  readGatewayLocalConfig(): Promise<{
    url?: string;
    token?: string;
    password?: string;
  }>;
  writeGatewayLocalConfig(payload: {
    url?: string;
    token?: string;
    password?: string;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
}

interface Window {
  lclawElectron?: LclawElectronApi;
}
