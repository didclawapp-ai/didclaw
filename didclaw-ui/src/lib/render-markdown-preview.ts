import DOMPurify from "dompurify";
import hljs from "highlight.js";
import "highlight.js/styles/github.min.css";
import MarkdownIt from "markdown-it";

/** 与 markdown-it 默认 escape 对齐，避免 highlight 回调里引用 `md` 造成 TS 循环推断 */
function escapeHtml(src: string): string {
  return src
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  highlight(src, lang): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre><code class="hljs">${hljs.highlight(src, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
      } catch {
        /* fall through */
      }
    }
    return `<pre><code class="hljs">${escapeHtml(src)}</code></pre>`;
  },
});

let domPurifyLinkHooked = false;
if (typeof window !== "undefined" && !domPurifyLinkHooked) {
  domPurifyLinkHooked = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A" && node instanceof HTMLAnchorElement) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
}

/** Markdown → 安全 HTML（供预览区 v-html） */
export function renderMarkdownPreviewToHtml(src: string): string {
  const dirty = md.render(src);
  return DOMPurify.sanitize(dirty, { USE_PROFILES: { html: true } });
}
