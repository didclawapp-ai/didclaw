const MAX_LIST_CHARS = 900;

function truncateWithNote(s: string, max: number): string {
  if (s.length <= max) {
    return s;
  }
  return `${s.slice(0, max)}\n…（共 ${s.length} 字符，已在左侧列表截断；点选本行可在右侧预览查看全文）`;
}

function isOpenClawMergedConfigJson(j: Record<string, unknown>): boolean {
  const models = j.models;
  if (!models || typeof models !== "object" || Array.isArray(models)) {
    return false;
  }
  const m = models as Record<string, unknown>;
  return m.mode === "merge" && typeof m.providers === "object" && m.providers !== null;
}

/** ASCII 表格顶栏，如 +----------+---------+ */
function looksLikeAsciiTableDivider(t: string): boolean {
  return /\+-{3,}\+/.test(t);
}

/** 多行 .openclaw 路径清单（含 ANSI 着色） */
function looksLikeOpenClawPathDump(t: string): boolean {
  const lines = t.split("\n").filter((l) => l.includes(".openclaw"));
  if (lines.length >= 4) {
    return true;
  }
  return /\[?\d+;?\d*m.*FullName/i.test(t) && /\.openclaw[\\/]/i.test(t) && lines.length >= 2;
}

/** 短小的「命令退出」提示，任意 role 都可能出现 */
function isShortCommandExitLine(t: string): boolean {
  const s = t.trim();
  if (s.length > 420) {
    return false;
  }
  return /^\(?\s*command\s+exited\s+with\s+code/i.test(s) || /\(Command\s+exited\s+with\s+code/i.test(s);
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
      if (j.meta && j.wizard && isOpenClawMergedConfigJson(j)) {
        return `[openclaw.json 类配置] 含 wizard / auth / models.providers 等（约 ${t.length} 字符）。右侧预览可看全文。`;
      }
      if (j.wizard && j.auth && j.models && typeof j.models === "object") {
        return `[OpenClaw 配置快照]（约 ${t.length} 字符）。右侧预览可看全文。`;
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

/**
 * 默认隐藏：审计表、路径清单、巨型配置 JSON、无正文的工具型 assistant、自动注入的长 user 等。
 * 短 system（如 HELLO）保留。
 */
export function shouldHideDiagnosticChatLine(role: "user" | "assistant" | "system", text: string): boolean {
  const t = text;
  const trim = t.trim();

  if (isShortCommandExitLine(t)) {
    return true;
  }

  if (role === "system") {
    if (trim.length <= 280) {
      return false;
    }
    if (t.includes("openclaw security audit")) {
      return true;
    }
    if (t.includes("gateway.nodes.denyCommands")) {
      return true;
    }
    if (/control\s+ui\s+local-only/i.test(t) && /\bWARN\b/i.test(t)) {
      return true;
    }
    if (t.includes("Channels") && (looksLikeAsciiTableDivider(t) || /\|\s*Channel\b/i.test(t))) {
      return true;
    }
    if (looksLikeOpenClawPathDump(t)) {
      return true;
    }
    if (t.startsWith("{")) {
      try {
        const j = JSON.parse(t) as Record<string, unknown>;
        if (j.wizard && j.auth) {
          return true;
        }
        if (isOpenClawMergedConfigJson(j)) {
          return true;
        }
      } catch {
        /* ignore */
      }
    }
  }

  if (role === "assistant") {
    if (trim.startsWith("[助手·仅元数据]")) {
      return true;
    }
    if (trim.startsWith("[系统] 无文本正文")) {
      return true;
    }
    if (
      t.length > 320 &&
      (t.includes("Gateway 连接信息") ||
        t.includes("开发 Control UI 需要的关键配置") ||
        t.includes("**WebSocket URL:**") ||
        t.includes("WebSocket URL:")) &&
      (t.includes("VITE_GATEWAY_TOKEN") || t.includes("VITE_GATEWAY_URL") || /\*\*Token:\*\*/i.test(t))
    ) {
      return true;
    }
  }

  if (role === "user") {
    if (t.includes("Exec failed") && (t.includes("FAQ:") || t.includes("docs.openclaw"))) {
      return true;
    }
    if (t.length > 400 && /^System:\s+\[/m.test(t) && t.includes("Exec failed")) {
      return true;
    }
  }

  if (role !== "system" && looksLikeOpenClawPathDump(t) && t.length > 400) {
    return true;
  }

  return false;
}
