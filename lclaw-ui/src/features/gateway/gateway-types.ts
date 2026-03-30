export type GatewayEventFrame = {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
};

export type GatewayResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string; details?: unknown };
};

export class GatewayRequestError extends Error {
  readonly gatewayCode: string;
  readonly details?: unknown;

  constructor(error: { code: string; message: string; details?: unknown }) {
    super(error.message);
    this.name = "GatewayRequestError";
    this.gatewayCode = error.code;
    this.details = error.details;
  }
}

export const PROTOCOL_VERSION = 3;
/** Must match a value in Gateway's GATEWAY_CLIENT_IDS enum. Desktop UI uses "openclaw-control-ui". */
export const GATEWAY_CLIENT_ID = "openclaw-control-ui";
/** 纯浏览器 / 非桌面壳 */
export const GATEWAY_CLIENT_MODE_WEBCHAT = "webchat";
/** Electron、Tauri 等桌面壳：与官方 Control UI 一致，便于本机静默配对等逻辑 */
export const GATEWAY_CLIENT_MODE_UI = "ui";
/** 默认（浏览器联调）；桌面壳在 store 中覆盖为 {@link GATEWAY_CLIENT_MODE_UI} */
export const GATEWAY_CLIENT_MODE = GATEWAY_CLIENT_MODE_WEBCHAT;

/** Browser close code used by upstream when connect RPC fails */
export const CONNECT_FAILED_CLOSE_CODE = 4008;
