/**
 * ClawHub Registry 公开 HTTP 接口（搜索 / 列表 / 详情 / 下载 zip）。
 * 统一目录搜索：`GET /api/v1/packages/search`（技能 + code/bundle 插件），见仓库 `docs/http-api.md`。
 * 技能专用：`GET /api/v1/search`、`/api/v1/skills` 等仍保留。
 */

import { didclawKvReadSync, didclawKvWriteSync } from "@/lib/didclaw-kv";
import { invoke, isTauri } from "@tauri-apps/api/core";

const DEFAULT_REGISTRY = "https://clawhub.ai";
const REQUEST_TIMEOUT_MS = 15_000;
const CLAWHUB_TOKEN_KEY = "didclaw.clawhubToken";
const CLAWHUB_REGISTRY_KEY = "didclaw.clawhubRegistry";
/** 429 时最多额外重试次数（含首次共 maxRetries+1 次）；下载单次等待可达数十秒 */
const RATE_LIMIT_MAX_RETRIES_JSON = 3;
const RATE_LIMIT_MAX_RETRIES_BINARY = 6;
const RATE_LIMIT_WAIT_CAP_SEC = 120;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 解析 Retry-After（秒或 HTTP 日期），与常见 CDN 行为兼容 */
function parseRetryAfterSeconds(res: Response, nowMs = Date.now()): number | null {
  const raw = res.headers.get("retry-after")?.trim();
  if (!raw) {
    return null;
  }
  const asNum = Number(raw);
  if (Number.isFinite(asNum) && asNum >= 0) {
    if (asNum > 86_400 * 365) {
      const nowSec = Math.floor(nowMs / 1000);
      return Math.min(RATE_LIMIT_WAIT_CAP_SEC, Math.max(1, Math.ceil(asNum - nowSec)));
    }
    return Math.min(RATE_LIMIT_WAIT_CAP_SEC, Math.max(1, Math.ceil(asNum)));
  }
  const asDate = Date.parse(raw);
  if (Number.isFinite(asDate)) {
    return Math.min(
      RATE_LIMIT_WAIT_CAP_SEC,
      Math.max(1, Math.ceil((asDate - nowMs) / 1000)),
    );
  }
  return null;
}

/**
 * 从 Ratelimit / X-RateLimit-Reset 推断等待秒数。
 * ClawHub 会同时给 `Ratelimit-Reset: 32`（距重置秒数）与 `X-Ratelimit-Reset: 纪元秒`。
 * 注意：跨域时部分响应头可能仍读不到，需配合 {@link compute429WaitSeconds} 的保底。
 */
function parseRateLimitResetSeconds(res: Response, nowMs = Date.now()): number | null {
  const tryParse = (raw: string | null): number | null => {
    const v = raw?.trim();
    if (!v) {
      return null;
    }
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) {
      return null;
    }
    if (n > 1_000_000_000) {
      const nowSec = Math.floor(nowMs / 1000);
      return Math.min(RATE_LIMIT_WAIT_CAP_SEC, Math.max(1, Math.ceil(n - nowSec)));
    }
    return Math.min(RATE_LIMIT_WAIT_CAP_SEC, Math.max(1, Math.ceil(n)));
  };

  return (
    tryParse(res.headers.get("ratelimit-reset")) ??
    tryParse(res.headers.get("x-ratelimit-reset")) ??
    null
  );
}

/**
 * 综合 Retry-After 与 Ratelimit-Reset；在浏览器 CORS 下常读不到 Retry-After，故对 download 设较高保底。
 */
function compute429WaitSeconds(res: Response, kind: "json" | "binary"): number {
  const fromRa = parseRetryAfterSeconds(res);
  const fromRl = parseRateLimitResetSeconds(res);
  let sec = Math.max(fromRa ?? 0, fromRl ?? 0);
  if (sec < 1) {
    sec = kind === "binary" ? 32 : 8;
  }
  if (kind === "binary" && sec < 20) {
    /* 头信息缺失时默认 3～8s 会导致连续 429；curl 实测 Reset 多为 30s 量级 */
    sec = 32;
  }
  return Math.min(RATE_LIMIT_WAIT_CAP_SEC, sec);
}

export class ClawhubHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly bodySnippet?: string,
  ) {
    super(message);
    this.name = "ClawhubHttpError";
  }
}

/** 与 CLI `explore --sort` 一致；`newest` 对应服务端默认排序，请求里不传 `sort` */
export type ClawhubListSort =
  | "newest"
  | "downloads"
  | "rating"
  | "installs"
  | "installsAllTime"
  | "trending";

export type ClawhubSearchHit = {
  score: number;
  slug: string;
  displayName?: string | null;
  summary?: string | null;
  version?: string | null;
  updatedAt?: number | null;
};

/** {@link clawhubPackagesSearch} 结果行：含 ClawHub 统一目录中的 family */
export type ClawhubPackageFamily = "skill" | "code-plugin" | "bundle-plugin";

export type ClawhubCatalogHit = ClawhubSearchHit & {
  family: ClawhubPackageFamily;
};

export type ClawhubSearchResponse = {
  results: ClawhubSearchHit[];
};

/** `GET /api/v1/packages/search` 单行（与线上一致） */
export type ClawhubPackageSearchRow = {
  score: number;
  package: {
    name: string;
    displayName?: string | null;
    summary?: string | null;
    family: ClawhubPackageFamily | string;
    latestVersion?: string | null;
    updatedAt?: number | null;
    channel?: string | null;
    executesCode?: boolean;
    isOfficial?: boolean;
    ownerHandle?: string | null;
  };
};

export type ClawhubPackagesSearchResponse = {
  results: ClawhubPackageSearchRow[];
};

/** `GET /api/v1/packages/{name}` 详情（字段随上游扩展，按需取用） */
export type ClawhubPackageDetail = {
  package?: {
    name: string;
    displayName?: string | null;
    summary?: string | null;
    family?: string | null;
    latestVersion?: string | null;
    channel?: string | null;
    executesCode?: boolean;
    isOfficial?: boolean;
    ownerHandle?: string | null;
  } | null;
};

export type ClawhubListItem = {
  slug: string;
  displayName?: string | null;
  summary?: string | null;
  updatedAt: number;
  latestVersion?: { version: string } | null;
};

export type ClawhubListResponse = {
  items: ClawhubListItem[];
  nextCursor?: string | null;
};

export type ClawhubSkillDetail = {
  skill: {
    slug: string;
    displayName?: string | null;
    summary?: string | null;
    tags?: Record<string, string>;
    stats?: Record<string, number>;
    createdAt?: number;
    updatedAt?: number;
  };
  latestVersion?: {
    version: string;
    createdAt?: number;
    changelog?: string | null;
    license?: string | null;
  } | null;
  metadata?: { os?: string[]; systems?: unknown } | null;
  owner?: {
    handle?: string;
    displayName?: string | null;
    image?: string | null;
  } | null;
  moderation?: {
    isMalwareBlocked?: boolean;
    isSuspicious?: boolean;
  } | null;
};

function registryBaseUrl(registry?: string): string {
  const raw = (registry ?? import.meta.env.VITE_CLAWHUB_REGISTRY ?? DEFAULT_REGISTRY).trim();
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function apiUrl(registry: string | undefined, path: string, search?: URLSearchParams): string {
  const base = registryBaseUrl(registry);
  const u = new URL(path.startsWith("/") ? path.slice(1) : path, `${base}/`);
  if (search) {
    search.forEach((v, k) => u.searchParams.set(k, v));
  }
  return u.toString();
}

function listSortToApiParam(sort: ClawhubListSort | undefined): string | undefined {
  if (!sort || sort === "newest") {
    return undefined;
  }
  const map: Record<Exclude<ClawhubListSort, "newest">, string> = {
    downloads: "downloads",
    rating: "stars",
    installs: "installsCurrent",
    installsAllTime: "installsAllTime",
    trending: "trending",
  };
  return map[sort as Exclude<ClawhubListSort, "newest">];
}

function clampLimit(limit: number, fallback = 25): number {
  if (!Number.isFinite(limit)) {
    return fallback;
  }
  return Math.min(Math.max(1, Math.floor(limit)), 200);
}

function assertSafeSlug(slug: string): string {
  const s = slug.trim();
  if (!s || s.includes("/") || s.includes("\\") || s.includes("..")) {
    throw new Error(`无效的 skill slug: ${slug}`);
  }
  return s;
}

/** 统一目录包名（含 `@scope/pkg`），仅禁止路径穿越 */
function assertSafePackageName(name: string): string {
  const s = name.trim();
  if (!s || s.includes("..")) {
    throw new Error(`无效的包名: ${name}`);
  }
  return s;
}

function clampPackagesSearchLimit(limit: number, fallback = 30): number {
  if (!Number.isFinite(limit)) {
    return fallback;
  }
  return Math.min(Math.max(1, Math.floor(limit)), 100);
}

function normalizePackageFamily(f: string | undefined): ClawhubPackageFamily {
  if (f === "code-plugin" || f === "bundle-plugin" || f === "skill") {
    return f;
  }
  return "skill";
}

function shouldUseDesktopProxy(): boolean {
  return isTauri();
}

function base64ToArrayBuffer(base64Data: string): ArrayBuffer {
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function mapPackageSearchRow(row: ClawhubPackageSearchRow): ClawhubCatalogHit {
  const p = row.package;
  const family = normalizePackageFamily(p.family);
  return {
    score: row.score,
    slug: p.name,
    displayName: p.displayName,
    summary: p.summary,
    version: p.latestVersion ?? null,
    updatedAt: p.updatedAt ?? null,
    family,
  };
}

async function fetchJson<T>(
  url: string,
  init: RequestInit,
  token?: string,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (token?.trim()) {
    headers.set("Authorization", `Bearer ${token.trim()}`);
  }

  for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES_JSON; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(
      () => controller.abort(new Error(`请求超时（${REQUEST_TIMEOUT_MS / 1000}s）`)),
      REQUEST_TIMEOUT_MS,
    );
    try {
      const res = await fetch(url, {
        ...init,
        headers,
        signal: controller.signal,
      });
      if (res.status === 429 && attempt < RATE_LIMIT_MAX_RETRIES_JSON) {
        const waitSec = compute429WaitSeconds(res, "json");
        await res.text().catch(() => "");
        await sleepMs(waitSec * 1000 + Math.floor(Math.random() * 400));
        continue;
      }
      const text = await res.text();
      if (!res.ok) {
        const snippet = text.length > 280 ? `${text.slice(0, 280)}…` : text;
        throw new ClawhubHttpError(`ClawHub HTTP ${res.status}`, res.status, snippet || undefined);
      }
      return JSON.parse(text || "null") as T;
    } finally {
      clearTimeout(t);
    }
  }
  throw new ClawhubHttpError("ClawHub 请求失败", 0);
}

async function fetchBinary(url: string, token?: string): Promise<ArrayBuffer> {
  const headers = new Headers();
  if (token?.trim()) {
    headers.set("Authorization", `Bearer ${token.trim()}`);
  }
  for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES_BINARY; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(
      () => controller.abort(new Error(`请求超时（${REQUEST_TIMEOUT_MS / 1000}s）`)),
      REQUEST_TIMEOUT_MS,
    );
    try {
      const res = await fetch(url, { method: "GET", headers, signal: controller.signal });
      if (res.status === 429 && attempt < RATE_LIMIT_MAX_RETRIES_BINARY) {
        const waitSec = compute429WaitSeconds(res, "binary");
        await res.text().catch(() => "");
        await sleepMs(waitSec * 1000 + Math.floor(Math.random() * 400));
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const snippet = text.length > 280 ? `${text.slice(0, 280)}…` : text;
        throw new ClawhubHttpError(`ClawHub HTTP ${res.status}`, res.status, snippet || undefined);
      }
      return await res.arrayBuffer();
    } finally {
      clearTimeout(t);
    }
  }
  throw new ClawhubHttpError("ClawHub 下载失败", 0);
}

export type ClawhubClientOptions = {
  /** Registry 根 URL，默认 `VITE_CLAWHUB_REGISTRY` 或 https://clawhub.ai */
  registry?: string;
  /** 可选；为未来的用户级登录态预留，桌面正式版默认不内置 token */
  token?: string;
};

export function getStoredClawhubClientOptions(): ClawhubClientOptions {
  try {
    const token = didclawKvReadSync(CLAWHUB_TOKEN_KEY)?.trim() || undefined;
    const registry = didclawKvReadSync(CLAWHUB_REGISTRY_KEY)?.trim() || undefined;
    return {
      token,
      registry,
    };
  } catch {
    return {};
  }
}

export function setStoredClawhubClientOptions(opts: ClawhubClientOptions): void {
  try {
    didclawKvWriteSync(CLAWHUB_TOKEN_KEY, opts.token?.trim() || null);
    didclawKvWriteSync(CLAWHUB_REGISTRY_KEY, opts.registry?.trim() || null);
  } catch {
    /* ignore */
  }
}

/**
 * 统一目录搜索：技能 + code-plugin + bundle-plugin。
 * `GET /api/v1/packages/search?q=...&limit=...`（limit 1–100）
 */
export async function clawhubPackagesSearch(
  query: string,
  opts: ClawhubClientOptions & {
    limit?: number;
    family?: ClawhubPackageFamily;
    channel?: "official" | "community" | "private";
  } = {},
): Promise<{ results: ClawhubCatalogHit[] }> {
  const q = query.trim();
  if (!q) {
    return { results: [] };
  }
  const stored = getStoredClawhubClientOptions();
  const registry = opts.registry?.trim() || stored.registry;
  const token = opts.token?.trim() || stored.token;
  if (shouldUseDesktopProxy()) {
    const raw = await invoke<ClawhubPackagesSearchResponse>("clawhub_packages_search", {
      query: q,
      limit: clampPackagesSearchLimit(opts.limit ?? 30),
      family: opts.family ?? null,
      channel: opts.channel ?? null,
      clawhubToken: token ?? null,
      clawhubRegistry: registry ?? null,
    });
    const rows = raw.results ?? [];
    return { results: rows.map(mapPackageSearchRow) };
  }
  const params = new URLSearchParams();
  params.set("q", q);
  params.set("limit", String(clampPackagesSearchLimit(opts.limit ?? 30)));
  if (opts.family) {
    params.set("family", opts.family);
  }
  if (opts.channel) {
    params.set("channel", opts.channel);
  }
  const url = apiUrl(registry, "/api/v1/packages/search", params);
  const raw = await fetchJson<ClawhubPackagesSearchResponse>(url, { method: "GET" }, token);
  const rows = raw.results ?? [];
  return { results: rows.map(mapPackageSearchRow) };
}

/**
 * 包详情（插件或统一目录下的技能条目）。
 * `GET /api/v1/packages/{name}`（name 需 URL 编码，含 `@scope/name`）
 */
export async function clawhubPackageDetail(
  name: string,
  opts: ClawhubClientOptions = {},
): Promise<ClawhubPackageDetail> {
  const n = assertSafePackageName(name);
  const stored = getStoredClawhubClientOptions();
  const registry = opts.registry?.trim() || stored.registry;
  const token = opts.token?.trim() || stored.token;
  if (shouldUseDesktopProxy()) {
    return invoke<ClawhubPackageDetail>("clawhub_package_detail", {
      name: n,
      clawhubToken: token ?? null,
      clawhubRegistry: registry ?? null,
    });
  }
  const url = apiUrl(registry, `/api/v1/packages/${encodeURIComponent(n)}`);
  return fetchJson<ClawhubPackageDetail>(url, { method: "GET" }, token);
}

/**
 * 向量/关键词搜索技能（仅 skills，不含插件）。
 * `GET /api/v1/search?q=...&limit=...`
 */
export async function clawhubSearch(
  query: string,
  opts: ClawhubClientOptions & { limit?: number } = {},
): Promise<ClawhubSearchResponse> {
  const q = query.trim();
  if (!q) {
    return { results: [] };
  }
  const params = new URLSearchParams();
  params.set("q", q);
  if (opts.limit != null) {
    params.set("limit", String(clampLimit(opts.limit, 25)));
  }
  const stored = getStoredClawhubClientOptions();
  const registry = opts.registry?.trim() || stored.registry;
  const url = apiUrl(registry, "/api/v1/search", params);
  const token = opts.token?.trim() || stored.token;
  return fetchJson<ClawhubSearchResponse>(url, { method: "GET" }, token);
}

/**
 * 浏览列表（对应 CLI `clawhub explore`）。
 * `GET /api/v1/skills?limit=...`；非 `newest` 时追加 `sort=...`。
 * 注意：公网 registry 上该接口可能长期返回 `items: []`，搜索 `/api/v1/search` 仍有数据。
 */
export async function clawhubListSkills(
  opts: ClawhubClientOptions & { limit?: number; sort?: ClawhubListSort } = {},
): Promise<ClawhubListResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(clampLimit(opts.limit ?? 25)));
  const apiSort = listSortToApiParam(opts.sort);
  if (apiSort) {
    params.set("sort", apiSort);
  }
  const stored = getStoredClawhubClientOptions();
  const registry = opts.registry?.trim() || stored.registry;
  const url = apiUrl(registry, "/api/v1/skills", params);
  const token = opts.token?.trim() || stored.token;
  return fetchJson<ClawhubListResponse>(url, { method: "GET" }, token);
}

/**
 * 技能详情（含最新版本号，供下载前解析）。
 * `GET /api/v1/skills/{slug}`
 */
export async function clawhubSkillDetail(
  slug: string,
  opts: ClawhubClientOptions = {},
): Promise<ClawhubSkillDetail> {
  const s = assertSafeSlug(slug);
  const stored = getStoredClawhubClientOptions();
  const registry = opts.registry?.trim() || stored.registry;
  const token = opts.token?.trim() || stored.token;
  if (shouldUseDesktopProxy()) {
    return invoke<ClawhubSkillDetail>("clawhub_skill_detail", {
      slug: s,
      clawhubToken: token ?? null,
      clawhubRegistry: registry ?? null,
    });
  }
  const url = apiUrl(registry, `/api/v1/skills/${encodeURIComponent(s)}`);
  return fetchJson<ClawhubSkillDetail>(url, { method: "GET" }, token);
}

/**
 * 下载技能包 zip（与 CLI `downloadZip` 一致：GET + query）。
 * `GET /api/v1/download?slug=...&version=...`
 */
export async function clawhubDownloadSkillZip(
  slug: string,
  opts: ClawhubClientOptions & { version?: string } = {},
): Promise<ArrayBuffer> {
  const s = assertSafeSlug(slug);
  const params = new URLSearchParams();
  params.set("slug", s);
  if (opts.version?.trim()) {
    params.set("version", opts.version.trim());
  }
  const stored = getStoredClawhubClientOptions();
  const registry = opts.registry?.trim() || stored.registry;
  const token = opts.token?.trim() || stored.token;
  if (shouldUseDesktopProxy()) {
    const base64Data = await invoke<string>("clawhub_download_skill_zip", {
      slug: s,
      version: opts.version?.trim() || null,
      clawhubToken: token ?? null,
      clawhubRegistry: registry ?? null,
    });
    return base64ToArrayBuffer(base64Data);
  }
  const url = apiUrl(registry, "/api/v1/download", params);
  return fetchBinary(url, token);
}

export function clawhubDefaultRegistry(): string {
  return registryBaseUrl(undefined);
}
