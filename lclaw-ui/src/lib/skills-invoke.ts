import { invoke, isTauri } from "@tauri-apps/api/core";

const LS_INSTALL_ROOT = "didclaw.skillsInstallRoot";

export type InstalledSkillRow = {
  slug: string;
  path: string;
  source: string;
  registry?: string | null;
  installedVersion?: string | null;
};

export function getStoredSkillsInstallRoot(): string | null {
  try {
    return localStorage.getItem(LS_INSTALL_ROOT);
  } catch {
    return null;
  }
}

export function setStoredSkillsInstallRoot(path: string): void {
  try {
    localStorage.setItem(LS_INSTALL_ROOT, path);
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
