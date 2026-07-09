import { describe, expect, it } from "vitest";
import {
  APP_CONFIG_VERSION,
  DEFAULT_APP_CONFIG,
  mergeAppConfig,
  sanitizeAppConfig,
} from "../src/app-config";
import type { AppConfig } from "../src/app-config";

const minimalRaw: AppConfig = {
  version: 1,
  appearance: { themeMode: "system", themeId: "geistr-default" },
  model: {
    defaultProvider: null,
    defaultModelId: null,
    defaultThinkingLevel: null,
    lastUsedProvider: null,
    lastUsedModelId: null,
    lastUsedThinkingLevel: null,
    favoriteModels: [],
  },
  sessions: { compaction: { enabled: true } },
  memory: { enabled: false },
  permissions: { mode: "auto" },
  skills: { disabledSkillNames: [] },
  mcp: { servers: [] },
  webAccess: { enabled: true, searchEnabled: true, fetchEnabled: true, provider: "exa" },
};

const fullRaw: AppConfig = {
  version: 1,
  appearance: { themeMode: "dark", themeId: "geistr-default" },
  model: {
    defaultProvider: "anthropic",
    defaultModelId: "claude-sonnet-5",
    defaultThinkingLevel: "high",
    lastUsedProvider: null,
    lastUsedModelId: null,
    lastUsedThinkingLevel: null,
    favoriteModels: ["anthropic/claude-sonnet-5"],
  },
  sessions: { compaction: { enabled: false } },
  memory: { enabled: true },
  permissions: { mode: "ask-always" },
  skills: { disabledSkillNames: ["drafting"] },
  mcp: { servers: [] },
  webAccess: { enabled: true, searchEnabled: true, fetchEnabled: true, provider: "exa" },
};

describe("app-config", () => {
  // ── Constants ───────────────────────────────────────────

  it("exports expected version", () => {
    expect(APP_CONFIG_VERSION).toBe(1);
  });

  it("has a valid default config", () => {
    expect(DEFAULT_APP_CONFIG).toEqual({
      version: 1,
      appearance: { themeMode: "system", themeId: "geistr-default" },
      model: {
        defaultProvider: null,
        defaultModelId: null,
        defaultThinkingLevel: null,
        lastUsedProvider: null,
        lastUsedModelId: null,
        lastUsedThinkingLevel: null,
        favoriteModels: [],
      },
      sessions: { compaction: { enabled: true } },
      memory: { enabled: false },
      permissions: { mode: "auto" },
      skills: { disabledSkillNames: [] },
      mcp: { servers: [] },
      webAccess: { enabled: true, searchEnabled: true, fetchEnabled: true, provider: "exa" },
    });
  });

  // ── sanitizeAppConfig ───────────────────────────────────

  it("sanitize returns defaults for null / undefined", () => {
    expect(sanitizeAppConfig(null)).toEqual(DEFAULT_APP_CONFIG);
    expect(sanitizeAppConfig(undefined)).toEqual(DEFAULT_APP_CONFIG);
  });

  it("sanitize returns defaults for non-object", () => {
    expect(sanitizeAppConfig("garbage")).toEqual(DEFAULT_APP_CONFIG);
    expect(sanitizeAppConfig(42)).toEqual(DEFAULT_APP_CONFIG);
  });

  it("sanitize fills missing sections with defaults", () => {
    const result = sanitizeAppConfig({ version: 1 });
    expect(result).toEqual(DEFAULT_APP_CONFIG);
  });

  it("sanitize preserves valid fields", () => {
    const result = sanitizeAppConfig(fullRaw);
    expect(result).toEqual(fullRaw);
  });

  it("sanitize clamps invalid themeMode to system", () => {
    const result = sanitizeAppConfig({
      version: 1,
      appearance: { themeMode: "rainbow" },
    });
    expect(result.appearance.themeMode).toBe("system");
  });

  it("sanitize preserves valid themeMode values", () => {
    for (const mode of ["system", "dark", "light"] as const) {
      const result = sanitizeAppConfig({
        version: 1,
        appearance: { themeMode: mode },
      });
      expect(result.appearance.themeMode).toBe(mode);
    }
  });

  it("sanitize ensures model.favoriteModels is an array of strings", () => {
    const result = sanitizeAppConfig({
      version: 1,
      model: { favoriteModels: [42, "a/b", null] },
    });
    expect(result.model.favoriteModels).toEqual(["a/b"]);
  });

  it("sanitize fills partial nested objects with defaults", () => {
    const result = sanitizeAppConfig({
      version: 1,
      appearance: { themeMode: "light" },
      // model, sessions, memory are missing
    });
    expect(result.appearance.themeMode).toBe("light");
    expect(result.appearance.themeId).toBe("geistr-default");
    expect(result.model).toEqual(DEFAULT_APP_CONFIG.model);
    expect(result.sessions).toEqual(DEFAULT_APP_CONFIG.sessions);
    expect(result.memory).toEqual(DEFAULT_APP_CONFIG.memory);
    expect(result.permissions).toEqual(DEFAULT_APP_CONFIG.permissions);
    expect(result.skills).toEqual(DEFAULT_APP_CONFIG.skills);
  });

  // ── mergeAppConfig ──────────────────────────────────────

  it("merge combines top-level fields", () => {
    const merged = mergeAppConfig(DEFAULT_APP_CONFIG, {
      memory: { enabled: true },
    });
    expect(merged.memory.enabled).toBe(true);
    expect(merged.appearance).toEqual(DEFAULT_APP_CONFIG.appearance);
  });

  it("merge combines nested appearance fields", () => {
    const merged = mergeAppConfig(DEFAULT_APP_CONFIG, {
      appearance: { themeMode: "dark" },
    });
    expect(merged.appearance.themeMode).toBe("dark");
    expect(merged.appearance.themeId).toBe("geistr-default");
  });

  it("merge combines nested model fields", () => {
    const merged = mergeAppConfig(DEFAULT_APP_CONFIG, {
      model: { defaultProvider: "openai" },
    });
    expect(merged.model.defaultProvider).toBe("openai");
    expect(merged.model.defaultModelId).toBeNull();
  });

  it("merge combines nested sessions.compaction", () => {
    const merged = mergeAppConfig(DEFAULT_APP_CONFIG, {
      sessions: { compaction: { enabled: false } },
    });
    expect(merged.sessions.compaction.enabled).toBe(false);
  });

  it("merge preserves existing fields when partial is empty", () => {
    const base: AppConfig = {
      ...minimalRaw,
      model: { ...minimalRaw.model, favoriteModels: ["a/b"] },
    };
    const merged = mergeAppConfig(base, {});
    expect(merged.model.favoriteModels).toEqual(["a/b"]);
    expect(merged.appearance.themeMode).toBe("system");
  });

  it("merge does not mutate the original base", () => {
    const base = { ...minimalRaw };
    const before = { ...base };
    mergeAppConfig(base, { memory: { enabled: true } });
    expect(base).toEqual(before);
  });
});
