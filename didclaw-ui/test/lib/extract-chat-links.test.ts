import { describe, expect, it } from "vitest";
import { segmentTextWithLinks } from "@/lib/extract-chat-links";

describe("segmentTextWithLinks", () => {
  it("returns single text segment for plain text", () => {
    const result = segmentTextWithLinks("hello world");
    expect(result).toEqual([{ type: "text", text: "hello world" }]);
  });

  it("extracts a bare https URL", () => {
    const result = segmentTextWithLinks("see https://example.com/doc.pdf for details");
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: "text", text: "see " });
    expect(result[1]).toMatchObject({ type: "link", url: "https://example.com/doc.pdf" });
    expect(result[2]).toEqual({ type: "text", text: " for details" });
  });

  it("extracts a bare http URL", () => {
    const result = segmentTextWithLinks("http://localhost:8080/file.png");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: "link", url: "http://localhost:8080/file.png" });
  });

  it("extracts a file:// URL", () => {
    const result = segmentTextWithLinks("open file:///home/user/doc.pdf now");
    expect(result).toHaveLength(3);
    expect(result[1]).toMatchObject({ type: "link", url: "file:///home/user/doc.pdf" });
  });

  it("extracts a Markdown link [label](url)", () => {
    const result = segmentTextWithLinks("click [My Doc](https://example.com/doc.pdf) here");
    expect(result).toHaveLength(3);
    expect(result[1]).toEqual({
      type: "link",
      url: "https://example.com/doc.pdf",
      label: "My Doc",
    });
  });

  it("uses shortened URL as label when Markdown label is empty", () => {
    const result = segmentTextWithLinks("[](https://example.com/some/report.pdf)");
    expect(result[0]).toMatchObject({ type: "link", label: "report.pdf" });
  });

  it("extracts multiple links from one string", () => {
    const text = "https://a.com/1.png and https://b.com/2.jpg";
    const result = segmentTextWithLinks(text);
    const links = result.filter((s) => s.type === "link");
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ url: "https://a.com/1.png" });
    expect(links[1]).toMatchObject({ url: "https://b.com/2.jpg" });
  });

  it("shortens long filename in auto-generated label", () => {
    const longPath = "https://example.com/" + "a".repeat(60) + ".pdf";
    const result = segmentTextWithLinks(longPath);
    const label = (result[0] as { label: string }).label;
    expect(label.length).toBeLessThan(55);
    expect(label).toContain("…");
  });

  it("returns single text segment for empty string", () => {
    const result = segmentTextWithLinks("");
    expect(result).toEqual([{ type: "text", text: "" }]);
  });
});
