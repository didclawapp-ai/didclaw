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
    | { ok: true; mimeType: string; base64: string; displayKind: "image" | "pdf" }
    | { ok: false; error: string }
  >;
  pickLocalFile(): Promise<string | null>;
}

interface Window {
  lclawElectron?: LclawElectronApi;
}
