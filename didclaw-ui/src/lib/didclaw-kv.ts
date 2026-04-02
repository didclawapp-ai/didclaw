/**
 * DidClaw 用户 KV：桌面端存 SQLite，浏览器仍用 localStorage。
 * 键名须与 `src-tauri/src/didclaw_db.rs` 中 `ALLOWED_USER_KV_KEYS` 一致。
 */
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import { isDidClawDesktop } from "@/lib/desktop-api";

export const DIDCLAW_KV_KEYS = [
  "didclaw-device-identity-v1",
  "didclaw_first_run_model_complete",
  "didclaw_model_config_deferred",
  "didclaw_model_wizard_snooze_until",
  "didclaw_setup_wizard_snooze_until",
  "didclaw.skillsInstallRoot",
  "didclaw.clawhubToken",
  "didclaw.clawhubRegistry",
  "didclaw.openclawUpdate.dismissedLatest",
  "didclaw.openclawUpdate.firstSeen",
  "didclaw.appUpdate.dismissedVersion",
] as const;

export type DidclawKvKey = (typeof DIDCLAW_KV_KEYS)[number];

/** 桌面：`key -> value | null`；浏览器：不填充（读时走 localStorage） */
const cache = new Map<string, string | null>();

let hydrated = false;

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * 在 `app.mount` 之前调用：从 DB 拉取白名单键填入内存缓存。
 */
export async function hydrateDidClawKvCache(): Promise<void> {
  if (!isDidClawDesktop()) {
    hydrated = true;
    return;
  }
  const api = getDidClawDesktopApi();
  if (!api?.didclawKvGet) {
    hydrated = true;
    return;
  }
  for (const key of DIDCLAW_KV_KEYS) {
    let v: string | null = null;
    try {
      const got = await api.didclawKvGet(key);
      v = got === undefined || got === null ? null : got;
    } catch {
      v = null;
    }
    cache.set(key, v);
  }
  hydrated = true;
}

function desktopRead(key: string): string | null {
  if (!hydrated) {
    return lsGet(key);
  }
  return cache.get(key) ?? null;
}

function desktopWrite(key: string, value: string | null): void {
  const api = getDidClawDesktopApi();
  if (!api?.didclawKvSet || !api?.didclawKvRemove) {
    return;
  }
  cache.set(key, value);
  if (value === null) {
    void api.didclawKvRemove(key);
  } else {
    void api.didclawKvSet(key, value);
  }
}

/** 同步读（桌面依赖 `hydrateDidClawKvCache` 已执行） */
export function didclawKvReadSync(key: DidclawKvKey | string): string | null {
  if (isDidClawDesktop() && getDidClawDesktopApi()?.didclawKvGet) {
    return desktopRead(key);
  }
  return lsGet(key);
}

/** 同步发起持久化（桌面为异步 IPC，仅更新内存缓存保证 UI 一致） */
export function didclawKvWriteSync(key: DidclawKvKey | string, value: string | null): void {
  if (isDidClawDesktop() && getDidClawDesktopApi()?.didclawKvSet) {
    desktopWrite(key, value);
    return;
  }
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    /* ignore */
  }
}

/** 不依赖 hydrate：直接读 DB（桌面）或 localStorage（浏览器） */
export async function didclawKvGetDirect(key: DidclawKvKey | string): Promise<string | null> {
  const api = getDidClawDesktopApi();
  if (!api?.didclawKvGet) {
    return lsGet(key);
  }
  try {
    let v = await api.didclawKvGet(key);
    if (v === undefined) {
      v = null;
    }
    if (hydrated) {
      cache.set(key, v);
    }
    return v;
  } catch {
    return lsGet(key);
  }
}

export async function didclawKvSetDirect(key: DidclawKvKey | string, value: string): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.didclawKvSet) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
    return;
  }
  await api.didclawKvSet(key, value);
  if (hydrated) {
    cache.set(key, value);
  }
}

export async function didclawKvRemoveDirect(key: DidclawKvKey | string): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.didclawKvRemove) {
    lsRemove(key);
    return;
  }
  await api.didclawKvRemove(key);
  if (hydrated) {
    cache.set(key, null);
  }
}
