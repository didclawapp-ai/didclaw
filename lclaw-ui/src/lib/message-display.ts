/** Minimal text extraction for chat payloads (MVP; extend when mirroring full Control UI). */
export function extractDisplayText(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }
  const m = message as Record<string, unknown>;
  if (typeof m.text === "string") {
    return m.text;
  }
  const content = m.content;
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        const x = p as Record<string, unknown>;
        if (x?.type === "text" && typeof x.text === "string") {
          return x.text;
        }
        return "";
      })
      .join("");
  }
  return "";
}
