import { describe, expect, it } from "vitest";
import { sniffImageMimeFromHeader } from "@/lib/chat-image-sniff";

describe("sniffImageMimeFromHeader", () => {
  it("detects PNG", () => {
    const b = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(sniffImageMimeFromHeader(b.buffer)).toBe("image/png");
  });

  it("detects JPEG", () => {
    const b = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(sniffImageMimeFromHeader(b.buffer)).toBe("image/jpeg");
  });

  it("detects GIF89a", () => {
    const s = "GIF89a";
    const b = new Uint8Array([...s].map((c) => c.charCodeAt(0)));
    expect(sniffImageMimeFromHeader(b.buffer)).toBe("image/gif");
  });

  it("returns null for unrelated bytes", () => {
    const b = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    expect(sniffImageMimeFromHeader(b.buffer)).toBeNull();
  });
});
