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
interface DidClawElectronApi {
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
  /** DidClaw 应用 KV（SQLite）；键名由 Rust 白名单校验 */
  didclawKvGet(key: string): Promise<string | null>;
  didclawKvSet(key: string, value: string): Promise<void>;
  didclawKvRemove(key: string): Promise<void>;
  /** 本机环回地址且端口未监听时，无窗口启动 openclaw gateway（由主进程 spawn，windowsHide） */
  ensureOpenClawGateway(payload: { wsUrl: string }): Promise<
    { ok: true; started: boolean } | { ok: false; error: string }
  >;
  /** 执行 `openclaw gateway restart`（系统已安装的服务/计划任务） */
  restartOpenClawGateway?(): Promise<{ ok: true } | { ok: false; error: string }>;
  /** 执行 `openclaw plugins install <spec>`（如 ClawHub：`clawhub:@scope/name`） */
  openclawPluginsInstall?(payload: {
    packageSpec: string;
    /** 与 `VITE_CLAWHUB_TOKEN` 同源，注入子进程以走用户配额 */
    clawhubToken?: string;
    /** 与 `VITE_CLAWHUB_REGISTRY` 同源 */
    clawhubRegistry?: string;
  }): Promise<
    | { ok: true; stdout?: string; stderr?: string }
    | { ok: false; error: string; stdout?: string; stderr?: string }
  >;
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
  /** 对比本机 `openclaw --version` 与 npm 最新版（需联网） */
  checkOpenclawUpdate?(): Promise<
    | {
        ok: true;
        exeFound: boolean;
        exePath?: string | null;
        currentVersion: string;
        latestVersion: string | null;
        registryError: string | null;
        updateAvailable: boolean;
        platform: string;
      }
    | { ok: false; error: string; platform?: string }
  >;
  /** 首次安装向导预检（桌面端） */
  getOpenClawSetupStatus(): Promise<{
    openclawDirExists: boolean;
    openclawConfigState: "ok" | "missing" | "invalid";
    openclawConfigError: string | null;
    openclawCli: { ok: true; path: string } | { ok: false; error: string };
    modelConfigDeferred: boolean;
    /** 本次预检是否刚把桌面 WebView Origin 写入 openclaw.json；为 true 时应重启网关后重连 */
    controlUiAllowedOriginsMerged?: boolean;
  }>;
  /** Windows：执行打包内的 ensure-openclaw-windows.ps1；`upgrade: true` 时等价 -Upgrade -SkipOnboard（强制 npm 升级 + doctor）；`skipOnboard: true` 等价 -SkipOnboard（仅首次装 CLI）。 */
  runEnsureOpenclawWindowsInstall(payload: {
    skipOnboard: boolean;
    upgrade?: boolean;
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
  /** 读取 workspace/IDENTITY.md 和 USER.md 中的 AI 名称与用户名称 */
  readWorkspaceIdentity?(): Promise<
    { ok: true; aiName?: string | null; userName?: string | null }
    | { ok: false; error: string }
  >;
  /** 执行 `openclaw doctor [--repair] --non-interactive`，返回原始输出供前端解析 */
  runOpenclawDoctor?(payload: {
    repair?: boolean;
    executable?: string;
  }): Promise<{
    ok: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
  /** 估算 ~/.openclaw/ 备份体积（不弹窗） */
  estimateOpenclawBackupSize?(): Promise<
    { ok: true; bytes: number; fileCount: number } | { ok: false; error: string }
  >;
  /** 弹出另存为对话框，将 ~/.openclaw/ 打包为 zip */
  backupOpenclawConfig?(): Promise<
    | { ok: true; savedPath: string; fileCount: number }
    | { ok: false; cancelled?: boolean; error?: string }
  >;
  /** 弹出打开文件对话框，从 zip 解压还原到 ~/.openclaw/ */
  restoreOpenclawConfig?(): Promise<
    | { ok: true; restoredFrom: string; fileCount: number }
    | { ok: false; cancelled?: boolean; error?: string }
  >;
  /** 将 payload 深合并写入 openclaw.json 的 channels.<channelKey> */
  writeChannelConfig?(
    channelKey: string,
    payload: Record<string, unknown>,
  ): Promise<{ ok: true; backupPath?: string } | { ok: false; error: string }>;
  /** 启动 QR 登录流（whatsapp），通过 Tauri 事件推送输出 */
  startChannelQrFlow?(
    channel: string,
    gatewayUrl: string,
  ): Promise<{ ok: boolean; exitCode?: number; error?: string }>;
}

interface Window {
  didClawElectron?: DidClawElectronApi;
}
