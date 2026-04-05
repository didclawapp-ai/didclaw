import { invoke, isTauri } from "@tauri-apps/api/core";

import { didclawKvReadSync, didclawKvWriteSync } from "@/lib/didclaw-kv";

const LS_INSTALL_ROOT = "didclaw.skillsInstallRoot";

export type InstalledSkillRow = {
  slug: string;
  path: string;
  source: string;
  registry?: string | null;
  installedVersion?: string | null;
};

export type OpenClawSkillItem = {
  name: string;
  description?: string | null;
  emoji?: string | null;
  eligible: boolean;
  disabled: boolean;
  blockedByAllowlist?: boolean;
  source?: string | null;
  bundled?: boolean;
  homepage?: string | null;
  missing?: {
    bins?: string[];
    anyBins?: string[];
    env?: string[];
    config?: string[];
    os?: string[];
  } | null;
};

export type OpenClawSkillsListResult = {
  workspaceDir?: string;
  managedSkillsDir?: string;
  skills: OpenClawSkillItem[];
};

export type OpenClawSkillSearchHit = {
  score: number;
  slug: string;
  displayName?: string | null;
  summary?: string | null;
  version?: string | null;
  updatedAt?: number | null;
};

export type OpenClawSkillsCheckResult = {
  summary?: {
    total?: number;
    eligible?: number;
    disabled?: number;
    blocked?: number;
    missingRequirements?: number;
  };
  eligible?: string[];
  disabled?: string[];
  blocked?: string[];
  missingRequirements?: Array<{
    name: string;
    missing?: {
      bins?: string[];
      anyBins?: string[];
      env?: string[];
      config?: string[];
      os?: string[];
    };
    install?: Array<{
      id?: string;
      kind?: string;
      label?: string;
      bins?: string[];
    }>;
  }>;
};

export type OpenClawSkillInfoResult = {
  name?: string;
  skillKey?: string | null;
  disabled?: boolean;
  bundled?: boolean;
};

export type OpenClawPluginItem = {
  id: string;
  name?: string | null;
  description?: string | null;
  version?: string | null;
  origin?: string | null;
  status?: string | null;
  enabled?: boolean;
  format?: string | null;
  source?: string | null;
  channelIds?: string[];
  providerIds?: string[];
  toolNames?: string[];
  commands?: string[];
  error?: string | null;
};

export type OpenClawPluginsListResult = {
  workspaceDir?: string;
  plugins: OpenClawPluginItem[];
};

export type OpenClawPluginInspectResult = {
  workspaceDir?: string;
  plugin?: OpenClawPluginItem & {
    rootDir?: string | null;
    configSchema?: boolean;
    configUiHints?: Record<string, { label?: string; help?: string; advanced?: boolean }>;
  };
  shape?: string | null;
  capabilityMode?: string | null;
  capabilityCount?: number;
  capabilities?: Array<Record<string, unknown>>;
  tools?: Array<Record<string, unknown>>;
  commands?: Array<Record<string, unknown>>;
  services?: Array<Record<string, unknown>>;
  gatewayMethods?: Array<Record<string, unknown>>;
  mcpServers?: Array<Record<string, unknown>>;
  compatibility?: Array<Record<string, unknown>>;
  diagnostics?: Array<Record<string, unknown>>;
};

type ClawhubAuthPayload = {
  token?: string;
  registry?: string;
};

export function getStoredSkillsInstallRoot(): string | null {
  try {
    return didclawKvReadSync(LS_INSTALL_ROOT);
  } catch {
    return null;
  }
}

export function setStoredSkillsInstallRoot(path: string): void {
  try {
    didclawKvWriteSync(LS_INSTALL_ROOT, path);
  } catch {
    /* ignore */
  }
}

export async function skillsDefaultInstallRoot(): Promise<string> {
  if (!isTauri()) {
    return "";
  }
  return invoke<string>("skills_default_install_root");
}

/** 解析安装根：override > localStorage > 系统默认 */
export async function skillsResolveInstallRoot(override?: string): Promise<string> {
  const o = override?.trim();
  if (o) {
    return o;
  }
  const stored = getStoredSkillsInstallRoot()?.trim();
  if (stored) {
    return stored;
  }
  return skillsDefaultInstallRoot();
}

export async function skillsListInstalled(installRoot: string): Promise<InstalledSkillRow[]> {
  if (!isTauri() || !installRoot.trim()) {
    return [];
  }
  const r = await invoke<InstalledSkillRow[]>("skills_list_installed", { installRoot });
  return Array.isArray(r) ? r : [];
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

export async function skillsInstallZipBase64(
  installRoot: string,
  slug: string,
  zipBase64: string,
  origin?: Record<string, unknown> | null,
): Promise<{ ok: boolean; path?: string }> {
  return invoke("skills_install_zip_base64", {
    installRoot,
    slug,
    zipBase64,
    origin: origin ?? null,
  });
}

export async function skillsInstallZipPath(
  installRoot: string,
  slug: string,
  zipPath: string,
): Promise<{ ok: boolean; path?: string }> {
  return invoke("skills_install_zip_path", { installRoot, slug, zipPath });
}

export async function skillsInstallFromFolder(
  installRoot: string,
  slug: string,
  sourcePath: string,
): Promise<{ ok: boolean; path?: string }> {
  return invoke("skills_install_from_folder", { installRoot, slug, sourcePath });
}

export async function skillsDelete(installRoot: string, slug: string): Promise<void> {
  await invoke("skills_delete", { installRoot, slug });
}

export async function skillsPickZipFile(): Promise<string | null> {
  if (!isTauri()) {
    return null;
  }
  return invoke<string | null>("skills_pick_zip_file");
}

export async function skillsPickFolder(): Promise<string | null> {
  if (!isTauri()) {
    return null;
  }
  return invoke<string | null>("skills_pick_folder");
}

export async function openclawSkillsList(options?: {
  eligibleOnly?: boolean;
  verbose?: boolean;
}): Promise<OpenClawSkillsListResult> {
  if (!isTauri()) {
    return { skills: [] };
  }
  const r = await invoke<OpenClawSkillsListResult & { ok?: boolean; error?: string }>(
    "openclaw_skills_list",
    {
      eligibleOnly: options?.eligibleOnly ?? false,
      verbose: options?.verbose ?? false,
    },
  );
  if (r && typeof r === "object" && "ok" in r && r.ok === false) {
    throw new Error(r.error || "OpenClaw skills list failed");
  }
  return {
    workspaceDir: r?.workspaceDir,
    managedSkillsDir: r?.managedSkillsDir,
    skills: Array.isArray(r?.skills) ? r.skills : [],
  };
}

export async function openclawSkillsSearch(
  query: string,
  options?: { limit?: number } & ClawhubAuthPayload,
): Promise<{ results: OpenClawSkillSearchHit[] }> {
  if (!isTauri()) {
    return { results: [] };
  }
  const r = await invoke<{ results?: OpenClawSkillSearchHit[]; ok?: boolean; error?: string }>(
    "openclaw_skills_search",
    {
      query,
      limit: options?.limit ?? 30,
      clawhubToken: options?.token?.trim() || null,
      clawhubRegistry: options?.registry?.trim() || null,
    },
  );
  if (r && typeof r === "object" && "ok" in r && r.ok === false) {
    throw new Error(r.error || "OpenClaw skills search failed");
  }
  return {
    results: Array.isArray(r?.results) ? r.results : [],
  };
}

export async function openclawSkillsInfo(skillName: string): Promise<OpenClawSkillInfoResult> {
  if (!isTauri()) {
    return {};
  }
  const r = await invoke<OpenClawSkillInfoResult & { ok?: boolean; error?: string }>(
    "openclaw_skills_info",
    {
      skillName,
    },
  );
  if (r && typeof r === "object" && "ok" in r && r.ok === false) {
    throw new Error(r.error || "OpenClaw skills info failed");
  }
  return r ?? {};
}

export async function writeOpenclawCompanyRosterSkill(skillMd: string): Promise<{
  ok: boolean;
  path?: string;
  slug?: string;
  backupPath?: string | null;
  error?: string;
}> {
  if (!isTauri()) {
    return { ok: false, error: "not-tauri" };
  }
  const r = await invoke<{
    ok?: boolean;
    error?: string;
    path?: string;
    slug?: string;
    backupPath?: string | null;
  }>("write_openclaw_company_roster_skill", { skillMd });
  if (r && typeof r === "object" && r.ok === false) {
    throw new Error(r.error || "write_openclaw_company_roster_skill failed");
  }
  return {
    ok: r?.ok === true,
    path: typeof r?.path === "string" ? r.path : undefined,
    slug: typeof r?.slug === "string" ? r.slug : undefined,
    backupPath: r?.backupPath ?? undefined,
  };
}

export async function writeOpenClawSkillEnabled(
  skillKey: string,
  enabled: boolean,
): Promise<{ ok: boolean; backupPath?: string | null }> {
  if (!isTauri()) {
    return { ok: false };
  }
  const r = await invoke<{ ok?: boolean; error?: string; backupPath?: string | null }>(
    "write_open_claw_skill_enabled",
    {
      skillKey,
      enabled,
    },
  );
  if (r && typeof r === "object" && r.ok === false) {
    throw new Error(r.error || "Write OpenClaw skill enabled failed");
  }
  return {
    ok: r?.ok === true,
    backupPath: r?.backupPath,
  };
}

export async function openclawSkillsInstall(
  skillSlug: string,
  version?: string,
  auth?: ClawhubAuthPayload,
): Promise<{ ok: boolean; stdout?: string; stderr?: string }> {
  if (!isTauri()) {
    return { ok: false };
  }
  const r = await invoke<{ ok?: boolean; error?: string; stdout?: string; stderr?: string }>(
    "openclaw_skills_install",
    {
      skillSlug,
      version: version?.trim() || null,
      clawhubToken: auth?.token?.trim() || null,
      clawhubRegistry: auth?.registry?.trim() || null,
    },
  );
  if (r && typeof r === "object" && r.ok === false) {
    throw new Error(r.error || "OpenClaw skills install failed");
  }
  return {
    ok: r?.ok === true,
    stdout: r?.stdout,
    stderr: r?.stderr,
  };
}

export async function openclawSkillsUpdate(
  skillName: string,
  auth?: ClawhubAuthPayload,
): Promise<{ ok: boolean; stdout?: string; stderr?: string }> {
  if (!isTauri()) {
    return { ok: false };
  }
  const r = await invoke<{ ok?: boolean; error?: string; stdout?: string; stderr?: string }>(
    "openclaw_skills_update",
    {
      skillName,
      clawhubToken: auth?.token?.trim() || null,
      clawhubRegistry: auth?.registry?.trim() || null,
    },
  );
  if (r && typeof r === "object" && r.ok === false) {
    throw new Error(r.error || "OpenClaw skills update failed");
  }
  return {
    ok: r?.ok === true,
    stdout: r?.stdout,
    stderr: r?.stderr,
  };
}

export async function openclawSkillsUninstall(
  skillName: string,
): Promise<{ ok: boolean; stdout?: string; stderr?: string }> {
  if (!isTauri()) {
    return { ok: false };
  }
  const r = await invoke<{ ok?: boolean; error?: string; stdout?: string; stderr?: string }>(
    "openclaw_skills_uninstall",
    {
      skillName,
    },
  );
  if (r && typeof r === "object" && r.ok === false) {
    throw new Error(r.error || "OpenClaw skills uninstall failed");
  }
  return {
    ok: r?.ok === true,
    stdout: r?.stdout,
    stderr: r?.stderr,
  };
}

export async function openclawSkillsCheck(): Promise<OpenClawSkillsCheckResult> {
  if (!isTauri()) {
    return {};
  }
  const r = await invoke<OpenClawSkillsCheckResult & { ok?: boolean; error?: string }>(
    "openclaw_skills_check",
  );
  if (r && typeof r === "object" && "ok" in r && r.ok === false) {
    throw new Error(r.error || "OpenClaw skills check failed");
  }
  return r ?? {};
}

export async function openclawPluginsList(
  options?: { enabledOnly?: boolean },
): Promise<OpenClawPluginsListResult> {
  if (!isTauri()) {
    return { plugins: [] };
  }
  const r = await invoke<OpenClawPluginsListResult & { ok?: boolean; error?: string }>(
    "openclaw_plugins_list",
    {
      enabledOnly: options?.enabledOnly ?? false,
    },
  );
  if (r && typeof r === "object" && "ok" in r && r.ok === false) {
    throw new Error(r.error || "OpenClaw plugins list failed");
  }
  return {
    workspaceDir: r?.workspaceDir,
    plugins: Array.isArray(r?.plugins) ? r.plugins : [],
  };
}

export async function openclawPluginsInspect(
  pluginId: string,
): Promise<OpenClawPluginInspectResult> {
  if (!isTauri()) {
    return {};
  }
  const r = await invoke<OpenClawPluginInspectResult & { ok?: boolean; error?: string }>(
    "openclaw_plugins_inspect",
    {
      pluginId,
    },
  );
  if (r && typeof r === "object" && "ok" in r && r.ok === false) {
    throw new Error(r.error || "OpenClaw plugins inspect failed");
  }
  return r ?? {};
}

export async function openclawPluginsSetEnabled(
  pluginId: string,
  enabled: boolean,
): Promise<{ ok: boolean; stdout?: string; stderr?: string }> {
  if (!isTauri()) {
    return { ok: false };
  }
  const r = await invoke<{ ok?: boolean; error?: string; stdout?: string; stderr?: string }>(
    "openclaw_plugins_set_enabled",
    {
      pluginId,
      enabled,
    },
  );
  if (r && typeof r === "object" && r.ok === false) {
    throw new Error(r.error || "OpenClaw plugins set enabled failed");
  }
  return {
    ok: r?.ok === true,
    stdout: r?.stdout,
    stderr: r?.stderr,
  };
}

export async function openclawPluginsUpdate(
  pluginId: string,
): Promise<{ ok: boolean; stdout?: string; stderr?: string }> {
  if (!isTauri()) {
    return { ok: false };
  }
  const r = await invoke<{ ok?: boolean; error?: string; stdout?: string; stderr?: string }>(
    "openclaw_plugins_update",
    {
      pluginId,
    },
  );
  if (r && typeof r === "object" && r.ok === false) {
    throw new Error(r.error || "OpenClaw plugins update failed");
  }
  return {
    ok: r?.ok === true,
    stdout: r?.stdout,
    stderr: r?.stderr,
  };
}

export async function openclawPluginsUninstall(
  pluginId: string,
): Promise<{ ok: boolean; stdout?: string; stderr?: string }> {
  if (!isTauri()) {
    return { ok: false };
  }
  const r = await invoke<{ ok?: boolean; error?: string; stdout?: string; stderr?: string }>(
    "openclaw_plugins_uninstall",
    {
      pluginId,
    },
  );
  if (r && typeof r === "object" && r.ok === false) {
    throw new Error(r.error || "OpenClaw plugins uninstall failed");
  }
  return {
    ok: r?.ok === true,
    stdout: r?.stdout,
    stderr: r?.stderr,
  };
}
