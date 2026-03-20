export type ChatLine = {
  role: "user" | "assistant" | "system";
  text: string;
  /** 流式占位行（非历史消息） */
  streaming?: boolean;
};

export function messageToChatLine(m: unknown): ChatLine {
  if (!m || typeof m !== "object") {
    return { role: "system", text: String(m) };
  }
  const o = m as Record<string, unknown>;
  const roleRaw = typeof o.role === "string" ? o.role.toLowerCase() : "system";
  const role =
    roleRaw === "user" || roleRaw === "assistant" || roleRaw === "system" ? roleRaw : "system";
  let text = "";
  if (typeof o.text === "string") {
    text = o.text;
  } else if (Array.isArray(o.content)) {
    text = o.content
      .map((p) => {
        const x = p as Record<string, unknown>;
        return x?.type === "text" && typeof x.text === "string" ? x.text : "";
      })
      .join("");
  }
  return { role, text: text || JSON.stringify(o).slice(0, 400) };
}
