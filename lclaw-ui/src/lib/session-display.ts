export function sessionDisplayLabel(key: string, label?: string): string {
  const trimmedLabel = label?.trim() ?? "";
  const endedSuffix = trimmedLabel.endsWith("（已结束）") ? "（已结束）" : "";
  const compactPeerId = (value: string): string =>
    value.length > 12 ? `${value.slice(0, 10)}…` : value;

  if (!key.includes(":")) {
    return "新对话";
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
    return "无活跃时间";
  }
  return new Date(ms).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
