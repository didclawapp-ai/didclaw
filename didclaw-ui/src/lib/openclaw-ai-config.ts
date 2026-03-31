import { i18n } from "@/i18n";
import { getDidClawDesktopApi, isDidClawDesktop } from "@/lib/electron-bridge";
import { findCatalogEntry, PROVIDER_CATALOG, type ProviderCatalogEntry } from "@/lib/provider-catalog";

export type OpenClawAiSnapshot = {
  defaultAgentId: string;
  providers: Record<string, Record<string, unknown>>;
  model: Record<string, unknown>;
  models: Record<string, Record<string, unknown>>;
  primaryModel: string;
  fallbacks: string[];
  modelRefs: string[];
  /** agents.defaults.imageGenerationModel.primary */
  imageGenerationModel: string;
};

export type OpenClawAliasRow = {
  ref: string;
  alias: string;
};

export type OpenClawProviderEditorState = {
  id: string;
  baseUrl: string;
  apiKey: string;
  modelIds: string[];
  extras: Record<string, unknown>;
};

export type OpenClawProviderAuthState = "configured" | "missing" | "notRequired";

export type OpenClawAiProviderView = {
  id: string;
  displayName: string;
  description: string;
  icon: string;
  color: string;
  docsUrl?: string;
  catalog?: ProviderCatalogEntry;
  source: "recommended" | "detected";
  baseUrl: string;
  baseUrlLabel: string;
  baseUrlAlt?: string;
  baseUrlAltLabel?: string;
  apiKeyRequired: boolean;
  authState: OpenClawProviderAuthState;
  isConfigured: boolean;
  isPrimary: boolean;
  models: string[];
  modelsSource: "configured" | "recommended";
  defaultModel: string;
  extras: Record<string, unknown>;
  raw: Record<string, unknown> | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function providerModelsFromValue(models: unknown): string[] {
  if (Array.isArray(models)) {
    return uniqueSorted(
      models
        .map((item) => {
          if (isRecord(item) && typeof item.id === "string") {
            return item.id;
          }
          return "";
        })
        .filter(Boolean),
    );
  }
  if (isRecord(models)) {
    return uniqueSorted(Object.keys(models));
  }
  return [];
}

export function readProviderBaseUrl(snapshot: Record<string, unknown> | undefined): string {
  const direct = snapshot?.baseUrl;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }
  const legacy = snapshot?.baseURL;
  if (typeof legacy === "string" && legacy.trim()) {
    return legacy.trim();
  }
  return "";
}

export function readProviderApiKey(snapshot: Record<string, unknown> | undefined): string {
  const apiKey = snapshot?.apiKey;
  return typeof apiKey === "string" ? apiKey : "";
}

export function extractProviderExtras(snapshot: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!snapshot) {
    return {};
  }
  const out: Record<string, unknown> = {};
  if (typeof snapshot.api === "string" && snapshot.api.trim()) {
    out.api = snapshot.api.trim();
  }
  if (snapshot.authHeader === true) {
    out.authHeader = true;
  }
  return out;
}

export function determineProviderAuthState(
  providerId: string,
  snapshot: Record<string, unknown> | undefined,
  catalog?: ProviderCatalogEntry,
): OpenClawProviderAuthState {
  if (catalog?.apiKeyRequired === false || providerId === "ollama") {
    return "notRequired";
  }
  return readProviderApiKey(snapshot).trim() ? "configured" : "missing";
}

function friendlyDetectedProviderName(providerId: string): string {
  return providerId
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function normalizeOpenClawAiSnapshot(raw: {
  defaultAgentId?: string;
  providers?: Record<string, unknown>;
  model?: Record<string, unknown>;
  models?: Record<string, unknown>;
  primaryModel?: string;
  fallbacks?: string[];
  modelRefs?: string[];
  imageGenerationModel?: string;
}): OpenClawAiSnapshot {
  const providers: Record<string, Record<string, unknown>> = {};
  for (const [id, value] of Object.entries(raw.providers ?? {})) {
    if (isRecord(value)) {
      providers[id] = { ...value };
    }
  }

  const model = isRecord(raw.model) ? { ...raw.model } : {};
  const models: Record<string, Record<string, unknown>> = {};
  for (const [ref, value] of Object.entries(raw.models ?? {})) {
    models[ref] = isRecord(value) ? { ...value } : {};
  }

  const primaryModel =
    typeof raw.primaryModel === "string" && raw.primaryModel.trim()
      ? raw.primaryModel.trim()
      : typeof model.primary === "string"
        ? model.primary.trim()
        : "";
  const fallbacks = uniqueSorted(Array.isArray(raw.fallbacks) ? raw.fallbacks : []);
  const modelRefs = uniqueSorted([
    ...Object.keys(models),
    ...(Array.isArray(raw.modelRefs) ? raw.modelRefs : []),
    primaryModel,
    ...fallbacks,
  ]);

  // Read imageGenerationModel: try raw field first, then model.imageGenerationModel.primary
  let imageGenerationModel = "";
  if (typeof raw.imageGenerationModel === "string" && raw.imageGenerationModel.trim()) {
    imageGenerationModel = raw.imageGenerationModel.trim();
  } else {
    const imgConfig = model.imageGenerationModel;
    if (isRecord(imgConfig) && typeof imgConfig.primary === "string") {
      imageGenerationModel = imgConfig.primary.trim();
    }
  }

  return {
    defaultAgentId: typeof raw.defaultAgentId === "string" && raw.defaultAgentId.trim()
      ? raw.defaultAgentId.trim()
      : "main",
    providers,
    model,
    models,
    primaryModel,
    fallbacks,
    modelRefs,
    imageGenerationModel,
  };
}

export async function readOpenClawAiSnapshot(): Promise<OpenClawAiSnapshot> {
  if (!isDidClawDesktop()) {
    return normalizeOpenClawAiSnapshot({});
  }
  const api = getDidClawDesktopApi();
  if (!api?.readOpenClawAiSnapshot) {
    return normalizeOpenClawAiSnapshot({});
  }
  const result = await api.readOpenClawAiSnapshot();
  if (!result.ok) {
    throw new Error(result.error || i18n.global.t("openClawAi.readSnapshotFailed"));
  }
  return normalizeOpenClawAiSnapshot(result);
}

export function snapshotToAliasRows(snapshot: OpenClawAiSnapshot): OpenClawAliasRow[] {
  return Object.keys(snapshot.models)
    .sort((a, b) => a.localeCompare(b))
    .map((ref) => {
      const alias = snapshot.models[ref]?.alias;
      return {
        ref,
        alias: typeof alias === "string" ? alias : "",
      };
    });
}

export function buildModelPickerRows(snapshot: OpenClawAiSnapshot): Array<{ value: string; label: string }> {
  const rows = Object.keys(snapshot.models)
    .sort((a, b) => a.localeCompare(b))
    .map((ref) => {
      const alias = snapshot.models[ref]?.alias;
      return {
        value: ref,
        label:
          typeof alias === "string" && alias.trim()
            ? i18n.global.t("openClawAi.modelPickerAlias", { ref, alias: alias.trim() })
            : ref,
      };
    });
  if (snapshot.primaryModel && !rows.some((row) => row.value === snapshot.primaryModel)) {
    rows.push({
      value: snapshot.primaryModel,
      label: i18n.global.t("openClawAi.modelPickerCurrentDefault", { model: snapshot.primaryModel }),
    });
  }
  rows.sort((a, b) => a.value.localeCompare(b.value));
  return rows;
}

export function buildFallbackSuggestions(snapshot: OpenClawAiSnapshot): string[] {
  return uniqueSorted(
    snapshot.modelRefs.filter(
      (ref) => ref !== snapshot.primaryModel && !snapshot.fallbacks.includes(ref),
    ),
  );
}

export function buildProviderEditorState(
  providerId: string,
  snapshot: OpenClawAiSnapshot,
): OpenClawProviderEditorState {
  const raw = snapshot.providers[providerId];
  return {
    id: providerId,
    baseUrl: readProviderBaseUrl(raw),
    apiKey: readProviderApiKey(raw),
    modelIds: providerModelsFromValue(raw?.models),
    extras: extractProviderExtras(raw),
  };
}

export function stripProviderModelRefs(
  snapshot: OpenClawAiSnapshot,
  providerId: string,
): {
  models: Record<string, Record<string, unknown>>;
  primaryModel: string;
  fallbacks: string[];
} {
  const prefix = `${providerId}/`;
  const models: Record<string, Record<string, unknown>> = {};
  for (const [ref, value] of Object.entries(snapshot.models)) {
    if (!ref.startsWith(prefix)) {
      models[ref] = { ...value };
    }
  }
  return {
    models,
    primaryModel: snapshot.primaryModel.startsWith(prefix) ? "" : snapshot.primaryModel,
    fallbacks: snapshot.fallbacks.filter((ref) => !ref.startsWith(prefix)),
  };
}

function buildProviderView(
  providerId: string,
  snapshot: OpenClawAiSnapshot,
): OpenClawAiProviderView {
  const raw = snapshot.providers[providerId];
  const catalog = findCatalogEntry(providerId);
  const detectedModels = uniqueSorted([
    ...providerModelsFromValue(raw?.models),
    ...snapshot.modelRefs
      .filter((ref) => ref.startsWith(`${providerId}/`))
      .map((ref) => ref.slice(providerId.length + 1)),
  ]);
  const recommendedModels = uniqueSorted(catalog?.models ?? []);
  const models = detectedModels.length > 0 ? detectedModels : recommendedModels;
  const authState = determineProviderAuthState(providerId, raw, catalog);
  const defaultModel = catalog?.defaultModel
    || models[0]
    || (snapshot.primaryModel.startsWith(`${providerId}/`) ? snapshot.primaryModel.slice(providerId.length + 1) : "");
  const baseUrl = readProviderBaseUrl(raw) || catalog?.baseUrl || "";
  return {
    id: providerId,
    displayName: catalog?.name || friendlyDetectedProviderName(providerId) || providerId,
    description: catalog?.description || i18n.global.t("openClawAi.detectedFromConfig"),
    icon: catalog?.icon || "AI",
    color: catalog?.color || "#64748b",
    docsUrl: catalog?.docsUrl,
    catalog,
    source: catalog ? "recommended" : "detected",
    baseUrl,
    baseUrlLabel: catalog?.baseUrlLabel || i18n.global.t("openClawAi.baseUrlCurrent"),
    baseUrlAlt: catalog?.baseUrlAlt,
    baseUrlAltLabel: catalog?.baseUrlAltLabel,
    apiKeyRequired: catalog?.apiKeyRequired ?? providerId !== "ollama",
    authState,
    isConfigured: authState !== "missing",
    isPrimary: snapshot.primaryModel.startsWith(`${providerId}/`),
    models,
    modelsSource: detectedModels.length > 0 ? "configured" : "recommended",
    defaultModel,
    extras: raw ? extractProviderExtras(raw) : (catalog?.extras ? { ...catalog.extras } : {}),
    raw: raw ?? null,
  };
}

export function buildAiProviderViews(snapshot: OpenClawAiSnapshot): {
  recommended: OpenClawAiProviderView[];
  detected: OpenClawAiProviderView[];
  all: OpenClawAiProviderView[];
} {
  const recommended = PROVIDER_CATALOG.map((entry) => buildProviderView(entry.id, snapshot));
  const recommendedIds = new Set(PROVIDER_CATALOG.map((entry) => entry.id));
  const detected = Object.keys(snapshot.providers)
    .filter((id) => !recommendedIds.has(id))
    .sort((a, b) => a.localeCompare(b))
    .map((id) => buildProviderView(id, snapshot));
  return {
    recommended,
    detected,
    all: [...recommended, ...detected],
  };
}
