import { describe, expect, it } from "vitest";
import {
  fileExtensionFromUrl,
  hljsLanguageFromUrl,
  isHttpsUrl,
  officeOnlineEmbedUrl,
  previewKindFromUrl,
} from "@/lib/preview-kind";

describe("fileExtensionFromUrl", () => {
  it("extracts extension from simple path", () => {
    expect(fileExtensionFromUrl("https://example.com/report.pdf")).toBe("pdf");
  });

  it("extracts extension from path with query string", () => {
    expect(fileExtensionFromUrl("https://example.com/image.png?v=1")).toBe("png");
  });

  it("extracts extension from path with fragment", () => {
    expect(fileExtensionFromUrl("https://example.com/doc.md#section")).toBe("md");
  });

  it("returns lowercase extension", () => {
    expect(fileExtensionFromUrl("https://example.com/Photo.JPG")).toBe("jpg");
  });

  it("returns empty string for no extension", () => {
    expect(fileExtensionFromUrl("https://example.com/README")).toBe("");
  });

  it("returns empty string for dotfile (leading dot only)", () => {
    expect(fileExtensionFromUrl("https://example.com/.gitignore")).toBe("");
  });

  it("handles bare filename without scheme", () => {
    expect(fileExtensionFromUrl("report.docx")).toBe("docx");
  });
});

describe("previewKindFromUrl", () => {
  it.each([
    ["https://cdn.example.com/photo.png", "image"],
    ["https://cdn.example.com/photo.jpeg", "image"],
    ["https://cdn.example.com/photo.jpg", "image"],
    ["https://cdn.example.com/anim.gif", "image"],
    ["https://cdn.example.com/icon.svg", "image"],
    ["https://cdn.example.com/art.webp", "image"],
  ])("classifies %s as image", (url, expected) => {
    expect(previewKindFromUrl(url)).toBe(expected);
  });

  it("classifies .pdf as pdf", () => {
    expect(previewKindFromUrl("https://files.example.com/report.pdf")).toBe("pdf");
  });

  it.each([
    ["https://example.com/doc.docx", "office"],
    ["https://example.com/doc.doc", "office"],
    ["https://example.com/sheet.xlsx", "office"],
    ["https://example.com/slide.pptx", "office"],
  ])("classifies %s as office", (url, expected) => {
    expect(previewKindFromUrl(url)).toBe(expected);
  });

  it.each([
    ["https://example.com/README.md", "markdown"],
    ["https://example.com/guide.markdown", "markdown"],
  ])("classifies %s as markdown", (url, expected) => {
    expect(previewKindFromUrl(url)).toBe(expected);
  });

  it.each([
    ["https://example.com/notes.txt", "text"],
    ["https://example.com/output.log", "text"],
    ["https://example.com/data.csv", "text"],
  ])("classifies %s as text", (url, expected) => {
    expect(previewKindFromUrl(url)).toBe(expected);
  });

  it.each([
    ["https://example.com/app.ts", "code"],
    ["https://example.com/main.py", "code"],
    ["https://example.com/lib.rs", "code"],
    ["https://example.com/build.gradle", "code"],
  ])("classifies %s as code", (url, expected) => {
    expect(previewKindFromUrl(url)).toBe(expected);
  });

  it("classifies Dockerfile (no extension) as code", () => {
    expect(previewKindFromUrl("https://example.com/Dockerfile")).toBe("code");
  });

  it("classifies Containerfile as code", () => {
    expect(previewKindFromUrl("https://example.com/Containerfile")).toBe("code");
  });

  it("falls back to other for unknown extension", () => {
    expect(previewKindFromUrl("https://example.com/archive.zip")).toBe("other");
  });

  it("falls back to other for URL with no extension", () => {
    expect(previewKindFromUrl("https://example.com/somefile")).toBe("other");
  });
});

describe("hljsLanguageFromUrl", () => {
  it("returns typescript for .ts", () => {
    expect(hljsLanguageFromUrl("https://example.com/main.ts")).toBe("typescript");
  });

  it("returns python for .py", () => {
    expect(hljsLanguageFromUrl("https://example.com/script.py")).toBe("python");
  });

  it("returns dockerfile for Dockerfile", () => {
    expect(hljsLanguageFromUrl("https://example.com/Dockerfile")).toBe("dockerfile");
  });

  it("returns dockerfile for Containerfile", () => {
    expect(hljsLanguageFromUrl("https://example.com/Containerfile")).toBe("dockerfile");
  });

  it("returns undefined for unknown extension", () => {
    expect(hljsLanguageFromUrl("https://example.com/archive.zip")).toBeUndefined();
  });

  it("returns undefined for no extension", () => {
    expect(hljsLanguageFromUrl("https://example.com/README")).toBeUndefined();
  });
});

describe("isHttpsUrl", () => {
  it("returns true for https", () => {
    expect(isHttpsUrl("https://example.com")).toBe(true);
  });

  it("returns false for http", () => {
    expect(isHttpsUrl("http://example.com")).toBe(false);
  });

  it("returns false for file protocol", () => {
    expect(isHttpsUrl("file:///local/file.pdf")).toBe(false);
  });

  it("returns false for invalid URL", () => {
    expect(isHttpsUrl("not-a-url")).toBe(false);
  });
});

describe("officeOnlineEmbedUrl", () => {
  it("wraps the file URL in Office Online viewer", () => {
    const file = "https://example.com/doc.docx";
    const result = officeOnlineEmbedUrl(file);
    expect(result).toBe(
      `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(file)}`,
    );
  });

  it("percent-encodes special characters in file URL", () => {
    const file = "https://example.com/my file.xlsx";
    const result = officeOnlineEmbedUrl(file);
    expect(result).toContain(encodeURIComponent(file));
  });
});
