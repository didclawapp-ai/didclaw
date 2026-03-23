/**
 * 小白向：预置常见 AI 服务的接口地址与模型名（不含密钥）。
 * 国内 / 国际节点与默认模型 ID 对齐 OpenClaw 源码（onboard-auth.models、auth-choice 等）。
 * @see OpenClaw: provider-auth-helpers / minimax-portal-auth / auth-choice.preferred-provider
 */
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

/** OpenClaw: MINIMAX_CN_API_BASE_URL / MINIMAX_API_BASE_URL + MINIMAX_MODEL_CATALOG */
const MINIMAX_INTL_MODELS = ["MiniMax-M2.5", "MiniMax-M2.5-highspeed", "MiniMax-M2.7"] as const;

export const PROVIDER_SETUP_PRESETS: readonly ProviderSetupPreset[] = [
  {
    id: "minimax",
    label: "MiniMax（国内）",
    bucket: "cn",
    baseUrl: "https://api.minimaxi.com/anthropic",
    modelIds: ["MiniMax-M2.7", "MiniMax-M2.5"],
    extras: { api: "anthropic-messages", authHeader: true },
  },
  {
    id: "minimax",
    label: "MiniMax（国际·OpenClaw 默认）",
    bucket: "intl",
    baseUrl: "https://api.minimax.io/anthropic",
    modelIds: [...MINIMAX_INTL_MODELS],
    extras: { api: "anthropic-messages", authHeader: true },
  },
  {
    id: "moonshot",
    label: "Kimi（国内）",
    bucket: "cn",
    baseUrl: "https://api.moonshot.cn/v1",
    modelIds: ["kimi-k2.5"],
    extras: { api: "openai-completions" },
  },
  {
    id: "moonshot",
    label: "Kimi（国际·OpenClaw 默认）",
    bucket: "intl",
    baseUrl: "https://api.moonshot.ai/v1",
    modelIds: ["kimi-k2.5"],
    extras: { api: "openai-completions" },
  },
  {
    id: "zai",
    label: "智谱 GLM（国内）",
    bucket: "cn",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    /** 不含 glm-image：生图为 /images/generations，不能作 OpenClaw 流式对话主模型 */
    modelIds: ["glm-5", "glm-4.7", "glm-4.7-flash", "glm-4.7-flashx"],
    extras: { api: "openai-completions" },
  },
  {
    id: "zai",
    label: "智谱 GLM（国际·OpenClaw 默认）",
    bucket: "intl",
    baseUrl: "https://api.z.ai/api/paas/v4",
    /** 同上，不设 glm-image 为对话主模型 */
    modelIds: ["glm-5", "glm-4.7", "glm-4.7-flash", "glm-4.7-flashx"],
    extras: { api: "openai-completions" },
  },
  {
    id: "xiaomi",
    label: "小米 MiMo",
    bucket: "cn",
    baseUrl: "https://api.xiaomimimo.com/anthropic",
    modelIds: ["mimo-v2-flash", "mimo-v2-pro"],
    extras: { api: "anthropic-messages", authHeader: true },
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    bucket: "cn",
    baseUrl: "https://api.deepseek.com/v1",
    modelIds: ["deepseek-chat", "deepseek-reasoner"],
    extras: { api: "openai-completions" },
  },
  {
    id: "openai",
    label: "OpenAI",
    bucket: "intl",
    baseUrl: "https://api.openai.com/v1",
    modelIds: ["gpt-5.1-codex", "gpt-4o"],
    extras: { api: "openai-completions" },
  },
  {
    id: "anthropic",
    label: "Anthropic（Claude）",
    bucket: "intl",
    baseUrl: "https://api.anthropic.com",
    modelIds: ["claude-sonnet-4-6"],
    extras: { api: "anthropic-messages", authHeader: true },
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    bucket: "intl",
    baseUrl: "https://openrouter.ai/api/v1",
    modelIds: ["auto"],
    extras: { api: "openai-completions" },
  },
  {
    id: "mistral",
    label: "Mistral",
    bucket: "intl",
    baseUrl: "https://api.mistral.ai/v1",
    modelIds: ["mistral-large-latest"],
    extras: { api: "openai-completions" },
  },
  {
    id: "xai",
    label: "xAI（Grok）",
    bucket: "intl",
    baseUrl: "https://api.x.ai/v1",
    modelIds: ["grok-4"],
    extras: { api: "openai-completions" },
  },
] as const;

export type PrimaryModelQuickPick = {
  label: string;
  ref: string;
  bucket: ProviderPresetBucket;
};

/** ③ 选模型：与 OpenClaw 默认 ref 对齐 */
export const PRIMARY_MODEL_QUICK_PICKS: readonly PrimaryModelQuickPick[] = [
  { label: "Ollama · llama3.2（本机）", ref: "ollama/llama3.2", bucket: "cn" },
  { label: "Ollama · qwen2.5:7b（本机）", ref: "ollama/qwen2.5:7b", bucket: "cn" },
  { label: "MiniMax M2.7", ref: "minimax/MiniMax-M2.7", bucket: "cn" },
  { label: "MiniMax M2.5", ref: "minimax/MiniMax-M2.5", bucket: "cn" },
  { label: "Kimi K2.5", ref: "moonshot/kimi-k2.5", bucket: "cn" },
  { label: "智谱 GLM-5", ref: "zai/glm-5", bucket: "cn" },
  { label: "智谱 GLM-4.7", ref: "zai/glm-4.7", bucket: "cn" },
  { label: "小米 MiMo Flash", ref: "xiaomi/mimo-v2-flash", bucket: "cn" },
  { label: "DeepSeek Chat", ref: "deepseek/deepseek-chat", bucket: "cn" },
  { label: "DeepSeek Reasoner", ref: "deepseek/deepseek-reasoner", bucket: "cn" },
  { label: "OpenAI GPT-5.1 Codex", ref: "openai/gpt-5.1-codex", bucket: "intl" },
  { label: "OpenAI GPT-4o", ref: "openai/gpt-4o", bucket: "intl" },
  { label: "Claude Sonnet 4.6", ref: "anthropic/claude-sonnet-4-6", bucket: "intl" },
  { label: "OpenRouter Auto", ref: "openrouter/auto", bucket: "intl" },
  { label: "Mistral Large", ref: "mistral/mistral-large-latest", bucket: "intl" },
  { label: "Grok 4", ref: "xai/grok-4", bucket: "intl" },
] as const;
