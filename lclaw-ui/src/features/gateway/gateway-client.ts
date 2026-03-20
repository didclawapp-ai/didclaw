import { buildDeviceAuthPayload } from "@/lib/device-auth-payload";
import { loadOrCreateDeviceIdentity, signDevicePayload } from "@/lib/device-identity";
import { generateUUID } from "@/lib/uuid";
import {
  CONNECT_FAILED_CLOSE_CODE,
  GATEWAY_CLIENT_ID,
  GATEWAY_CLIENT_MODE,
  GatewayRequestError,
  PROTOCOL_VERSION,
  type GatewayEventFrame,
  type GatewayResponseFrame,
} from "./gateway-types";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
};

export type GatewayClientOptions = {
  url: string;
  token?: string;
  password?: string;
  clientVersion?: string;
  onHello?: (hello: unknown) => void;
  onEvent?: (evt: GatewayEventFrame) => void;
  onClose?: (info: { code: number; reason: string; error?: GatewayRequestError }) => void;
};

const OPERATOR_SCOPES = ["operator.admin", "operator.approvals", "operator.pairing"];

export class GatewayClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private closed = false;
  private connectNonce: string | null = null;
  private connectSent = false;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = 800;
  private pendingConnectError: GatewayRequestError | undefined;
  private lastSeq: number | null = null;

  constructor(private readonly opts: GatewayClientOptions) {}

  start(): void {
    this.closed = false;
    this.backoffMs = 800;
    this.connect();
  }

  stop(): void {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
    this.pendingConnectError = undefined;
    this.flushPending(new Error("gateway client stopped"));
    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("gateway not connected"));
    }
    const id = generateUUID();
    const frame = { type: "req", id, method, params };
    const p = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      });
    });
    this.ws.send(JSON.stringify(frame));
    return p;
  }

  private connect(): void {
    if (this.closed) {
      return;
    }
    this.ws = new WebSocket(this.opts.url);
    this.ws.addEventListener("open", () => this.queueConnect());
    this.ws.addEventListener("message", (ev) => this.handleMessage(String(ev.data ?? "")));
    this.ws.addEventListener("close", (ev) => {
      const reason = String(ev.reason ?? "");
      const connectError = this.pendingConnectError;
      this.pendingConnectError = undefined;
      this.ws = null;
      this.flushPending(new Error(`gateway closed (${ev.code}): ${reason}`));
      this.opts.onClose?.({
        code: ev.code,
        reason,
        error: connectError,
      });
      if (!this.closed && !this.shouldSuppressReconnect(ev.code, connectError)) {
        this.scheduleReconnect();
      }
    });
    this.ws.addEventListener("error", () => {
      /* close handler runs */
    });
  }

  private shouldSuppressReconnect(code: number, err?: GatewayRequestError): boolean {
    if (code === CONNECT_FAILED_CLOSE_CODE && err) {
      const msg = `${err.message} ${JSON.stringify(err.details ?? {})}`.toLowerCase();
      if (msg.includes("pairing") || msg.includes("unauthorized") || msg.includes("password")) {
        return true;
      }
    }
    return false;
  }

  private scheduleReconnect(): void {
    if (this.closed) {
      return;
    }
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 1.7, 15_000);
    window.setTimeout(() => this.connect(), delay);
  }

  private flushPending(err: Error): void {
    for (const [, p] of this.pending) {
      p.reject(err);
    }
    this.pending.clear();
  }

  private queueConnect(): void {
    this.connectNonce = null;
    this.connectSent = false;
    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer);
    }
    this.connectTimer = window.setTimeout(() => {
      void this.sendConnect();
    }, 750);
  }

  private handleMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    const frame = parsed as { type?: unknown };
    if (frame.type === "event") {
      const evt = parsed as GatewayEventFrame;
      if (evt.event === "connect.challenge") {
        const payload = evt.payload as { nonce?: unknown } | undefined;
        const nonce = payload && typeof payload.nonce === "string" ? payload.nonce : null;
        if (nonce) {
          this.connectNonce = nonce;
          if (this.connectTimer !== null) {
            clearTimeout(this.connectTimer);
            this.connectTimer = null;
          }
          void this.sendConnect();
        }
        return;
      }
      const seq = typeof evt.seq === "number" ? evt.seq : null;
      if (seq !== null) {
        if (this.lastSeq !== null && seq > this.lastSeq + 1) {
          console.warn("[lclaw-ui] gateway event seq gap", this.lastSeq + 1, seq);
        }
        this.lastSeq = seq;
      }
      try {
        this.opts.onEvent?.(evt);
      } catch (e) {
        console.error("[lclaw-ui] onEvent error", e);
      }
      return;
    }

    if (frame.type === "res") {
      const res = parsed as GatewayResponseFrame;
      const pending = this.pending.get(res.id);
      if (!pending) {
        return;
      }
      this.pending.delete(res.id);
      if (res.ok) {
        pending.resolve(res.payload);
      } else {
        pending.reject(
          new GatewayRequestError({
            code: res.error?.code ?? "UNAVAILABLE",
            message: res.error?.message ?? "request failed",
            details: res.error?.details,
          }),
        );
      }
    }
  }

  private async sendConnect(): Promise<void> {
    if (this.connectSent) {
      return;
    }
    this.connectSent = true;
    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }

    try {
      await this.sendConnectInner();
    } catch (e) {
      console.error("[lclaw-ui] sendConnect failed", e);
      this.pendingConnectError =
        e instanceof GatewayRequestError
          ? e
          : new GatewayRequestError({
              code: "CLIENT_ERROR",
              message: e instanceof Error ? e.message : String(e),
            });
      this.ws?.close(CONNECT_FAILED_CLOSE_CODE, "connect failed");
    }
  }

  private async sendConnectInner(): Promise<void> {
    const isSecureContext = typeof crypto !== "undefined" && !!crypto.subtle;
    const role = "operator";
    const token = this.opts.token?.trim() || undefined;
    const password = this.opts.password?.trim() || undefined;
    const auth =
      token || password
        ? {
            token,
            password,
          }
        : undefined;

    let device:
      | {
          id: string;
          publicKey: string;
          signature: string;
          signedAt: number;
          nonce: string;
        }
      | undefined;

    if (isSecureContext) {
      const deviceIdentity = await loadOrCreateDeviceIdentity();
      const signedAtMs = Date.now();
      const nonce = this.connectNonce ?? "";
      const payload = buildDeviceAuthPayload({
        deviceId: deviceIdentity.deviceId,
        clientId: GATEWAY_CLIENT_ID,
        clientMode: GATEWAY_CLIENT_MODE,
        role,
        scopes: OPERATOR_SCOPES,
        signedAtMs,
        token: token ?? null,
        nonce,
      });
      const signature = await signDevicePayload(deviceIdentity.privateKey, payload);
      device = {
        id: deviceIdentity.deviceId,
        publicKey: deviceIdentity.publicKey,
        signature,
        signedAt: signedAtMs,
        nonce,
      };
    }

    const params = {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: {
        id: GATEWAY_CLIENT_ID,
        version: this.opts.clientVersion ?? "lclaw-ui/0.1.0",
        platform: typeof navigator !== "undefined" ? navigator.platform : "web",
        mode: GATEWAY_CLIENT_MODE,
      },
      role,
      scopes: OPERATOR_SCOPES,
      device,
      caps: ["tool-events"],
      auth,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      locale: typeof navigator !== "undefined" ? navigator.language : "",
    };

    const hello = await this.request("connect", params);
    this.backoffMs = 800;
    this.pendingConnectError = undefined;
    this.opts.onHello?.(hello);
  }
}
