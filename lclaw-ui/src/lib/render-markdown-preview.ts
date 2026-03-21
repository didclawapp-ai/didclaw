import DOMPurify from "dompurify";
import hljs from "highlight.js";
import "highlight.js/styles/github.min.css";
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  highlight(src, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre><code class="hljs">${hljs.highlight(src, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
      } catch {
        /* fall through */
      }
    }
    return `<pre><code class="hljs">${md.utils.escapeHtml(src)}</code></pre>`;
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
