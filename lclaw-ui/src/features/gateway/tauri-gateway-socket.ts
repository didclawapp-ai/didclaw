/**
 * Tauri 下由 Rust 建立本机 WebSocket，WebView 仅通过 invoke + 事件收发 JSON 文本，
 * 避免浏览器 Origin 触发 OpenClaw gateway.controlUi 校验。
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

type TunnelPayload =
  | { kind: "text"; data: string }
  | { kind: "close"; code?: number; reason?: string };

type OpenListener = (this: TauriGatewayWebSocket, ev: Event) => void;
type MessageListener = (this: TauriGatewayWebSocket, ev: MessageEvent) => void;
type CloseListener = (this: TauriGatewayWebSocket, ev: CloseEvent) => void;
type ErrorListener = (this: TauriGatewayWebSocket, ev: Event) => void;

function syntheticCloseEvent(code: number, reason: string): CloseEvent {
  return new CloseEvent("close", { code, reason });
}

export class TauriGatewayWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = TauriGatewayWebSocket.CONNECTING;
  readonly OPEN = TauriGatewayWebSocket.OPEN;
  readonly CLOSING = TauriGatewayWebSocket.CLOSING;
  readonly CLOSED = TauriGatewayWebSocket.CLOSED;

  readyState = TauriGatewayWebSocket.CONNECTING;

  private sendTail: Promise<void> = Promise.resolve();
  private unlisten?: UnlistenFn;
  private disposed = false;
  /**
   * 网关可能在 Rust `connect_async` 返回后立刻推送 `connect.challenge`，而前端此时尚未把
   * readyState 置为 OPEN。若此时处理 message，`request`/`send` 会直接失败或丢包，导致
   * 「closed before connect / 1005」。先缓冲，在 open 回调之后再按序派发。
   */
  private pendingInbound: string[] = [];

  private openListeners: OpenListener[] = [];
  private messageListeners: MessageListener[] = [];
  private closeListeners: CloseListener[] = [];
  private errorListeners: ErrorListener[] = [];

  constructor(
    private readonly url: string,
    private readonly auth?: { token?: string; password?: string },
  ) {}

  addEventListener(
    type: "open",
    listener: OpenListener,
  ): void;
  addEventListener(
    type: "message",
    listener: MessageListener,
  ): void;
  addEventListener(
    type: "close",
    listener: CloseListener,
  ): void;
  addEventListener(
    type: "error",
    listener: ErrorListener,
  ): void;
  addEventListener(
    type: string,
    listener: OpenListener | MessageListener | CloseListener | ErrorListener,
  ): void {
    if (type === "open") {
      this.openListeners.push(listener as OpenListener);
    } else if (type === "message") {
      this.messageListeners.push(listener as MessageListener);
    } else if (type === "close") {
      this.closeListeners.push(listener as CloseListener);
    } else if (type === "error") {
      this.errorListeners.push(listener as ErrorListener);
    }
  }

  removeEventListener(
    type: string,
    listener: OpenListener | MessageListener | CloseListener | ErrorListener,
  ): void {
    if (type === "open") {
      this.openListeners = this.openListeners.filter((l) => l !== listener);
    } else if (type === "message") {
      this.messageListeners = this.messageListeners.filter((l) => l !== listener);
    } else if (type === "close") {
      this.closeListeners = this.closeListeners.filter((l) => l !== listener);
    } else if (type === "error") {
      this.errorListeners = this.errorListeners.filter((l) => l !== listener);
    }
  }

  send(data: string): void {
    if (this.readyState !== TauriGatewayWebSocket.OPEN) {
      return;
    }
    this.sendTail = this.sendTail.then(async () => {
      try {
        await invoke("gateway_tunnel_send", { text: data });
      } catch (e) {
        console.error("[lclaw-ui] gateway_tunnel_send", e);
      }
    });
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === TauriGatewayWebSocket.CLOSED) {
      return;
    }
    this.pendingInbound = [];
    this.readyState = TauriGatewayWebSocket.CLOSING;
    void this.disposeTunnel();
    this.readyState = TauriGatewayWebSocket.CLOSED;
    const ev = syntheticCloseEvent(code, reason);
    for (const l of this.closeListeners) {
      l.call(this, ev);
    }
  }

  /** 释放监听与后端隧道，不触发 close 事件 */
  async disposeTunnel(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.pendingInbound = [];
    this.unlisten?.();
    this.unlisten = undefined;
    try {
      await invoke("gateway_tunnel_close");
    } catch {
      /* 已断开时可能失败，忽略 */
    }
  }

  private dispatchMessage(data: string): void {
    const me = new MessageEvent("message", { data });
    for (const l of this.messageListeners) {
      l.call(this, me);
    }
  }

  async start(): Promise<void> {
    try {
      this.pendingInbound = [];
      this.unlisten = await listen<TunnelPayload>("lclaw-gateway-tunnel", (event) => {
        const p = event.payload;
        if (p.kind === "text") {
          if (this.readyState !== TauriGatewayWebSocket.OPEN) {
            this.pendingInbound.push(p.data);
            return;
          }
          this.dispatchMessage(p.data);
        } else if (p.kind === "close") {
          if (this.readyState === TauriGatewayWebSocket.CLOSED) {
            return;
          }
          this.pendingInbound = [];
          this.readyState = TauriGatewayWebSocket.CLOSED;
          void this.disposeTunnel();
          const ev = syntheticCloseEvent(
            typeof p.code === "number" ? p.code : 1005,
            typeof p.reason === "string" ? p.reason : "",
          );
          for (const l of this.closeListeners) {
            l.call(this, ev);
          }
        }
      });

      await invoke("gateway_tunnel_open", {
        wsUrl: this.url,
        token: this.auth?.token?.trim() || null,
        password: this.auth?.password?.trim() || null,
      });

      if (this.disposed || this.readyState === TauriGatewayWebSocket.CLOSED) {
        return;
      }

      this.readyState = TauriGatewayWebSocket.OPEN;
      const openEv = new Event("open");
      for (const l of this.openListeners) {
        l.call(this, openEv);
      }
      const queued = this.pendingInbound.splice(0);
      for (const data of queued) {
        this.dispatchMessage(data);
      }
    } catch (e) {
      this.unlisten?.();
      this.unlisten = undefined;
      this.readyState = TauriGatewayWebSocket.CLOSED;
      console.error("[lclaw-ui] gateway tunnel connect failed", e);
      const errEv = new Event("error");
      for (const l of this.errorListeners) {
        l.call(this, errEv);
      }
      const msg = e instanceof Error ? e.message : String(e);
      const closeEv = syntheticCloseEvent(1006, msg);
      for (const l of this.closeListeners) {
        l.call(this, closeEv);
      }
    }
  }
}

export function isTauriGatewayWebSocket(
  ws: WebSocket | TauriGatewayWebSocket | null,
): ws is TauriGatewayWebSocket {
  return ws != null && ws instanceof TauriGatewayWebSocket;
}
