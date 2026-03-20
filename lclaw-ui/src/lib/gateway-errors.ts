import { GatewayRequestError } from "@/features/gateway/gateway-types";

/** 常见网关 JSON-RPC 错误码 → 用户可见说明（可与官方码表对照扩展） */
const CODE_HINTS: Record<string, string> = {
  UNAUTHORIZED: "鉴权失败：请检查环境变量中的 TOKEN 或 PASSWORD 是否与网关一致。",
  FORBIDDEN: "当前身份无权执行该操作。",
  NOT_FOUND: "资源不存在（会话或任务可能已过期）。",
  UNAVAILABLE: "网关暂不可用或请求超时，请稍后重试。",
  INVALID_ARGUMENT: "请求参数无效。",
  FAILED_PRECONDITION: "前置条件不满足（例如会话状态不允许该操作）。",
  ALREADY_EXISTS: "资源已存在。",
  ABORTED: "操作已中止。",
  DEADLINE_EXCEEDED: "请求超时。",
};

/**
 * 将网关请求错误、一般 Error 或未知值整理为适合直接展示的中文优先文案。
 */
export function describeGatewayError(err: unknown): string {
  if (err instanceof GatewayRequestError) {
    const code = err.gatewayCode.toUpperCase();
    const hint = CODE_HINTS[code];
    const base = err.message.trim() || code;
    return hint ? `${hint}（${base}）` : base;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
