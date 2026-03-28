import { invoke, isTauri } from "@tauri-apps/api/core";

/** 浏览器 + Electron + Tauri 统一判断 */
export function isDidClawDesktop(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  if (window.didClawElectron?.isElectron === true) {
    return true;
  }
  return isTauri();
}

function tauriApi(): DidClawElectronApi {
  return {
    isElectron: true,
    openLocalPreview: (fileUrl) => invoke("preview_open_local", { fileUrl }),
    openFileUrlInSystem: (fileUrl) => invoke("shell_open_file_url", { fileUrl }),
    saveLocalFileCopyAs: (fileUrl) => invoke("file_save_copy_as", { fileUrl }),
    saveBase64FileAs: (base64Data, defaultFileName) =>
      invoke("dialog_save_base64_file", { base64Data, defaultFileName }),
    prepareEmailWithLocalFile: (fileUrl) =>
      invoke("shell_prepare_email_with_local_file", { fileUrl }),
    copyLocalFileForShare: (fileUrl, label) =>
      invoke("shell_copy_local_file_for_share", { fileUrl, label }),
    getLibreOfficeStatus: () => invoke("preview_libre_office_status"),
    openLibreOfficeDownloadPage: () => invoke("preview_open_libre_office_download_page"),
    showLibreOfficeInstallDialog: () => invoke("preview_show_libre_office_install_dialog"),
    pickLocalFile: () => invoke("dialog_open_file"),
    readGatewayLocalConfig: () => invoke("read_gateway_local_config"),
    writeGatewayLocalConfig: (data) => invoke("write_gateway_local_config", { data }),
    didclawKvGet: (key: string) => invoke<string | null>("didclaw_kv_get", { key }),
    didclawKvSet: (key: string, value: string) => invoke("didclaw_kv_set", { key, value }),
    didclawKvRemove: (key: string) => invoke("didclaw_kv_remove", { key }),
    ensureOpenClawGateway: (payload) =>
      invoke("ensure_open_claw_gateway", { wsUrl: payload.wsUrl }),
    restartOpenClawGateway: () => invoke("restart_open_claw_gateway"),
    openclawPluginsInstall: (payload: {
      packageSpec: string;
      clawhubToken?: string;
      clawhubRegistry?: string;
    }) =>
      invoke("openclaw_plugins_install", {
        packageSpec: payload.packageSpec,
        clawhubToken: payload.clawhubToken?.trim() || null,
        clawhubRegistry: payload.clawhubRegistry?.trim() || null,
      }),
    readOpenClawModelConfig: () => invoke("read_open_claw_model_config"),
    writeOpenClawModelConfig: (payload) =>
      invoke("write_open_claw_model_config", { payload }),
    restoreOpenClawConfigToLatestBackup: () => invoke("restore_open_claw_config_to_latest_backup"),
    readOpenClawProviders: () => invoke("read_open_claw_providers"),
    readWorkspaceIdentity: () => invoke("read_workspace_identity"),
    writeOpenClawProvidersPatch: (payload) =>
      invoke("write_open_claw_providers_patch", { payload }),
    runOpenclawDoctor: (payload) =>
      invoke("run_openclaw_doctor", {
        repair: payload.repair ?? false,
        executable: payload.executable ?? null,
      }),
    estimateOpenclawBackupSize: () => invoke("estimate_openclaw_backup_size"),
    backupOpenclawConfig: () => invoke("backup_openclaw_config"),
    restoreOpenclawConfig: () => invoke("restore_openclaw_config"),
    writeChannelConfig: (channelKey: string, payload: Record<string, unknown>) =>
      invoke("write_channel_config", { channelKey, payload }),
    checkChannelPluginInstalled: (channel: string) =>
      invoke("check_channel_plugin_installed", { channel }),
    cleanupChannelResidue: (channel: string) =>
      invoke("cleanup_channel_residue", { channel }),
    startChannelQrFlow: (channel: string, gatewayUrl: string, flowId: string) =>
      invoke("start_channel_qr_flow", { channel, gatewayUrl, flowId }),
    getOpenClawSetupStatus: () => invoke("get_open_claw_setup_status"),
    checkOpenclawUpdate: () => invoke("check_openclaw_update"),
    runEnsureOpenclawWindowsInstall: (payload: { skipOnboard: boolean; upgrade?: boolean }) =>
      invoke("run_ensure_openclaw_windows_install", {
        skipOnboard: payload.skipOnboard,
        upgrade: payload.upgrade ?? false,
      }),
  };
}

/** 桌面壳 API：Electron preload 或 Tauri invoke */
export function getDidClawDesktopApi(): DidClawElectronApi | undefined {
  if (!isDidClawDesktop()) {
    return undefined;
  }
  if (typeof window !== "undefined" && window.didClawElectron?.isElectron) {
    return window.didClawElectron;
  }
  if (isTauri()) {
    return tauriApi();
  }
  return undefined;
}
