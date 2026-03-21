import { BrowserWindow, app, dialog, ipcMain } from "electron";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
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
  } else {
    void mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;
const PDF_EXT = /\.pdf$/i;
const OFFICE_EXT = /\.(docx?|xlsx?|pptx?)$/i;

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
  displayKind: "image" | "pdf";
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
    if (OFFICE_EXT.test(lower)) {
      const pdfBuf = await convertOfficeToPdfBuffer(p);
      return {
        ok: true,
        mimeType: "application/pdf",
        base64: pdfBuf.toString("base64"),
        displayKind: "pdf",
      };
    }
    return { ok: false, error: "不支持的文件类型（仅图片、PDF、Office）" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
});

ipcMain.handle("dialog:openFile", async (): Promise<string | null> => {
  const win = mainWindow ?? BrowserWindow.getFocusedWindow();
  const opts = {
    properties: ["openFile" as const],
    filters: [
      { name: "Office", extensions: ["ppt", "pptx", "xls", "xlsx", "doc", "docx"] },
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
