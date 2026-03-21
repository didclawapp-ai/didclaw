/**
 * 聊天消息在 UI 层的类型：网关结构开放（passthrough），乐观 user 为本地构造的窄类型。
 */

export const CHAT_OPTIMISTIC_KEY = "_lclawOptimistic" as const;

export type OptimisticUserMessage = {
  role: "user";
  text: string;
  [CHAT_OPTIMISTIC_KEY]: string;
};

/** 单条历史/下行消息：网关可增字段，仅保证可按 Record 访问 */
export type GatewayChatMessage = Record<string, unknown>;

export type UiChatMessage = GatewayChatMessage | OptimisticUserMessage;

export function isOptimisticUserMessage(m: UiChatMessage): m is OptimisticUserMessage {
  return (
    typeof m === "object" &&
    m !== null &&
    CHAT_OPTIMISTIC_KEY in m &&
    typeof (m as Record<string, unknown>)[CHAT_OPTIMISTIC_KEY] === "string"
  );
}
