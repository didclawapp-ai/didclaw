import { i18n } from "@/i18n";
import type { GatewayChatMessage } from "@/lib/chat-messages";
import { extractMessageTimeMs } from "@/lib/chat-history-sort";
import { buildListPreview } from "@/lib/chat-message-format";

export type ChatLine = {
  role: "user" | "assistant" | "system";
  /** Full body text used for right-side preview and copy */
  text: string;
  /** Abbreviated text shown in the left message list (avoids flooding with large JSON) */
  listText: string;
  streaming?: boolean;
  /** Local HH:mm derived from gateway `timestamp` (matches official Web UI) */
  timeLabel?: string;
};

/** Locale-independent prefix used to identify auto-generated assistant meta-only lines */
export const ASSISTANT_META_PREFIX = "[assistant\u00b7meta-only]";
/** Locale-independent prefix used to identify auto-generated system no-text lines */
export const SYSTEM_NO_TEXT_PREFIX = "[system\u00b7no-text]";

/** Time label for the message list badge (HH:mm, matches official Control UI) */
export function formatMessageListTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function compactObjectHint(o: Record<string, unknown>): string {
  const keys = Object.keys(o).filter((k) => k !== "content" && k !== "role");
  const head = keys.slice(0, 6).join(", ");
  return head
    ? `${i18n.global.t("chatLineLib.fieldHint")}${head}${keys.length > 6 ? "…" : ""}`
    : i18n.global.t("chatLineLib.noTextField");
}

/** Returns a single readable line when the assistant message has only metadata (no text parts) */
function assistantStructuredSummary(o: Record<string, unknown>): string | null {
  const model = o.model;
  const api = o.api;
  const provider = o.provider;
  if (typeof model !== "string" && typeof api !== "string" && typeof provider !== "string") {
    return null;
  }
  const parts = [
    typeof provider === "string" ? `provider=${provider}` : null,
    typeof api === "string" ? `api=${api}` : null,
    typeof model === "string" ? `model=${model}` : null,
  ].filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  return `${ASSISTANT_META_PREFIX} ${parts.join(", ")} (${i18n.global.t("chatLineLib.noTextBody")})`;
}

function extractBody(o: Record<string, unknown>): string {
  if (typeof o.text === "string") {
    return o.text;
  }
  if (Array.isArray(o.content)) {
    return o.content
      .map((p) => {
        const x = p as Record<string, unknown>;
        return x?.type === "text" && typeof x.text === "string" ? x.text : "";
      })
      .join("");
  }
  return "";
}

function stripTransportInjectedUserHeader(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length === 0) {
    return text;
  }

  const first = (lines[0] ?? "").trim();
  const second = (lines[1] ?? "").trim();
  const looksLikeTransportHeader =
    /^System:\s*\[[^\]]+\]\s*(Feishu|Lark|WhatsApp|WeChat)\[[^\]]+\]/i.test(first);
  const looksLikeMessageId = /^\[msg:[^\]]+\]$/i.test(second);
  if (!looksLikeTransportHeader) {
    return text;
  }

  let start = looksLikeMessageId ? 2 : 1;
  while (start < lines.length && lines[start].trim() === "") {
    start += 1;
  }
  const stripped = lines.slice(start).join("\n").trim();
  return stripped || text;
}

export function messageToChatLine(m: unknown): ChatLine {
  if (!m || typeof m !== "object") {
    const s = String(m);
    return { role: "system", text: s, listText: buildListPreview(s) };
  }
  const o = m as Record<string, unknown>;
  const roleRaw = typeof o.role === "string" ? o.role.toLowerCase() : "system";
  const role =
    roleRaw === "user" || roleRaw === "assistant" || roleRaw === "system" ? roleRaw : "system";

  let text = extractBody(o);
  if (role === "user" && text) {
    text = stripTransportInjectedUserHeader(text);
  }
  if (!text.trim()) {
    if (role === "assistant") {
      const structured = assistantStructuredSummary(o);
      if (structured) {
        text = structured;
      }
    }
    if (!text.trim()) {
      text = `${SYSTEM_NO_TEXT_PREFIX} (${compactObjectHint(o)})`;
    }
  }

  const timeMs = extractMessageTimeMs(o as GatewayChatMessage);
  const timeLabel = timeMs != null ? formatMessageListTime(timeMs) : undefined;

  return {
    role,
    text,
    listText: buildListPreview(text),
    ...(timeLabel ? { timeLabel } : {}),
  };
}
