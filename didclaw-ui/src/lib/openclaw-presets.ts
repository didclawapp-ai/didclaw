import { findCatalogEntry } from "@/lib/provider-catalog";

export type ProviderPresetBucket = "cn" | "intl";

export type ProviderSetupPreset = {
  id: string;
  label: string;
  /** 分组：国内 / 国外或国际节点 */
  bucket: ProviderPresetBucket;
  /** 接口网址 */
  baseUrl: string;
  /** 每行一个模型 ID（不要带 /） */
  modelIds: string[];
  /** 写入 provider 的额外字段，如 api、authHeader */
  extras: Record<string, unknown>;
};

function requireCatalogEntry(id: string) {
  const entry = findCatalogEntry(id);
  if (!entry) {
    throw new Error(`Missing provider catalog entry: ${id}`);
  }
  return entry;
}

const minimax = requireCatalogEntry("minimax");
const moonshot = requireCatalogEntry("moonshot");
const zai = requireCatalogEntry("zai");
const xiaomi = requireCatalogEntry("xiaomi");
const deepseek = requireCatalogEntry("deepseek");
const openai = requireCatalogEntry("openai");
const anthropic = requireCatalogEntry("anthropic");
const openrouter = requireCatalogEntry("openrouter");
const mistral = requireCatalogEntry("mistral");
const xai = requireCatalogEntry("xai");
const ollama = requireCatalogEntry("ollama");

export const PROVIDER_SETUP_PRESETS: readonly ProviderSetupPreset[] = [
  {
    id: "minimax",
    label: "MiniMax（国内）",
    bucket: "cn",
    baseUrl: minimax.baseUrl,
    modelIds: minimax.models.filter((id) => id !== "MiniMax-M2.5-highspeed"),
    extras: { ...minimax.extras },
  },
  {
    id: "minimax",
    label: "MiniMax（国际·OpenClaw 默认）",
    bucket: "intl",
    baseUrl: minimax.baseUrlAlt ?? minimax.baseUrl,
    modelIds: [...minimax.models],
    extras: { ...minimax.extras },
  },
  {
    id: "moonshot",
    label: "Kimi（国内）",
    bucket: "cn",
    baseUrl: moonshot.baseUrl,
    modelIds: [moonshot.defaultModel],
    extras: { ...moonshot.extras },
  },
  {
    id: "moonshot",
    label: "Kimi（国际·OpenClaw 默认）",
    bucket: "intl",
    baseUrl: moonshot.baseUrlAlt ?? moonshot.baseUrl,
    modelIds: [moonshot.defaultModel],
    extras: { ...moonshot.extras },
  },
  {
    id: "zai",
    label: "智谱 GLM（国内）",
    bucket: "cn",
    baseUrl: zai.baseUrl,
    modelIds: [...zai.models],
    extras: { ...zai.extras },
  },
  {
    id: "zai",
    label: "智谱 GLM（国际·OpenClaw 默认）",
    bucket: "intl",
    baseUrl: zai.baseUrlAlt ?? zai.baseUrl,
    modelIds: [...zai.models],
    extras: { ...zai.extras },
  },
  {
    id: "xiaomi",
    label: "小米 MiMo",
    bucket: "cn",
    baseUrl: xiaomi.baseUrl,
    modelIds: [...xiaomi.models],
    extras: { ...xiaomi.extras },
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    bucket: "cn",
    baseUrl: deepseek.baseUrl,
    modelIds: [...deepseek.models],
    extras: { ...deepseek.extras },
  },
  {
    id: "openai",
    label: "OpenAI",
    bucket: "intl",
    baseUrl: openai.baseUrl,
    modelIds: [...openai.models],
    extras: { ...openai.extras },
  },
  {
    id: "anthropic",
    label: "Anthropic（Claude）",
    bucket: "intl",
    baseUrl: anthropic.baseUrl,
    modelIds: [...anthropic.models],
    extras: { ...anthropic.extras },
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    bucket: "intl",
    baseUrl: openrouter.baseUrl,
    modelIds: [...openrouter.models],
    extras: { ...openrouter.extras },
  },
  {
    id: "mistral",
    label: "Mistral",
    bucket: "intl",
    baseUrl: mistral.baseUrl,
    modelIds: [...mistral.models],
    extras: { ...mistral.extras },
  },
  {
    id: "xai",
    label: "xAI（Grok）",
    bucket: "intl",
    baseUrl: xai.baseUrl,
    modelIds: [...xai.models],
    extras: { ...xai.extras },
  },
] as const;

export type PrimaryModelQuickPick = {
  label: string;
  ref: string;
  bucket: ProviderPresetBucket;
};

/** ③ 选模型：与 OpenClaw 默认 ref 对齐 */
export const PRIMARY_MODEL_QUICK_PICKS: readonly PrimaryModelQuickPick[] = [
  { label: "Ollama · llama3.2（本机）", ref: `ollama/${ollama.models[0]}`, bucket: "cn" },
  { label: "Ollama · qwen2.5:7b（本机）", ref: "ollama/qwen2.5:7b", bucket: "cn" },
  { label: "MiniMax M2.7", ref: "minimax/MiniMax-M2.7", bucket: "cn" },
  { label: "MiniMax M2.5", ref: "minimax/MiniMax-M2.5", bucket: "cn" },
  { label: "Kimi K2.5", ref: `moonshot/${moonshot.defaultModel}`, bucket: "cn" },
  { label: "智谱 GLM-5", ref: `zai/${zai.models[0]}`, bucket: "cn" },
  { label: "智谱 GLM-4.7", ref: "zai/glm-4.7", bucket: "cn" },
  { label: "小米 MiMo Flash", ref: "xiaomi/mimo-v2-flash", bucket: "cn" },
  { label: "DeepSeek Chat", ref: `deepseek/${deepseek.models[0]}`, bucket: "cn" },
  { label: "DeepSeek Reasoner", ref: "deepseek/deepseek-reasoner", bucket: "cn" },
  { label: "OpenAI GPT-5.1 Codex", ref: "openai/gpt-5.1-codex", bucket: "intl" },
  { label: "OpenAI GPT-4o", ref: `openai/${openai.defaultModel}`, bucket: "intl" },
  { label: "Claude Sonnet 4.6", ref: `anthropic/${anthropic.defaultModel}`, bucket: "intl" },
  { label: "OpenRouter Auto", ref: `openrouter/${openrouter.defaultModel}`, bucket: "intl" },
  { label: "Mistral Large", ref: `mistral/${mistral.defaultModel}`, bucket: "intl" },
  { label: "Grok 4", ref: `xai/${xai.defaultModel}`, bucket: "intl" },
] as const;
