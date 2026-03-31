import { describe, expect, it } from "vitest";
import { isSafePreviewUrl } from "@/lib/is-safe-preview-url";

describe("isSafePreviewUrl", () => {
  it.each([
    "https://example.com/report.pdf",
    "http://localhost:8080/file.png",
    "file:///home/user/doc.pdf",
    "blob:https://example.com/some-uuid",
  ])("allows safe URL: %s", (url) => {
    expect(isSafePreviewUrl(url)).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "JAVASCRIPT:void(0)",
    "data:text/html,<h1>xss</h1>",
    "DATA:image/png;base64,abc",
    "vbscript:msgbox(1)",
  ])("blocks dangerous scheme: %s", (url) => {
    expect(isSafePreviewUrl(url)).toBe(false);
  });

  it("blocks empty string", () => {
    expect(isSafePreviewUrl("")).toBe(false);
  });

  it("blocks whitespace-only string", () => {
    expect(isSafePreviewUrl("   ")).toBe(false);
  });

  it("blocks invalid URL (no scheme)", () => {
    expect(isSafePreviewUrl("//example.com/file.pdf")).toBe(false);
  });

  it("blocks ftp scheme", () => {
    expect(isSafePreviewUrl("ftp://example.com/file.zip")).toBe(false);
  });

  it("handles leading/trailing whitespace by trimming", () => {
    expect(isSafePreviewUrl("  https://example.com/ok.pdf  ")).toBe(true);
  });
});
