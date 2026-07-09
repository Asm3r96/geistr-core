import type { GeistrThinkingLevel } from "./provider-selection";

/**
 * Current app config version.
 * Increment when a migration is needed.
 */
export const APP_CONFIG_VERSION = 1;

// ── Schema types ──────────────────────────────────────────────

export type ThemeMode = "system" | "dark" | "light";

export interface AppConfigAppearance {
  /** How the UI colour scheme is chosen. */
  themeMode: ThemeMode;
  /**
   * Which theme preset to apply.
   * Only "geistr-default" exists in this slice.
   */
  themeId: string;
}

export interface AppConfigModel {
  /** Provider ID for the default model (null = not set). */
  defaultProvider: string | null;
  /** Model ID for the default model (null = not set). */
  defaultModelId: string | null;
  /** Default thinking level (null = let the model decide). */
  defaultThinkingLevel: GeistrThinkingLevel | null;
  /**
   * Last user-chosen model/thinking from the chat composer picker.
   * Takes precedence over the explicit default on app start / runtime creation.
   * The default* fields act only as fallback when no prior chat selection exists.
   */
  lastUsedProvider: string | null;
  lastUsedModelId: string | null;
  lastUsedThinkingLevel: GeistrThinkingLevel | null;
  /** Model keys ("provider/modelId") the user has starred. */
  favoriteModels: string[];
}

export interface AppConfigSessions {
  compaction: {
    /** Auto-compact session history to save tokens. */
    enabled: boolean;
  };
}

export interface AppConfigMemory {
  /** Whether cross-session memory is enabled. */
  enabled: boolean;
}

export type AppConfigPermissionMode = "read-only" | "ask-always" | "auto" | "full-access";

export interface AppConfigPermissions {
  /** Runtime tool approval behavior. */
  mode: AppConfigPermissionMode;
}

export interface AppConfigSkills {
  /** Skill names hidden from runtime prompts/tools. */
  disabledSkillNames: string[];
}

export type McpTransportType = "stdio" | "streamable-http";

export interface McpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  transport: McpTransportType;
  stdio?: {
    command: string;
    args: string[];
    cwd?: string | null;
    env: Array<{ key: string; secretRef?: string; value?: string }>;
    envPassthrough: string[];
  };
  http?: {
    url: string;
    auth: "none" | "api-key" | "oauth";
    headers?: Array<{ key: string; secretRef?: string; value?: string }>;
  };
  createdAt: number;
  updatedAt: number;
}

export interface AppConfigMcp {
  servers: McpServerConfig[];
}

export interface AppConfigWebAccess {
  /** Master toggle for all web tools. */
  enabled: boolean;
  /** Controls the web_search tool specifically. */
  searchEnabled: boolean;
  /** Controls the web_fetch tool specifically. */
  fetchEnabled: boolean;
  /** Backend provider identifier. Currently only "exa". */
  provider: "exa";
}

export interface AppConfig {
  /** Schema version for future migrations. */
  version: number;
  appearance: AppConfigAppearance;
  model: AppConfigModel;
  sessions: AppConfigSessions;
  memory: AppConfigMemory;
  permissions: AppConfigPermissions;
  skills: AppConfigSkills;
  mcp: AppConfigMcp;
  webAccess: AppConfigWebAccess;
}

/**
 * Deep partial variant of AppConfig for partial updates.
 * Each nested field can be partially provided.
 */
export type AppConfigUpdate = {
  version?: number;
  appearance?: Partial<AppConfigAppearance>;
  model?: Partial<AppConfigModel>;
  sessions?: { compaction?: Partial<AppConfigSessions["compaction"]> };
  memory?: Partial<AppConfigMemory>;
  permissions?: Partial<AppConfigPermissions>;
  skills?: Partial<AppConfigSkills>;
  mcp?: { servers?: McpServerConfig[] };
  webAccess?: Partial<AppConfigWebAccess>;
};

// ── Defaults ─────────────────────────────────────────────────

export const DEFAULT_APP_CONFIG: AppConfig = {
  version: APP_CONFIG_VERSION,
  appearance: {
    themeMode: "system",
    themeId: "geistr-default",
  },
  model: {
    defaultProvider: null,
    defaultModelId: null,
    defaultThinkingLevel: null,
    lastUsedProvider: null,
    lastUsedModelId: null,
    lastUsedThinkingLevel: null,
    favoriteModels: [],
  },
  sessions: {
    compaction: {
      enabled: true,
    },
  },
  memory: {
    enabled: false,
  },
  permissions: {
    mode: "auto",
  },
  skills: {
    disabledSkillNames: [],
  },
  mcp: {
    servers: [],
  },
  webAccess: {
    enabled: true,
    searchEnabled: true,
    fetchEnabled: true,
    provider: "exa",
  },
};

const VALID_THEME_MODES: readonly ThemeMode[] = ["system", "dark", "light"];
const VALID_PERMISSION_MODES: readonly AppConfigPermissionMode[] = ["read-only", "ask-always", "auto", "full-access"];

// ── Helpers ───────────────────────────────────────────────────

/**
 * Deep-merge a partial config into an existing config.
 * Returns a new object; the original is not mutated.
 */
export function mergeAppConfig(
  base: AppConfig,
  partial: AppConfigUpdate,
): AppConfig {
  return {
    ...base,
    ...partial,
    appearance: { ...base.appearance, ...(partial.appearance ?? {}) },
    model: { ...base.model, ...(partial.model ?? {}) },
    sessions: {
      ...base.sessions,
      ...(partial.sessions ?? {}),
      compaction: {
        ...base.sessions.compaction,
        ...(partial.sessions?.compaction ?? {}),
      },
    },
    memory: { ...base.memory, ...(partial.memory ?? {}) },
    permissions: { ...base.permissions, ...(partial.permissions ?? {}) },
    skills: { ...base.skills, ...(partial.skills ?? {}) },
    mcp: { ...base.mcp, ...(partial.mcp ?? {}) },
    webAccess: { ...base.webAccess, ...(partial.webAccess ?? {}) },
  };
}

/**
 * Sanitize an unknown / partial value into a valid AppConfig.
 * Missing or invalid fields are filled from defaults.
 */
export function sanitizeAppConfig(raw: unknown): AppConfig {
  if (!raw || typeof raw !== "object") {
    return deepCloneConfig(DEFAULT_APP_CONFIG);
  }

  const input = raw as Record<string, unknown>;

  return {
    version:
      typeof input.version === "number" && input.version >= 1
        ? input.version
        : APP_CONFIG_VERSION,
    appearance: sanitizeAppearance(input.appearance),
    model: sanitizeModel(input.model),
    sessions: sanitizeSessions(input.sessions),
    memory: sanitizeMemory(input.memory),
    permissions: sanitizePermissions(input.permissions),
    skills: sanitizeSkills(input.skills),
    mcp: sanitizeMcp(input.mcp),
    webAccess: sanitizeWebAccess(input.webAccess),
  };
}

function sanitizeAppearance(raw: unknown): AppConfigAppearance {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_APP_CONFIG.appearance };
  }
  const input = raw as Record<string, unknown>;
  const themeMode =
    typeof input.themeMode === "string" &&
    VALID_THEME_MODES.includes(input.themeMode as ThemeMode)
      ? (input.themeMode as ThemeMode)
      : DEFAULT_APP_CONFIG.appearance.themeMode;
  return {
    themeMode,
    themeId:
      typeof input.themeId === "string"
        ? input.themeId
        : DEFAULT_APP_CONFIG.appearance.themeId,
  };
}

function sanitizeModel(raw: unknown): AppConfigModel {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_APP_CONFIG.model };
  }
  const input = raw as Record<string, unknown>;
  return {
    defaultProvider:
      typeof input.defaultProvider === "string"
        ? input.defaultProvider
        : DEFAULT_APP_CONFIG.model.defaultProvider,
    defaultModelId:
      typeof input.defaultModelId === "string"
        ? input.defaultModelId
        : DEFAULT_APP_CONFIG.model.defaultModelId,
    defaultThinkingLevel:
      typeof input.defaultThinkingLevel === "string"
        ? (input.defaultThinkingLevel as GeistrThinkingLevel)
        : DEFAULT_APP_CONFIG.model.defaultThinkingLevel,
    lastUsedProvider:
      typeof input.lastUsedProvider === "string"
        ? input.lastUsedProvider
        : DEFAULT_APP_CONFIG.model.lastUsedProvider,
    lastUsedModelId:
      typeof input.lastUsedModelId === "string"
        ? input.lastUsedModelId
        : DEFAULT_APP_CONFIG.model.lastUsedModelId,
    lastUsedThinkingLevel:
      typeof input.lastUsedThinkingLevel === "string"
        ? (input.lastUsedThinkingLevel as GeistrThinkingLevel)
        : DEFAULT_APP_CONFIG.model.lastUsedThinkingLevel,
    favoriteModels: Array.isArray(input.favoriteModels)
      ? input.favoriteModels.filter(
          (m): m is string => typeof m === "string",
        )
      : [...DEFAULT_APP_CONFIG.model.favoriteModels],
  };
}

function sanitizeSessions(raw: unknown): AppConfigSessions {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_APP_CONFIG.sessions };
  }
  const input = raw as Record<string, unknown>;
  const compaction =
    input.compaction && typeof input.compaction === "object"
      ? (input.compaction as Record<string, unknown>)
      : {};
  return {
    compaction: {
      enabled:
        typeof compaction.enabled === "boolean"
          ? compaction.enabled
          : DEFAULT_APP_CONFIG.sessions.compaction.enabled,
    },
  };
}

function sanitizeMemory(raw: unknown): AppConfigMemory {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_APP_CONFIG.memory };
  }
  const input = raw as Record<string, unknown>;
  return {
    enabled:
      typeof input.enabled === "boolean"
        ? input.enabled
        : DEFAULT_APP_CONFIG.memory.enabled,
  };
}

function sanitizePermissions(raw: unknown): AppConfigPermissions {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_APP_CONFIG.permissions };
  }
  const input = raw as Record<string, unknown>;
  return {
    mode:
      typeof input.mode === "string" &&
      VALID_PERMISSION_MODES.includes(input.mode as AppConfigPermissionMode)
        ? (input.mode as AppConfigPermissionMode)
        : DEFAULT_APP_CONFIG.permissions.mode,
  };
}

function sanitizeSkills(raw: unknown): AppConfigSkills {
  if (!raw || typeof raw !== "object") {
    return { disabledSkillNames: [...DEFAULT_APP_CONFIG.skills.disabledSkillNames] };
  }
  const input = raw as Record<string, unknown>;
  return {
    disabledSkillNames: Array.isArray(input.disabledSkillNames)
      ? [...new Set(input.disabledSkillNames.filter((name): name is string => typeof name === "string" && name.trim().length > 0))]
      : [...DEFAULT_APP_CONFIG.skills.disabledSkillNames],
  };
}

function sanitizeMcp(raw: unknown): AppConfigMcp {
  if (!raw || typeof raw !== "object") return { servers: [] };
  const input = raw as Record<string, unknown>;
  return {
    servers: Array.isArray(input.servers)
      ? input.servers.map(sanitizeMcpServer).filter((server): server is McpServerConfig => Boolean(server))
      : [],
  };
}

function sanitizeMcpServer(raw: unknown): McpServerConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const id = typeof input.id === "string" && input.id.trim() ? input.id.trim() : "";
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : "";
  const transport = input.transport === "streamable-http" ? "streamable-http" : input.transport === "stdio" ? "stdio" : null;
  if (!id || !name || !transport) return null;
  const createdAt = typeof input.createdAt === "number" ? input.createdAt : Date.now();
  const updatedAt = typeof input.updatedAt === "number" ? input.updatedAt : createdAt;
  if (transport === "stdio") {
    const stdio = input.stdio && typeof input.stdio === "object" ? input.stdio as Record<string, unknown> : {};
    const command = typeof stdio.command === "string" ? stdio.command.trim() : "";
    if (!command) return null;
    return { id, name, enabled: input.enabled === true, transport: "stdio", createdAt, updatedAt, stdio: { command, args: Array.isArray(stdio.args) ? stdio.args.filter((arg): arg is string => typeof arg === "string") : [], cwd: typeof stdio.cwd === "string" && stdio.cwd.trim() ? stdio.cwd : null, env: sanitizeKeyValueRefs(stdio.env), envPassthrough: Array.isArray(stdio.envPassthrough) ? stdio.envPassthrough.filter((key): key is string => isEnvKey(key)) : [] } };
  }
  const http = input.http && typeof input.http === "object" ? input.http as Record<string, unknown> : {};
  const url = typeof http.url === "string" ? http.url.trim() : "";
  if (!url) return null;
  const auth = http.auth === "api-key" || http.auth === "oauth" ? http.auth : "none";
  return { id, name, enabled: input.enabled === true, transport: "streamable-http", createdAt, updatedAt, http: { url, auth, headers: sanitizeKeyValueRefs(http.headers) } };
}

function sanitizeKeyValueRefs(raw: unknown): Array<{ key: string; secretRef?: string; value?: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const key = typeof row.key === "string" ? row.key.trim() : "";
    if (!key) return [];
    return [{ key, ...(typeof row.secretRef === "string" ? { secretRef: row.secretRef } : {}), ...(typeof row.value === "string" ? { value: row.value } : {}) }];
  });
}

function isEnvKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function sanitizeWebAccess(raw: unknown): AppConfigWebAccess {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_APP_CONFIG.webAccess };
  }
  const input = raw as Record<string, unknown>;
  return {
    enabled:
      typeof input.enabled === "boolean"
        ? input.enabled
        : DEFAULT_APP_CONFIG.webAccess.enabled,
    searchEnabled:
      typeof input.searchEnabled === "boolean"
        ? input.searchEnabled
        : DEFAULT_APP_CONFIG.webAccess.searchEnabled,
    fetchEnabled:
      typeof input.fetchEnabled === "boolean"
        ? input.fetchEnabled
        : DEFAULT_APP_CONFIG.webAccess.fetchEnabled,
    provider:
      input.provider === "exa"
        ? "exa"
        : DEFAULT_APP_CONFIG.webAccess.provider,
  };
}

function deepCloneConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    appearance: { ...config.appearance },
    model: { ...config.model, favoriteModels: [...config.model.favoriteModels] },
    sessions: {
      ...config.sessions,
      compaction: { ...config.sessions.compaction },
    },
    memory: { ...config.memory },
    permissions: { ...config.permissions },
    skills: { disabledSkillNames: [...config.skills.disabledSkillNames] },
    mcp: { servers: config.mcp.servers.map(cloneMcpServer) },
    webAccess: { ...config.webAccess },
  };
}

function cloneMcpServer(server: McpServerConfig): McpServerConfig {
  if (server.transport === "stdio") {
    return {
      ...server,
      transport: "stdio",
      ...(server.stdio ? { stdio: { ...server.stdio, args: [...server.stdio.args], env: server.stdio.env.map((row) => ({ ...row })), envPassthrough: [...server.stdio.envPassthrough] } } : {}),
    };
  }
  const http = server.http
    ? { ...server.http, ...(server.http.headers ? { headers: server.http.headers.map((row) => ({ ...row })) } : {}) }
    : undefined;
  return {
    ...server,
    transport: "streamable-http",
    ...(http ? { http } : {}),
  };
}
