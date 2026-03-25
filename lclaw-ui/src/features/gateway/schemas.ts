import { z } from "zod";

/** Minimal validation for `connect` success payload（网关可增字段，故 passthrough）。 */
export const gatewayHelloOkSchema = z
  .object({
    type: z.literal("hello-ok").optional(),
    protocol: z.number().optional(),
    server: z
      .object({
        version: z.string().optional(),
        connId: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

export const sessionRowSchema = z
  .object({
    key: z.string(),
    label: z.string().optional(),
    lastActiveAt: z.number().optional(),
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    totalTokens: z.number().optional(),
  })
  .passthrough();

/** `sessions.list` 响应体 */
export const sessionsListResponseSchema = z
  .object({
    sessions: z.array(sessionRowSchema).optional(),
  })
  .passthrough();

/** `chat.history` 响应体 */
export const chatHistoryResponseSchema = z
  .object({
    messages: z.array(z.unknown()).optional(),
  })
  .passthrough();

/** 下行 `chat` 事件载荷（用于 UI 与流式展示） */
export const chatEventPayloadSchema = z
  .object({
    sessionKey: z.string(),
    state: z.enum(["delta", "final", "aborted", "error"]),
    runId: z.string().optional(),
    message: z.unknown().optional(),
    errorMessage: z.string().optional(),
  })
  .passthrough();

export type ChatEventPayloadValidated = z.infer<typeof chatEventPayloadSchema>;

/** 下行事件帧（`type: "event"`）结构校验；payload 保持 unknown 由上层按事件名解析 */
export const gatewayEventFrameSchema = z
  .object({
    type: z.literal("event"),
    event: z.string(),
    seq: z.number().optional(),
    payload: z.unknown().optional(),
  })
  .passthrough();

/** 下行响应帧（`type: "res"`）结构校验 */
export const gatewayResponseFrameSchema = z
  .object({
    type: z.literal("res"),
    id: z.string(),
    ok: z.boolean(),
    payload: z.unknown().optional(),
    error: z
      .object({
        code: z.string().optional(),
        message: z.string().optional(),
        details: z.unknown().optional(),
      })
      .optional(),
  })
  .passthrough();
