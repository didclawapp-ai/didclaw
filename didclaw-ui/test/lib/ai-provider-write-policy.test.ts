import { describe, expect, it } from "vitest";
import type { OpenClawAiSnapshot } from "@/lib/openclaw-ai-config";
import {
  shouldPatchProviderApiKey,
  shouldWriteEnvVar,
} from "@/lib/ai-provider-write-policy";

function snap(partial: Partial<OpenClawAiSnapshot>): OpenClawAiSnapshot {
  return {
    defaultAgentId: "main",
    providers: partial.providers ?? {},
    model: {},
    models: {},
    primaryModel: "",
    fallbacks: [],
    modelRefs: [],
    imageGenerationModel: "",
    envVars: partial.envVars ?? {},
  };
}

describe("shouldWriteEnvVar", () => {
  it("allows write when env key is empty", () => {
    expect(shouldWriteEnvVar(snap({ envVars: {} }), "ZHIPU_API_KEY", "k")).toBe(true);
  });

  it("blocks write when env key already has a value", () => {
    expect(
      shouldWriteEnvVar(snap({ envVars: { ZHIPU_API_KEY: "old" } }), "ZHIPU_API_KEY", "new"),
    ).toBe(false);
  });
});

describe("shouldPatchProviderApiKey", () => {
  it("allows first-time key", () => {
    expect(shouldPatchProviderApiKey(snap({}), "deepseek", "sk-1")).toBe(true);
  });

  it("blocks masked placeholder as new key", () => {
    expect(shouldPatchProviderApiKey(snap({}), "deepseek", "sk-a****")).toBe(false);
  });

  it("allows replacement when snapshot was masked", () => {
    expect(
      shouldPatchProviderApiKey(
        snap({ providers: { zai: { apiKey: "sk-a****" } } }),
        "zai",
        "sk-real",
      ),
    ).toBe(true);
  });

  it("blocks when same key as snapshot", () => {
    expect(
      shouldPatchProviderApiKey(
        snap({ providers: { zai: { apiKey: "same" } } }),
        "zai",
        "same",
      ),
    ).toBe(false);
  });
});
