/**
 * OpenClaw primary model (`agents.defaults.model.primary`) uses the gateway streaming chat path
 * (Chat Completions + SSE). Some vendor models only support non-streaming APIs (e.g. Zhipu image),
 * and must not be used as primary or the gateway may return 400.
 */

import { i18n } from "@/i18n";

/** modelId part of `provider/modelId` (after last `/`, or whole ref lowercased) */
function modelIdFromPrimaryRef(primaryRef: string): string {
  const lower = primaryRef.trim().toLowerCase();
  if (!lower) {
    return "";
  }
  const i = lower.lastIndexOf("/");
  return i >= 0 ? lower.slice(i + 1) : lower;
}

/**
 * If this primary ref cannot be used as OpenClaw chat primary model, returns user-facing text; else `null`.
 */
export function describeOpenClawPrimaryModelIncompatibility(
  primaryRef: string,
): string | null {
  const id = modelIdFromPrimaryRef(primaryRef);
  if (id === "glm-image") {
    return i18n.global.t("openClawModel.glmImagePrimaryIncompatible");
  }
  return null;
}
