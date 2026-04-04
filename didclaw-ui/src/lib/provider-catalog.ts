/**
 * 服务商卡片目录：每个条目对应一张 AI 配置卡片。
 * 模型列表在此维护；点"应用"时自动写入 OpenClaw 配置，无需手动填写。
 */

export type ProviderCatalogEntry = {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** 卡片顶部强调色（hex） */
  color: string;
  /** 默认（国内优先）接口地址 */
  baseUrl: string;
  baseUrlLabel: string;
  /** 备选节点（如国际线路） */
  baseUrlAlt?: string;
  baseUrlAltLabel?: string;
  /** false = Ollama 等无需 Key */
  apiKeyRequired: boolean;
  apiKeyPlaceholder: string;
  /** 预置模型列表（写入 OpenClaw models[id]） */
  models: string[];
  /** 点"应用"时自动设为主力模型 */
  defaultModel: string;
  /** 该服务商支持的图片生成模型列表（写入 agents.defaults.imageGenerationModel.primary） */
  imageModels?: string[];
  /** 点"应用"时自动设为图片生成模型 */
  defaultImageModel?: string;
  /** OpenClaw provider extras：api、authHeader 等 */
  extras: Record<string, unknown>;
  docsUrl?: string;
};

export const PROVIDER_CATALOG: readonly ProviderCatalogEntry[] = [
  // ── 国内优先 ────────────────────────────────────────────────
  {
    id: "zai",
    name: "智谱 AI（GLM）",
    icon: "🧠",
    description: "GLM 系列大模型，国内直连",
    color: "#6366f1",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    baseUrlLabel: "国内节点",
    baseUrlAlt: "https://api.z.ai/api/paas/v4",
    baseUrlAltLabel: "国际节点",
    apiKeyRequired: true,
    apiKeyPlaceholder: "粘贴智谱 API Key",
    models: ["glm-5", "glm-4.7", "glm-4.7-flash", "glm-4.7-flashx"],
    defaultModel: "glm-5",
    extras: { api: "openai-completions" },
    docsUrl: "https://docs.openclaw.ai/zh-CN/providers/glm",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    icon: "🐋",
    description: "DeepSeek-V3 / R2 推理模型",
    color: "#3b82f6",
    baseUrl: "https://api.deepseek.com/v1",
    baseUrlLabel: "官方节点",
    apiKeyRequired: true,
    apiKeyPlaceholder: "粘贴 DeepSeek API Key",
    models: ["deepseek-chat", "deepseek-reasoner"],
    defaultModel: "deepseek-chat",
    extras: { api: "openai-completions" },
    docsUrl: "https://platform.deepseek.com/",
  },
  {
    id: "minimax",
    name: "MiniMax",
    icon: "🟣",
    description: "MiniMax M2.7 旗舰 + 高速版，支持图片生成",
    color: "#8b5cf6",
    baseUrl: "https://api.minimaxi.com/v1",
    baseUrlLabel: "国内节点",
    baseUrlAlt: "https://api.minimax.io/v1",
    baseUrlAltLabel: "国际节点",
    apiKeyRequired: true,
    apiKeyPlaceholder: "粘贴 MiniMax API Key",
    models: ["MiniMax-M2.7", "MiniMax-M2.7-highspeed"],
    defaultModel: "MiniMax-M2.7",
    imageModels: ["minimax/image-01"],
    defaultImageModel: "minimax/image-01",
    extras: { api: "openai-completions" },
    docsUrl: "https://docs.openclaw.ai/zh-CN/providers/minimax",
  },
  {
    id: "moonshot",
    name: "Kimi（Moonshot）",
    icon: "🌙",
    description: "Kimi K2.5 超长上下文 · 支持思考模式",
    color: "#06b6d4",
    baseUrl: "https://api.moonshot.cn/v1",
    baseUrlLabel: "国内节点",
    baseUrlAlt: "https://api.moonshot.ai/v1",
    baseUrlAltLabel: "国际节点",
    apiKeyRequired: true,
    apiKeyPlaceholder: "粘贴 Moonshot API Key（sk-...）",
    models: ["kimi-k2.5", "kimi-k2-turbo-preview", "kimi-k2-thinking", "kimi-k2-thinking-turbo"],
    defaultModel: "kimi-k2.5",
    extras: { api: "openai-completions" },
    docsUrl: "https://docs.openclaw.ai/zh-CN/providers/moonshot",
  },
  {
    id: "qwen",
    name: "通义千问（Qwen）",
    icon: "🟠",
    description: "阿里云百炼 Qwen 系列",
    color: "#f97316",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    baseUrlLabel: "阿里云百炼",
    apiKeyRequired: true,
    apiKeyPlaceholder: "粘贴阿里云 DashScope Key",
    models: ["qwen-max", "qwen-plus", "qwen-turbo", "qwen3-235b-a22b"],
    defaultModel: "qwen-max",
    extras: { api: "openai-completions" },
    docsUrl: "https://docs.openclaw.ai/zh-CN/providers/qwen",
  },
  {
    id: "xiaomi",
    name: "小米 MiMo",
    icon: "📱",
    description: "MiMo V2（OpenAI 兼容 /v1，与 OpenClaw 内置 catalog 一致）",
    color: "#ef4444",
    baseUrl: "https://api.xiaomimimo.com/v1",
    baseUrlLabel: "官方节点",
    apiKeyRequired: true,
    apiKeyPlaceholder: "粘贴小米 MiMo API Key",
    models: ["mimo-v2-flash", "mimo-v2-pro", "mimo-v2-omni"],
    defaultModel: "mimo-v2-flash",
    extras: { api: "openai-completions" },
    docsUrl: "https://docs.openclaw.ai/providers/xiaomi",
  },
  // ── 国际 ────────────────────────────────────────────────────
  {
    id: "google",
    name: "Google Gemini",
    icon: "✨",
    description: "Gemini 3.1 Pro / Flash 多模态旗舰，支持图片生成",
    color: "#4285f4",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    baseUrlLabel: "Google AI Studio",
    apiKeyRequired: true,
    apiKeyPlaceholder: "粘贴 Google AI Studio API Key（AIza...）",
    models: ["gemini-3.1-pro", "gemini-3.1-flash", "gemini-3.1-flash-lite"],
    defaultModel: "gemini-3.1-pro",
    imageModels: ["google/gemini-3-pro-image-preview"],
    defaultImageModel: "google/gemini-3-pro-image-preview",
    extras: { api: "openai-completions" },
    docsUrl: "https://docs.openclaw.ai/zh-CN/providers/google",
  },
  {
    id: "anthropic",
    name: "Anthropic（Claude）",
    icon: "💎",
    description: "Claude Sonnet / Opus 系列",
    color: "#d97706",
    baseUrl: "https://api.anthropic.com",
    baseUrlLabel: "官方 API",
    apiKeyRequired: true,
    apiKeyPlaceholder: "粘贴 Anthropic API Key（sk-ant-...）",
    models: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-6"],
    defaultModel: "claude-sonnet-4-6",
    extras: { api: "anthropic-messages", authHeader: true },
    docsUrl: "https://docs.openclaw.ai/zh-CN/providers/anthropic",
  },
  {
    id: "openai",
    name: "OpenAI",
    icon: "⚡",
    description: "GPT-4o / GPT-5 系列",
    color: "#10b981",
    baseUrl: "https://api.openai.com/v1",
    baseUrlLabel: "官方 API",
    apiKeyRequired: true,
    apiKeyPlaceholder: "粘贴 OpenAI API Key（sk-...）",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-5.1-codex"],
    defaultModel: "gpt-4o",
    extras: { api: "openai-completions" },
    docsUrl: "https://docs.openclaw.ai/zh-CN/providers/openai",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    icon: "🔀",
    description: "统一接入 100+ 模型，含免费额度",
    color: "#0ea5e9",
    baseUrl: "https://openrouter.ai/api/v1",
    baseUrlLabel: "OpenRouter API",
    apiKeyRequired: true,
    apiKeyPlaceholder: "粘贴 OpenRouter API Key（sk-or-...）",
    models: ["auto", "free"],
    defaultModel: "auto",
    extras: { api: "openai-completions" },
    docsUrl: "https://docs.openclaw.ai/zh-CN/providers/openrouter",
  },
  {
    id: "xai",
    name: "xAI（Grok）",
    icon: "𝕏",
    description: "Grok 4 超级智能模型",
    color: "#6b7280",
    baseUrl: "https://api.x.ai/v1",
    baseUrlLabel: "xAI API",
    apiKeyRequired: true,
    apiKeyPlaceholder: "粘贴 xAI API Key",
    models: ["grok-4", "grok-4-mini"],
    defaultModel: "grok-4",
    extras: { api: "openai-completions" },
    docsUrl: "https://docs.openclaw.ai/zh-CN/providers",
  },
  {
    id: "mistral",
    name: "Mistral",
    icon: "🔮",
    description: "Mistral Large 欧洲开放模型",
    color: "#f59e0b",
    baseUrl: "https://api.mistral.ai/v1",
    baseUrlLabel: "官方 API",
    apiKeyRequired: true,
    apiKeyPlaceholder: "粘贴 Mistral API Key",
    models: ["mistral-large-latest", "mistral-small-latest"],
    defaultModel: "mistral-large-latest",
    extras: { api: "openai-completions" },
    docsUrl: "https://docs.openclaw.ai/zh-CN/providers/mistral",
  },
  // ── 本机 ────────────────────────────────────────────────────
  {
    id: "ollama",
    name: "Ollama（本机）",
    icon: "🦙",
    description: "本机运行开源模型，无需 Key",
    color: "#14b8a6",
    baseUrl: "http://127.0.0.1:11434/v1",
    baseUrlLabel: "本机地址",
    apiKeyRequired: false,
    apiKeyPlaceholder: "无需 API Key",
    models: ["llama3.2", "qwen2.5:7b", "gemma3:12b"],
    defaultModel: "llama3.2",
    extras: { api: "openai-completions" },
    docsUrl: "https://docs.openclaw.ai/zh-CN/providers/ollama",
  },
];

/** 通过 id 查找目录条目 */
export function findCatalogEntry(id: string): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.find((e) => e.id === id);
}

// ── 图片生成目录 ─────────────────────────────────────────────

export type ImageGenCatalogEntry = {
  /** 唯一 ID，用于区分多张图片卡 */
  id: string;
  /** 对应聊天 provider 的 id（用于预填 API Key） */
  providerId: string;
  name: string;
  icon: string;
  description: string;
  color: string;
  /** 写入 agents.defaults.imageGenerationModel.primary 的值 */
  modelRef: string;
  /** 用于界面展示的模型简名 */
  modelLabel: string;
  apiKeyPlaceholder: string;
  /** OpenClaw 图片生成插件所需的 env var 名（写入 openclaw.json env 段） */
  envKey: string;
  docsUrl?: string;
};

export const IMAGE_GEN_CATALOG: readonly ImageGenCatalogEntry[] = [
  {
    id: "minimax-image",
    providerId: "minimax",
    name: "MiniMax 图片生成",
    icon: "🎨",
    description: "商业级文生图与图片编辑，支持多种风格与宽高比",
    color: "#8b5cf6",
    modelRef: "minimax/image-01",
    modelLabel: "image-01",
    apiKeyPlaceholder: "粘贴 MiniMax API Key（与对话模型相同）",
    envKey: "MINIMAX_API_KEY",
    docsUrl: "https://docs.openclaw.ai/zh-CN/providers/minimax",
  },
  {
    id: "google-image",
    providerId: "google",
    name: "Google Gemini 图片生成",
    icon: "🖼️",
    description: "Gemini 原生图片生成，精准理解文本意图",
    color: "#4285f4",
    modelRef: "google/gemini-3-pro-image-preview",
    modelLabel: "gemini-3-pro-image-preview",
    apiKeyPlaceholder: "粘贴 Google AI Studio API Key（AIza...）",
    envKey: "GEMINI_API_KEY",
    docsUrl: "https://ai.google.dev/gemini-api/docs/image-generation",
  },
];

/** 通过 id 查找图片生成条目 */
export function findImageGenEntry(id: string): ImageGenCatalogEntry | undefined {
  return IMAGE_GEN_CATALOG.find((e) => e.id === id);
}
