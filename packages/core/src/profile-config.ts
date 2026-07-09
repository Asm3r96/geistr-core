// ---------------------------------------------------------------------------
// Profile Config — key/value table for app settings stored with profiles
// ---------------------------------------------------------------------------

export type ConfigValueType = "string" | "boolean" | "json";

export interface ConfigItem {
  key: string;
  value: unknown;
  valueType: ConfigValueType;
  updatedAt: number;
}

export const PROFILE_CONFIG_SCHEMA_SQL =
  "CREATE TABLE IF NOT EXISTS profile_config (" +
  "key TEXT PRIMARY KEY NOT NULL, " +
  "value_json TEXT NOT NULL, " +
  "value_type TEXT NOT NULL, " +
  "updated_at INTEGER NOT NULL" +
  ")";

export const DEFAULT_CONFIG_DEFINITIONS: readonly {
  key: string;
  valueType: ConfigValueType;
  defaultValue: unknown;
}[] = [
  {
    key: "onboarding_done",
    valueType: "boolean",
    defaultValue: false,
  },
  {
    key: "localization.app_language",
    valueType: "string",
    defaultValue: "en",
  },
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type SqliteDb = {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...params: unknown[]): { changes?: number } | unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
};

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseStoredConfigValue(row: Record<string, unknown> | undefined): ConfigItem | null {
  if (!row) return null;
  const key = asString(row.key).trim();
  if (!key) return null;
  const rawType = asString(row.value_type);
  const valueType: ConfigValueType =
    rawType === "boolean" || rawType === "string" || rawType === "json" ? rawType : "json";
  const valueJson = asString(row.value_json);
  let value: unknown = null;
  try {
    value = JSON.parse(valueJson);
  } catch {
    value = valueType === "string" ? valueJson : null;
  }
  return { key, value, valueType, updatedAt: asNumber(row.updated_at) };
}

// ---------------------------------------------------------------------------
// Schema operations
// ---------------------------------------------------------------------------

export function ensureProfileConfigSchema(db: SqliteDb): void {
  db.exec(PROFILE_CONFIG_SCHEMA_SQL);
}

export function readConfigValue(db: SqliteDb, key: string): ConfigItem | null {
  const row = db.prepare("SELECT key, value_json, value_type, updated_at FROM profile_config WHERE key = ?").get(key) as Record<string, unknown> | undefined;
  return parseStoredConfigValue(row);
}

export function readAllConfigValues(db: SqliteDb): ConfigItem[] {
  const rows = db.prepare("SELECT key, value_json, value_type, updated_at FROM profile_config ORDER BY key ASC").all() as Record<string, unknown>[];
  return rows.map(parseStoredConfigValue).filter((item): item is ConfigItem => item !== null);
}

export function writeConfigValue(db: SqliteDb, key: string, value: unknown, valueType: ConfigValueType, now: number): ConfigItem {
  db.prepare(
    "INSERT INTO profile_config (key, value_json, value_type, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, value_type = excluded.value_type, updated_at = excluded.updated_at"
  ).run(key, JSON.stringify(value), valueType, now);
  const item = readConfigValue(db, key);
  if (!item) throw new Error(`Failed to save config key: ${key}`);
  return item;
}

export function seedDefaultProfileConfig(db: SqliteDb, now: number): void {
  ensureProfileConfigSchema(db);
  for (const def of DEFAULT_CONFIG_DEFINITIONS) {
    db.prepare(
      "INSERT INTO profile_config (key, value_json, value_type, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO NOTHING"
    ).run(def.key, JSON.stringify(def.defaultValue), def.valueType, now);
  }
}
