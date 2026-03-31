/** Minimal text extraction for chat payloads (MVP; extend when mirroring full Control UI). */
export function extractDisplayText(message: unknown): string {
  if (message == null) {
    return "";
  }
  if (typeof message === "string") {
    return message;
  }
  if (typeof message !== "object") {
    return "";
  }
  const m = message as Record<string, unknown>;

  if (typeof m.text === "string") {
    return m.text;
  }
  if (typeof m.textDelta === "string") {
    return m.textDelta;
  }
  if (typeof m.delta === "string") {
    return m.delta;
  }
  if (typeof m.body === "string") {
    return m.body;
  }

  const nested = m.message;
  if (nested != null) {
    const inner = extractDisplayText(nested);
    if (inner) {
      return inner;
    }
  }

  const content = m.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const joined = content
      .map((p) => {
        if (typeof p === "string") {
          return p;
        }
        const x = p as Record<string, unknown>;
        if (x?.type === "text") {
          if (typeof x.text === "string") {
            return x.text;
          }
          if (typeof x.value === "string") {
            return x.value;
          }
        }
        if (typeof x.text === "string") {
          return x.text;
        }
        return "";
      })
      .join("");
    if (joined) {
      return joined;
    }
  }

  const parts = m.parts;
  if (Array.isArray(parts)) {
    const joined = parts
      .map((p) => {
        if (typeof p === "string") {
          return p;
        }
        return extractDisplayText(p);
      })
      .join("");
    if (joined) {
      return joined;
    }
  }

  const choices = m.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const c0 = choices[0] as Record<string, unknown>;
    const d = c0?.delta;
    if (d && typeof d === "object") {
      const dd = d as Record<string, unknown>;
      if (typeof dd.content === "string") {
        return dd.content;
      }
      const fromContent = extractDisplayText({ content: dd.content });
      if (fromContent) {
        return fromContent;
      }
    }
  }

  return "";
}

/** 优先读 `message`，再读 `chat` 事件顶层常见字段（Zod passthrough 可能带上）。 */
export function extractChatDeltaText(payload: Record<string, unknown>): string {
  const fromMsg = extractDisplayText(payload.message);
  if (fromMsg) {
    return fromMsg;
  }
  return extractDisplayText({
    text: payload.text,
    textDelta: payload.textDelta,
    delta: payload.delta,
    body: payload.body,
    content: payload.content,
    parts: payload.parts,
  });
}

/**
 * 合并 `chat` 事件的 delta：网关可能发「已累计的全文」或「仅本次增量」。
 * 若新片段以当前全文为前缀则视为快照并替换；否则在互不前缀时做追加。
 */
export function mergeAssistantStreamDelta(
  current: string | null | undefined,
  chunk: string,
): string {
  const cur = current ?? "";
  if (!chunk) {
    return cur;
  }
  if (!cur) {
    return chunk;
  }
  if (chunk.startsWith(cur)) {
    return chunk;
  }
  if (cur.startsWith(chunk)) {
    return cur;
  }
  return cur + chunk;
}
