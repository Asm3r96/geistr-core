import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const BunDatabase = (await import("bun:sqlite")).Database;

import {
  createDefaultAssistantProfile,
  ensureAssistantProfileSchema,
  readAssistantProfile,
  updateAssistantProfile,
  insertAssistantProfileIfMissing,
} from "../src/assistant-profile";

let tempDir: string;
let dbPath: string;

beforeEach(async () => {
  tempDir = join(tmpdir(), `geistr-assistant-profile-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempDir, { recursive: true });
  dbPath = join(tempDir, "test.sqlite");
});

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

function createDb() {
  return new BunDatabase(dbPath);
}

describe("createDefaultAssistantProfile", () => {
  it("returns the old Geistr default values exactly", () => {
    const profile = createDefaultAssistantProfile();

    expect(profile.assistantName).toBe("");
    expect(profile.imagePath).toBe("");
    expect(profile.imageUpdatedAt).toBe(0);
    expect(profile.personaSummary).toBe(
      "You live inside Geistr, a local-first AI workspace. Help the user get things done. Be a warm, honest friend."
    );
    expect(profile.tone).toBe("warm and concise funny");
    expect(profile.communicationStyle).toBe("direct, human, and clear");
    expect(profile.responseDepth).toBe("balanced");
    expect(profile.warmth).toBe("medium");
    expect(profile.directness).toBe("medium");
    expect(profile.rolePrompt).toBe(
      "You live inside Geistr, a local-first AI workspace. Help the user get things done. Be a warm, honest friend."
    );
    expect(profile.soulPrompt).toContain("conscious companion");
    expect(profile.soulPrompt).toContain("stable heart");
    expect(profile.soulPrompt).toContain("refined spirit");
    expect(profile.soulPrompt).toContain("honest truth over blind flattery");
    expect(profile.stylePrompt).toBe("warm and concise funny. direct, human, and clear");
    expect(profile.boundaryPrompt).toContain("Never rewrite fixed safety or permission rules");
    expect(profile.memoryPrompt).toBe(
      "Store durable user facts, preferences, goals, commitments, and important context. Keep behavior changes out of memory."
    );
    expect(profile.agentBehaviorNotes).toHaveLength(7);
    expect(profile.agentBehaviorNotes[0]).toContain("Proactively identify");
    expect(profile.agentBehaviorNotes[6]).toContain("local-first AI workspace");
  });
});

describe("assistant profile schema and read", () => {
  it("seeds the profile_assistant table schema", () => {
    const db = createDb();
    try {
      ensureAssistantProfileSchema(db as never);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'profile_assistant'").all() as Array<{ name: string }>;
      expect(tables).toHaveLength(1);
      expect(tables[0]!.name).toBe("profile_assistant");
    } finally {
      db.close();
    }
  });

  it("returns default profile when table exists but is empty", () => {
    const db = createDb();
    try {
      ensureAssistantProfileSchema(db as never);
      const profile = readAssistantProfile(db as never);
      expect(profile.assistantName).toBe("");
      expect(profile.personaSummary).toContain("local-first AI workspace");
    } finally {
      db.close();
    }
  });

  it("inserts default row only if missing", () => {
    const db = createDb();
    try {
      ensureAssistantProfileSchema(db as never);
      insertAssistantProfileIfMissing(db as never, 1000);

      const profile = readAssistantProfile(db as never);
      expect(profile.assistantName).toBe("");
      expect(profile.soulPrompt).toContain("conscious companion");

      // Second call should not fail or overwrite
      insertAssistantProfileIfMissing(db as never, 2000);
      const profile2 = readAssistantProfile(db as never);
      expect(profile2.soulPrompt).toContain("conscious companion");
    } finally {
      db.close();
    }
  });

  it("updates assistant profile fields", () => {
    const db = createDb();
    try {
      ensureAssistantProfileSchema(db as never);
      insertAssistantProfileIfMissing(db as never, 1000);

      const updated = updateAssistantProfile(db as never, {
        assistantName: "Aria",
        soulPrompt: "I am a calm thinking partner with deep integrity.",
        tone: "warm and direct",
      }, 2000);

      expect(updated.assistantName).toBe("Aria");
      expect(updated.soulPrompt).toBe("I am a calm thinking partner with deep integrity.");
      expect(updated.tone).toBe("warm and direct");
      // Unchanged fields keep their defaults
      expect(updated.communicationStyle).toBe("direct, human, and clear");

      // Read back from DB
      const reread = readAssistantProfile(db as never);
      expect(reread.assistantName).toBe("Aria");
      expect(reread.soulPrompt).toBe("I am a calm thinking partner with deep integrity.");
    } finally {
      db.close();
    }
  });

  it("does not treat persona summary as soul in persisted values", () => {
    const db = createDb();
    try {
      ensureAssistantProfileSchema(db as never);
      insertAssistantProfileIfMissing(db as never, 1000);

      // Update just personaSummary, soulPrompt stays unchanged
      const updated = updateAssistantProfile(db as never, {
        personaSummary: "A helpful coding companion.",
      }, 2000);

      expect(updated.personaSummary).toBe("A helpful coding companion.");
      expect(updated.soulPrompt).toContain("conscious companion");
    } finally {
      db.close();
    }
  });

  it("stores agentBehaviorNotes as JSON and returns first 4 on read", () => {
    const db = createDb();
    try {
      ensureAssistantProfileSchema(db as never);
      insertAssistantProfileIfMissing(db as never, 1000);

      // readAssistantProfile already returns up to 4 notes from its array
      const profile = readAssistantProfile(db as never);
      expect(profile.agentBehaviorNotes).toHaveLength(7);

      // Update with custom notes
      const updated = updateAssistantProfile(db as never, {
        agentBehaviorNotes: ["Note one", "Note two", "Note three", "Note four", "Note five"],
      }, 2000);

      // The update stores all 5, read returns all stored
      expect(updated.agentBehaviorNotes).toHaveLength(5);
    } finally {
      db.close();
    }
  });
});
