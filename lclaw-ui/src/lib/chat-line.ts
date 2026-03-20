import { buildListPreview } from "@/lib/chat-message-format";

export type ChatLine = {
  role: "user" | "assistant" | "system";
  /** 完整正文：右侧预览、复制等 */
  text: string;
  /** 左侧消息列表展示（可摘要/截断，避免大块 JSON 刷屏） */
  listText: string;
  streaming?: boolean;
};

function compactObjectHint(o: Record<string, unknown>): string {
  const keys = Object.keys(o).filter((k) => k !== "content" && k !== "role");
  const head = keys.slice(0, 6).join(", ");
  return head ? `字段: ${head}${keys.length > 6 ? "…" : ""}` : "无常用文本字段";
}

/** assistant 仅有 api/provider/model 等、无文本 part 时的可读一行 */
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
  return `[助手·仅元数据] ${parts.join("，")}（无文本正文）`;
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
  if (!text.trim()) {
    if (role === "assistant") {
      const structured = assistantStructuredSummary(o);
      if (structured) {
        text = structured;
      }
    }
    if (!text.trim()) {
      text = `[系统] 无文本正文（${compactObjectHint(o)}）`;
    }
  }

  return {
    role,
    text,
    listText: buildListPreview(text),
  };
}
