import { GatewayRequestError } from "@/features/gateway/gateway-types";
import { i18n } from "@/i18n";

/** Maps common gateway JSON-RPC error codes to i18n keys (extend alongside upstream code tables) */
const CODE_TO_I18N_KEY: Record<string, string> = {
  UNAUTHORIZED: "gatewayErr.unauthorized",
  FORBIDDEN: "gatewayErr.forbidden",
  NOT_FOUND: "gatewayErr.notFound",
  UNAVAILABLE: "gatewayErr.unavailable",
  INVALID_ARGUMENT: "gatewayErr.invalidArgument",
  FAILED_PRECONDITION: "gatewayErr.failedPrecondition",
  ALREADY_EXISTS: "gatewayErr.alreadyExists",
  ABORTED: "gatewayErr.aborted",
  DEADLINE_EXCEEDED: "gatewayErr.deadlineExceeded",
};

/**
 * Turn a gateway request error, generic Error, or unknown value into user-facing text for the current locale.
 */
export function describeGatewayError(err: unknown): string {
  if (err instanceof GatewayRequestError) {
    const code = err.gatewayCode.toUpperCase();
    const key = CODE_TO_I18N_KEY[code];
    const hint = key ? i18n.global.t(key) : undefined;
    const base = err.message.trim() || code;
    return hint ? i18n.global.t("gatewayErr.withDetail", { hint, detail: base }) : base;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
