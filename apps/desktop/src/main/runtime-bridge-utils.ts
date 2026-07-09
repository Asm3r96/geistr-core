import type { AppConfig, CoreProviderAuthEvent, PendingLoopResult } from "@geistr/core";
import type { DesktopChatMessage, DesktopProviderSettingsState } from "../shared/desktop-api";

export function formatMcpPromptSection(statuses: Array<{ serverId: string; status: string; toolCount: number; error?: string }>): string {
  const lines = ["MCP tools come from user-configured external servers and may be unavailable or untrusted.", "Use MCP tools only when relevant to the user request. Do not ask the user to paste MCP secrets into chat; use Settings → MCP Servers.", "Do not claim an MCP action succeeded unless the MCP tool result returned success."];
  for (const status of statuses) lines.push(`- ${status.serverId}: ${status.status}, ${status.toolCount} tool(s)${status.error ? `, error: ${status.error}` : ""}`);
  return lines.join("\n");
}

export function formatToolPermissionPrompt(mode: AppConfig["permissions"]["mode"]): string {
  const prompts: Record<AppConfig["permissions"]["mode"], string> = {
    "read-only": "Permission mode is Read only. You may read files and internal state, but file/shell mutation tools are unavailable. Do not claim you can create, edit, or delete files in this mode.",
    "ask-always": "Permission mode is Request approval. Use Geistr-controlled file_write, file_edit, and shell_run when the user explicitly asks for file/shell mutations. Do not ask for chat confirmation instead; calling the tool will pause execution and show the app approval widget. If the user asks to test approval, actually call the relevant tool.",
    "full-access": "Permission mode is Full access. File and shell tools may run without approval except for blocked catastrophic actions.",
    auto: "Permission mode is Default. Safe reads and low-risk internal mutations may run automatically; risky shell actions require app approval.",
  };
  return prompts[mode];
}

export function formatPendingLoopResults(results: PendingLoopResult[]): string {
  const instruction = "These are completed background loop results for this same session. If the user asks whether a background loop finished, use this section as source of truth.";
  const formattedResults = results.map((result) => [`runId: ${result.runId}`, `loopId: ${result.loopId}`, `status: ${result.status}`, `summary: ${result.summary}`, result.artifactIds.length ? `artifacts: ${result.artifactIds.join(", ")}` : "artifacts: none"].join("\n")).join("\n\n");
  return [instruction, formattedResults].join("\n\n");
}

export function extractSimpleText(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const record = event as Record<string, unknown>;
  for (const key of ["text", "delta", "content", "message"]) if (typeof record[key] === "string") return record[key];
  return null;
}

const RUNTIME_FAILURE_FIELD_KEYS = ["errorMessage", "message", "messages"] as const;
const ASSISTANT_FAILURE_FIELD_KEYS = ["role", "stopReason", "errorMessage"] as const;
const UNSAFE_RUNTIME_FAILURE_MESSAGE = "The provider request failed, but the error event could not be inspected safely.";

export function extractRuntimeProviderFailure(event: Record<string, unknown>): Error | null {
  try {
    return extractRuntimeProviderFailureUnsafe(event);
  } catch (error) {
    if (isStackOverflowError(error)) return buildUnsafeRuntimeFailureError();
    return buildRuntimeFailureError(error instanceof Error ? error.message : String(error));
  }
}

function extractRuntimeProviderFailureUnsafe(event: Record<string, unknown>): Error | null {
  if (hasUnsafeRuntimeFailureAccessors(event)) return buildUnsafeRuntimeFailureError();

  const directError = safeTrimmedString(event, "errorMessage");
  if (directError) return buildRuntimeFailureError(directError);

  const message = safeRecordProperty(event, "message");
  if (message) {
    if (hasUnsafeAssistantFailureAccessors(message)) return buildUnsafeRuntimeFailureError();
    const messageError = extractAssistantErrorMessage(message);
    if (messageError) return buildRuntimeFailureError(messageError);
  }

  const messages = readOwnDataProperty(event, "messages");
  if (Array.isArray(messages)) {
    const count = safeArrayLength(messages);
    for (let index = count - 1; index >= 0; index -= 1) {
      const item = safeArrayItem(messages, index);
      if (!item || typeof item !== "object") continue;
      if (hasUnsafeAssistantFailureAccessors(item)) return buildUnsafeRuntimeFailureError();
      const itemError = extractAssistantErrorMessage(item as Record<string, unknown>);
      if (itemError) return buildRuntimeFailureError(itemError);
    }
  }
  return null;
}

function buildRuntimeFailureError(message: string): Error {
  const trimmed = message.length > 8_000 ? message.slice(0, 8_000) : message;
  const error = Object.create(Error.prototype) as Error;
  error.name = "Error";
  error.message = trimmed;
  return error;
}

function buildUnsafeRuntimeFailureError(): Error {
  return buildRuntimeFailureError(UNSAFE_RUNTIME_FAILURE_MESSAGE);
}

function isStackOverflowError(error: unknown): boolean {
  return error instanceof RangeError || (error instanceof Error && /maximum call stack|call stack size/i.test(error.message));
}

function hasUnsafeRuntimeFailureAccessors(record: object): boolean {
  return RUNTIME_FAILURE_FIELD_KEYS.some((key) => hasAccessorProperty(record, key));
}

function hasUnsafeAssistantFailureAccessors(record: object): boolean {
  return ASSISTANT_FAILURE_FIELD_KEYS.some((key) => hasAccessorProperty(record, key));
}

function hasAccessorProperty(record: object, key: string): boolean {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return Boolean(descriptor && typeof descriptor.get === "function");
  } catch {
    return true;
  }
}

export function runtimeMessageEndedSuccessfully(event: Record<string, unknown>): boolean {
  try {
    if (hasUnsafeRuntimeFailureAccessors(event)) return false;
    const message = safeRecordProperty(event, "message");
    if (!message || hasUnsafeAssistantFailureAccessors(message)) return false;
    return readOwnDataProperty(message, "role") === "assistant" && readOwnDataProperty(message, "stopReason") !== "error";
  } catch {
    return false;
  }
}

function extractAssistantErrorMessage(record: Record<string, unknown>): string | null {
  if (readOwnDataProperty(record, "role") !== "assistant" || readOwnDataProperty(record, "stopReason") !== "error") return null;
  return safeTrimmedString(record, "errorMessage");
}

function safeRecordProperty(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = readOwnDataProperty(record, key);
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function safeTrimmedString(record: Record<string, unknown>, key: string): string | null {
  const value = readOwnDataProperty(record, key);
  return typeof value === "string" && value.trim() ? value : null;
}

function readOwnDataProperty(record: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !("value" in descriptor)) return undefined;
    return descriptor.value;
  } catch {
    return undefined;
  }
}

function safeArrayLength(items: unknown[]): number {
  const length = readOwnDataProperty(items, "length");
  return typeof length === "number" && Number.isFinite(length) ? Math.min(Math.max(0, length), 500) : 0;
}

function safeArrayItem(items: unknown[], index: number): unknown {
  return readOwnDataProperty(items, String(index));
}

export function extractRuntimeTextDelta(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const record = event as Record<string, unknown>;
  const assistantMessageEvent = record.assistantMessageEvent;
  if (assistantMessageEvent && typeof assistantMessageEvent === "object") {
    const nested = assistantMessageEvent as Record<string, unknown>;
    return nested.type === "text_delta" && typeof nested.delta === "string" ? nested.delta : null;
  }
  return record.type === "text_delta" && typeof record.delta === "string" ? record.delta : null;
}

export function appendToolActivity(message: DesktopChatMessage, label: string): DesktopChatMessage {
  const cleanLabel = label.replace(/\s+/g, " ").trim();
  if (!cleanLabel) return message;
  const current = message.toolActivities ?? [];
  const withoutDuplicateTail = current.at(-1) === cleanLabel ? current : [...current, cleanLabel];
  return { ...message, toolActivities: withoutDuplicateTail.slice(-6) };
}

export function extractToolName(event: Record<string, unknown>): string {
  if (typeof event.toolName === "string" && event.toolName.trim()) return event.toolName.trim();
  const toolCall = event.toolCall;
  if (toolCall && typeof toolCall === "object") {
    const name = (toolCall as Record<string, unknown>).name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  const partial = event.partial;
  if (partial && typeof partial === "object") {
    const content = (partial as Record<string, unknown>).content;
    if (Array.isArray(content)) {
      const latestTool = [...content].reverse().find((item) => item && typeof item === "object" && (item as Record<string, unknown>).type === "toolCall") as Record<string, unknown> | undefined;
      if (typeof latestTool?.name === "string" && latestTool.name.trim()) return latestTool.name.trim();
    }
  }
  return "tool";
}

export function describeAuthEvent(event: CoreProviderAuthEvent): string {
  if (event.type === "auth_url") return "Opening your browser to finish provider login…";
  if (event.type === "device_code") return `Enter code ${event.userCode ?? ""} at ${event.verificationUri ?? ""}`.trim();
  return event.message ?? "Provider login is progressing.";
}

export function getConnectedProviderIds(providers: DesktopProviderSettingsState): Set<string> {
  return new Set([
    ...providers.apiKeyProviders.filter((provider) => provider.configured).map((provider) => provider.provider),
    ...providers.loginProviders.filter((provider) => provider.configured).map((provider) => provider.id),
  ]);
}
