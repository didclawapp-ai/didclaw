/**
 * OpenClaw gateway 设备签名载荷 **v3**（协议 minProtocol 3 时应对齐此格式）。
 * 参考社区面板在 Rust 侧组装的 `v3|…|platform|deviceFamily` 串，与仅含 v2 的旧浏览器客户端区分。
 */
export function buildDeviceAuthPayload(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token?: string | null;
  nonce: string;
  /** `windows` | `macos` | `linux` */
  platformOs: string;
  /** 桌面壳一般为 `desktop` */
  deviceFamily: string;
}): string {
  const scopes = params.scopes.join(",");
  const token = params.token ?? "";
  return [
    "v3",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopes,
    String(params.signedAtMs),
    token,
    params.nonce,
    params.platformOs,
    params.deviceFamily,
  ].join("|");
}
