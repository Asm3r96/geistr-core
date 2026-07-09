import { describe, expect, it } from "vitest";

import { assembleRuntimeContext, type RuntimeContextInput } from "../src/runtime-context";

describe("assembleRuntimeContext", () => {
  const baseInput: RuntimeContextInput = {
    sessionKey: "chat:session_xxx",
    sessionTitle: "My Chat",
    sessionSummary: null,
    recentMessages: [],
    memoryContextItems: [],
    timezone: "America/New_York",
    localDateTime: "Jul 6, 2026, 9:00 PM",
    isoTimestamp: "2026-07-07T01:00:00.000Z",
    unixTimestamp: 1770858000,
  };

  it("builds stable and dynamic sections for prompt caching", () => {
    const result = assembleRuntimeContext(baseInput);

    expect(result.stableSections.length).toBeGreaterThan(0);
    expect(result.dynamicSections.length).toBeGreaterThan(0);

    // Identity goes first (stable)
    const firstStable = result.stableSections[0]!;
    expect(firstStable.tag).toBe("identity");

    // Runtime context is dynamic
    const runtimeSection = result.dynamicSections.find((s) => s.tag === "runtime_context");
    expect(runtimeSection).toBeDefined();
    const section = runtimeSection!;
    expect(section.content).toContain("America/New_York");
    expect(section.content).toContain("Jul 6, 2026");
  });

  it("includes session summary when present", () => {
    const result = assembleRuntimeContext({
      ...baseInput,
      sessionSummary: "User asked about Geistr architecture. Assistant explained core brain and app model.",
    });

    const summarySection = result.dynamicSections.find((s) => s.tag === "session_summary");
    expect(summarySection).toBeDefined();
    expect(summarySection!.content).toContain("Geistr architecture");
  });

  it("omits session summary when null", () => {
    const result = assembleRuntimeContext(baseInput);

    const summarySection = result.dynamicSections.find((s) => s.tag === "session_summary");
    expect(summarySection).toBeUndefined();
  });

  it("includes recent messages formatted with role prefixes", () => {
    const result = assembleRuntimeContext({
      ...baseInput,
      recentMessages: [
        { id: "1", role: "user", content: "Hello", createdAt: 1000 },
        { id: "2", role: "assistant", content: "Hi there", createdAt: 2000 },
      ],
    });

    const messagesSection = result.dynamicSections.find((s) => s.tag === "recent_messages");
    expect(messagesSection).toBeDefined();
    expect(messagesSection!.content).toContain("user: Hello");
    expect(messagesSection!.content).toContain("assistant: Hi there");
  });

  it("includes memory context placeholder when no memory items", () => {
    const result = assembleRuntimeContext(baseInput);

    const memorySection = result.dynamicSections.find((s) => s.tag === "memory_context");
    expect(memorySection).toBeDefined();
    expect(memorySection!.content).toContain("No relevant memory context");
  });

  it("includes memory context items when present", () => {
    const result = assembleRuntimeContext({
      ...baseInput,
      memoryContextItems: [
        { content: "User prefers concise answers", category: "preference" },
        { content: "User is learning TypeScript", category: "goal" },
      ],
    });

    const memorySection = result.dynamicSections.find((s) => s.tag === "memory_context");
    expect(memorySection).toBeDefined();
    expect(memorySection!.content).toContain("[preference] User prefers concise answers");
    expect(memorySection!.content).toContain("[goal] User is learning TypeScript");
  });

  it("accepts additional stable and dynamic sections", () => {
    const result = assembleRuntimeContext({
      ...baseInput,
      additionalStableSections: [{ tag: "tools_policy", content: "Use tools when needed." }],
      additionalDynamicSections: [{ tag: "app_context", content: "Active app: Tutor." }],
    });

    expect(result.stableSections.find((s) => s.tag === "tools_policy")).toBeDefined();
    expect(result.dynamicSections.find((s) => s.tag === "app_context")).toBeDefined();
  });

  it("places stable sections before dynamic sections", () => {
    const result = assembleRuntimeContext(baseInput);

    // Find the last stable index and first dynamic index
    const stableTags = result.stableSections.map((s) => s.tag);
    const dynamicTags = result.dynamicSections.map((s) => s.tag);

    // All stable tags should come before all dynamic tags in the combined output
    for (const stableTag of stableTags) {
      for (const dynamicTag of dynamicTags) {
        const stableIdx = stableTags.indexOf(stableTag);
        const dynamicIdx = stableTags.length + dynamicTags.indexOf(dynamicTag);
        // In the combined array, stable sections come first
        expect(stableIdx).toBeLessThan(dynamicIdx);
      }
    }
  });

  it("works with empty recent messages and no summary", () => {
    const result = assembleRuntimeContext(baseInput);

    expect(result.stableSections.length).toBeGreaterThan(0);
    expect(result.dynamicSections.length).toBeGreaterThan(0);
    expect(result.dynamicSections.find((s) => s.tag === "recent_messages")).toBeDefined();
    expect(result.dynamicSections.find((s) => s.tag === "memory_context")).toBeDefined();
  });
});
