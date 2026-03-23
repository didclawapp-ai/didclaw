/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_GATEWAY_URL?: string;
  readonly VITE_GATEWAY_TOKEN?: string;
  readonly VITE_GATEWAY_PASSWORD?: string;
  readonly VITE_LINK_ALLOWLIST?: string;
  /** ClawHub Registry 根 URL，默认生产为 https://clawhub.ai */
  readonly VITE_CLAWHUB_REGISTRY?: string;
  /**
   * ClawHub API token（`clawhub login` 或网页签发，形如 `clh_...`）。
   * 会随 Vite 注入前端包，勿提交含真实值的 .env；泄露请立即在 ClawHub 作废。
   */
  readonly VITE_CLAWHUB_TOKEN?: string;
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
  /** 将图片 base64 正文另存为本地文件（聊天内嵌图等） */
  saveBase64FileAs?(
    base64Data: string,
    defaultFileName: string,
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
    autoStartOpenClaw?: boolean;
    stopManagedGatewayOnQuit?: boolean;
    openclawExecutable?: string;
  }>;
  writeGatewayLocalConfig(payload: {
    url?: string;
    token?: string;
    password?: string;
    autoStartOpenClaw?: boolean;
    stopManagedGatewayOnQuit?: boolean;
    openclawExecutable?: string;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  /** 本机环回地址且端口未监听时，无窗口启动 openclaw gateway（由主进程 spawn，windowsHide） */
  ensureOpenClawGateway(payload: { wsUrl: string }): Promise<
    { ok: true; started: boolean } | { ok: false; error: string }
  >;
  /** 执行 `openclaw gateway restart`（系统已安装的服务/计划任务） */
  restartOpenClawGateway?(): Promise<{ ok: true } | { ok: false; error: string }>;
  readOpenClawModelConfig(): Promise<
    | { ok: true; model: Record<string, unknown>; models: Record<string, unknown> }
    | { ok: false; error: string }
  >;
  writeOpenClawModelConfig(payload: {
    model?: Record<string, unknown>;
    models?: Record<string, Record<string, unknown>>;
  }): Promise<
    | { ok: true; backupPath?: string }
    | { ok: false; error: string; backupPath?: string }
  >;
  restoreOpenClawConfigToLatestBackup(): Promise<
    | { ok: true; backupUsed: string }
    | { ok: false; error: string; backupPath?: string }
  >;
  readOpenClawProviders(): Promise<
    | { ok: true; providers: Record<string, unknown>; defaultAgentId: string }
    | { ok: false; error: string }
  >;
  /** 首次安装向导预检（桌面端） */
  getOpenClawSetupStatus(): Promise<{
    openclawDirExists: boolean;
    openclawConfigState: "ok" | "missing" | "invalid";
    openclawConfigError: string | null;
    openclawCli: { ok: true; path: string } | { ok: false; error: string };
    modelConfigDeferred: boolean;
  }>;
  /** Windows：执行打包内的 ensure-openclaw-windows.ps1；`skipOnboard` 为 true 时等价 -SkipOnboard */
  runEnsureOpenclawWindowsInstall(payload: {
    skipOnboard: boolean;
  }): Promise<{
    ok: boolean;
    exitCode: number;
    log: string;
    error?: string | null;
  }>;
  writeOpenClawProvidersPatch(payload: {
    patch: Record<string, Record<string, unknown> | null>;
  }): Promise<
    | {
        ok: true;
        backupPath?: string;
        agentModelsBackupPath?: string;
        authProfilesBackupPath?: string;
        defaultAgentId: string;
      }
    | {
        ok: false;
        error: string;
        backupPath?: string;
        agentModelsBackupPath?: string;
        authProfilesBackupPath?: string;
      }
  >;
}

interface Window {
  lclawElectron?: LclawElectronApi;
}
