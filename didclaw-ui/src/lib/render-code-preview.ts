import DOMPurify from "dompurify";
import hljs from "highlight.js";
import "highlight.js/styles/github.min.css";

function escapeHtml(src: string): string {
  return src
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 将源码高亮为安全 HTML，供预览区 v-html */
export function renderCodePreviewHtml(
  source: string,
  language: string | undefined,
): string {
  const lang = language?.trim().toLowerCase();
  let inner: string;
  if (lang && hljs.getLanguage(lang)) {
    try {
      inner = hljs.highlight(source, { language: lang, ignoreIllegals: true }).value;
    } catch {
      inner = hljs.highlightAuto(source).value;
    }
  } else {
    try {
      inner = hljs.highlightAuto(source).value;
    } catch {
      inner = escapeHtml(source);
    }
  }
  const dirty = `<pre class="code-preview-pre"><code class="hljs">${inner}</code></pre>`;
  return DOMPurify.sanitize(dirty, { USE_PROFILES: { html: true } });
}
