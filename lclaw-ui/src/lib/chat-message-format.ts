const MAX_LIST_CHARS = 900;

function truncateWithNote(s: string, max: number): string {
  if (s.length <= max) {
    return s;
  }
  return `${s.slice(0, max)}\n…（共 ${s.length} 字符，已在左侧列表截断；点选本行可在右侧预览查看全文）`;
}

/**
 * 识别网关/Agent 常见的大块 JSON（如模型目录），在**左侧列表**用一行说明代替全文。
 */
export function buildListPreview(fullText: string): string {
  const t = fullText.trim();
  if (t.length === 0) {
    return "";
  }
  if (t.length < 800 && !t.startsWith("{")) {
    return t;
  }
  if (t.startsWith("{")) {
    try {
      const j = JSON.parse(t) as Record<string, unknown>;
      if (Array.isArray(j.models) && j.models.length > 0) {
        const n = j.models.length;
        return `[配置 JSON] 模型列表等共 ${n} 项（约 ${t.length} 字符）。点选本行在右侧可查看或搜索全文。`;
      }
      if (typeof j.api === "string" && Array.isArray(j.models)) {
        const n = j.models.length;
        return `[配置 JSON] api=${j.api}，含 ${n} 条 models（约 ${t.length} 字符）。右侧预览可看全文。`;
      }
    } catch {
      /* 非合法 JSON，走下方截断 */
    }
  }
  if (t.length > MAX_LIST_CHARS) {
    return truncateWithNote(t, MAX_LIST_CHARS);
  }
  return t;
}
