import { describe, expect, test } from "bun:test";

import { classifyProviderError, normalizeProviderError } from "../src/provider-errors";

describe("provider error normalization", () => {
  test("classifies invalid API key errors without exposing raw text in message", () => {
    const error = new Error("401 Unauthorized: invalid API key\n    at provider.sdk.request (/app/secret.ts:10:1)");
    const normalized = normalizeProviderError({ error, providerId: "anthropic", modelId: "claude-test" });

    expect(normalized.kind).toBe("invalid_api_key");
    expect(normalized.title).toBe("The model request failed.");
    expect(normalized.message).toContain("API key");
    expect(normalized.message).not.toContain("/app/secret.ts");
    expect(normalized.technicalDetails).toContain("invalid API key");
    expect(normalized.providerId).toBe("anthropic");
    expect(normalized.modelId).toBe("claude-test");
  });

  test("classifies rate limit, quota, model, network, timeout, provider, and tool failures", () => {
    expect(classifyProviderError({ status: 429, message: "Too many requests" })).toBe("rate_limited");
    expect(classifyProviderError(new Error("insufficient credits / quota exceeded"))).toBe("quota_exceeded");
    expect(classifyProviderError({ status: 404, message: "model does not exist" })).toBe("model_unavailable");
    expect(classifyProviderError(new Error("fetch failed: ENOTFOUND api.example.com"))).toBe("network");
    expect(classifyProviderError(new Error("request timed out"))).toBe("timeout");
    expect(classifyProviderError({ status: 500, message: "internal server error" })).toBe("provider_error");
    expect(classifyProviderError(new Error("tool call failed: bash exited 1"))).toBe("tool_error");
  });
});
