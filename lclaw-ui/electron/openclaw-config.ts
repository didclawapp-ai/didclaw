import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const BACKUP_PREFIX = "openclaw.json.lclaw-backup-";
const BACKUP_SUFFIX = ".json";

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

export async function readOpenClawProviders(): Promise<
  { ok: true; providers: Record<string, unknown> } | { ok: false; error: string }
> {
  const p = getOpenClawConfigPath();
  try {
    const raw = await fs.readFile(p, "utf8");
    let root: unknown;
    try {
      root = JSON.parse(raw) as unknown;
    } catch {
      return { ok: false, error: "openclaw.json 不是合法 JSON，请用编辑器修正后再试" };
    }
    return { ok: true, providers: extractModelsProviders(root) };
  } catch (e) {
    if (isEnoent(e)) {
      return { ok: true, providers: {} };
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

export async function writeOpenClawProvidersPatch(
  payload: OpenClawProvidersPatchPayload,
): Promise<
  | { ok: true; backupPath?: string }
  | { ok: false; error: string; backupPath?: string }
> {
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
  const providers = modelsBlock.providers as Record<string, unknown>;

  for (const [id, body] of Object.entries(payload.patch)) {
    if (body === null) {
      delete providers[id];
    } else if (typeof body === "object" && !Array.isArray(body)) {
      providers[id] = mergeProviderEntry(providers[id], body as Record<string, unknown>);
    } else {
      return { ok: false, error: `provider「${id}」的合并内容无效`, backupPath: bak.backupPath || undefined };
    }
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
