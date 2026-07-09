import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const BunDatabase = (await import("bun:sqlite")).Database;

import {
  createDefaultUserProfile,
  ensureUserProfileSchema,
  readUserProfile,
  updateUserProfile,
  insertUserProfileIfMissing,
} from "../src/user-profile";

let tempDir: string;
let dbPath: string;

beforeEach(async () => {
  tempDir = join(tmpdir(), `geistr-user-profile-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

describe("createDefaultUserProfile", () => {
  it("returns the old Geistr default values exactly", () => {
    const profile = createDefaultUserProfile();

    expect(profile.displayName).toBe("");
    expect(profile.locale).toBe("en-US");
    expect(profile.timezone).toBe("UTC");
    expect(profile.languagePreferences).toBe("English");
    expect(profile.activeGoals).toBe("");
    expect(profile.preferences).toBe("");
    expect(profile.constraints).toBe("");
    expect(profile.learningStyle).toBe("");
    expect(profile.imagePath).toBe("");
    expect(profile.imageUpdatedAt).toBe(0);
  });
});

describe("user profile schema and read", () => {
  it("seeds the profile_user table schema", () => {
    const db = createDb();
    try {
      ensureUserProfileSchema(db as never);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'profile_user'").all() as Array<{ name: string }>;
      expect(tables).toHaveLength(1);
      expect(tables[0]!.name).toBe("profile_user");
    } finally {
      db.close();
    }
  });

  it("returns default profile when table exists but is empty", () => {
    const db = createDb();
    try {
      ensureUserProfileSchema(db as never);
      const profile = readUserProfile(db as never);
      expect(profile.displayName).toBe("");
      expect(profile.locale).toBe("en-US");
      expect(profile.timezone).toBe("UTC");
    } finally {
      db.close();
    }
  });

  it("inserts default row only if missing", () => {
    const db = createDb();
    try {
      ensureUserProfileSchema(db as never);
      insertUserProfileIfMissing(db as never, 1000);

      const profile = readUserProfile(db as never);
      expect(profile.locale).toBe("en-US");
      expect(profile.timezone).toBe("UTC");

      // Second call should not fail
      insertUserProfileIfMissing(db as never, 2000);
    } finally {
      db.close();
    }
  });

  it("updates user profile fields", () => {
    const db = createDb();
    try {
      ensureUserProfileSchema(db as never);
      insertUserProfileIfMissing(db as never, 1000);

      const updated = updateUserProfile(db as never, {
        displayName: "Mohammed",
        locale: "ar-IQ",
        timezone: "Asia/Baghdad",
        languagePreferences: "Arabic, English",
      }, 2000);

      expect(updated.displayName).toBe("Mohammed");
      expect(updated.locale).toBe("ar-IQ");
      expect(updated.timezone).toBe("Asia/Baghdad");
      expect(updated.languagePreferences).toBe("Arabic, English");

      // Unchanged fields keep defaults
      expect(updated.activeGoals).toBe("");
      expect(updated.learningStyle).toBe("");

      // Read back from DB
      const reread = readUserProfile(db as never);
      expect(reread.displayName).toBe("Mohammed");
      expect(reread.timezone).toBe("Asia/Baghdad");
    } finally {
      db.close();
    }
  });

  it("partial update keeps existing values for unspecified fields", () => {
    const db = createDb();
    try {
      ensureUserProfileSchema(db as never);
      insertUserProfileIfMissing(db as never, 1000);

      // First update sets displayName
      updateUserProfile(db as never, { displayName: "TestUser" }, 1500);
      // Second update only changes locale
      updateUserProfile(db as never, { locale: "de-DE" }, 2000);

      const profile = readUserProfile(db as never);
      expect(profile.displayName).toBe("TestUser"); // preserved
      expect(profile.locale).toBe("de-DE");
      expect(profile.timezone).toBe("UTC"); // still default
    } finally {
      db.close();
    }
  });
});
