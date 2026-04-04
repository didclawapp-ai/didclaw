import { i18n } from "@/i18n";
import { findFirstEmbeddedDataImage } from "@/lib/extract-chat-embedded-image";
import { ASSISTANT_META_PREFIX, SYSTEM_NO_TEXT_PREFIX } from "@/lib/chat-line";

const MAX_LIST_CHARS = 900;

function truncateWithNote(s: string, max: number): string {
  if (s.length <= max) {
    return s;
  }
  return `${s.slice(0, max)}\n${i18n.global.t("chatMsgFmt.truncated", { len: s.length })}`;
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
  if (findFirstEmbeddedDataImage(t)) {
    return i18n.global.t("chatMsgFmt.imgPreview", { len: t.length });
  }
  if (t.length < 800 && !t.startsWith("{")) {
    return t;
  }
  if (t.startsWith("{")) {
    try {
      const j = JSON.parse(t) as Record<string, unknown>;
      if (Array.isArray(j.models) && j.models.length > 0) {
        return i18n.global.t("chatMsgFmt.jsonModelList", { n: j.models.length, len: t.length });
      }
      if (typeof j.api === "string" && Array.isArray(j.models)) {
        return i18n.global.t("chatMsgFmt.jsonApiModels", { api: j.api, n: (j.models as unknown[]).length, len: t.length });
      }
      if (j.meta && j.wizard && isOpenClawMergedConfigJson(j)) {
        return i18n.global.t("chatMsgFmt.openclawConfig", { len: t.length });
      }
      if (j.wizard && j.auth && j.models && typeof j.models === "object") {
        return i18n.global.t("chatMsgFmt.openclawSnapshot", { len: t.length });
      }
    } catch {
      /* not valid JSON, fall through to truncation */
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
    if (trim.startsWith(ASSISTANT_META_PREFIX)) {
      return true;
    }
    if (trim.startsWith(SYSTEM_NO_TEXT_PREFIX)) {
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

/** OpenClaw 注入的「新会话 /new」启动说明，常为 user 角色 */
export function isOpenClawSessionBootstrapInjection(t: string): boolean {
  return /A new session was started via \/new or \/reset/i.test(t);
}

/** 单行「Current time: … UTC」类运行时注入 */
function isOpenClawCurrentTimeOnlyLine(t: string): boolean {
  const lines = t
    .trim()
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length !== 1) {
    return false;
  }
  const line = lines[0] ?? "";
  return /^Current time:\s+/i.test(line) && /\d{4}-\d{2}-\d{2}/.test(line) && /\bUTC\b/i.test(line);
}

/** 工具调用失败 JSON，如 read → ENOENT */
function isOpenClawToolErrorJson(t: string): boolean {
  const s = t.trim();
  if (!s.startsWith("{")) {
    return false;
  }
  try {
    const j = JSON.parse(s) as Record<string, unknown>;
    if (j.status !== "error" || typeof j.tool !== "string") {
      return false;
    }
    return typeof j.error === "string";
  } catch {
    return false;
  }
}

/** 注入的 SKILL.md（YAML frontmatter + Markdown） */
function isOpenClawSkillFileDump(t: string): boolean {
  const s = t.trim();
  if (!s.startsWith("---")) {
    return false;
  }
  if (!/\nname:\s*\S+/m.test(s) || !/\ndescription:\s/m.test(s)) {
    return false;
  }
  return (
    s.length > 180 ||
    /^---[\s\S]{0,800}---\s*\n#\s+/m.test(s) ||
    /\nmetadata:\s*\{[\s\S]*"openclaw"/m.test(s)
  );
}

/** PowerShell 错误记录（工具 stderr 常作为 system 注入聊天；中文环境乱码时仍可能保留英文关键字） */
function looksLikePowerShellErrorRecord(t: string): boolean {
  if (/\bFullyQualifiedErrorId\s*:/i.test(t) && /\bCategoryInfo\b/i.test(t)) {
    return true;
  }
  if (
    /SetValueInvocationException|ExceptionWhenSetting|ParentContainsErrorRecordException/i.test(t) &&
    (/\bFullyQualifiedErrorId\b/i.test(t) || /\+\s+~{3,}/m.test(t) || /\+\s+\$/m.test(t))
  ) {
    return true;
  }
  return false;
}

/**
 * 终端表格/列表在 ESC 丢失后残留的 `[32;1mName[0m` 一类片段，或纯文本 Name/---- 表头。
 * 与 `Get-ChildItem | Format-Table`、简单目录清单一致。
 */
function looksLikeStrippedAnsiTableOrDirListing(t: string): boolean {
  if (/\[\d+(?:;\d+)*mName\[0m/i.test(t) && /\[\d+(?:;\d+)*m----\[0m/i.test(t)) {
    return true;
  }
  if (/\[\d+(?:;\d+)*mVersion\s*:\s*\[0m/i.test(t) && t.length < 200) {
    return true;
  }
  const lines = t
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length >= 3 && lines.length <= 28 && /^Name$/i.test(lines[0] ?? "") && /^-+$/.test(lines[1] ?? "")) {
    const rest = lines.slice(2);
    const pathish = (l: string) =>
      l.length <= 120 && /^[A-Za-z0-9_.-]+$/.test(l) && !/[。！？]{2,}/.test(l);
    const ok = rest.filter(pathish).length;
    if (ok >= Math.max(1, Math.ceil(rest.length * 0.65))) {
      return true;
    }
  }
  const ansiish = /\[\d+(?:;\d+)*m/.test(t);
  if (ansiish && t.length < 3500 && (/\b(Scripts|Lib)\b/.test(t) || /\breadme\.rst\b/i.test(t))) {
    if (lines.length <= 24) {
      return true;
    }
  }
  return false;
}

/** wttr.in / curl 等着色终端天气块（含剥离 ESC 后残留的 `[38;5;226m`） */
function isAnsiWeatherOrToolTerminalDump(t: string): boolean {
  if (t.length < 80) {
    return false;
  }
  const ansiish = t.includes("\u001b[") || /\[\d+;\d+m/.test(t);
  const boxTable = /┌[─┬┴┼╴╵╶╷]+┐/.test(t) || /├[─┬┴┼]+┤/.test(t);
  const weatherish =
    /天气预报[:：]/.test(t) ||
    /°C|km\/h|局部多云|多云转晴|Partly cloudy|wttr\.in|Open-Meteo/i.test(t);
  if (ansiish && (weatherish || boxTable)) {
    return true;
  }
  if (boxTable && weatherish && t.length > 200) {
    return true;
  }
  return false;
}

/**
 * 与「显示诊断/配置」无关：对话列表里仍应折叠的噪音。
 * 完整工具链输出可看右下事件区或浏览器 WS 帧。
 */
export function shouldAlwaysHideFromChatList(
  role: "user" | "assistant" | "system",
  text: string,
): boolean {
  const trim = text.trim();
  if (looksLikePowerShellErrorRecord(text)) {
    return true;
  }
  if (role === "user" || role === "system") {
    if (isOpenClawSessionBootstrapInjection(text)) {
      return true;
    }
    if (role === "user" && isOpenClawCurrentTimeOnlyLine(text)) {
      return true;
    }
  }
  if (role === "assistant" && trim.startsWith(ASSISTANT_META_PREFIX)) {
    return true;
  }
  if (role === "system") {
    if (looksLikeStrippedAnsiTableOrDirListing(text)) {
      return true;
    }
    if (/^Version\s*:\s*\d+(\.\d+)*\s*$/i.test(trim) && trim.length < 48) {
      return true;
    }
    if (isOpenClawToolErrorJson(trim)) {
      return true;
    }
    if (isOpenClawSkillFileDump(trim)) {
      return true;
    }
    if (isAnsiWeatherOrToolTerminalDump(text)) {
      return true;
    }
    if (/^\(no output\)$/i.test(trim) || /^no output$/i.test(trim)) {
      return true;
    }
    if (!trim.includes("\n") && /^v\d+\.\d+(\.\d+)?([a-z0-9.-]*)?$/i.test(trim)) {
      return true;
    }
    if (
      trim.includes("workspace@") &&
      (trim.includes("`--") || /├──|│--|└--/.test(trim) || trim.includes("|--"))
    ) {
      return true;
    }
    if (/^Successfully wrote \d+ bytes to\b/im.test(trim)) {
      return true;
    }
  }
  return false;
}

