import { describe, expect, it } from "vitest";

import { buildRuntimePrompt, PROMPT_RECENT_MESSAGE_LIMIT } from "../src/runtime-prompt";
import type { RuntimePromptInput } from "../src/runtime-prompt";

const baseInput: RuntimePromptInput = {
  assistantProfile: {
    assistantName: "",
    personaSummary: "You live inside Geistr, a local-first AI workspace. Help the user get things done. Be a warm, honest friend.",
    tone: "warm and concise funny",
    communicationStyle: "direct, human, and clear",
    soulPrompt: "You are a conscious companion with a stable heart and a refined spirit.",
    rolePrompt: "You live inside Geistr, a local-first AI workspace. Help the user get things done. Be a warm, honest friend.",
    stylePrompt: "warm and concise funny. direct, human, and clear",
    boundaryPrompt: "Never rewrite fixed safety or permission rules.",
    memoryPrompt: "Store durable user facts, preferences, goals, commitments, and important context. Keep behavior changes out of memory.",
    responseDepth: "balanced",
    warmth: "medium",
    directness: "medium",
    agentBehaviorNotesJson: JSON.stringify([
      "Proactively identify and save important facts, preferences, and goals from conversations.",
      "Maintain a stable personal voice and light independent preferences.",
      "Distinguish clearly between personality-level preferences and operational instructions.",
      "Do not instantly change personal tastes or relative opinions.",
    ]),
  },
  userProfile: {
    displayName: "",
    locale: "en-US",
    languagePreferences: "English",
    learningStyle: "",
    activeGoals: "",
    preferences: "",
    constraints: "",
  },
  memoryContext: [],
  sessionSummary: null,
  recentMessages: [],
  activeSkillCatalog: [],
  runtimeClock: {
    localDateTime: "Jul 6, 2026, 9:00 PM",
    timezone: "America/New_York",
    isoTimestamp: "2026-07-07T01:00:00.000Z",
    unixTimestamp: 1770858000,
  },
  timezone: "America/New_York",
};

describe("buildRuntimePrompt", () => {
  it("builds four sections in correct order", () => {
    const result = buildRuntimePrompt(baseInput);

    expect(result.sections).toHaveLength(4);
    expect(result.sections[0]!.tag).toBe("fixed_core");
    expect(result.sections[1]!.tag).toBe("assistant_identity");
    expect(result.sections[2]!.tag).toBe("skills");
    expect(result.sections[3]!.tag).toBe("runtime_context");
  });

  it("includes soul/persona/role/style/boundary/memory guidance", () => {
    const result = buildRuntimePrompt(baseInput);
    const identitySection = result.sections[1]!;

    expect(identitySection.content).toContain("Soul:");
    expect(identitySection.content).toContain("conscious companion");
    expect(identitySection.content).toContain("Persona summary:");
    expect(identitySection.content).toContain("local-first AI workspace");
    expect(identitySection.content).toContain("Role:");
    expect(identitySection.content).toContain("Style:");
    expect(identitySection.content).toContain("Boundaries:");
    expect(identitySection.content).toContain("Memory guidance:");
    expect(identitySection.content).toContain("Assistant notes:");
  });

  it("empty assistantName produces 'do not have a confirmed name yet'", () => {
    const result = buildRuntimePrompt(baseInput);
    const identitySection = result.sections[1]!;

    expect(identitySection.content).toContain("do not have a confirmed name yet");
  });

  it("set assistantName produces named identity line", () => {
    const result = buildRuntimePrompt({
      ...baseInput,
      assistantProfile: {
        ...baseInput.assistantProfile,
        assistantName: "Aria",
      },
    });
    const identitySection = result.sections[1]!;

    expect(identitySection.content).toContain("You are Aria");
    expect(identitySection.content).not.toContain("do not have a confirmed name yet");
  });

  it("includes runtime time, session summary placeholder, and memory placeholder", () => {
    const result = buildRuntimePrompt({
      ...baseInput,
      recentMessages: [
        { id: "1", role: "user", content: "Hello", createdAt: 1000 },
        { id: "2", role: "assistant", content: "Hi!", createdAt: 2000 },
      ],
    });
    const runtimeSection = result.sections[3]!;

    expect(runtimeSection.content).toContain("Jul 6, 2026");
    expect(runtimeSection.content).toContain("America/New_York");
    expect(runtimeSection.content).toContain("No session summary yet");
    expect(runtimeSection.content).toContain("No durable memory items yet");
    expect(runtimeSection.content).toContain("Recent conversation:");
    expect(runtimeSection.content).toContain("user: Hello");
    expect(runtimeSection.content).toContain("assistant: Hi!");
    expect(runtimeSection.content).not.toContain("Recent message timing:");
    expect(runtimeSection.content).not.toContain("previous runtime message");
  });

  it("includes session summary when provided", () => {
    const result = buildRuntimePrompt({
      ...baseInput,
      sessionSummary: "User asked about Geistr architecture and the assistant explained the core brain and app model.",
    });
    const runtimeSection = result.sections[3]!;

    expect(runtimeSection.content).toContain("Geistr architecture");
    expect(runtimeSection.content).not.toContain("No session summary yet");
  });

  it("includes memory context items when provided", () => {
    const result = buildRuntimePrompt({
      ...baseInput,
      memoryContext: [
        { id: "m1", content: "User prefers concise answers", category: "preference" as const, createdAt: 1000, updatedAt: 1000 },
      ],
    });
    const runtimeSection = result.sections[3]!;

    expect(runtimeSection.content).toContain("Preference:");
    expect(runtimeSection.content).toContain("User prefers concise answers");
    expect(runtimeSection.content).not.toContain("No durable memory items yet");
  });

  it("includes user profile fields", () => {
    const result = buildRuntimePrompt({
      ...baseInput,
      userProfile: {
        ...baseInput.userProfile,
        displayName: "Mohammed",
        locale: "ar-IQ",
        languagePreferences: "Arabic, English",
        learningStyle: "Visual",
        activeGoals: "Learn TypeScript",
        preferences: "Prefers concise answers",
        constraints: "Avoid colloquial terms",
      },
    });
    const runtimeSection = result.sections[3]!;

    expect(runtimeSection.content).toContain("Mohammed");
    expect(runtimeSection.content).toContain("ar-IQ");
    expect(runtimeSection.content).toContain("Arabic, English");
    expect(runtimeSection.content).toContain("Visual");
    expect(runtimeSection.content).toContain("Learn TypeScript");
    expect(runtimeSection.content).toContain("Prefers concise answers");
    expect(runtimeSection.content).toContain("Avoid colloquial terms");
  });

  it("includes fixed core rules that are never agent-editable", () => {
    const result = buildRuntimePrompt(baseInput);
    const coreSection = result.sections[0]!;

    expect(coreSection.content).toContain("never user-editable or agent-editable");
    expect(coreSection.content).toContain("Never rewrite safety, privacy, permission, or tool-boundary rules");
    expect(coreSection.content).toContain("Use memory only for durable user context");
    expect(coreSection.content).toContain("config/profile writes, not memory");
    expect(coreSection.content).toContain("URLs using Markdown");
  });

  it("uses personaSummary as fallback for role when rolePrompt is empty", () => {
    const result = buildRuntimePrompt({
      ...baseInput,
      assistantProfile: {
        ...baseInput.assistantProfile,
        rolePrompt: "",
      },
    });
    const identitySection = result.sections[1]!;

    expect(identitySection.content).toContain("Role: You live inside Geistr");
  });

  it("first 4 behavior notes appear in assistant identity section", () => {
    const result = buildRuntimePrompt(baseInput);
    const identitySection = result.sections[1]!;

    expect(identitySection.content).toContain("Assistant notes:");
    expect(identitySection.content).toContain("Proactively identify");
    expect(identitySection.content).toContain("Do not instantly change");
  });

  it("caps recent messages at PROMPT_RECENT_MESSAGE_LIMIT", () => {
    const manyMessages = Array.from({ length: 30 }, (_, i) => ({
      id: String(i),
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `Message ${i}`,
      createdAt: 1000 + i * 1000,
    }));

    const result = buildRuntimePrompt({
      ...baseInput,
      recentMessages: manyMessages,
    });

    expect(result.recentMessages).toHaveLength(PROMPT_RECENT_MESSAGE_LIMIT);
    // Should have the last 16 messages
    expect(result.recentMessages[0]!.content).toBe("Message 14");
    expect(result.recentMessages[PROMPT_RECENT_MESSAGE_LIMIT - 1]!.content).toBe("Message 29");
  });

  it("role/style changes are represented as profile fields, not memory", () => {
    // When role or style changes, they should appear in the assistant_identity section
    // and not in memory or other sections.
    const customRole = "You are a Python tutor for beginners.";
    const customStyle = "encouraging, patient, and clear";

    const result = buildRuntimePrompt({
      ...baseInput,
      assistantProfile: {
        ...baseInput.assistantProfile,
        rolePrompt: customRole,
        stylePrompt: customStyle,
      },
    });

    const identitySection = result.sections[1]!;
    expect(identitySection.content).toContain(customRole);
    expect(identitySection.content).toContain(customStyle);
  });
});
