export type PreviewKind = "pdf" | "image" | "office" | "markdown" | "text" | "other";

export function previewKindFromUrl(url: string): PreviewKind {
  let pathPart = url;
  try {
    const u = new URL(url);
    pathPart = u.pathname;
  } catch {
    pathPart = url.split(/[?#]/)[0] ?? url;
  }
  const lower = pathPart.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(lower)) {
    return "image";
  }
  if (/\.pdf$/i.test(lower)) {
    return "pdf";
  }
  if (/\.(docx?|xlsx?|pptx?)$/i.test(lower)) {
    return "office";
  }
  if (/\.(md|markdown|mdown|mkd)$/i.test(lower)) {
    return "markdown";
  }
  if (/\.(txt|text|log|csv)$/i.test(lower)) {
    return "text";
  }
  return "other";
}

export function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Microsoft Office Online 嵌入（仅公网 HTTPS 资源可用） */
export function officeOnlineEmbedUrl(httpsFileUrl: string): string {
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(httpsFileUrl)}`;
}
