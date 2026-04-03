import { isDidClawDesktop } from "./desktop-api";

export { getDidClawDesktopApi, isDidClawDesktop } from "./desktop-api";

/**
 * 是否在桌面壳内（Electron 或 Tauri）。
 * 名称保留为 `isDidClawElectron` 以减少历史调用处改动。
 *
 * **兼容策略**：DidClaw 以 Tauri 为主力；若仍存在独立 Electron 壳，应与本函数及
 * `getDidClawDesktopApi()` 的桌面能力对齐。移除 Electron 前需全仓检索 `isDidClawElectron` /
 * `electron-bridge` 并改测 Tauri 路径。
 */
export function isDidClawElectron(): boolean {
  return isDidClawDesktop();
}
