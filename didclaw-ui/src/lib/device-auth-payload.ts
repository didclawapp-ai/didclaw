/**
 * OpenClaw 网关设备认证载荷 **v3**：`minProtocol >= 3` 时须使用本格式（管道分隔字段，末尾含 `platformOs`、`deviceFamily`）。
 * 与仅含 v2 字段的旧版浏览器客户端区分。
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
