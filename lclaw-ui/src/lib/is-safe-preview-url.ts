const BLOCKED = /^(javascript|data|vbscript):/i;

/** 允许在预览中加载的 URL 协议（不含外链白名单：预览由用户显式点击触发） */
export function isSafePreviewUrl(href: string): boolean {
  const h = href.trim();
  if (!h || BLOCKED.test(h)) {
    return false;
  }
  try {
    const u = new URL(h);
    return u.protocol === "http:" || u.protocol === "https:" || u.protocol === "file:";
  } catch {
    return false;
  }
}
