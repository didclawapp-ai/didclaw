/** Detect image format from the first bytes (clipboard / WebView2 often omits `File.type`). */
export function sniffImageMimeFromHeader(buf: ArrayBuffer): string | null {
  const u = new Uint8Array(buf);
  if (u.length < 3) {
    return null;
  }
  if (
    u.length >= 4 &&
    u[0] === 0x89 &&
    u[1] === 0x50 &&
    u[2] === 0x4e &&
    u[3] === 0x47
  ) {
    return "image/png";
  }
  if (u[0] === 0xff && u[1] === 0xd8 && u[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    u.length >= 6 &&
    u[0] === 0x47 &&
    u[1] === 0x49 &&
    u[2] === 0x46 &&
    u[3] === 0x38 &&
    (u[4] === 0x37 || u[4] === 0x39)
  ) {
    return "image/gif";
  }
  if (
    u.length >= 12 &&
    u[0] === 0x52 &&
    u[1] === 0x49 &&
    u[2] === 0x46 &&
    u[3] === 0x46 &&
    u[8] === 0x57 &&
    u[9] === 0x45 &&
    u[10] === 0x42 &&
    u[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}
