import { buildDeviceAuthPayload } from "@/lib/device-auth-payload";
import {
  loadOrCreateDeviceIdentity,
  saveDeviceToken,
  signDevicePayload,
  type DeviceIdentity,
} from "@/lib/device-identity";
import { inferOpenclawGatewayOs } from "@/lib/openclaw-gateway-os";
import { generateUUID } from "@/lib/uuid";
import { TauriGatewayWebSocket } from "./tauri-gateway-socket";
import {
  CONNECT_FAILED_CLOSE_CODE,
  GATEWAY_CLIENT_ID,
  GATEWAY_CLIENT_MODE,
  GatewayRequestError,
  PROTOCOL_VERSION,
  type GatewayEventFrame,
  type GatewayResponseFrame,
} from "./gateway-types";
import { gatewayEventFrameSchema, gatewayResponseFrameSchema } from "./schemas";

/** 与 `WebSocket.OPEN` 一致；隧道实现未必继承 WebSocket，故用数值比较 */
const WS_OPEN = typeof WebSocket !== "undefined" ? WebSocket.OPEN : 1;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
};

export type GatewayClientOptions = {
  url: string;
  /** 用户配置的 token 或 password，优先级高于 deviceToken */
  token?: string;
  password?: string;
  clientVersion?: string;
  /** Tauri 下由 Rust 建连本机 WS，不经 WebView Origin */
  useTauriTunnel?: boolean;
  /**
   * 默认 {@link GATEWAY_CLIENT_MODE}（webchat）；桌面壳应传 `ui`，与 OpenClaw Control UI 行为一致。
   */
  clientMode?: string;
  onHello?: (hello: unknown) => void;
  onEvent?: (evt: GatewayEventFrame) => void;
  onClose?: (info: { code: number; reason: string; error?: GatewayRequestError }) => void;
  /**
   * 可选的 deviceToken，用于自动重连。
   * 如果提供了 userToken 或 password，则优先使用用户凭证。
   */
  deviceToken?: string;
};

const OPERATOR_SCOPES = [
  "operator.admin",
  "operator.approvals",
  "operator.pairing",
  "operator.read",
  "operator.write",
];

export class GatewayClient {
  private ws: WebSocket | TauriGatewayWebSocket | null = null;
  private pending = new Map<string, Pending>();
  private closed = false;
  private connectNonce: string | null = null;
  private connectSent = false;
  private connectTimer: number | null = null;
  private backoffMs = 800;
  private pendingConnectError: GatewayRequestError | undefined;
  private lastSeq: number | null = null;
  /** 与建连并行准备，避免 crypto 耗时导致网关先断开（closed before connect） */
  private deviceIdentityPromise: Promise<DeviceIdentity | null> | null = null;

  constructor(private readonly opts: GatewayClientOptions) {}

  start(): void {
    this.closed = false;
    this.backoffMs = 800;
    if (typeof crypto !== "undefined" && crypto.subtle) {
      this.deviceIdentityPromise = loadOrCreateDeviceIdentity().catch(() => null);
    } else {
      this.deviceIdentityPromise = null;
    }
    this.connect();
  }

  stop(): void {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
    this.deviceIdentityPromise = null;
    this.pendingConnectError = undefined;
    this.flushPending(new Error("gateway client stopped"));
    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  get connected(): boolean {
    return this.ws?.readyState === WS_OPEN;
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WS_OPEN) {
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
    const onClose = (ev: CloseEvent) => {
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
    };

    if (this.opts.useTauriTunnel) {
      const ws = new TauriGatewayWebSocket(this.opts.url, {
        token: this.opts.token,
        password: this.opts.password,
      });
      this.ws = ws;
      ws.addEventListener("open", () => this.queueConnect());
      ws.addEventListener("message", (ev) => this.handleMessage(String(ev.data ?? "")));
      ws.addEventListener("close", onClose);
      ws.addEventListener("error", () => {
        /* close handler runs */
      });
      void ws.start();
      return;
    }

    const ws = new WebSocket(this.opts.url);
    this.ws = ws;
    ws.addEventListener("open", () => this.queueConnect());
    ws.addEventListener("message", (ev) => this.handleMessage(String(ev.data ?? "")));
    ws.addEventListener("close", onClose);
    ws.addEventListener("error", () => {
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
    // 官方协议要求先收 connect.challenge，再用其 nonce 做 device 签名后发 connect。
    // 若在收到挑战前抢发 connect（nonce 为空），2026.3+ 网关会直接掐线（日志常见 closed before connect / 1006）。
    // 见 https://docs.molt.bot/gateway/protocol
    /** 慢盘/冷启动网关可能较晚才下发 challenge；过短会空 nonce 抢连导致被网关断开 */
    const challengeFallbackMs = 28_000;
    this.connectTimer = window.setTimeout(() => {
      void this.sendConnect();
    }, challengeFallbackMs);
  }

  private handleMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    if (typeof parsed !== "object" || parsed === null) {
      return;
    }

    const frame = parsed as { type?: unknown };

    if (frame.type === "event") {
      const result = gatewayEventFrameSchema.safeParse(parsed);
      if (!result.success) {
        console.warn("[didclaw] invalid gateway event frame", result.error.issues);
        return;
      }
      const evt = result.data as GatewayEventFrame;
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
          console.warn("[didclaw] gateway event seq gap", this.lastSeq + 1, seq);
        }
        this.lastSeq = seq;
      }
      try {
        this.opts.onEvent?.(evt);
      } catch (e) {
        console.error("[didclaw] onEvent error", e);
      }
      return;
    }

    if (frame.type === "res") {
      const result = gatewayResponseFrameSchema.safeParse(parsed);
      if (!result.success) {
        console.warn("[didclaw] invalid gateway res frame", result.error.issues);
        return;
      }
      const res = result.data as GatewayResponseFrame;
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
      // AUTH_TOKEN_MISMATCH: per-spec, trusted clients may attempt one bounded
      // retry with the cached per-device token when user credentials fail.
      if (
        e instanceof GatewayRequestError &&
        e.gatewayCode === "AUTH_TOKEN_MISMATCH" &&
        this.opts.deviceToken?.trim() &&
        (this.opts.token?.trim() || this.opts.password?.trim())
      ) {
        console.warn("[didclaw] AUTH_TOKEN_MISMATCH on user credentials, retrying with deviceToken");
        try {
          await this.sendConnectInner({ useDeviceTokenOnly: true });
          return;
        } catch (retryErr) {
          // Retry also failed — report the original error (more actionable)
          console.error("[didclaw] deviceToken retry also failed", retryErr);
        }
      }
      console.error("[didclaw] sendConnect failed", e);
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

  private async sendConnectInner(overrides?: { useDeviceTokenOnly?: boolean }): Promise<void> {
    const isSecureContext = typeof crypto !== "undefined" && !!crypto.subtle;
    const role = "operator";
    const clientMode = this.opts.clientMode ?? GATEWAY_CLIENT_MODE;
    const platformOs = inferOpenclawGatewayOs();
    const deviceFamily = "desktop";

    // Priority: user-configured token/password > deviceToken.
    // useDeviceTokenOnly=true is used for the AUTH_TOKEN_MISMATCH bounded retry.
    const userToken = overrides?.useDeviceTokenOnly ? undefined : (this.opts.token?.trim() || undefined);
    const password = overrides?.useDeviceTokenOnly ? undefined : (this.opts.password?.trim() || undefined);
    const deviceToken = this.opts.deviceToken?.trim() || undefined;

    const auth = userToken || password
      ? { token: userToken, password }
      : deviceToken
        ? { token: deviceToken }
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
      const deviceIdentity =
        (this.deviceIdentityPromise != null ? await this.deviceIdentityPromise : null) ??
        (await loadOrCreateDeviceIdentity());
      if (!deviceIdentity) {
        throw new Error("device identity unavailable");
      }
      const signedAtMs = Date.now();
      const nonce = this.connectNonce ?? "";
      const payload = buildDeviceAuthPayload({
        deviceId: deviceIdentity.deviceId,
        clientId: GATEWAY_CLIENT_ID,
        clientMode,
        role,
        scopes: OPERATOR_SCOPES,
        signedAtMs,
        token: userToken ?? null,
        nonce,
        platformOs,
        deviceFamily,
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

    if (!this.ws || this.ws.readyState !== WS_OPEN) {
      throw new Error("gateway closed before connect request");
    }

    const params = {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: {
        id: GATEWAY_CLIENT_ID,
        version: this.opts.clientVersion ?? `didclaw/${__APP_VERSION__}`,
        platform: platformOs,
        deviceFamily,
        mode: clientMode,
      },
      role,
      scopes: OPERATOR_SCOPES,
      device,
      /**
       * OpenClaw `connect` 里 `caps` 默认为 `[]`（见协议文档）。
       * 仅填 `["tool-events"]` 时，网关可能只推送工具相关事件，**不下发 `chat` 的 delta/final**，
       * 表现为定时任务等在其它会话（如 `cron:<jobId>`，见 [Session 概念](https://docs.openclaw.ai/concepts/session)）跑完后，
       * 界面不更新，直到重连触发 `chat.history`。
       */
      caps: [],
      auth,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      locale: typeof navigator !== "undefined" ? navigator.language : "",
    };

    const hello = await this.request("connect", params);
    this.backoffMs = 800;
    this.pendingConnectError = undefined;
    
    // 保存网关返回的 deviceToken（如果有）
    const helloPayload = hello as { 
      auth?: { 
        deviceToken?: string;
        role?: string;
        scopes?: string[];
      };
      type?: string;
      protocol?: number;
    } | undefined;
    
    const returnedDeviceToken = helloPayload?.auth?.deviceToken;
    if (returnedDeviceToken && typeof returnedDeviceToken === "string") {
      // 异步保存，不阻塞连接流程
      void saveDeviceToken(returnedDeviceToken).catch((e) => {
        console.error("[didclaw] failed to save deviceToken", e);
      });
    }
    
    this.opts.onHello?.(hello);
  }
}
