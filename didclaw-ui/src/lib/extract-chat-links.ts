export type ChatSegment =
  | { type: "text"; text: string }
  | { type: "link"; url: string; label: string };

function shortenUrlForLabel(url: string): string {
  try {
    const u = new URL(url);
    const base = u.pathname.split("/").pop() || url;
    return base.length > 48 ? `${base.slice(0, 20)}…${base.slice(-12)}` : base;
  } catch {
    const t = url.replace(/^file:\/\//i, "");
    return t.length > 52 ? `…${t.slice(-40)}` : t;
  }
}

/**
 * 从聊天正文中切出 Markdown 链接与裸 URL（http(s) / file），用于左侧渲染可点击预览入口。
 */
export function segmentTextWithLinks(raw: string): ChatSegment[] {
  const out: ChatSegment[] = [];
  let last = 0;
  const re =
    /(?:\[([^\]]*)\]\((https?:[^)\s]+|file:[^)\s]+|data:image\/[^)\s]+)\))|(https?:\/\/[^\s<>"'()[\]]+|file:\/\/[^\s<>"'()[\]]+|data:image\/[^\s<>"'()[\]]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) {
      out.push({ type: "text", text: raw.slice(last, m.index) });
    }
    if (m[1] !== undefined && m[2]) {
      const url = m[2].trim();
      const label = (m[1] || shortenUrlForLabel(url)).trim() || shortenUrlForLabel(url);
      out.push({ type: "link", url, label });
    } else if (m[3]) {
      const url = m[3].trim();
      out.push({ type: "link", url, label: shortenUrlForLabel(url) });
    }
    last = m.index + m[0].length;
  }
  if (last < raw.length) {
    out.push({ type: "text", text: raw.slice(last) });
  }
  if (out.length === 0) {
    out.push({ type: "text", text: raw });
  }
  return out;
}
