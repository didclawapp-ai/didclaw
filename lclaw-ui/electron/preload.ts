import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("lclawElectron", {
  isElectron: true as const,
  openLocalPreview: (fileUrl: string) =>
    ipcRenderer.invoke("preview:openLocal", fileUrl) as Promise<
      | {
          ok: true;
          mimeType: string;
          base64: string;
          displayKind: "image" | "pdf" | "markdown" | "text";
        }
      | { ok: false; error: string }
    >,
  openFileUrlInSystem: (fileUrl: string) =>
    ipcRenderer.invoke("shell:openFileUrl", fileUrl) as Promise<
      { ok: true } | { ok: false; error: string }
    >,
  saveLocalFileCopyAs: (fileUrl: string) =>
    ipcRenderer.invoke("file:saveCopyAs", fileUrl) as Promise<
      { ok: true; saved: boolean } | { ok: false; error: string }
    >,
  prepareEmailWithLocalFile: (fileUrl: string) =>
    ipcRenderer.invoke("shell:prepareEmailWithLocalFile", fileUrl) as Promise<
      { ok: true } | { ok: false; error: string }
    >,
  copyLocalFileForShare: (fileUrl: string, label?: string) =>
    ipcRenderer.invoke("shell:copyLocalFileForShare", { fileUrl, label }) as Promise<
      { ok: true } | { ok: false; error: string }
    >,
  getLibreOfficeStatus: () =>
    ipcRenderer.invoke("preview:libreOfficeStatus") as Promise<{ available: boolean }>,
  openLibreOfficeDownloadPage: () => ipcRenderer.invoke("preview:openLibreOfficeDownloadPage"),
  showLibreOfficeInstallDialog: () =>
    ipcRenderer.invoke("preview:showLibreOfficeInstallDialog") as Promise<{
      openedDownload: boolean;
    }>,
  pickLocalFile: () => ipcRenderer.invoke("dialog:openFile") as Promise<string | null>,
  readGatewayLocalConfig: () =>
    ipcRenderer.invoke("gateway:readLocalConfig") as Promise<{
      url?: string;
      token?: string;
      password?: string;
    }>,
  writeGatewayLocalConfig: (payload: { url?: string; token?: string; password?: string }) =>
    ipcRenderer.invoke("gateway:writeLocalConfig", payload) as Promise<
      { ok: true } | { ok: false; error: string }
    >,
});
