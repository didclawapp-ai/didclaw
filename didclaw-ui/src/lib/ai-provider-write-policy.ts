import type { OpenClawAiSnapshot } from "@/lib/openclaw-ai-config";

/** Existing apiKey string from snapshot (may be masked with ****). */
export function getExistingProviderApiKey(
  snapshot: OpenClawAiSnapshot,
  providerId: string,
): string {
  const raw = snapshot.providers[providerId] as Record<string, unknown> | undefined;
  return typeof raw?.apiKey === "string" ? raw.apiKey.trim() : "";
}

/**
 * Whether to include `apiKey` in a provider patch. Avoids overwriting keys that are
 * already configured unless the user supplied a new real key (different from stored).
 */
export function shouldPatchProviderApiKey(
  snapshot: OpenClawAiSnapshot,
  providerId: string,
  keyTrimmed: string,
): boolean {
  if (!keyTrimmed || keyTrimmed.endsWith("****")) {
    return false;
  }
  const ex = getExistingProviderApiKey(snapshot, providerId);
  if (!ex) {
    return true;
  }
  if (ex.endsWith("****")) {
    return true;
  }
  return keyTrimmed !== ex;
}

/**
 * Whether DidClaw may write an env var into `openclaw.json` → `env.vars`.
 * If the key already has a non-empty value (e.g. set by CLI or hand-edited), we skip
 * writes so existing OpenClaw setups are not overwritten.
 */
export function shouldWriteEnvVar(
  snapshot: OpenClawAiSnapshot,
  envKey: string,
  value: string,
): boolean {
  if (!value?.trim()) {
    return false;
  }
  const cur = snapshot.envVars[envKey]?.trim() ?? "";
  return !cur;
}
