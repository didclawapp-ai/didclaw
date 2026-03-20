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
export const GATEWAY_CLIENT_ID = "openclaw-control-ui";
export const GATEWAY_CLIENT_MODE = "webchat";

/** Browser close code used by upstream when connect RPC fails */
export const CONNECT_FAILED_CLOSE_CODE = 4008;
