export type PreviewKind = "pdf" | "image" | "office" | "markdown" | "text" | "code" | "html" | "other";

/** 扩展名（小写）→ highlight.js 语言；未列出时预览端使用 highlightAuto */
const CODE_EXT_TO_HLJS: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  pyw: "python",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  cxx: "cpp",
  cc: "cpp",
  hpp: "cpp",
  hh: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  swift: "swift",
  scala: "scala",
  sc: "scala",
  sh: "bash",
  zsh: "bash",
  ps1: "powershell",
  psm1: "powershell",
  sql: "sql",
  vue: "xml",
  xml: "xml",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  json: "json",
  jsonc: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  gradle: "groovy",
  groovy: "groovy",
  lua: "lua",
  pl: "perl",
  r: "r",
  dart: "dart",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hrl: "erlang",
  clj: "clojure",
  cljs: "clojure",
  edn: "clojure",
  fs: "fsharp",
  fsx: "fsharp",
  hs: "haskell",
  nim: "nim",
  zig: "zig",
  vhdl: "vhdl",
  verilog: "verilog",
  v: "verilog",
  sv: "verilog",
  tcl: "tcl",
  diff: "diff",
  patch: "diff",
  cmake: "cmake",
  proto: "protobuf",
  prisma: "prisma",
  graphql: "graphql",
  gql: "graphql",
  properties: "properties",
  asm: "x86asm",
  s: "x86asm",
};

function pathnameFromUrl(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split(/[?#]/)[0] ?? url;
  }
}

export function fileExtensionFromUrl(url: string): string {
  const pathPart = pathnameFromUrl(url);
  const base = pathPart.split("/").pop() ?? "";
  const i = base.lastIndexOf(".");
  if (i <= 0 || i >= base.length - 1) {
    return "";
  }
  return base.slice(i + 1).toLowerCase();
}

function previewBasenameLower(url: string): string {
  const pathPart = pathnameFromUrl(url);
  return (pathPart.split("/").pop() ?? "").toLowerCase();
}

/** 根据链接推断 highlight.js 语言；无把握时返回 undefined（由预览使用自动检测） */
export function hljsLanguageFromUrl(url: string): string | undefined {
  const base = previewBasenameLower(url);
  if (base === "dockerfile" || base === "containerfile") {
    return "dockerfile";
  }
  const ext = fileExtensionFromUrl(url);
  return CODE_EXT_TO_HLJS[ext];
}

function isCodeFileUrl(url: string): boolean {
  const base = previewBasenameLower(url);
  if (base === "dockerfile" || base === "containerfile") {
    return true;
  }
  const ext = fileExtensionFromUrl(url);
  return Boolean(ext && CODE_EXT_TO_HLJS[ext]);
}

export function previewKindFromUrl(url: string): PreviewKind {
  const pathPart = pathnameFromUrl(url);
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
  if (/\.html?$/i.test(lower)) {
    return "html";
  }
  if (/\.(txt|text|log|csv)$/i.test(lower)) {
    return "text";
  }
  if (isCodeFileUrl(url)) {
    return "code";
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
