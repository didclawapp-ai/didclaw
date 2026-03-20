import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

const SAFE_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "code",
  "pre",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "a",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "hr",
];

/**
 * Markdown → HTML，经 DOMPurify 白名单消毒（禁用原始 HTML 注入）。
 */
export function renderMarkdownToSafeHtml(source: string): string {
  const raw = md.render(source);
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: SAFE_TAGS,
    ALLOWED_ATTR: ["href", "target", "rel", "class"],
  });
}
