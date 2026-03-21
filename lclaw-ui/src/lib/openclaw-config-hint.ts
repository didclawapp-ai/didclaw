/** 与官方 Configuration「Config hot reload」一致：https://docs.openclaw.ai/gateway/configuration#config-hot-reload */
export const OPENCLAW_HOT_RELOAD_DOC =
  "https://docs.openclaw.ai/gateway/configuration#config-hot-reload";

/** 保存 openclaw.json 后给用户的一次性提示（勿过长） */
export const OPENCLAW_AFTER_WRITE_HINT =
  "已写入配置。官方说明 Gateway 会监视 openclaw.json，agents / models 类变更通常可热更新（默认 hybrid）。若仍不生效：检查 gateway.reload.mode 是否为 off；或执行 openclaw gateway restart。当前会话若曾用 /model 等切换过模型，可能仍与会话绑定，与 primary 不同。";
