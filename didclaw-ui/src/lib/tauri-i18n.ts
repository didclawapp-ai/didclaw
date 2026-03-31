import { i18n } from "@/i18n";

/** Maps `KV_KEY_TOO_LONG` → `tauriErr.kvKeyTooLong` */
function tauriErrConstToI18nKey(code: string): string {
  const parts = code.toLowerCase().split("_");
  const camel = parts
    .map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("");
  return `tauriErr.${camel}`;
}

const KNOWN_INVOKE_CODES = new Set([
  "KV_KEY_TOO_LONG",
  "KV_KEY_NOT_ALLOWED",
  "KV_VALUE_TOO_LARGE",
]);

/**
 * Translates stable `invoke` `Err` messages (e.g. from didclaw KV validation).
 */
export function translateTauriInvokeMessage(message: string): string {
  const trimmed = message.trim();
  if (KNOWN_INVOKE_CODES.has(trimmed)) {
    const key = tauriErrConstToI18nKey(trimmed);
    if (i18n.global.te(key)) {
      return String(i18n.global.t(key));
    }
  }
  return message;
}

function extractInvokeErrorMessage(err: unknown): string {
  if (typeof err === "string") {
    return err;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

export function translateTauriInvokeError(err: unknown): string {
  return translateTauriInvokeMessage(extractInvokeErrorMessage(err));
}

type ShellLikeResult = {
  ok?: boolean;
  error?: string;
  errorKey?: string;
  detail?: string;
};

/**
 * JSON results from shell/dialog commands with optional `errorKey` for vue-i18n.
 */
export function translateTauriShellResult(r: ShellLikeResult): string {
  if (r.errorKey && typeof r.errorKey === "string") {
    const key = `tauriErr.${r.errorKey}`;
    if (i18n.global.te(key)) {
      const params =
        r.detail != null && String(r.detail).length > 0 ? { detail: r.detail } : {};
      return String(i18n.global.t(key, params as Record<string, unknown>));
    }
  }
  return r.error ?? "";
}
