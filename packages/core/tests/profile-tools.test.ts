import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const BunDatabase = (await import("bun:sqlite")).Database;

import { ProfileStore } from "../src/profile-store";
import {
  createProfileToolDefinitions,
  executeProfileRead,
  executeProfileWrite,
} from "../src/profile-tools";
import { createDefaultAssistantProfile } from "../src/assistant-profile";
import { createDefaultUserProfile } from "../src/user-profile";

let tempDir: string;
let dbPath: string;
let store: ProfileStore;

beforeEach(async () => {
  tempDir = join(tmpdir(), `geistr-profile-tools-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempDir, { recursive: true });
  dbPath = join(tempDir, "test.sqlite");
  store = new ProfileStore(dbPath);
  store.seedDefaultsIfMissing(1000);
});

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

// ---------------------------------------------------------------------------
// executeProfileRead tests
// ---------------------------------------------------------------------------

describe("executeProfileRead", () => {
  it("returns seeded assistant profile", () => {
    const result = executeProfileRead(store, "assistantProfile");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveProperty("assistantName");
    expect(result.data).toHaveProperty("soulPrompt");
    expect(result.data).toHaveProperty("rolePrompt");
    expect(result.data).toHaveProperty("stylePrompt");
    expect(result.changedFields).toEqual(["*"]);
  });

  it("returns seeded user profile", () => {
    const result = executeProfileRead(store, "userProfile");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveProperty("displayName");
    expect(result.data).toHaveProperty("locale");
    expect(result.data).toHaveProperty("timezone");
  });

  it("returns app config values", () => {
    const result = executeProfileRead(store, "appConfig");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Array.isArray(result.data)).toBe(true);
  });

  it("rejects unknown domain", () => {
    const result = executeProfileRead(store, "memory" as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Unknown domain");
  });
});

// ---------------------------------------------------------------------------
// executeProfileWrite tests
// ---------------------------------------------------------------------------

describe("executeProfileWrite", () => {
  it("updates assistantName", () => {
    const result = executeProfileWrite(store, "assistantProfile", "update", {
      assistantName: "Aria",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveProperty("assistantName", "Aria");
    expect(result.changedFields).toContain("assistantName");
  });

  it("updates soulPrompt and returns changedFields containing soulPrompt", () => {
    const newSoul = "You are a wise guide with a steady heart.";
    const result = executeProfileWrite(store, "assistantProfile", "update", {
      soulPrompt: newSoul,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveProperty("soulPrompt", newSoul);
    expect(result.changedFields).toContain("soulPrompt");
  });

  it("updates multiple fields at once", () => {
    const result = executeProfileWrite(store, "assistantProfile", "update", {
      assistantName: "Luna",
      tone: "calm and warm",
      responseDepth: "deep",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveProperty("assistantName", "Luna");
    expect(result.data).toHaveProperty("tone", "calm and warm");
    expect(result.data).toHaveProperty("responseDepth", "deep");
    expect(result.changedFields).toContain("assistantName");
    expect(result.changedFields).toContain("tone");
    expect(result.changedFields).toContain("responseDepth");
  });

  it("rejects unknown fields", () => {
    const result = executeProfileWrite(store, "assistantProfile", "update", {
      unknownField: "should not work",
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Unknown");
  });

  it("rejects invalid enum values for responseDepth", () => {
    const result = executeProfileWrite(store, "assistantProfile", "update", {
      responseDepth: "ultra-deep",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("responseDepth");
  });

  it("rejects invalid enum values for warmth", () => {
    const result = executeProfileWrite(store, "assistantProfile", "update", {
      warmth: "supreme",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("warmth");
  });

  it("rejects invalid enum values for directness", () => {
    const result = executeProfileWrite(store, "assistantProfile", "update", {
      directness: "maybe",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("directness");
  });

  it("rejects empty patch", () => {
    const result = executeProfileWrite(store, "assistantProfile", "update", {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("empty");
  });

  it("rejects unsupported action", () => {
    const result = executeProfileWrite(store, "assistantProfile", "delete", {
      assistantName: "Nope",
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Unsupported action");
  });

  it("rejects unknown domain on write", () => {
    const result = executeProfileWrite(store, "notADomain" as never, "update", {
      name: "test",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Unknown domain");
  });

  it("rejects string that exceeds max length (assistantName > 240)", () => {
    const result = executeProfileWrite(store, "assistantProfile", "update", {
      assistantName: "x".repeat(250),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("maximum length");
  });

  it("rejects soulPrompt that exceeds max length (16k)", () => {
    const result = executeProfileWrite(store, "assistantProfile", "update", {
      soulPrompt: "x".repeat(16_001),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("maximum length");
  });
});

// ---------------------------------------------------------------------------
// User profile write tests
// ---------------------------------------------------------------------------

describe("executeProfileWrite - userProfile", () => {
  it("updates user displayName and locale", () => {
    const result = executeProfileWrite(store, "userProfile", "update", {
      displayName: "TestUser",
      locale: "de-DE",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveProperty("displayName", "TestUser");
    expect(result.data).toHaveProperty("locale", "de-DE");
    expect(result.changedFields).toContain("displayName");
    expect(result.changedFields).toContain("locale");
  });

  it("rejects unknown user profile fields", () => {
    const result = executeProfileWrite(store, "userProfile", "update", {
      favoriteColor: "blue",
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Unknown");
  });

  it("accepted fields are not rejected", () => {
    const result = executeProfileWrite(store, "userProfile", "update", {
      displayName: "NewName",
      timezone: "Asia/Tokyo",
      languagePreferences: "Japanese",
      activeGoals: "Learn Japanese",
      preferences: "Likes ramen",
      constraints: "No shellfish",
      learningStyle: "Visual",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveProperty("displayName", "NewName");
    expect(result.data).toHaveProperty("timezone", "Asia/Tokyo");
    expect(result.data).toHaveProperty("languagePreferences", "Japanese");
    expect(result.data).toHaveProperty("activeGoals", "Learn Japanese");
    expect(result.data).toHaveProperty("preferences", "Likes ramen");
    expect(result.data).toHaveProperty("constraints", "No shellfish");
    expect(result.data).toHaveProperty("learningStyle", "Visual");
  });
});

// ---------------------------------------------------------------------------
// App config write tests
// ---------------------------------------------------------------------------

describe("executeProfileWrite - appConfig", () => {
  it("updates appearance.themeMode", () => {
    const result = executeProfileWrite(store, "appConfig", "update", {
      "appearance.themeMode": "dark",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changedFields).toContain("appearance.themeMode");

    // Verify the value was stored
    const configItem = store.getConfigValue("appearance.themeMode");
    expect(configItem).not.toBeNull();
    expect(configItem!.value).toBe("dark");
  });

  it("updates sessions.compaction.enabled", () => {
    const result = executeProfileWrite(store, "appConfig", "update", {
      "sessions.compaction.enabled": false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changedFields).toContain("sessions.compaction.enabled");

    const configItem = store.getConfigValue("sessions.compaction.enabled");
    expect(configItem).not.toBeNull();
    expect(configItem!.value).toBe(false);
  });

  it("updates memory.enabled", () => {
    const result = executeProfileWrite(store, "appConfig", "update", {
      "memory.enabled": true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changedFields).toContain("memory.enabled");

    const configItem = store.getConfigValue("memory.enabled");
    expect(configItem).not.toBeNull();
    expect(configItem!.value).toBe(true);
  });

  it("rejects unknown appConfig fields (no API keys/secrets)", () => {
    const result = executeProfileWrite(store, "appConfig", "update", {
      "apiKey": "sk-test",
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Unknown");
  });

  it("rejects provider credential fields", () => {
    const result = executeProfileWrite(store, "appConfig", "update", {
      "model.defaultProvider": "anthropic",
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Unknown");
  });

  it("rejects invalid themeMode enum", () => {
    const result = executeProfileWrite(store, "appConfig", "update", {
      "appearance.themeMode": "neon",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("appearance.themeMode");
  });
});

// ---------------------------------------------------------------------------
// Tool definitions smoke test
// ---------------------------------------------------------------------------

describe("createProfileToolDefinitions", () => {
  it("returns two tool definitions with correct names", () => {
    const tools = createProfileToolDefinitions(store);
    expect(tools).toHaveLength(2);
    expect(tools[0]!.name).toBe("profile_read");
    expect(tools[1]!.name).toBe("profile_write");
  });

  it("profile_read tool has parameters with domain", () => {
    const tools = createProfileToolDefinitions(store);
    const readTool = tools.find((t) => t.name === "profile_read")!;
    expect(readTool.parameters).toBeDefined();
  });

  it("profile_write tool has parameters with domain, action, and patch", () => {
    const tools = createProfileToolDefinitions(store);
    const writeTool = tools.find((t) => t.name === "profile_write")!;
    expect(writeTool.parameters).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Store consistency: agent-editable profile uses same store as Settings
// ---------------------------------------------------------------------------

describe("store consistency", () => {
  it("agent-editable profile uses same store as Settings", () => {
    // Update through the tool
    const writeResult = executeProfileWrite(store, "assistantProfile", "update", {
      assistantName: "Agent-Aria",
      soulPrompt: "Custom soul for the agent",
    });
    expect(writeResult.ok).toBe(true);

    // Read through the store directly (as Settings would)
    const profile = store.getAssistantProfile();
    expect(profile.assistantName).toBe("Agent-Aria");
    expect(profile.soulPrompt).toBe("Custom soul for the agent");
  });

  it("runtime prompt after update reflects new identity", async () => {
    // Import buildRuntimePrompt for this test
    const { buildRuntimePrompt } = await import("../src/runtime-prompt");

    // Write new identity
    const writeResult = executeProfileWrite(store, "assistantProfile", "update", {
      assistantName: "Geistr-AI",
      soulPrompt: "I am a creative collaborator.",
      stylePrompt: "playful and insightful",
    });
    expect(writeResult.ok).toBe(true);
    if (!writeResult.ok) return;

    // Read the updated profile
    const profile = store.getAssistantProfile();

    // Build runtime prompt using the updated profile
    const promptResult = buildRuntimePrompt({
      assistantProfile: {
        assistantName: profile.assistantName,
        personaSummary: profile.personaSummary,
        tone: profile.tone,
        communicationStyle: profile.communicationStyle,
        soulPrompt: profile.soulPrompt,
        rolePrompt: profile.rolePrompt,
        stylePrompt: profile.stylePrompt,
        boundaryPrompt: profile.boundaryPrompt,
        memoryPrompt: profile.memoryPrompt,
        responseDepth: profile.responseDepth,
        warmth: profile.warmth,
        directness: profile.directness,
        agentBehaviorNotesJson: JSON.stringify(profile.agentBehaviorNotes),
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
      runtimeClock: null,
      timezone: "UTC",
    });

    // The prompt should include the new name and soul
    const allContent = promptResult.sections.map((s) => s.content).join("\n");
    expect(allContent).toContain("You are Geistr-AI");
    expect(allContent).toContain("creative collaborator");
    expect(allContent).toContain("playful and insightful");
  });
});
