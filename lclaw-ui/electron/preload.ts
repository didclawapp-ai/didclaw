import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("lclawElectron", {
  isElectron: true as const,
  openLocalPreview: (fileUrl: string) =>
    ipcRenderer.invoke("preview:openLocal", fileUrl) as Promise<
      | { ok: true; mimeType: string; base64: string; displayKind: "image" | "pdf" }
      | { ok: false; error: string }
    >,
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
