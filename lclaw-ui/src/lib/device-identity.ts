import { getPublicKeyAsync, signAsync, utils } from "@noble/ed25519";

import { getDidClawDesktopApi } from "@/lib/electron-bridge";

import { didclawKvGetDirect, didclawKvSetDirect } from "./didclaw-kv";
import { getSafeLocalStorage } from "./local-storage";

type StoredIdentity = {
  version: 1;
  deviceId: string;
  publicKey: string;
  privateKey: string;
  createdAtMs: number;
  /** OpenClaw 网关颁发的设备令牌，用于自动重连 */
  deviceToken?: string;
};

export type DeviceIdentity = {
  deviceId: string;
  publicKey: string;
  privateKey: string;
  /** OpenClaw 网关颁发的设备令牌 */
  deviceToken?: string;
};

const STORAGE_KEY = "didclaw-device-identity-v1";

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlDecode(input: string): Uint8Array {
  const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function fingerprintPublicKey(publicKey: Uint8Array): Promise<string> {
  const buf = publicKey.buffer.slice(
    publicKey.byteOffset,
    publicKey.byteOffset + publicKey.byteLength,
  ) as ArrayBuffer;
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return bytesToHex(new Uint8Array(hash));
}

async function generateIdentity(): Promise<DeviceIdentity> {
  const privateKey = utils.randomPrivateKey();
  const publicKey = await getPublicKeyAsync(privateKey);
  const deviceId = await fingerprintPublicKey(publicKey);
  return {
    deviceId,
    publicKey: base64UrlEncode(publicKey),
    privateKey: base64UrlEncode(privateKey),
    // 新生成的身份没有 deviceToken，需要配对后获取
  };
}

async function persistIdentity(stored: StoredIdentity): Promise<void> {
  const body = JSON.stringify(stored);
  const api = getDidClawDesktopApi();
  if (api?.didclawKvSet) {
    await didclawKvSetDirect(STORAGE_KEY, body);
    return;
  }
  getSafeLocalStorage()?.setItem(STORAGE_KEY, body);
}

export async function loadOrCreateDeviceIdentity(): Promise<DeviceIdentity> {
  const storage = getSafeLocalStorage();
  let raw: string | null = null;
  try {
    if (getDidClawDesktopApi()?.didclawKvGet) {
      raw = await didclawKvGetDirect(STORAGE_KEY);
    } else {
      raw = storage?.getItem(STORAGE_KEY) ?? null;
    }
    if (raw) {
      const parsed = JSON.parse(raw) as StoredIdentity;
      if (
        parsed?.version === 1 &&
        typeof parsed.deviceId === "string" &&
        typeof parsed.publicKey === "string" &&
        typeof parsed.privateKey === "string"
      ) {
        const derivedId = await fingerprintPublicKey(base64UrlDecode(parsed.publicKey));
        if (derivedId !== parsed.deviceId) {
          const updated: StoredIdentity = { ...parsed, deviceId: derivedId };
          await persistIdentity(updated);
          return {
            deviceId: derivedId,
            publicKey: parsed.publicKey,
            privateKey: parsed.privateKey,
            deviceToken: parsed.deviceToken,
          };
        }
        return {
          deviceId: parsed.deviceId,
          publicKey: parsed.publicKey,
          privateKey: parsed.privateKey,
          deviceToken: parsed.deviceToken,
        };
      }
    }
  } catch {
    // regenerate
  }

  const identity = await generateIdentity();
  const stored: StoredIdentity = {
    version: 1,
    deviceId: identity.deviceId,
    publicKey: identity.publicKey,
    privateKey: identity.privateKey,
    createdAtMs: Date.now(),
  };
  await persistIdentity(stored);
  return identity;
}

/**
 * 保存网关颁发的 deviceToken 到设备身份存储
 */
export async function saveDeviceToken(deviceToken: string): Promise<void> {
  const storage = getSafeLocalStorage();
  let raw: string | null = null;
  try {
    if (getDidClawDesktopApi()?.didclawKvGet) {
      raw = await didclawKvGetDirect(STORAGE_KEY);
    } else {
      raw = storage?.getItem(STORAGE_KEY) ?? null;
    }
    if (raw) {
      const parsed = JSON.parse(raw) as StoredIdentity;
      if (parsed?.version === 1) {
        const updated: StoredIdentity = { ...parsed, deviceToken };
        await persistIdentity(updated);
        return;
      }
    }
  } catch {
    // ignore
  }
  // 如果没有现有身份，无法保存 token（这种情况不应该发生）
  console.warn("[didclaw] saveDeviceToken: no existing identity found");
}

/**
 * 清除保存的 deviceToken（例如在令牌失效或用户登出时）
 */
export async function clearDeviceToken(): Promise<void> {
  const storage = getSafeLocalStorage();
  let raw: string | null = null;
  try {
    if (getDidClawDesktopApi()?.didclawKvGet) {
      raw = await didclawKvGetDirect(STORAGE_KEY);
    } else {
      raw = storage?.getItem(STORAGE_KEY) ?? null;
    }
    if (raw) {
      const parsed = JSON.parse(raw) as StoredIdentity;
      if (parsed?.version === 1) {
        const { deviceToken: _, ...rest } = parsed;
        await persistIdentity(rest as StoredIdentity);
        return;
      }
    }
  } catch {
    // ignore
  }
}

export async function signDevicePayload(privateKeyBase64Url: string, payload: string): Promise<string> {
  const key = base64UrlDecode(privateKeyBase64Url);
  const data = new TextEncoder().encode(payload);
  const sig = await signAsync(data, key);
  return base64UrlEncode(sig);
}
