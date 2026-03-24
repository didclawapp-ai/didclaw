import { isDidClawDesktop } from "./desktop-api";

export { getDidClawDesktopApi, isDidClawDesktop } from "./desktop-api";

/**
 * 是否在桌面壳内（Electron 或 Tauri）。
 * 名称保留为 `isDidClawElectron` 以减少历史调用处改动。
 */
export function isDidClawElectron(): boolean {
  return isDidClawDesktop();
}
