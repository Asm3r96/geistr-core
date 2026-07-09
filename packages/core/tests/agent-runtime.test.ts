import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";

import { createCoreAgentRuntime, type GeistrThinkingLevel } from "../src/index";

function createFakeAdapter() {
  const calls: Array<{ name: string; value?: unknown }> = [];
  const listeners: Array<(event: never) => void> = [];
  const session = {
    sessionId: "session-1",
    isStreaming: false,
    messages: ["hello"],
    prompt: vi.fn(async (text: string) => {
      calls.push({ name: "prompt", value: text });
    }),
    steer: vi.fn(async (text: string) => {
      calls.push({ name: "steer", value: text });
    }),
    followUp: vi.fn(async (text: string) => {
      calls.push({ name: "followUp", value: text });
    }),
    subscribe: vi.fn((listener: (event: never) => void) => {
      listeners.push(listener);
      return () => calls.push({ name: "unsubscribe" });
    }),
    abort: vi.fn(async () => {
      calls.push({ name: "abort" });
    }),
    setModel: vi.fn(async (model: unknown) => {
      calls.push({ name: "setModel", value: model });
    }),
    setThinkingLevel: vi.fn((level: string) => {
      calls.push({ name: "setThinkingLevel", value: level });
    }),
    dispose: vi.fn(() => calls.push({ name: "dispose" })),
  };

  const model = {
    provider: "test-provider",
    id: "test-model",
    name: "Test Model",
    api: "anthropic-messages",
    baseUrl: "https://example.test",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  } satisfies Model<Api>;
  const providerLayer = {
    listModelOptions: vi.fn(async () => [
      {
        provider: "test-provider",
        providerName: "Test Provider",
        modelId: "test-model",
        modelName: "Test Model",
        configured: true,
        reasoning: true,
        thinkingLevels: ["off", "low", "high"] as GeistrThinkingLevel[],
      },
    ]),
    resolveModelSelection: vi.fn(async (selection: { provider: string; modelId: string; thinkingLevel?: GeistrThinkingLevel }) => ({
      model,
      ...(selection.thinkingLevel ? { thinkingLevel: selection.thinkingLevel } : {}),
    })),
  };

  const adapter = {
    getAgentDir: vi.fn(() => "/agent"),
    createInMemorySessionManager: vi.fn((cwd: string) => ({ cwd })),
    createResourceLoader: vi.fn((options: { cwd: string; agentDir: string; systemPrompt: string }) => ({
      options,
      reload: vi.fn(async () => {
        calls.push({ name: "reload" });
      }),
    })),
    createAgentSession: vi.fn(async (options: unknown) => {
      calls.push({ name: "createAgentSession", value: options });
      return { session };
    }),
    createProviderLayer: vi.fn(() => providerLayer),
  };

  return { adapter, calls, session, model, providerLayer };
}

describe("createCoreAgentRuntime", () => {
  it("creates a Pi-backed session with an assembled Geistr core prompt", async () => {
    const { adapter } = createFakeAdapter();

    const runtime = await createCoreAgentRuntime(
      {
        cwd: "/workspace",
        prompt: {
          stableSections: [{ tag: "identity", content: "You are Geistr's core personal agent." }],
          dynamicSections: [{ tag: "tools_policy", content: "Use only configured tools." }],
        },
        tools: ["read"],
      },
      adapter,
    );

    expect(runtime.sessionId).toBe("session-1");
    expect(runtime.systemPrompt).toBe(
      "<identity>\nYou are Geistr's core personal agent.\n</identity>\n\n<tools_policy>\nUse only configured tools.\n</tools_policy>",
    );
    expect(adapter.createResourceLoader).toHaveBeenCalledWith({
      cwd: "/workspace",
      agentDir: "/agent",
      systemPrompt: runtime.systemPrompt,
    });
    expect(adapter.createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/workspace", agentDir: "/agent", tools: ["read"] }),
    );
  });

  it("passes selected provider model and thinking level into the Pi session", async () => {
    const { adapter, model } = createFakeAdapter();

    await createCoreAgentRuntime(
      {
        cwd: "/workspace",
        prompt: { stableSections: [{ tag: "identity", content: "Core" }] },
        modelSelection: { provider: "test-provider", modelId: "test-model", thinkingLevel: "high" },
      },
      adapter,
    );

    expect(adapter.createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ model, thinkingLevel: "high" }),
    );
  });

  it("exposes model selection state and can change the runtime model", async () => {
    const { adapter, calls } = createFakeAdapter();
    const runtime = await createCoreAgentRuntime(
      {
        cwd: "/workspace",
        prompt: { stableSections: [{ tag: "identity", content: "Core" }] },
      },
      adapter,
    );

    expect(await runtime.getModelSelectionState()).toEqual({
      selected: null,
      options: [expect.objectContaining({ provider: "test-provider", modelId: "test-model" })],
    });

    const state = await runtime.selectModel({ provider: "test-provider", modelId: "test-model", thinkingLevel: "low" });

    expect(state.selected).toEqual({ provider: "test-provider", modelId: "test-model", thinkingLevel: "low" });
    expect(calls.map((call) => call.name)).toContain("setModel");
    expect(calls.map((call) => call.name)).toContain("setThinkingLevel");
  });

  it("exposes a small app-facing chat control surface", async () => {
    const { adapter, calls } = createFakeAdapter();
    const runtime = await createCoreAgentRuntime(
      {
        cwd: "/workspace",
        prompt: { stableSections: [{ tag: "identity", content: "Core" }] },
      },
      adapter,
    );

    const unsubscribe = runtime.subscribe(() => undefined);
    await runtime.sendMessage("Hello");
    await runtime.steer("Change direction");
    await runtime.followUp("Do this next");
    await runtime.abort();
    unsubscribe();
    runtime.dispose();

    expect(runtime.getSnapshot()).toEqual({ sessionId: "session-1", isStreaming: false, messageCount: 1 });
    expect(calls.map((call) => call.name)).toEqual([
      "reload",
      "createAgentSession",
      "prompt",
      "steer",
      "followUp",
      "abort",
      "unsubscribe",
      "dispose",
    ]);
  });
});
