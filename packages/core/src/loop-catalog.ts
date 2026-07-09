import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { LoopRunState } from "./loops";

export type LoopCatalogStatus = "available" | "disabled" | "internal-only";
export type LoopCatalogMode = "background" | "foreground";
export type LoopResultPolicy = "inline-small" | "artifact-required" | "hidden-only";

export interface LoopCatalogEntry {
  loopId: string; label: string; description: string; status: LoopCatalogStatus; inputSchema: unknown; defaultMode: LoopCatalogMode;
  requiresApproval: boolean; allowedScopes: string[]; maxEstimatedRuntimeMs?: number; resultPolicy: LoopResultPolicy;
}
export interface LoopCatalogStartInput { loopId: string; input?: Record<string, unknown>; reason?: string; sessionKey: string }
export interface LoopCatalogRunStatus { runId: string; loopId: string; status: LoopRunState["status"] | "queued"; summary?: string; artifactIds?: string[] }
export interface LoopCatalogRunner { start(input: LoopCatalogStartInput): Promise<{ runId: string; status: LoopCatalogRunStatus["status"] }>; cancel(runId: string): Promise<boolean>; status(runId: string): Promise<LoopCatalogRunStatus | null> }

export class LoopCatalog {
  private readonly entries = new Map<string, LoopCatalogEntry>();
  constructor(entries: LoopCatalogEntry[] = []) { for (const entry of entries) this.register(entry); }
  register(entry: LoopCatalogEntry): void { this.entries.set(entry.loopId, entry); }
  list(scope = "agent"): LoopCatalogEntry[] { return [...this.entries.values()].filter((entry) => entry.status === "available" && entry.allowedScopes.includes(scope)); }
  get(loopId: string, scope = "agent"): LoopCatalogEntry | null { const entry = this.entries.get(loopId); return entry && entry.status === "available" && entry.allowedScopes.includes(scope) ? entry : null; }
  getRaw(loopId: string): LoopCatalogEntry | null { return this.entries.get(loopId) ?? null; }
}

export const SESSION_COMPACTION_CATALOG_ENTRY: LoopCatalogEntry = {
  loopId: "session-compaction",
  label: "Session compaction",
  description: "Internal session-management loop that summarizes old visible chat messages into hidden continuity state.",
  status: "available",
  inputSchema: { type: "object", properties: { force: { type: "boolean", description: "Force compaction for development/testing when enough visible messages exist." } } },
  defaultMode: "background",
  requiresApproval: false,
  allowedScopes: ["agent", "internal"],
  maxEstimatedRuntimeMs: 120_000,
  resultPolicy: "hidden-only",
};

export function createDefaultLoopCatalog(extra: LoopCatalogEntry[] = []): LoopCatalog { return new LoopCatalog([SESSION_COMPACTION_CATALOG_ENTRY, ...extra]); }

export function createLoopToolDefinitions(input: { catalog: LoopCatalog; runner: LoopCatalogRunner; getSessionKey: () => string | null; scope?: string }): ToolDefinition[] {
  const scope = input.scope ?? "agent";
  return [defineTool({
    name: "loop_read", label: "Loop Read", description: "List approved loops, get loop details, or check loop run status.",
    parameters: Type.Object({ action: Type.Union([Type.Literal("list"), Type.Literal("get"), Type.Literal("status")]), loopId: Type.Optional(Type.String()), runId: Type.Optional(Type.String()) }),
    execute: async (_id, params) => {
      if (params.action === "list") return toolJson({ loops: input.catalog.list(scope).map(publicEntry) });
      if (params.action === "get") { const entry = params.loopId ? input.catalog.get(params.loopId, scope) : null; return toolJson(entry ? publicEntry(entry) : { error: "Loop not found or unavailable" }); }
      if (params.action === "status") { const status = params.runId ? await input.runner.status(params.runId) : null; return toolJson(status ?? { error: "Run not found" }); }
      return toolJson({ error: "Unsupported action" });
    },
  }), defineTool({
    name: "loop_write", label: "Loop Write", description: "Start or cancel an approved background loop. Only cataloged loops are allowed.",
    parameters: Type.Object({ action: Type.Union([Type.Literal("start"), Type.Literal("cancel")]), loopId: Type.Optional(Type.String()), runId: Type.Optional(Type.String()), input: Type.Optional(Type.Record(Type.String(), Type.Unknown())), reason: Type.Optional(Type.String()) }),
    execute: async (_id, params) => {
      const sessionKey = input.getSessionKey();
      if (!sessionKey) return toolJson({ error: "No active session" });
      if (params.action === "cancel") return toolJson({ cancelled: params.runId ? await input.runner.cancel(params.runId) : false });
      const entry = params.loopId ? input.catalog.get(params.loopId, scope) : null;
      if (!entry) return toolJson({ error: "Loop not found or unavailable" });
      const startInput: LoopCatalogStartInput = { loopId: entry.loopId, sessionKey, ...(params.input ? { input: params.input } : {}), ...(params.reason ? { reason: params.reason } : {}) };
      console.info(`[geistr] Agent loop start requested: loopId=${entry.loopId} session=${sessionKey}`);
      const started = await input.runner.start(startInput);
      return toolJson({ started: true, runId: started.runId, loopId: entry.loopId, status: started.status, message: `${entry.label} started`, resultDelivery: "same-session-wakeup" });
    },
  })];
}

function publicEntry(entry: LoopCatalogEntry): Omit<LoopCatalogEntry, "status"> { const { status: _status, ...rest } = entry; return rest; }
function toolJson(value: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], details: value as Record<string, unknown> }; }
