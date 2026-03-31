/**
 * 设备签名 v3 所需的 OS 标识，与 OpenClaw / ClawPanel（Rust `std::env::consts::OS`）约定一致：
 * `windows` | `macos` | `linux`。
 */
export function inferOpenclawGatewayOs(): string {
  if (typeof navigator === "undefined") {
    return "linux";
  }
  const p = (navigator.platform ?? "").toLowerCase();
  const ua = (navigator.userAgent ?? "").toLowerCase();
  if (p.includes("win") || ua.includes("windows nt")) {
    return "windows";
  }
  if (p.includes("mac") || ua.includes("mac os x") || ua.includes("macintosh")) {
    return "macos";
  }
  return "linux";
}
