import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import MarkdownIt from "markdown-it";
import type { RenderRule } from "markdown-it/lib/renderer.mjs";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("vue", xml);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

md.set({
  highlight(str: string, lang: string, _attrs: string): string {
    const name = lang?.trim().toLowerCase() ?? "";
    if (name && hljs.getLanguage(name)) {
      try {
        return hljs.highlight(str, { language: name, ignoreIllegals: true }).value;
      } catch {
        /* fall through */
      }
    }
    try {
      return hljs.highlightAuto(str).value;
    } catch {
      return md.utils.escapeHtml(str);
    }
  },
});

const fenceRule: RenderRule = (tokens, idx, options) => {
  const token = tokens[idx];
  const info = token.info ? md.utils.unescapeAll(token.info).trim() : "";
  let langName = "";
  let langAttrs = "";
  if (info) {
    const arr = info.split(/(\s+)/g);
    langName = arr[0] ?? "";
    langAttrs = arr.slice(2).join("");
  }
  const hlLang = langName.trim().toLowerCase();
  const safeClassLang = langName.replace(/[^a-zA-Z0-9_-]/g, "");
  const highlighted =
    options.highlight?.(token.content, hlLang, langAttrs) || md.utils.escapeHtml(token.content);
  const cls = ["hljs", safeClassLang ? `language-${safeClassLang}` : ""].filter(Boolean).join(" ");
  return `<pre><code class="${cls}">${highlighted}</code></pre>\n`;
};
md.renderer.rules.fence = fenceRule;

const SAFE_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "span",
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
