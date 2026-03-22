import { isLclawDesktop } from "./desktop-api";

export { getLclawDesktopApi, isLclawDesktop } from "./desktop-api";

/**
 * 是否在桌面壳内（Electron 或 Tauri）。
 * 名称保留为 `isLclawElectron` 以减少历史调用处改动。
 */
export function isLclawElectron(): boolean {
  return isLclawDesktop();
}
