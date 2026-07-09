// ---------------------------------------------------------------------------
// ProfileStore — combined store for assistant profile, user profile, and
// profile config, sharing the same SQLite database as the session store
// ---------------------------------------------------------------------------

import { createRequire } from "node:module";

import {
  ensureAssistantProfileSchema,
  readAssistantProfile,
  updateAssistantProfile,
  insertAssistantProfileIfMissing,
  type AssistantProfile,
  type AssistantProfileUpdateInput,
} from "./assistant-profile";
import {
  ensureUserProfileSchema,
  readUserProfile,
  updateUserProfile,
  insertUserProfileIfMissing,
  type UserProfile,
  type UserProfileUpdateInput,
} from "./user-profile";
import {
  ensureProfileConfigSchema,
  readConfigValue,
  readAllConfigValues,
  writeConfigValue,
  seedDefaultProfileConfig,
  type ConfigItem,
  type ConfigValueType,
} from "./profile-config";

const require = createRequire(import.meta.url);

type DatabaseConstructor = new (path: string, options?: { readonly?: boolean }) => SqliteDatabase;

interface SqliteDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface SqliteStatement {
  run(...params: unknown[]): { changes?: number } | unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

const Database = resolveSqliteDatabase();

function resolveSqliteDatabase(): DatabaseConstructor {
  if (typeof process !== "undefined" && process.versions && "bun" in process.versions) {
    return (require("bun:sqlite") as { Database: DatabaseConstructor }).Database;
  }
  return (require("node:sqlite") as { DatabaseSync: DatabaseConstructor }).DatabaseSync;
}

/**
 * ProfileStore manages three profile-related tables in a shared SQLite
 * database: profile_assistant, profile_user, and profile_config.
 *
 * It is designed to share the same database path as SessionPersistenceStore
 * so that profiles and session data live in one file.
 */
export class ProfileStore {
  constructor(private readonly databasePath: string) {}

  ensureReady(): void {
    const db = this.openWritable();
    try {
      ensureProfileConfigSchema(db);
      ensureAssistantProfileSchema(db);
      ensureUserProfileSchema(db);
    } finally {
      db.close();
    }
  }

  /**
   * Seed the default rows if they are missing. Safe to call on every startup.
   */
  seedDefaultsIfMissing(now = Date.now()): void {
    const db = this.openWritable();
    try {
      this.ensureReady();
      seedDefaultProfileConfig(db, now);
      insertAssistantProfileIfMissing(db, now);
      insertUserProfileIfMissing(db, now);
    } finally {
      db.close();
    }
  }

  // ── Assistant profile ──

  getAssistantProfile(): AssistantProfile {
    const db = this.openReadonly();
    try {
      return readAssistantProfile(db);
    } finally {
      db.close();
    }
  }

  updateAssistantProfile(input: AssistantProfileUpdateInput, now = Date.now()): AssistantProfile {
    const db = this.openWritable();
    try {
      this.ensureReady();
      return updateAssistantProfile(db, input, now);
    } finally {
      db.close();
    }
  }

  // ── User profile ──

  getUserProfile(): UserProfile {
    const db = this.openReadonly();
    try {
      return readUserProfile(db);
    } finally {
      db.close();
    }
  }

  updateUserProfile(input: UserProfileUpdateInput, now = Date.now()): UserProfile {
    const db = this.openWritable();
    try {
      this.ensureReady();
      return updateUserProfile(db, input, now);
    } finally {
      db.close();
    }
  }

  // ── Config ──

  getConfigValue(key: string): ConfigItem | null {
    const db = this.openReadonly();
    try {
      return readConfigValue(db, key);
    } finally {
      db.close();
    }
  }

  getAllConfigValues(): ConfigItem[] {
    const db = this.openReadonly();
    try {
      return readAllConfigValues(db);
    } finally {
      db.close();
    }
  }

  setConfigValue(key: string, value: unknown, valueType: ConfigValueType, now = Date.now()): ConfigItem {
    const db = this.openWritable();
    try {
      this.ensureReady();
      return writeConfigValue(db, key, value, valueType, now);
    } finally {
      db.close();
    }
  }

  private openWritable(): SqliteDatabase {
    const db = new Database(this.databasePath);
    db.exec("PRAGMA journal_mode = WAL");
    return db;
  }

  private openReadonly(): SqliteDatabase {
    return new Database(this.databasePath);
  }
}

// Re-export types for convenience
export type {
  AssistantProfile,
  AssistantProfileUpdateInput,
} from "./assistant-profile";
export type {
  UserProfile,
  UserProfileUpdateInput,
} from "./user-profile";
export type {
  ConfigItem,
  ConfigValueType,
} from "./profile-config";
