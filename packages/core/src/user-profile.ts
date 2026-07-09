// ---------------------------------------------------------------------------
// User Profile — types, defaults, DB schema, read/update
// ---------------------------------------------------------------------------

export interface UserProfile {
  displayName: string;
  locale: string;
  timezone: string;
  languagePreferences: string;
  activeGoals: string;
  preferences: string;
  constraints: string;
  learningStyle: string;
  imagePath: string;
  imageUpdatedAt: number;
}

export function createDefaultUserProfile(): UserProfile {
  return {
    displayName: "",
    locale: "en-US",
    timezone: "UTC",
    languagePreferences: "English",
    activeGoals: "",
    preferences: "",
    constraints: "",
    learningStyle: "",
    imagePath: "",
    imageUpdatedAt: 0,
  };
}

export const USER_PROFILE_SCHEMA_SQL =
  "CREATE TABLE IF NOT EXISTS profile_user (" +
  "id TEXT PRIMARY KEY NOT NULL, " +
  "display_name TEXT NOT NULL, " +
  "locale TEXT NOT NULL, " +
  "timezone TEXT NOT NULL, " +
  "language_preferences TEXT NOT NULL, " +
  "active_goals TEXT NOT NULL, " +
  "preferences TEXT NOT NULL, " +
  "constraints TEXT NOT NULL, " +
  "updated_at INTEGER NOT NULL, " +
  "learning_style TEXT NOT NULL DEFAULT '', " +
  "image_path TEXT NOT NULL DEFAULT '', " +
  "image_updated_at INTEGER NOT NULL DEFAULT 0" +
  ")";

// ---------------------------------------------------------------------------
// Helpers for SQLite row conversion
// ---------------------------------------------------------------------------

export function rowToUserProfile(row: Record<string, unknown>): UserProfile {
  return {
    displayName: asString(row.display_name),
    locale: asString(row.locale, "en-US"),
    timezone: asString(row.timezone, "UTC"),
    languagePreferences: asString(row.language_preferences, "English"),
    activeGoals: asString(row.active_goals),
    preferences: asString(row.preferences),
    constraints: asString(row.constraints),
    learningStyle: asString(row.learning_style),
    imagePath: asString(row.image_path),
    imageUpdatedAt: asNumber(row.image_updated_at),
  };
}

export function userProfileToRow(
  profile: UserProfile,
  now: number,
): Record<string, unknown> {
  return {
    id: "user-profile",
    display_name: profile.displayName,
    locale: profile.locale,
    timezone: profile.timezone,
    language_preferences: profile.languagePreferences,
    active_goals: profile.activeGoals,
    preferences: profile.preferences,
    constraints: profile.constraints,
    updated_at: now,
    learning_style: profile.learningStyle,
    image_path: profile.imagePath,
    image_updated_at: profile.imageUpdatedAt,
  };
}

export interface UserProfileUpdateInput {
  displayName?: string;
  locale?: string;
  timezone?: string;
  languagePreferences?: string;
  activeGoals?: string;
  preferences?: string;
  constraints?: string;
  learningStyle?: string;
  imagePath?: string;
  imageUpdatedAt?: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type SqliteDb = {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...params: unknown[]): { changes?: number } | unknown;
    get(...params: unknown[]): unknown;
  };
  close(): void;
};

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// ---------------------------------------------------------------------------
// Schema operations
// ---------------------------------------------------------------------------

export function ensureUserProfileSchema(db: SqliteDb): void {
  db.exec(USER_PROFILE_SCHEMA_SQL);
}

export function readUserProfile(db: SqliteDb): UserProfile {
  const row = db.prepare("SELECT * FROM profile_user LIMIT 1").get() as Record<string, unknown> | undefined;
  if (!row) return createDefaultUserProfile();
  return rowToUserProfile(row);
}

export function insertUserProfileIfMissing(db: SqliteDb, now: number): void {
  const existing = db.prepare("SELECT id FROM profile_user WHERE id = ?").get("user-profile") as Record<string, unknown> | undefined;
  if (existing) return;

  const profile = createDefaultUserProfile();
  const row = userProfileToRow(profile, now);
  db.prepare(
    "INSERT INTO profile_user (id, display_name, locale, timezone, language_preferences, active_goals, preferences, constraints, updated_at, learning_style, image_path, image_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    row.id, row.display_name, row.locale, row.timezone, row.language_preferences,
    row.active_goals, row.preferences, row.constraints, row.updated_at,
    row.learning_style, row.image_path, row.image_updated_at,
  );
}

export function updateUserProfile(db: SqliteDb, input: UserProfileUpdateInput, now: number): UserProfile {
  const current = readUserProfile(db);

  const next: UserProfile = {
    displayName: input.displayName?.trim() ?? current.displayName,
    locale: input.locale?.trim() ?? current.locale,
    timezone: input.timezone?.trim() ?? current.timezone,
    languagePreferences: input.languagePreferences?.trim() ?? current.languagePreferences,
    activeGoals: input.activeGoals?.trim() ?? current.activeGoals,
    preferences: input.preferences?.trim() ?? current.preferences,
    constraints: input.constraints?.trim() ?? current.constraints,
    learningStyle: input.learningStyle?.trim() ?? current.learningStyle,
    imagePath: input.imagePath?.trim() ?? current.imagePath,
    imageUpdatedAt: input.imageUpdatedAt ?? current.imageUpdatedAt,
  };

  const row = userProfileToRow(next, now);
  db.prepare(
    "INSERT INTO profile_user (id, display_name, locale, timezone, language_preferences, active_goals, preferences, constraints, updated_at, learning_style, image_path, image_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET " +
    "display_name = excluded.display_name, " +
    "locale = excluded.locale, " +
    "timezone = excluded.timezone, " +
    "language_preferences = excluded.language_preferences, " +
    "active_goals = excluded.active_goals, " +
    "preferences = excluded.preferences, " +
    "constraints = excluded.constraints, " +
    "updated_at = excluded.updated_at, " +
    "learning_style = excluded.learning_style, " +
    "image_path = excluded.image_path, " +
    "image_updated_at = excluded.image_updated_at"
  ).run(
    row.id, row.display_name, row.locale, row.timezone, row.language_preferences,
    row.active_goals, row.preferences, row.constraints, row.updated_at,
    row.learning_style, row.image_path, row.image_updated_at,
  );

  return readUserProfile(db);
}
