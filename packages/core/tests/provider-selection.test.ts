import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { clampToSupportedThinkingLevel, createCoreProviderLayer, toModelOption } from "../src/index";

const reasoningModel = {
  provider: "anthropic",
  id: "claude-test",
  name: "Claude Test",
  api: "anthropic-messages",
  baseUrl: "https://example.test",
  reasoning: true,
  thinkingLevelMap: { off: null, low: "low", medium: "medium", high: "high", xhigh: null },
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
  maxTokens: 100,
} satisfies Model<Api>;

const plainModel = {
  ...reasoningModel,
  provider: "openai",
  id: "gpt-test",
  name: "GPT Test",
  reasoning: false,
} satisfies Model<Api>;

describe("core provider selection", () => {
  it("lists model options from the Pi model registry shape without inventing providers", async () => {
    const registry = {
      refresh: () => undefined,
      getAll: () => [reasoningModel, plainModel],
      getAvailable: () => [reasoningModel],
      find: (provider: string, modelId: string) => [reasoningModel, plainModel].find((model) => model.provider === provider && model.id === modelId),
      getProviderDisplayName: (provider: string) => (provider === "anthropic" ? "Anthropic" : "OpenAI"),
    };

    const layer = createCoreProviderLayer(registry);

    expect(await layer.listModelOptions()).toEqual([
      expect.objectContaining({ provider: "anthropic", providerName: "Anthropic", modelId: "claude-test", configured: true }),
      expect.objectContaining({ provider: "openai", providerName: "OpenAI", modelId: "gpt-test", configured: false }),
    ]);
    expect(await layer.listModelOptions({ configuredOnly: true })).toEqual([
      expect.objectContaining({ provider: "anthropic", modelId: "claude-test", configured: true }),
    ]);
  });

  it("resolves provider/model selections and clamps unsupported thinking levels", async () => {
    const layer = createCoreProviderLayer({
      refresh: () => undefined,
      getAll: () => [reasoningModel],
      getAvailable: () => [reasoningModel],
      find: () => reasoningModel,
      getProviderDisplayName: () => "Anthropic",
    });

    await expect(layer.resolveModelSelection({ provider: "anthropic", modelId: "claude-test", thinkingLevel: "xhigh" })).resolves.toMatchObject({
      model: reasoningModel,
      thinkingLevel: "high",
    });
  });

  it("maps supported thinking levels for UI display", () => {
    expect(toModelOption(reasoningModel, { getProviderDisplayName: () => "Anthropic" }).thinkingLevels).toEqual(["minimal", "low", "medium", "high"]);
    expect(clampToSupportedThinkingLevel(reasoningModel, "xhigh")).toBe("high");
  });
});
