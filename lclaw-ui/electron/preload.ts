import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("lclawElectron", {
  isElectron: true as const,
  openLocalPreview: (fileUrl: string) =>
    ipcRenderer.invoke("preview:openLocal", fileUrl) as Promise<
      | { ok: true; mimeType: string; base64: string; displayKind: "image" | "pdf" }
      | { ok: false; error: string }
    >,
  pickLocalFile: () => ipcRenderer.invoke("dialog:openFile") as Promise<string | null>,
});
