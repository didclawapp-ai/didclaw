import { i18n } from "@/i18n";

/** Doc URL aligned with official Configuration "Config hot reload". */
export const OPENCLAW_HOT_RELOAD_DOC =
  "https://docs.openclaw.ai/gateway/configuration#config-hot-reload";

/** Toast text after saving local model-related config (short, minimal jargon). */
export function getOpenClawAfterWriteHint(): string {
  return i18n.global.t("openClawConfig.afterWriteHint");
}
