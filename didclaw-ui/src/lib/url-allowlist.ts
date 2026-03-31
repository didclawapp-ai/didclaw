const BLOCKED_SCHEMES = /^(javascript|data|vbscript):/i;

function parseAllowlistRules(): string[] {
  const raw = import.meta.env.VITE_LINK_ALLOWLIST?.trim();
  if (!raw) {
    return [];
  }
  return raw.split(",").map((s: string) => s.trim()).filter(Boolean);
}

/**
 * 外链白名单（Markdown 中 `<a href>`）。
 * - 未配置 `VITE_LINK_ALLOWLIST` 时：仅允许相对路径、`#`、`mailto:`、`tel:`、以及指向 localhost / 127.0.0.1 / ::1 的 http(s)。
 * - 配置为 `*` 时：允许任意 http(s)（仍禁止 javascript/data 等）。
 * - 否则为逗号分隔规则：`github.com`、\`*.example.com\`、或以 `https://` 开头的前缀 URL。
 */
export function isLinkHrefAllowed(href: string): boolean {
  const h = href.trim();
  if (!h) {
    return false;
  }
  if (BLOCKED_SCHEMES.test(h)) {
    return false;
  }

  if (h.startsWith("#")) {
    return true;
  }

  if (!/^[a-z][a-z0-9+.-]*:/i.test(h)) {
    if (h.startsWith("//")) {
      return false;
    }
    return true;
  }

  const lower = h.toLowerCase();
  if (lower.startsWith("mailto:") || lower.startsWith("tel:")) {
    return true;
  }

  let u: URL;
  try {
    u = new URL(h);
  } catch {
    return false;
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return false;
  }

  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") {
    return true;
  }

  const rules = parseAllowlistRules();
  if (rules.includes("*")) {
    return true;
  }
  if (rules.length === 0) {
    return false;
  }

  for (const rule of rules) {
    if (rule === "*") {
      return true;
    }
    if (rule.startsWith("http://") || rule.startsWith("https://")) {
      const base = rule.replace(/\/$/, "");
      if (h.startsWith(base)) {
        return true;
      }
      try {
        const ru = new URL(rule);
        if (u.origin === ru.origin) {
          return true;
        }
      } catch {
        /* ignore */
      }
    } else if (rule.startsWith("*.")) {
      const base = rule.slice(2).toLowerCase();
      if (base && (host === base || host.endsWith(`.${base}`))) {
        return true;
      }
    } else if (host === rule.toLowerCase()) {
      return true;
    }
  }

  return false;
}
