import { GatewayRequestError } from "@/features/gateway/gateway-types";
import {
  extractAgentsListFromConfigGet,
  extractConfigSnapshotHash,
  isGatewayConfigHashStaleError,
  isGatewayConfigPatchRejectedError,
  retryAfterSecondsFromGatewayDetails,
} from "@/lib/openclaw-gateway-config";
import { describe, expect, it } from "vitest";

describe("openclaw-gateway-config", () => {
  it("extractConfigSnapshotHash", () => {
    expect(extractConfigSnapshotHash({ hash: "abc" })).toBe("abc");
    expect(extractConfigSnapshotHash({})).toBeNull();
    expect(extractConfigSnapshotHash(null)).toBeNull();
  });

  it("extractAgentsListFromConfigGet", () => {
    expect(
      extractAgentsListFromConfigGet({
        config: { agents: { list: [{ id: "sales" }] } },
      }),
    ).toEqual([{ id: "sales" }]);
    expect(extractAgentsListFromConfigGet({ config: {} })).toEqual([]);
    expect(extractAgentsListFromConfigGet({ config: { agents: {} } })).toEqual([]);
  });

  it("retryAfterSecondsFromGatewayDetails", () => {
    expect(retryAfterSecondsFromGatewayDetails({ retryAfterMs: 3500 })).toBe(4);
    expect(retryAfterSecondsFromGatewayDetails({})).toBeNull();
  });

  it("isGatewayConfigHashStaleError", () => {
    expect(
      isGatewayConfigHashStaleError(
        new GatewayRequestError({
          code: "INVALID_REQUEST",
          message: "config changed since last load; re-run config.get and retry",
        }),
      ),
    ).toBe(true);
    expect(
      isGatewayConfigHashStaleError(
        new GatewayRequestError({
          code: "INVALID_REQUEST",
          message: "config base hash required; re-run config.get and retry",
        }),
      ),
    ).toBe(true);
    expect(
      isGatewayConfigHashStaleError(
        new GatewayRequestError({ code: "INVALID_REQUEST", message: "invalid config: agents" }),
      ),
    ).toBe(false);
  });

  it("isGatewayConfigPatchRejectedError", () => {
    expect(
      isGatewayConfigPatchRejectedError(
        new GatewayRequestError({
          code: "INVALID_REQUEST",
          message: "invalid config; fix before patching",
        }),
      ),
    ).toBe(true);
    expect(
      isGatewayConfigPatchRejectedError(
        new GatewayRequestError({
          code: "INVALID_REQUEST",
          message: "config changed since last load; re-run config.get and retry",
        }),
      ),
    ).toBe(false);
  });
});
