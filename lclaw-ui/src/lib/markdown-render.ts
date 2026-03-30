import DOMPurify from "dompurify";
import { i18n } from "@/i18n";
import { echartsJsonSchema } from "@/lib/echarts-option-schema";
import { isLinkHrefAllowed } from "@/lib/url-allowlist";
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

function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]!);
  }
  return btoa(bin);
}

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

  if (hlLang === "echarts-json") {
    const raw = token.content.trim();
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const line = i18n.global.t("markdownRender.echartsJsonInvalid", { msg });
      return `<pre class="didclaw-chart-error">${md.utils.escapeHtml(line)}</pre>\n`;
    }
    const zr = echartsJsonSchema.safeParse(parsedJson);
    if (!zr.success) {
      const detail = zr.error.issues.map((i) => i.message).join("; ");
      const line = i18n.global.t("markdownRender.echartsSchemaFailed", { detail });
      return `<pre class="didclaw-chart-error">${md.utils.escapeHtml(line)}</pre>\n`;
    }
    const payload = utf8ToBase64(JSON.stringify(zr.data));
    if (payload.length > 180_000) {
      const line = i18n.global.t("markdownRender.echartsPayloadTooLarge");
      return `<pre class="didclaw-chart-error">${md.utils.escapeHtml(line)}</pre>\n`;
    }
    const aria = md.utils.escapeHtml(i18n.global.t("markdownRender.chartAriaLabel"));
    return `<div class="didclaw-chart" data-didclaw-chart="${payload}" role="img" aria-label="${aria}"></div>\n`;
  }

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
  "div",
];

const g = globalThis as { __didclawDomPurifyHooks?: boolean };
if (!g.__didclawDomPurifyHooks) {
  g.__didclawDomPurifyHooks = true;
  DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
    if (data.attrName === "href" && String(node.nodeName).toLowerCase() === "a") {
      if (!isLinkHrefAllowed(String(data.attrValue ?? ""))) {
        data.keepAttr = false;
      }
    }
    if (data.attrName === "data-didclaw-chart" && String(node.nodeName).toLowerCase() === "div") {
      const v = String(data.attrValue ?? "");
      if (!/^[A-Za-z0-9+/=]+$/.test(v) || v.length > 200_000) {
        data.keepAttr = false;
      }
    }
  });
  // Mutate DOM after sanitize to avoid a second innerHTML parse (mXSS risk)
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (String(node.nodeName).toLowerCase() === "a") {
      const href = node.getAttribute("href");
      if (href && /^https?:\/\//i.test(href)) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    }
  });
}

/**
 * Markdown → HTML, sanitized with a DOMPurify tag allowlist (raw HTML from source disabled).
 * External links get target/_blank/rel via afterSanitizeAttributes during sanitize (no second parse).
 */
export function renderMarkdownToSafeHtml(source: string): string {
  const raw = md.render(source);
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: SAFE_TAGS,
    ALLOWED_ATTR: ["href", "target", "rel", "class", "data-didclaw-chart", "role", "aria-label"],
  });
}
