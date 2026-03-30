import { i18n } from "@/i18n";

/** Stored labels may use a legacy suffix if the UI locale changed */
const SESSION_ENDED_SUFFIX_FALLBACKS = ["（已结束）", " (closed)"] as const;

export function sessionEndedSuffix(): string {
  return i18n.global.t("sessionDisplay.endedSuffix");
}

function allEndedSuffixes(): string[] {
  const cur = sessionEndedSuffix();
  return [...new Set([cur, ...SESSION_ENDED_SUFFIX_FALLBACKS])].filter(Boolean);
}

/** Strip a trailing "session ended" marker from a stored label */
export function stripSessionEndedSuffix(label: string): string {
  const trimmed = label.trim();
  for (const suf of allEndedSuffixes()) {
    if (trimmed.endsWith(suf)) {
      return trimmed.slice(0, -suf.length).trim();
    }
  }
  return trimmed;
}

export function labelHasEndedSuffix(label: string): boolean {
  const s = label.trim();
  return allEndedSuffixes().some((suf) => s.endsWith(suf));
}

function dateLocaleForApp(): string {
  const v = (i18n.global.locale as { value: string }).value;
  return v === "en" ? "en-US" : "zh-CN";
}

export function sessionDisplayLabel(key: string, label?: string): string {
  const trimmedLabel = label?.trim() ?? "";
  const endedSuffix = labelHasEndedSuffix(trimmedLabel) ? sessionEndedSuffix() : "";
  const compactPeerId = (value: string): string =>
    value.length > 12 ? `${value.slice(0, 10)}…` : value;

  if (!key.includes(":")) {
    return i18n.global.t("sessionDisplay.newChat");
  }
  if (key === "agent:main:main") {
    return `agent:main${endedSuffix}`;
  }

  const whatsappDirect = key.match(/^agent:main:whatsapp:direct:(.+)$/);
  if (whatsappDirect) {
    return `WhatsApp ${whatsappDirect[1]}${endedSuffix}`;
  }

  const feishuDirect = key.match(/^agent:main:feishu:direct:(.+)$/);
  if (feishuDirect) {
    return `Feishu ${compactPeerId(feishuDirect[1])}${endedSuffix}`;
  }

  if (key.startsWith("agent:main:openclaw-weixin:")) {
    return `WeChat${endedSuffix}`;
  }

  return trimmedLabel || key;
}

export function formatSessionHistoryTime(ms?: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) {
    return i18n.global.t("sessionDisplay.noActiveTime");
  }
  return new Date(ms).toLocaleString(dateLocaleForApp(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
