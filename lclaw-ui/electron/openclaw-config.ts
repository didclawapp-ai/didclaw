import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const BACKUP_PREFIX = "openclaw.json.lclaw-backup-";
const BACKUP_SUFFIX = ".json";
const AGENT_MODELS_BACKUP_PREFIX = "models.json.lclaw-backup-";
const AGENT_AUTH_PROFILES_BACKUP_PREFIX = "auth-profiles.json.lclaw-backup-";

export function getOpenClawConfigPath(): string {
  return path.join(os.homedir(), ".openclaw", "openclaw.json");
}

function getOpenClawDir(): string {
  return path.join(os.homedir(), ".openclaw");
}

function newBackupBasename(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${BACKUP_PREFIX}${stamp}${BACKUP_SUFFIX}`;
}

function newAgentModelsBackupBasename(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${AGENT_MODELS_BACKUP_PREFIX}${stamp}${BACKUP_SUFFIX}`;
}

function newAgentAuthProfilesBackupBasename(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${AGENT_AUTH_PROFILES_BACKUP_PREFIX}${stamp}${BACKUP_SUFFIX}`;
}

/** 默认代理 id：与 OpenClaw agents.list 约定一致（带 default: true 的项，否则首项，否则 main） */
function extractDefaultAgentId(root: Record<string, unknown>): string {
  const agents = root.agents;
  if (!agents || typeof agents !== "object" || Array.isArray(agents)) {
    return "main";
  }
  const list = (agents as Record<string, unknown>).list;
  if (!Array.isArray(list) || list.length === 0) {
    return "main";
  }
  for (const item of list) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const o = item as Record<string, unknown>;
      if (o.default === true) {
        const id = o.id;
        if (typeof id === "string" && id.trim()) {
          return id.trim();
        }
      }
    }
  }
  const first = list[0];
  if (first && typeof first === "object" && !Array.isArray(first)) {
    const id = (first as Record<string, unknown>).id;
    if (typeof id === "string" && id.trim()) {
      return id.trim();
    }
  }
  return "main";
}

function getAgentModelsJsonPath(agentId: string): string {
  return path.join(getOpenClawDir(), "agents", agentId, "agent", "models.json");
}

function getAgentAuthProfilesJsonPath(agentId: string): string {
  return path.join(getOpenClawDir(), "agents", agentId, "agent", "auth-profiles.json");
}

/** OpenClaw 将此类 apiKey 视为非「真实密钥」，不应写入 auth-profiles */
const OPENCLAW_NON_SECRET_API_KEY_MARKERS = new Set(
  [
    "minimax-oauth",
    "qwen-oauth",
    "ollama-local",
    "custom-local",
    "secretref-managed",
  ].map((s) => s.toLowerCase()),
);

function normalizeWritableProviderApiKey(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const t = raw.trim();
  if (!t) {
    return null;
  }
  if (OPENCLAW_NON_SECRET_API_KEY_MARKERS.has(t.toLowerCase())) {
    return null;
  }
  return t;
}

function isEnoent(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT";
}

function extractAgentsDefaults(root: unknown): {
  model: Record<string, unknown>;
  models: Record<string, unknown>;
} {
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    return { model: {}, models: {} };
  }
  const agents = (root as Record<string, unknown>).agents;
  if (!agents || typeof agents !== "object" || Array.isArray(agents)) {
    return { model: {}, models: {} };
  }
  const defaults = (agents as Record<string, unknown>).defaults;
  if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) {
    return { model: {}, models: {} };
  }
  const def = defaults as Record<string, unknown>;
  const model =
    def.model && typeof def.model === "object" && !Array.isArray(def.model)
      ? { ...(def.model as Record<string, unknown>) }
      : {};
  const models =
    def.models && typeof def.models === "object" && !Array.isArray(def.models)
      ? { ...(def.models as Record<string, unknown>) }
      : {};
  return { model, models };
}

export async function readOpenClawModelConfig(): Promise<
  | { ok: true; model: Record<string, unknown>; models: Record<string, unknown> }
  | { ok: false; error: string }
> {
  const p = getOpenClawConfigPath();
  try {
    const raw = await fs.readFile(p, "utf8");
    let root: unknown;
    try {
      root = JSON.parse(raw) as unknown;
    } catch {
      return { ok: false, error: "openclaw.json 不是合法 JSON，请用 CLI 或编辑器修正后再试" };
    }
    const { model, models } = extractAgentsDefaults(root);
    return { ok: true, model, models };
  } catch (e) {
    if (isEnoent(e)) {
      return { ok: true, model: {}, models: {} };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type OpenClawModelWritePayload = {
  model?: Record<string, unknown>;
  models?: Record<string, Record<string, unknown>>;
};

async function backupCurrentFileIfExists(configPath: string): Promise<
  { ok: true; backupPath: string } | { ok: false; error: string }
> {
  try {
    await fs.access(configPath);
  } catch (e) {
    if (isEnoent(e)) {
      return { ok: true, backupPath: "" };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const dir = path.dirname(configPath);
  const backupPath = path.join(dir, newBackupBasename());
  try {
    await fs.copyFile(configPath, backupPath);
    return { ok: true, backupPath };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function writeOpenClawModelConfig(
  payload: OpenClawModelWritePayload,
): Promise<
  | { ok: true; backupPath?: string }
  | { ok: false; error: string; backupPath?: string }
> {
  const configPath = getOpenClawConfigPath();
  const dir = getOpenClawDir();
  let root: Record<string, unknown>;

  try {
    const raw = await fs.readFile(configPath, "utf8");
    try {
      root = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { ok: false, error: "当前 openclaw.json 无法解析为 JSON，已中止写入" };
    }
  } catch (e) {
    if (isEnoent(e)) {
      root = {};
    } else {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  const bak = await backupCurrentFileIfExists(configPath);
  if (!bak.ok) {
    return { ok: false, error: `备份失败，已中止写入：${bak.error}` };
  }

  if (!root.agents || typeof root.agents !== "object" || Array.isArray(root.agents)) {
    root.agents = {};
  }
  const agents = root.agents as Record<string, unknown>;
  if (!agents.defaults || typeof agents.defaults !== "object" || Array.isArray(agents.defaults)) {
    agents.defaults = {};
  }
  const defaults = agents.defaults as Record<string, unknown>;

  if (payload.model && typeof payload.model === "object" && !Array.isArray(payload.model)) {
    if (!defaults.model || typeof defaults.model !== "object" || Array.isArray(defaults.model)) {
      defaults.model = {};
    }
    const dm = defaults.model as Record<string, unknown>;
    for (const [k, v] of Object.entries(payload.model)) {
      dm[k] = v;
    }
  }

  if (payload.models !== undefined) {
    if (typeof payload.models !== "object" || Array.isArray(payload.models)) {
      return { ok: false, error: "models 参数无效", backupPath: bak.backupPath || undefined };
    }
    defaults.models = { ...payload.models };
  }

  const out = `${JSON.stringify(root, null, 2)}\n`;
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(configPath, out, "utf8");
    return { ok: true, backupPath: bak.backupPath || undefined };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      backupPath: bak.backupPath || undefined,
    };
  }
}

async function findLatestBackupFile(configDir: string): Promise<string | null> {
  let names: string[];
  try {
    names = await fs.readdir(configDir);
  } catch (e) {
    if (isEnoent(e)) {
      return null;
    }
    throw e;
  }
  const candidates = names.filter(
    (n) => n.startsWith(BACKUP_PREFIX) && n.endsWith(BACKUP_SUFFIX),
  );
  if (candidates.length === 0) {
    return null;
  }
  const withStat = await Promise.all(
    candidates.map(async (n) => {
      const full = path.join(configDir, n);
      const st = await fs.stat(full);
      return { full, mtime: st.mtimeMs };
    }),
  );
  withStat.sort((a, b) => b.mtime - a.mtime);
  return withStat[0]?.full ?? null;
}

/** 与常见 OpenClaw / CLI 习惯一致：小写 + 数字 + 连字符，不以连字符开头或结尾 */
export const OPENCLAW_PROVIDER_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function extractModelsProviders(root: unknown): Record<string, unknown> {
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    return {};
  }
  const models = (root as Record<string, unknown>).models;
  if (!models || typeof models !== "object" || Array.isArray(models)) {
    return {};
  }
  const providers = (models as Record<string, unknown>).providers;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    return {};
  }
  return { ...(providers as Record<string, unknown>) };
}

/**
 * 读取时合并：与运行时一致，代理目录下 models.json 的 providers 覆盖 openclaw.json 同 id 字段。
 * @see https://docs.openclaw.ai/concepts/models#models-registry-models-json
 */
function mergeSingleProviderForRead(globalP: unknown, agentP: unknown): Record<string, unknown> {
  const g =
    globalP && typeof globalP === "object" && !Array.isArray(globalP)
      ? { ...(globalP as Record<string, unknown>) }
      : {};
  const a =
    agentP && typeof agentP === "object" && !Array.isArray(agentP)
      ? { ...(agentP as Record<string, unknown>) }
      : {};
  const out = { ...g };
  for (const [k, v] of Object.entries(a)) {
    if (k === "models" && v && typeof v === "object" && !Array.isArray(v)) {
      const gm =
        out.models && typeof out.models === "object" && !Array.isArray(out.models)
          ? { ...(out.models as Record<string, unknown>) }
          : {};
      out.models = { ...gm, ...(v as Record<string, unknown>) };
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

function mergeProvidersForRead(
  globalProviders: Record<string, unknown>,
  agentProviders: Record<string, unknown>,
): Record<string, unknown> {
  const ids = new Set([...Object.keys(globalProviders), ...Object.keys(agentProviders)]);
  const out: Record<string, unknown> = {};
  for (const id of ids) {
    out[id] = mergeSingleProviderForRead(globalProviders[id], agentProviders[id]);
  }
  return out;
}

async function readAgentModelsProvidersMap(agentId: string): Promise<Record<string, unknown>> {
  const p = getAgentModelsJsonPath(agentId);
  try {
    const raw = await fs.readFile(p, "utf8");
    const root = JSON.parse(raw) as unknown;
    if (!root || typeof root !== "object" || Array.isArray(root)) {
      return {};
    }
    const pr = (root as Record<string, unknown>).providers;
    if (!pr || typeof pr !== "object" || Array.isArray(pr)) {
      return {};
    }
    return { ...(pr as Record<string, unknown>) };
  } catch (e) {
    if (isEnoent(e)) {
      return {};
    }
    throw e;
  }
}

export async function readOpenClawProviders(): Promise<
  | { ok: true; providers: Record<string, unknown>; defaultAgentId: string }
  | { ok: false; error: string }
> {
  const p = getOpenClawConfigPath();
  try {
    const raw = await fs.readFile(p, "utf8");
    let root: Record<string, unknown>;
    try {
      root = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { ok: false, error: "openclaw.json 不是合法 JSON，请用编辑器修正后再试" };
    }
    const agentId = extractDefaultAgentId(root);
    const globalP = extractModelsProviders(root);
    let agentP: Record<string, unknown>;
    try {
      agentP = await readAgentModelsProvidersMap(agentId);
    } catch (e) {
      return {
        ok: false,
        error: `读取代理 models.json 失败：${e instanceof Error ? e.message : String(e)}`,
      };
    }
    return {
      ok: true,
      providers: mergeProvidersForRead(globalP, agentP),
      defaultAgentId: agentId,
    };
  } catch (e) {
    if (isEnoent(e)) {
      const agentId = "main";
      let agentP: Record<string, unknown> = {};
      try {
        agentP = await readAgentModelsProvidersMap(agentId);
      } catch (e2) {
        return {
          ok: false,
          error: `读取代理 models.json 失败：${e2 instanceof Error ? e2.message : String(e2)}`,
        };
      }
      return { ok: true, providers: mergeProvidersForRead({}, agentP), defaultAgentId: agentId };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 将 patch 合并进 `models.providers`：每个 key 为 provider id；
 * `null` 表示删除该 provider。单条内的 `models` 若出现则整体替换该 provider 下的 models 对象，
 * 条目内其它字段浅合并进已有 provider（保留 JSON 里未在表单出现的键）。
 */
function mergeProviderEntry(
  existing: unknown,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === "models") {
      if (v === null || v === undefined) {
        delete base.models;
        continue;
      }
      if (typeof v === "object" && !Array.isArray(v)) {
        const prevModels =
          base.models && typeof base.models === "object" && !Array.isArray(base.models)
            ? (base.models as Record<string, unknown>)
            : {};
        const nextModels: Record<string, unknown> = {};
        for (const [mid, mbody] of Object.entries(v as Record<string, unknown>)) {
          const pe = prevModels[mid];
          if (
            mbody &&
            typeof mbody === "object" &&
            !Array.isArray(mbody) &&
            pe &&
            typeof pe === "object" &&
            !Array.isArray(pe)
          ) {
            nextModels[mid] = { ...(pe as Record<string, unknown>), ...(mbody as Record<string, unknown>) };
          } else {
            nextModels[mid] = mbody as unknown;
          }
        }
        base.models = nextModels;
      }
      continue;
    }
    if (v !== undefined) {
      if (k === "baseUrl") {
        delete base.baseURL;
      } else if (k === "baseURL") {
        delete base.baseUrl;
      }
      (base as Record<string, unknown>)[k] = v;
    }
  }
  return base;
}

export type OpenClawProvidersPatchPayload = {
  patch: Record<string, Record<string, unknown> | null>;
};

export type OpenClawProvidersWriteResult =
  | {
      ok: true;
      /** openclaw.json 备份（仅当该文件在写入前已存在时生成） */
      backupPath?: string;
      /** ~/.openclaw/agents/<id>/agent/models.json 备份（仅当该文件已存在时生成） */
      agentModelsBackupPath?: string;
      /** ~/.openclaw/agents/<id>/agent/auth-profiles.json 备份（仅当本次写入了该文件且原文件已存在时生成） */
      authProfilesBackupPath?: string;
      defaultAgentId: string;
    }
  | {
      ok: false;
      error: string;
      backupPath?: string;
      agentModelsBackupPath?: string;
      authProfilesBackupPath?: string;
    };

async function backupAgentModelsIfExists(
  agentModelsPath: string,
): Promise<{ ok: true; backupPath: string } | { ok: false; error: string }> {
  try {
    await fs.access(agentModelsPath);
  } catch (e) {
    if (isEnoent(e)) {
      return { ok: true, backupPath: "" };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const backupPath = path.join(path.dirname(agentModelsPath), newAgentModelsBackupBasename());
  try {
    await fs.copyFile(agentModelsPath, backupPath);
    return { ok: true, backupPath };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function backupAgentAuthProfilesIfExists(
  authProfilesPath: string,
): Promise<{ ok: true; backupPath: string } | { ok: false; error: string }> {
  try {
    await fs.access(authProfilesPath);
  } catch (e) {
    if (isEnoent(e)) {
      return { ok: true, backupPath: "" };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const backupPath = path.join(path.dirname(authProfilesPath), newAgentAuthProfilesBackupBasename());
  try {
    await fs.copyFile(authProfilesPath, backupPath);
    return { ok: true, backupPath };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 与 OpenClaw 运行时一致：网关按 agentDir 下 auth-profiles.json 解析 API Key。
 * 在保存 models.json 前写入，避免出现「providers 里有 apiKey 但报 No API key found」。
 */
function buildNextAgentAuthProfilesRoot(params: {
  existingRaw: string | null;
  patch: Record<string, Record<string, unknown> | null>;
  mergedAgentProviders: Record<string, unknown>;
}): { root: Record<string, unknown>; changed: boolean } {
  let authRoot: Record<string, unknown> = { version: 1, profiles: {}, usageStats: {} };
  if (params.existingRaw !== null) {
    const parsed = JSON.parse(params.existingRaw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      authRoot = { ...(parsed as Record<string, unknown>) };
    }
  }

  if (
    !authRoot.profiles ||
    typeof authRoot.profiles !== "object" ||
    Array.isArray(authRoot.profiles)
  ) {
    authRoot.profiles = {};
  }
  const profiles = authRoot.profiles as Record<string, unknown>;
  const prevSnap = JSON.stringify(profiles);

  for (const id of Object.keys(params.patch)) {
    const profileKey = `${id}:default`;
    if (params.patch[id] === null) {
      if (profileKey in profiles) {
        delete profiles[profileKey];
      }
      continue;
    }
    const prov = params.mergedAgentProviders[id];
    const key = normalizeWritableProviderApiKey(
      prov && typeof prov === "object" && !Array.isArray(prov)
        ? (prov as Record<string, unknown>).apiKey
        : undefined,
    );
    if (key) {
      profiles[profileKey] = { type: "api_key", provider: id, key };
    } else {
      const old = profiles[profileKey];
      if (
        old &&
        typeof old === "object" &&
        !Array.isArray(old) &&
        (old as Record<string, unknown>).type === "api_key"
      ) {
        delete profiles[profileKey];
      }
    }
  }

  const changed = JSON.stringify(profiles) !== prevSnap;
  return { root: authRoot, changed };
}

function syncOpenClawRootAuthProfileRefs(
  root: Record<string, unknown>,
  patch: Record<string, Record<string, unknown> | null>,
  mergedAgentProviders: Record<string, unknown>,
): boolean {
  if (!root.auth || typeof root.auth !== "object" || Array.isArray(root.auth)) {
    root.auth = {};
  }
  const auth = root.auth as Record<string, unknown>;
  if (!auth.profiles || typeof auth.profiles !== "object" || Array.isArray(auth.profiles)) {
    auth.profiles = {};
  }
  const profiles = auth.profiles as Record<string, unknown>;
  const prevSnap = JSON.stringify(profiles);

  for (const id of Object.keys(patch)) {
    const profileKey = `${id}:default`;
    if (patch[id] === null) {
      if (profileKey in profiles) {
        delete profiles[profileKey];
      }
      continue;
    }
    const prov = mergedAgentProviders[id];
    const key = normalizeWritableProviderApiKey(
      prov && typeof prov === "object" && !Array.isArray(prov)
        ? (prov as Record<string, unknown>).apiKey
        : undefined,
    );
    if (key) {
      profiles[profileKey] = { provider: id, mode: "api_key" };
    } else {
      const old = profiles[profileKey];
      if (
        old &&
        typeof old === "object" &&
        !Array.isArray(old) &&
        (old as Record<string, unknown>).mode === "api_key"
      ) {
        delete profiles[profileKey];
      }
    }
  }

  return JSON.stringify(profiles) !== prevSnap;
}

/**
 * OpenClaw ModelRegistry 校验要求 `providers.*.models` 为**非空数组**（见 dist 内对 `Array.isArray(providerConfig.models)` 的判断）。
 * UI 合并层使用「模型 id → 对象」映射写入时，网关会忽略该 provider，导致 Unknown model。
 */
function normalizeProviderModelsToArray(models: unknown): Record<string, unknown>[] {
  if (Array.isArray(models)) {
    return (models as unknown[]).filter(
      (m) => m && typeof m === "object" && !Array.isArray(m),
    ) as Record<string, unknown>[];
  }
  if (models && typeof models === "object" && !Array.isArray(models)) {
    const out: Record<string, unknown>[] = [];
    for (const [mid, body] of Object.entries(models as Record<string, unknown>)) {
      const id = mid.trim();
      if (!id) {
        continue;
      }
      const extra =
        body && typeof body === "object" && !Array.isArray(body)
          ? { ...(body as Record<string, unknown>) }
          : {};
      out.push({ ...extra, id });
    }
    return out;
  }
  return [];
}

function normalizeAgentProvidersModelsShape(providers: Record<string, unknown>): void {
  for (const prov of Object.values(providers)) {
    if (!prov || typeof prov !== "object" || Array.isArray(prov)) {
      continue;
    }
    const p = prov as Record<string, unknown>;
    if (p.models === undefined) {
      continue;
    }
    p.models = normalizeProviderModelsToArray(p.models);
  }
}

function stripGlobalProvidersFromOpenClawRoot(
  root: Record<string, unknown>,
  patch: Record<string, Record<string, unknown> | null>,
): void {
  for (const id of Object.keys(patch)) {
    if (!root.models || typeof root.models !== "object" || Array.isArray(root.models)) {
      root.models = {};
    }
    const modelsBlock = root.models as Record<string, unknown>;
    if (
      !modelsBlock.providers ||
      typeof modelsBlock.providers !== "object" ||
      Array.isArray(modelsBlock.providers)
    ) {
      modelsBlock.providers = {};
    }
    const globalProviders = modelsBlock.providers as Record<string, unknown>;
    delete globalProviders[id];
  }
}

/**
 * 供应商写入默认代理的 `agents/<agentId>/agent/models.json` → `providers`（与 onboard / models registry 一致），
 * 同步写入同目录 `auth-profiles.json`（真实 API Key → `{providerId}:default`），供网关解析凭据。
 * 若存在 `openclaw.json`，同时维护其中 `auth.profiles` 的 api_key 引用，并从 `models.providers` 去掉同名 id，避免密钥在总配置重复落盘。
 * @see https://docs.openclaw.ai/concepts/models#models-registry-models-json
 */
export async function writeOpenClawProvidersPatch(
  payload: OpenClawProvidersPatchPayload,
): Promise<OpenClawProvidersWriteResult> {
  if (!payload.patch || typeof payload.patch !== "object" || Array.isArray(payload.patch)) {
    return { ok: false, error: "patch 无效" };
  }
  for (const id of Object.keys(payload.patch)) {
    if (!OPENCLAW_PROVIDER_ID_RE.test(id)) {
      return {
        ok: false,
        error: `provider 名称「${id}」不合法，请用小写字母、数字与连字符（如 deepseek、xiaomi）`,
      };
    }
  }

  const configPath = getOpenClawConfigPath();
  let openclawExisted = false;
  try {
    await fs.access(configPath);
    openclawExisted = true;
  } catch {
    /* 无总配置文件时仅写代理 models.json */
  }

  let root: Record<string, unknown>;
  try {
    const raw = await fs.readFile(configPath, "utf8");
    try {
      root = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { ok: false, error: "当前 openclaw.json 无法解析为 JSON，已中止写入" };
    }
  } catch (e) {
    if (isEnoent(e)) {
      root = {};
    } else {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  const agentId = extractDefaultAgentId(root);
  const agentModelsPath = getAgentModelsJsonPath(agentId);
  const agentDir = path.dirname(agentModelsPath);

  let openclawBackupPath = "";
  if (openclawExisted) {
    const bak = await backupCurrentFileIfExists(configPath);
    if (!bak.ok) {
      return { ok: false, error: `备份 openclaw.json 失败：${bak.error}` };
    }
    openclawBackupPath = bak.backupPath;
  }

  const agentBak = await backupAgentModelsIfExists(agentModelsPath);
  if (!agentBak.ok) {
    return {
      ok: false,
      error: `备份代理 models.json 失败：${agentBak.error}`,
      backupPath: openclawBackupPath || undefined,
    };
  }

  let agentRoot: Record<string, unknown>;
  try {
    const raw = await fs.readFile(agentModelsPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    agentRoot =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? { ...(parsed as Record<string, unknown>) }
        : {};
  } catch (e) {
    if (isEnoent(e)) {
      agentRoot = {};
    } else {
      return {
        ok: false,
        error: `代理 models.json 无法解析：${e instanceof Error ? e.message : String(e)}`,
        backupPath: openclawBackupPath || undefined,
        agentModelsBackupPath: agentBak.backupPath || undefined,
      };
    }
  }

  if (
    !agentRoot.providers ||
    typeof agentRoot.providers !== "object" ||
    Array.isArray(agentRoot.providers)
  ) {
    agentRoot.providers = {};
  }
  const agentProviders = agentRoot.providers as Record<string, unknown>;

  for (const [id, body] of Object.entries(payload.patch)) {
    if (body === null) {
      delete agentProviders[id];
    } else if (typeof body === "object" && !Array.isArray(body)) {
      agentProviders[id] = mergeProviderEntry(agentProviders[id], body as Record<string, unknown>);
    } else {
      return {
        ok: false,
        error: `provider「${id}」的合并内容无效`,
        backupPath: openclawBackupPath || undefined,
        agentModelsBackupPath: agentBak.backupPath || undefined,
      };
    }
  }

  normalizeAgentProvidersModelsShape(agentProviders);

  const globalProvidersBefore = extractModelsProviders(root);
  const stripFromOpenclaw =
    openclawExisted &&
    Object.keys(payload.patch).some((id) =>
      Object.prototype.hasOwnProperty.call(globalProvidersBefore, id),
    );

  if (stripFromOpenclaw) {
    stripGlobalProvidersFromOpenClawRoot(root, payload.patch);
  }

  const rootAuthDirty =
    openclawExisted &&
    syncOpenClawRootAuthProfileRefs(root, payload.patch, agentProviders);

  const authProfilesPath = getAgentAuthProfilesJsonPath(agentId);
  let authExistingRaw: string | null = null;
  try {
    authExistingRaw = await fs.readFile(authProfilesPath, "utf8");
  } catch (e) {
    if (!isEnoent(e)) {
      return {
        ok: false,
        error: `读取代理 auth-profiles.json 失败：${e instanceof Error ? e.message : String(e)}`,
        backupPath: openclawBackupPath || undefined,
        agentModelsBackupPath: agentBak.backupPath || undefined,
      };
    }
  }

  if (authExistingRaw !== null) {
    try {
      JSON.parse(authExistingRaw);
    } catch {
      return {
        ok: false,
        error:
          "代理 auth-profiles.json 不是合法 JSON，请用编辑器修正后再试（本次未写入 models / openclaw）",
        backupPath: openclawBackupPath || undefined,
        agentModelsBackupPath: agentBak.backupPath || undefined,
      };
    }
  }

  const { root: nextAuthRoot, changed: authProfilesChanged } = buildNextAgentAuthProfilesRoot({
    existingRaw: authExistingRaw,
    patch: payload.patch,
    mergedAgentProviders: agentProviders,
  });

  try {
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(agentModelsPath, `${JSON.stringify(agentRoot, null, 2)}\n`, "utf8");
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      backupPath: openclawBackupPath || undefined,
      agentModelsBackupPath: agentBak.backupPath || undefined,
    };
  }

  let authProfilesBackupPath = "";
  if (authProfilesChanged) {
    const authBak = await backupAgentAuthProfilesIfExists(authProfilesPath);
    if (!authBak.ok) {
      return {
        ok: false,
        error: `models.json 已更新，但备份代理 auth-profiles.json 失败：${authBak.error}（请重试保存以写入凭据）`,
        backupPath: openclawBackupPath || undefined,
        agentModelsBackupPath: agentBak.backupPath || undefined,
      };
    }
    authProfilesBackupPath = authBak.backupPath;
    try {
      await fs.mkdir(path.dirname(authProfilesPath), { recursive: true });
      await fs.writeFile(authProfilesPath, `${JSON.stringify(nextAuthRoot, null, 2)}\n`, "utf8");
    } catch (e) {
      return {
        ok: false,
        error: `models.json 已更新，但写入代理 auth-profiles.json 失败：${e instanceof Error ? e.message : String(e)}（网关仍可能报无 API Key，请重试保存）`,
        backupPath: openclawBackupPath || undefined,
        agentModelsBackupPath: agentBak.backupPath || undefined,
        authProfilesBackupPath: authProfilesBackupPath || undefined,
      };
    }
  }

  const rootNeedsWrite = openclawExisted && (stripFromOpenclaw || rootAuthDirty);
  if (rootNeedsWrite) {
    const out = `${JSON.stringify(root, null, 2)}\n`;
    try {
      await fs.mkdir(getOpenClawDir(), { recursive: true });
      await fs.writeFile(configPath, out, "utf8");
    } catch (e) {
      return {
        ok: false,
        error: `写入 openclaw.json 失败：${e instanceof Error ? e.message : String(e)}`,
        backupPath: openclawBackupPath || undefined,
        agentModelsBackupPath: agentBak.backupPath || undefined,
        authProfilesBackupPath: authProfilesBackupPath || undefined,
      };
    }
  }

  return {
    ok: true,
    backupPath: openclawBackupPath || undefined,
    agentModelsBackupPath: agentBak.backupPath || undefined,
    authProfilesBackupPath: authProfilesBackupPath || undefined,
    defaultAgentId: agentId,
  };
}

export async function restoreOpenClawConfigToLatestBackup(): Promise<
  { ok: true; backupUsed: string } | { ok: false; error: string; backupPath?: string }
> {
  const configPath = getOpenClawConfigPath();
  const dir = getOpenClawDir();
  let latest: string | null;
  try {
    latest = await findLatestBackupFile(dir);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!latest) {
    return { ok: false, error: "未找到本应用生成的备份文件（openclaw.json.lclaw-backup-*.json）" };
  }

  const pre = await backupCurrentFileIfExists(configPath);
  if (!pre.ok) {
    return { ok: false, error: `恢复前备份失败：${pre.error}` };
  }

  try {
    const content = await fs.readFile(latest, "utf8");
    JSON.parse(content);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(configPath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
    return { ok: true, backupUsed: latest };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      backupPath: pre.backupPath || undefined,
    };
  }
}
