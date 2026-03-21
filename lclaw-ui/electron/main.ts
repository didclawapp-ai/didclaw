import { BrowserWindow, app, clipboard, dialog, ipcMain, shell } from "electron";
import type { Server } from "node:http";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  type OpenClawModelWritePayload,
  type OpenClawProvidersPatchPayload,
  readOpenClawModelConfig,
  readOpenClawProviders,
  restoreOpenClawConfigToLatestBackup,
  writeOpenClawModelConfig,
  writeOpenClawProvidersPatch,
} from "./openclaw-config";
import { startProdStaticServer } from "./static-server";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
/** 生产态用 http://127.0.0.1 提供 dist，避免 file:// 触发 Gateway origin 拒绝 */
let prodStaticServer: Server | null = null;
let prodStaticOrigin: string | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    /** 仅 Windows/Linux：窗口内菜单栏可自动隐藏（按 Alt 显示）。macOS 为系统顶栏菜单，此项无意义故关闭。 */
    autoHideMenuBar: process.platform === "win32" || process.platform === "linux",
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else if (prodStaticOrigin) {
    void mainWindow.loadURL(`${prodStaticOrigin}/index.html`);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  if (!process.env.VITE_DEV_SERVER_URL) {
    const distDir = path.join(__dirname, "..", "dist");
    const { server, origin } = await startProdStaticServer(distDir);
    prodStaticServer = server;
    prodStaticOrigin = origin;
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("will-quit", () => {
  prodStaticServer?.close();
  prodStaticServer = null;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

const LIBREOFFICE_DOWNLOAD_PAGE = "https://www.libreoffice.org/download/download-libreoffice/";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;
const PDF_EXT = /\.pdf$/i;
const OFFICE_EXT = /\.(docx?|xlsx?|pptx?)$/i;
const TEXT_PREVIEW_EXT = /\.(txt|text|log|csv|md|markdown|mdown|mkd)$/i;
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
};

function textDisplayKindForPath(lower: string): "markdown" | "text" {
  return /\.(md|markdown|mdown|mkd)$/i.test(lower) ? "markdown" : "text";
}

async function resolveExistingFilePath(fileUrl: string): Promise<string> {
  let u: URL;
  try {
    u = new URL(fileUrl);
  } catch {
    throw new Error("无效的 URL");
  }
  if (u.protocol !== "file:") {
    throw new Error("仅支持 file: 本地预览");
  }
  const raw = fileURLToPath(u);
  const resolved = path.resolve(raw);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isFile()) {
    throw new Error("路径不存在或不是文件");
  }
  return resolved;
}

async function findSofficeExecutable(): Promise<string | null> {
  const envPath = process.env.LIBREOFFICE_PATH?.trim();
  if (envPath) {
    try {
      await fs.access(envPath);
      return envPath;
    } catch {
      /* try fallbacks */
    }
  }
  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
      "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
    ];
    for (const c of candidates) {
      try {
        await fs.access(c);
        return c;
      } catch {
        /* next */
      }
    }
  }
  for (const name of ["soffice", "libreoffice"]) {
    try {
      await execFileAsync(name, ["--version"], { timeout: 8000, windowsHide: true });
      return name;
    } catch {
      /* next */
    }
  }
  return null;
}

async function convertOfficeToPdfBuffer(sourcePath: string): Promise<Buffer> {
  const soffice = await findSofficeExecutable();
  if (!soffice) {
    throw new Error(
      "未找到 LibreOffice。请安装 LibreOffice，或设置环境变量 LIBREOFFICE_PATH 指向 soffice.exe",
    );
  }
  const sessionDir = path.join(app.getPath("temp"), "lclaw-preview", randomUUID());
  await fs.mkdir(sessionDir, { recursive: true });
  const ext = path.extname(sourcePath);
  const tempInput = path.join(sessionDir, `source${ext}`);
  await fs.copyFile(sourcePath, tempInput);
  await execFileAsync(
    soffice,
    [
      "--headless",
      "--norestore",
      "--nologo",
      "--convert-to",
      "pdf",
      "--outdir",
      sessionDir,
      tempInput,
    ],
    { timeout: 180_000, windowsHide: true },
  );
  const stem = path.basename(tempInput, ext);
  const pdfPath = path.join(sessionDir, `${stem}.pdf`);
  const buf = await fs.readFile(pdfPath);
  await fs.rm(sessionDir, { recursive: true, force: true });
  return buf;
}

type OpenOk = {
  ok: true;
  mimeType: string;
  base64: string;
  displayKind: "image" | "pdf" | "markdown" | "text";
};

type OpenFail = { ok: false; error: string };

ipcMain.handle("preview:openLocal", async (_event, fileUrl: unknown): Promise<OpenOk | OpenFail> => {
  if (typeof fileUrl !== "string") {
    return { ok: false, error: "参数错误" };
  }
  try {
    const p = await resolveExistingFilePath(fileUrl);
    const lower = p.toLowerCase();
    if (IMAGE_EXT.test(lower) || PDF_EXT.test(lower)) {
      const ext = path.extname(lower) || "";
      const mime = MIME[ext] ?? "application/octet-stream";
      const buf = await fs.readFile(p);
      const displayKind = PDF_EXT.test(lower) ? "pdf" : "image";
      return {
        ok: true,
        mimeType: mime,
        base64: buf.toString("base64"),
        displayKind,
      };
    }
    if (TEXT_PREVIEW_EXT.test(lower)) {
      const st = await fs.stat(p);
      if (st.size > MAX_TEXT_PREVIEW_BYTES) {
        return {
          ok: false,
          error: `文本文件过大（>${Math.round(MAX_TEXT_PREVIEW_BYTES / 1024 / 1024)}MB），请使用外部编辑器打开`,
        };
      }
      const buf = await fs.readFile(p);
      const dk = textDisplayKindForPath(lower);
      return {
        ok: true,
        mimeType: dk === "markdown" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8",
        base64: buf.toString("base64"),
        displayKind: dk,
      };
    }
    if (OFFICE_EXT.test(lower)) {
      const pdfBuf = await convertOfficeToPdfBuffer(p);
      return {
        ok: true,
        mimeType: "application/pdf",
        base64: pdfBuf.toString("base64"),
        displayKind: "pdf",
      };
    }
    return { ok: false, error: "不支持的文件类型（图片、PDF、Office、Markdown、纯文本）" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
});

ipcMain.handle("preview:libreOfficeStatus", async (): Promise<{ available: boolean }> => {
  const p = await findSofficeExecutable();
  return { available: p !== null };
});

ipcMain.handle("preview:openLibreOfficeDownloadPage", async (): Promise<void> => {
  await shell.openExternal(LIBREOFFICE_DOWNLOAD_PAGE);
});

ipcMain.handle(
  "preview:showLibreOfficeInstallDialog",
  async (): Promise<{ openedDownload: boolean }> => {
    const win = mainWindow ?? BrowserWindow.getFocusedWindow();
    const opts = {
      type: "info" as const,
      title: "需要 LibreOffice",
      message: "在应用内预览 Word / Excel / PowerPoint 需本机安装 LibreOffice（免费开源）。",
      detail:
        "点击「打开下载页」将在浏览器中打开官网。安装后若仍无法预览，请重启本应用或设置环境变量 LIBREOFFICE_PATH 指向 soffice.exe。\n\n若已安装 Microsoft Office 或 WPS，可使用「用系统应用打开」，无需 LibreOffice。",
      buttons: ["打开下载页", "稍后"],
      defaultId: 0,
      cancelId: 1,
    };
    const result = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    if (result.response === 0) {
      await shell.openExternal(LIBREOFFICE_DOWNLOAD_PAGE);
      return { openedDownload: true };
    }
    return { openedDownload: false };
  },
);

/** 用操作系统默认应用打开本地文件（可用已安装的 Microsoft Office，无需 LibreOffice） */
ipcMain.handle(
  "shell:openFileUrl",
  async (_event, fileUrl: unknown): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (typeof fileUrl !== "string") {
      return { ok: false, error: "参数错误" };
    }
    try {
      const p = await resolveExistingFilePath(fileUrl);
      const errMsg = await shell.openPath(p);
      if (errMsg) {
        return { ok: false, error: errMsg };
      }
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  },
);

/** 将本地文件复制到用户选择的路径（另存为） */
ipcMain.handle(
  "file:saveCopyAs",
  async (_event, fileUrl: unknown): Promise<
    { ok: true; saved: boolean } | { ok: false; error: string }
  > => {
    if (typeof fileUrl !== "string") {
      return { ok: false, error: "参数错误" };
    }
    try {
      const src = await resolveExistingFilePath(fileUrl);
      const base = path.basename(src);
      const win = mainWindow ?? BrowserWindow.getFocusedWindow();
      const r = win
        ? await dialog.showSaveDialog(win, { defaultPath: base })
        : await dialog.showSaveDialog({ defaultPath: base });
      if (r.canceled || !r.filePath) {
        return { ok: true, saved: false };
      }
      await fs.copyFile(src, r.filePath);
      return { ok: true, saved: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  },
);

/** 在资源管理器中定位并复制路径，便于拖入邮件客户端或「发送到邮件收件人」 */
ipcMain.handle(
  "shell:prepareEmailWithLocalFile",
  async (_event, fileUrl: unknown): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (typeof fileUrl !== "string") {
      return { ok: false, error: "参数错误" };
    }
    try {
      const p = await resolveExistingFilePath(fileUrl);
      shell.showItemInFolder(p);
      clipboard.writeText(p);
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  },
);

/** 复制文件名、本地路径与 file URL，便于粘贴到 IM / 协作工具 */
ipcMain.handle(
  "shell:copyLocalFileForShare",
  async (_event, payload: unknown): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, error: "参数错误" };
    }
    const o = payload as Record<string, unknown>;
    const fileUrl = typeof o.fileUrl === "string" ? o.fileUrl : "";
    const label = typeof o.label === "string" ? o.label.trim() : "";
    if (!fileUrl) {
      return { ok: false, error: "参数错误" };
    }
    try {
      const p = await resolveExistingFilePath(fileUrl);
      const name = label || path.basename(p);
      const href = pathToFileURL(p).href;
      clipboard.writeText(`${name}\n路径：${p}\n${href}`);
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  },
);

ipcMain.handle("dialog:openFile", async (): Promise<string | null> => {
  const win = mainWindow ?? BrowserWindow.getFocusedWindow();
  const opts = {
    properties: ["openFile" as const],
    filters: [
      { name: "Office", extensions: ["ppt", "pptx", "xls", "xlsx", "doc", "docx"] },
      { name: "Markdown / 文本", extensions: ["md", "markdown", "txt", "log", "csv"] },
      { name: "PDF", extensions: ["pdf"] },
      { name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] },
      { name: "全部", extensions: ["*"] },
    ],
  };
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (r.canceled || !r.filePaths[0]) {
    return null;
  }
  return pathToFileURL(r.filePaths[0]).href;
});

function gatewayLocalConfigPath(): string {
  return path.join(app.getPath("userData"), "gateway-local.json");
}

type LocalGatewayFile = { url?: string; token?: string; password?: string };

ipcMain.handle("gateway:readLocalConfig", async (): Promise<LocalGatewayFile> => {
  try {
    const raw = await fs.readFile(gatewayLocalConfigPath(), "utf8");
    const j = JSON.parse(raw) as Record<string, unknown>;
    return {
      url: typeof j.url === "string" ? j.url : undefined,
      token: typeof j.token === "string" ? j.token : undefined,
      password: typeof j.password === "string" ? j.password : undefined,
    };
  } catch {
    return {};
  }
});

ipcMain.handle(
  "gateway:writeLocalConfig",
  async (_e, data: unknown): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, error: "参数无效" };
    }
    const o = data as Record<string, unknown>;
    const out: Record<string, string> = {};
    if (typeof o.url === "string" && o.url.trim()) {
      out.url = o.url.trim();
    }
    if (typeof o.token === "string" && o.token.trim()) {
      out.token = o.token.trim();
    }
    if (typeof o.password === "string" && o.password.trim()) {
      out.password = o.password.trim();
    }
    try {
      const p = gatewayLocalConfigPath();
      await fs.mkdir(path.dirname(p), { recursive: true });
      if (Object.keys(out).length === 0) {
        await fs.rm(p, { force: true }).catch(() => {
          /* 文件不存在等 */
        });
        return { ok: true };
      }
      await fs.writeFile(p, `${JSON.stringify(out, null, 2)}\n`, "utf8");
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
);

ipcMain.handle("openclaw:readModelConfig", async (): Promise<
  | { ok: true; model: Record<string, unknown>; models: Record<string, unknown> }
  | { ok: false; error: string }
> => {
  return readOpenClawModelConfig();
});

ipcMain.handle(
  "openclaw:writeModelConfig",
  async (_e, payload: unknown): Promise<
    | { ok: true; backupPath?: string }
    | { ok: false; error: string; backupPath?: string }
  > => {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, error: "参数无效" };
    }
    return writeOpenClawModelConfig(payload as OpenClawModelWritePayload);
  },
);

ipcMain.handle(
  "openclaw:restoreLatestBackup",
  async (): Promise<
    { ok: true; backupUsed: string } | { ok: false; error: string; backupPath?: string }
  > => {
    return restoreOpenClawConfigToLatestBackup();
  },
);

ipcMain.handle(
  "openclaw:readProviders",
  async (): Promise<
    { ok: true; providers: Record<string, unknown> } | { ok: false; error: string }
  > => {
    return readOpenClawProviders();
  },
);

ipcMain.handle(
  "openclaw:writeProvidersPatch",
  async (_e, payload: unknown): Promise<
    | { ok: true; backupPath?: string }
    | { ok: false; error: string; backupPath?: string }
  > => {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, error: "参数无效" };
    }
    const p = payload as { patch?: unknown };
    if (!p.patch || typeof p.patch !== "object" || Array.isArray(p.patch)) {
      return { ok: false, error: "patch 缺失或无效" };
    }
    return writeOpenClawProvidersPatch({ patch: p.patch as OpenClawProvidersPatchPayload["patch"] });
  },
);
