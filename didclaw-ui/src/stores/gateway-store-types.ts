/** 与 gateway Pinia store 一致；独立文件避免 `gateway` ↔ `gateway-store-lifecycle` 循环类型依赖 */

export type GatewayConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export type PendingBackendPairingRepair = {
  requestId: string;
  deviceId?: string;
  clientId?: string;
  clientMode?: string;
  displayName?: string;
  scopes: string[];
  ts?: number;
};
