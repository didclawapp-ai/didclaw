export type EmbeddedDataImage = {
  /** 规范化的 data URL（无多余空白） */
  dataUrl: string;
  mimeType: string;
  /** 纯 base64 段，已去掉空白 */
  base64Payload: string;
};

/** 匹配消息中的 `data:image/...;base64,...`（允许 base64 段中含换行） */
const DATA_IMAGE_RE =
  /data:(image\/[a-z0-9.+-]+);base64,([\s\r\nA-Za-z0-9+/=]+)/gi;

const MIN_BASE64_LEN = 24;

/**
 * 从助手/用户正文中取出第一段内嵌的 Data URL 图像。
 * 用于左侧列表摘要、点击行时在右侧预览。
 */
export function findFirstEmbeddedDataImage(text: string): EmbeddedDataImage | null {
  if (!text || !text.includes("data:image")) {
    return null;
  }
  DATA_IMAGE_RE.lastIndex = 0;
  const m = DATA_IMAGE_RE.exec(text);
  if (!m) {
    return null;
  }
  const mimeType = m[1].toLowerCase();
  const raw = m[2].replace(/\s+/g, "");
  if (raw.length < MIN_BASE64_LEN) {
    return null;
  }
  return {
    dataUrl: `data:${mimeType};base64,${raw}`,
    mimeType,
    base64Payload: raw,
  };
}

export function defaultFileNameForImageMime(mime: string): string {
  const map: Record<string, string> = {
    "image/png": "image.png",
    "image/jpeg": "image.jpg",
    "image/jpg": "image.jpg",
    "image/gif": "image.gif",
    "image/webp": "image.webp",
    "image/bmp": "image.bmp",
    "image/svg+xml": "image.svg",
  };
  return map[mime] ?? "image.png";
}
