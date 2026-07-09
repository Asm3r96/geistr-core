// ---------------------------------------------------------------------------
// Profile Tools — safe Profile.read / Profile.write tool definitions for
// the agent to read and update its own profile, user profile, and app config
// ---------------------------------------------------------------------------

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

import type { ProfileStore } from "./profile-store";
import type { AssistantProfileUpdateInput } from "./assistant-profile";
import type { UserProfileUpdateInput } from "./user-profile";
import type { AppConfig, AppConfigUpdate } from "./app-config";

// ---------------------------------------------------------------------------
// Allowed patch field types
// ---------------------------------------------------------------------------

/** Flat enum-like values that accept only specific strings. */
const RESPONSE_DEPTH_OPTIONS = ["brief", "balanced", "deep"] as const;
const WARMTH_OPTIONS = ["low", "medium", "high"] as const;
const DIRECTNESS_OPTIONS = ["low", "medium", "high"] as const;
const THEME_MODE_OPTIONS = ["system", "dark", "light"] as const;

/** Allowed assistant profile patch fields for the agent surface. */
interface AgentAssistantProfilePatch {
  assistantName?: string;
  soulPrompt?: string;
  personaSummary?: string;
  rolePrompt?: string;
  stylePrompt?: string;
  boundaryPrompt?: string;
  memoryPrompt?: string;
  tone?: string;
  communicationStyle?: string;
  responseDepth?: (typeof RESPONSE_DEPTH_OPTIONS)[number];
  warmth?: (typeof WARMTH_OPTIONS)[number];
  directness?: (typeof DIRECTNESS_OPTIONS)[number];
}

const ALLOWED_ASSISTANT_PATCH_FIELDS = new Set<string>([
  "assistantName",
  "soulPrompt",
  "personaSummary",
  "rolePrompt",
  "stylePrompt",
  "boundaryPrompt",
  "memoryPrompt",
  "tone",
  "communicationStyle",
  "responseDepth",
  "warmth",
  "directness",
]);

/** Allowed user profile patch fields for the agent surface. */
interface AgentUserProfilePatch {
  displayName?: string;
  locale?: string;
  timezone?: string;
  languagePreferences?: string;
  activeGoals?: string;
  preferences?: string;
  constraints?: string;
  learningStyle?: string;
}

const ALLOWED_USER_PATCH_FIELDS = new Set<string>([
  "displayName",
  "locale",
  "timezone",
  "languagePreferences",
  "activeGoals",
  "preferences",
  "constraints",
  "learningStyle",
]);

/** Allowed app config patch fields for the agent surface. */
interface AgentAppConfigPatch {
  "appearance.themeMode"?: (typeof THEME_MODE_OPTIONS)[number];
  "sessions.compaction.enabled"?: boolean;
  "memory.enabled"?: boolean;
}

const ALLOWED_APPCONFIG_PATCH_FIELDS = new Set<string>([
  "appearance.themeMode",
  "sessions.compaction.enabled",
  "memory.enabled",
]);

// ---------------------------------------------------------------------------
// Max length constants
// ---------------------------------------------------------------------------

const MAX_LEN_SHORT = 240; // name, displayName, tone, communicationStyle, locale, timezone
const MAX_LEN_LONG = 16_000; // soulPrompt, rolePrompt, stylePrompt, boundaryPrompt, memoryPrompt, etc.
const MAX_LEN_DISPLAY_NAME = 120;

// ---------------------------------------------------------------------------
// Domain type
// ---------------------------------------------------------------------------

export type ProfileToolDomain = "assistantProfile" | "userProfile" | "appConfig";

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export interface ProfileToolError {
  ok: false;
  error: string;
}

export interface ProfileToolSuccess<T> {
  ok: true;
  data: T;
  changedFields: string[];
}

export type ProfileToolResult<T> = ProfileToolError | ProfileToolSuccess<T>;

function ok<T>(data: T, changedFields: string[]): ProfileToolSuccess<T> {
  return { ok: true, data, changedFields };
}

function err(error: string): ProfileToolError {
  return { ok: false, error };
}

/** Reject unknown keys in the patch. */
function rejectUnknownFields(
  patch: Record<string, unknown>,
  allowed: Set<string>,
  domain: string,
): string | null {
  const unknown = Object.keys(patch).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    return `Unknown ${domain} patch field(s): ${unknown.join(", ")}`;
  }
  return null;
}

/** Reject or warn empty patch (no fields set). */
function rejectEmptyPatch(patch: Record<string, unknown>): string | null {
  if (Object.keys(patch).length === 0) {
    return "Patch is empty — no fields to update.";
  }
  return null;
}

function validateStringLength(value: unknown, maxLen: number, field: string): string | null {
  if (typeof value !== "string") return null; // skip non-string fields
  const trimmed = value.trim();
  if (trimmed.length > maxLen) {
    return `Field "${field}" exceeds maximum length of ${maxLen} characters (got ${trimmed.length}).`;
  }
  return null;
}

function validateEnum<T extends string>(
  value: unknown,
  options: readonly T[],
  field: string,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    return `Field "${field}" must be a string, got ${typeof value}.`;
  }
  if (!(options as readonly string[]).includes(value)) {
    return `Field "${field}" must be one of: ${options.join(", ")}. Got: "${value}".`;
  }
  return null;
}

function validateBoolean(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") {
    return `Field "${field}" must be a boolean, got ${typeof value}.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Patch validation (per domain)
// ---------------------------------------------------------------------------

function validateAssistantPatch(patch: Record<string, unknown>): string | null {
  const emptyErr = rejectEmptyPatch(patch);
  if (emptyErr) return emptyErr;

  const unknownErr = rejectUnknownFields(patch, ALLOWED_ASSISTANT_PATCH_FIELDS, "assistantProfile");
  if (unknownErr) return unknownErr;

  // Validate short string fields
  for (const field of ["assistantName", "tone", "communicationStyle"] as const) {
    const err = validateStringLength(patch[field], MAX_LEN_SHORT, field);
    if (err) return err;
  }

  // Validate long string fields
  for (const field of ["soulPrompt", "personaSummary", "rolePrompt", "stylePrompt", "boundaryPrompt", "memoryPrompt"] as const) {
    const err = validateStringLength(patch[field], MAX_LEN_LONG, field);
    if (err) return err;
  }

  // Validate enum fields
  const enumErrs = [
    validateEnum(patch.responseDepth, RESPONSE_DEPTH_OPTIONS, "responseDepth"),
    validateEnum(patch.warmth, WARMTH_OPTIONS, "warmth"),
    validateEnum(patch.directness, DIRECTNESS_OPTIONS, "directness"),
  ].filter((e): e is string => e !== null);

  if (enumErrs.length > 0) return enumErrs.join("; ");

  return null;
}

function validateUserPatch(patch: Record<string, unknown>): string | null {
  const emptyErr = rejectEmptyPatch(patch);
  if (emptyErr) return emptyErr;

  const unknownErr = rejectUnknownFields(patch, ALLOWED_USER_PATCH_FIELDS, "userProfile");
  if (unknownErr) return unknownErr;

  // Validate short string fields
  for (const field of ["displayName", "locale", "timezone", "languagePreferences"] as const) {
    const maxLen = field === "displayName" ? MAX_LEN_DISPLAY_NAME : MAX_LEN_SHORT;
    const err = validateStringLength(patch[field], maxLen, field);
    if (err) return err;
  }

  // Validate long string fields
  for (const field of ["activeGoals", "preferences", "constraints", "learningStyle"] as const) {
    const err = validateStringLength(patch[field], MAX_LEN_LONG, field);
    if (err) return err;
  }

  return null;
}

function validateAppConfigPatch(patch: Record<string, unknown>): string | null {
  const emptyErr = rejectEmptyPatch(patch);
  if (emptyErr) return emptyErr;

  const unknownErr = rejectUnknownFields(patch, ALLOWED_APPCONFIG_PATCH_FIELDS, "appConfig");
  if (unknownErr) return unknownErr;

  // Validate enum fields
  const enumErr = validateEnum(patch["appearance.themeMode"], THEME_MODE_OPTIONS, "appearance.themeMode");
  if (enumErr) return enumErr;

  // Validate boolean fields
  const boolErrFields = ["sessions.compaction.enabled", "memory.enabled"];
  for (const field of boolErrFields) {
    const err = validateBoolean(patch[field], field);
    if (err) return err;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Patch conversion (translate flat agent patch → domain update input)
// ---------------------------------------------------------------------------

function assistantPatchToUpdateInput(
  patch: Record<string, unknown>,
): AssistantProfileUpdateInput {
  const input: AssistantProfileUpdateInput = {};
  const allowedPatches = patch as Record<string, unknown>;
  for (const key of Object.keys(patch)) {
    const value = allowedPatches[key];
    if (value !== undefined && value !== null) {
      (input as Record<string, unknown>)[key] = typeof value === "string" ? String(value).trim() : value;
    }
  }
  return input;
}

function userPatchToUpdateInput(
  patch: Record<string, unknown>,
): UserProfileUpdateInput {
  const input: UserProfileUpdateInput = {};
  for (const key of Object.keys(patch)) {
    const value = (patch as Record<string, unknown>)[key];
    if (value !== undefined && value !== null) {
      (input as Record<string, unknown>)[key] = typeof value === "string" ? String(value).trim() : value;
    }
  }
  return input;
}

function appConfigPatchToUpdate(patch: Record<string, unknown>): AppConfigUpdate {
  const update: AppConfigUpdate = {};

  if (patch["appearance.themeMode"] !== undefined) {
    update.appearance = { themeMode: String(patch["appearance.themeMode"]) as AppConfig["appearance"]["themeMode"] };
  }

  if (patch["sessions.compaction.enabled"] !== undefined) {
    update.sessions = {
      compaction: { enabled: Boolean(patch["sessions.compaction.enabled"]) },
    };
  }

  if (patch["memory.enabled"] !== undefined) {
    update.memory = { enabled: Boolean(patch["memory.enabled"]) };
  }

  return update;
}

// ---------------------------------------------------------------------------
// Tool definitions factory
// ---------------------------------------------------------------------------

/**
 * Create the tool definitions for Profile.read and Profile.write, wired to a
 * concrete ProfileStore instance.
 *
 * Returns two ToolDefinition objects suitable for passing via `customTools` to
 * `createAgentSession` (or the Geistr runtime wrapper).
 */
export function createProfileToolDefinitions(
  store: ProfileStore,
): ToolDefinition[] {
  const profileReadTool = defineTool({
    name: "profile_read",
    label: "Profile Read",
    description:
      "Read the current assistant profile, user profile, or app config. " +
      "Returns the full JSON object for the requested domain.",
    parameters: Type.Object({
      domain: Type.Union(
        [
          Type.Literal("assistantProfile"),
          Type.Literal("userProfile"),
          Type.Literal("appConfig"),
        ],
        { description: "Which profile/config to read." },
      ),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      const result = executeProfileRead(store, params.domain);
      if (!result.ok) {
        return {
          content: [{ type: "text", text: result.error }],
          details: {},
        };
      }
      return {
        content: [
          { type: "text", text: JSON.stringify(result.data, null, 2) },
        ],
        details: { domain: params.domain },
      };
    },
  });

  const profileWriteTool = defineTool({
    name: "profile_write",
    label: "Profile Write",
    description:
      "Update the assistant profile, user profile, or app config. " +
      "Use this to change your own Name, Soul, Role, Style, Boundaries, " +
      "Memory guidance, tone, or recurring user-facing behavior " +
      "(domain: assistantProfile). " +
      "Use this to change the user's display name, locale, timezone, " +
      "language preferences, goals, preferences, constraints, or " +
      "learning style (domain: userProfile). " +
      "Use this to change app appearance or session preferences " +
      "(domain: appConfig. Allowed fields: appearance.themeMode, " +
      "sessions.compaction.enabled, memory.enabled). " +
      "Returns the updated object and a list of changed fields.",
    parameters: Type.Object({
      domain: Type.Union(
        [
          Type.Literal("assistantProfile"),
          Type.Literal("userProfile"),
          Type.Literal("appConfig"),
        ],
        { description: "Which profile/config to update." },
      ),
      action: Type.Literal("update", {
        description: "The action to perform. Currently only 'update' is supported.",
      }),
      patch: Type.Record(Type.String(), Type.Unknown(), {
        description:
          "Fields to update. For assistantProfile: assistantName, soulPrompt, " +
          "personaSummary, rolePrompt, stylePrompt, boundaryPrompt, memoryPrompt, " +
          "tone, communicationStyle, responseDepth (brief|balanced|deep), " +
          "warmth (low|medium|high), directness (low|medium|high). " +
          "For userProfile: displayName, locale, timezone, languagePreferences, " +
          "activeGoals, preferences, constraints, learningStyle. " +
          "For appConfig: appearance.themeMode (system|dark|light), " +
          "sessions.compaction.enabled, memory.enabled.",
      }),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      const result = executeProfileWrite(store, params.domain, params.action, params.patch);
      if (!result.ok) {
        return {
          content: [{ type: "text", text: result.error }],
          details: {},
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                updated: result.data,
                changedFields: result.changedFields,
              },
              null,
              2,
            ),
          },
        ],
        details: {
          domain: params.domain,
          changedFields: result.changedFields,
        },
      };
    },
  });

  return [profileReadTool, profileWriteTool];
}

// ---------------------------------------------------------------------------
// Pure logic: executeProfileRead / executeProfileWrite
// (exported separately for testing without a live store)
// ---------------------------------------------------------------------------

export function executeProfileRead(
  store: ProfileStore,
  domain: string,
): ProfileToolResult<unknown> {
  if (domain === "assistantProfile") {
    const profile = store.getAssistantProfile();
    return ok(profile, ["*"]);
  }

  if (domain === "userProfile") {
    const profile = store.getUserProfile();
    return ok(profile, ["*"]);
  }

  if (domain === "appConfig") {
    const config = store.getAllConfigValues();
    return ok(config, ["*"]);
  }

  return err(`Unknown domain: "${domain}". Valid domains: assistantProfile, userProfile, appConfig.`);
}

export function executeProfileWrite(
  store: ProfileStore,
  domain: string,
  action: string,
  patch: Record<string, unknown>,
): ProfileToolResult<unknown> {
  // — Validate action
  if (action !== "update") {
    return err(`Unsupported action: "${action}". Only "update" is supported.`);
  }

  // — Validate and apply per domain
  if (domain === "assistantProfile") {
    const validationErr = validateAssistantPatch(patch);
    if (validationErr) return err(validationErr);

    const mapped = assistantPatchToUpdateInput(patch);
    const previous = store.getAssistantProfile();
    const updated = store.updateAssistantProfile(mapped);
    const changedFields = computeChangedFields(previous, updated, ALLOWED_ASSISTANT_PATCH_FIELDS);
    return ok(updated, changedFields);
  }

  if (domain === "userProfile") {
    const validationErr = validateUserPatch(patch);
    if (validationErr) return err(validationErr);

    const mapped = userPatchToUpdateInput(patch);
    const previous = store.getUserProfile();
    const updated = store.updateUserProfile(mapped);
    const changedFields = computeChangedFields(previous, updated, ALLOWED_USER_PATCH_FIELDS);
    return ok(updated, changedFields);
  }

  if (domain === "appConfig") {
    const validationErr = validateAppConfigPatch(patch);
    if (validationErr) return err(validationErr);

    const changedFields: string[] = [];

    if (patch["appearance.themeMode"] !== undefined) {
      const mode = String(patch["appearance.themeMode"]).trim() as AppConfig["appearance"]["themeMode"];
      store.setConfigValue("appearance.themeMode", mode, "string");
      changedFields.push("appearance.themeMode");
    }

    if (patch["sessions.compaction.enabled"] !== undefined) {
      const enabled = Boolean(patch["sessions.compaction.enabled"]);
      store.setConfigValue("sessions.compaction.enabled", enabled, "boolean");
      changedFields.push("sessions.compaction.enabled");
    }

    if (patch["memory.enabled"] !== undefined) {
      const enabled = Boolean(patch["memory.enabled"]);
      store.setConfigValue("memory.enabled", enabled, "boolean");
      changedFields.push("memory.enabled");
    }

    const allConfigs = store.getAllConfigValues();
    return ok(allConfigs, changedFields);
  }

  return err(`Unknown domain: "${domain}". Valid domains: assistantProfile, userProfile, appConfig.`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compare two objects on the allowed fields and return the names of fields
 * whose values have changed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function computeChangedFields<T extends Record<string, any>>(
  before: T,
  after: T,
  allowedFields: Set<string>,
): string[] {
  const changed: string[] = [];
  for (const field of allowedFields) {
    const bv = (before as Record<string, unknown>)[field];
    const av = (after as Record<string, unknown>)[field];
    if (JSON.stringify(bv) !== JSON.stringify(av)) {
      changed.push(field);
    }
  }
  return changed;
}
