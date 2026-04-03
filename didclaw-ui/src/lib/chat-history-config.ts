/**
 * 单次 `chat.history` 请求的 `limit`。OpenClaw 网关对 transcript 做尾部截取（`slice(-limit)`），
 * 无游标分页前，提高该值可减轻长会话「只看到最近 200 条」的限制；若上游收紧上限会自动截断。
 */
export const CHAT_HISTORY_LIMIT = 500;
