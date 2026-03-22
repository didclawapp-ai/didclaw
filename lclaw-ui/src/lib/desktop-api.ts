import { invoke, isTauri } from "@tauri-apps/api/core";

/** 浏览器 + Electron + Tauri 统一判断 */
export function isLclawDesktop(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  if (window.lclawElectron?.isElectron === true) {
    return true;
  }
  return isTauri();
}

function tauriApi(): LclawElectronApi {
  return {
    isElectron: true,
    openLocalPreview: (fileUrl) => invoke("preview_open_local", { fileUrl }),
    openFileUrlInSystem: (fileUrl) => invoke("shell_open_file_url", { fileUrl }),
    saveLocalFileCopyAs: (fileUrl) => invoke("file_save_copy_as", { fileUrl }),
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
    ensureOpenClawGateway: (payload) =>
      invoke("ensure_open_claw_gateway", { wsUrl: payload.wsUrl }),
    readOpenClawModelConfig: () => invoke("read_open_claw_model_config"),
    writeOpenClawModelConfig: (payload) =>
      invoke("write_open_claw_model_config", { payload }),
    restoreOpenClawConfigToLatestBackup: () => invoke("restore_open_claw_config_to_latest_backup"),
    readOpenClawProviders: () => invoke("read_open_claw_providers"),
    writeOpenClawProvidersPatch: (payload) =>
      invoke("write_open_claw_providers_patch", { payload }),
  };
}

/** 桌面壳 API：Electron preload 或 Tauri invoke */
export function getLclawDesktopApi(): LclawElectronApi | undefined {
  if (!isLclawDesktop()) {
    return undefined;
  }
  if (typeof window !== "undefined" && window.lclawElectron?.isElectron) {
    return window.lclawElectron;
  }
  if (isTauri()) {
    return tauriApi();
  }
  return undefined;
}
