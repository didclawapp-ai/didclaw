/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_GATEWAY_URL?: string;
  readonly VITE_GATEWAY_TOKEN?: string;
  readonly VITE_GATEWAY_PASSWORD?: string;
  readonly VITE_LINK_ALLOWLIST?: string;
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
