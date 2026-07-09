import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { MemoryLinkType, MemoryRecord, MemoryType, SqliteDatabase } from "./session-persistence";
import { ensureSessionSchema } from "./session-persistence";
import { listMemoryItems, searchMemoryItems } from "./memory-persistence";

type Row = Record<string, unknown>;
type MemoryStatus = MemoryRecord["status"];
export interface MemoryToolError { error: string }
export interface MemoryWriteSuccess { updated: true; action: string; memoryId: string; changedFields: string[] }
export type MemoryWriteResult = MemoryWriteSuccess | MemoryToolError;

const MEMORY_TYPES = new Set<MemoryType>(["fact", "preference", "goal", "episode", "person_context", "lesson"]);
const STATUSES = new Set<MemoryStatus>(["active", "cold", "deleted"]);
const PROFILE_WORDS = /\b(assistant name|your name|soul|role|style|personality|persona|display name|my name|locale|timezone|language preference|profile|app config)\b/i;
const SECRET_WORDS = /\b(api[_ -]?key|secret|password|token|private key|ssh key|access key|refresh token|bearer)\b/i;

export interface MemoryToolDatabaseProvider {
  withReadonlyMemoryDatabase<T>(run: (db: SqliteDatabase) => T): T;
  withWritableMemoryDatabase<T>(run: (db: SqliteDatabase) => T): T;
}

export function createMemoryToolDefinitions(store: MemoryToolDatabaseProvider, getSessionKey?: () => string): ToolDefinition[] {
  return [defineTool({
    name: "memory_read",
    label: "Memory Read",
    description: "Read durable memories. Use for explicit user requests like 'what do you remember about X?'. Actions: search, list_recent, get.",
    parameters: Type.Object({ action: Type.Union([Type.Literal("search"), Type.Literal("list_recent"), Type.Literal("get")]), query: Type.Optional(Type.String()), memoryId: Type.Optional(Type.String()), includeLinks: Type.Optional(Type.Boolean()), limit: Type.Optional(Type.Number()) }),
    execute: async (_id, params) => toolResult(store.withReadonlyMemoryDatabase((db) => executeMemoryRead(db, params))),
  }), defineTool({
    name: "memory_write",
    label: "Memory Write",
    description: "Create, update, delete, supersede, or reinforce durable memories only when the user explicitly asks to remember/forget/correct a memory. Profile/identity/config changes belong in profile_write.",
    parameters: Type.Object({ action: Type.Union([Type.Literal("create"), Type.Literal("update"), Type.Literal("delete"), Type.Literal("supersede"), Type.Literal("reinforce")]), memoryId: Type.Optional(Type.String()), content: Type.Optional(Type.String()), memoryType: Type.Optional(Type.String()), status: Type.Optional(Type.String()), importance: Type.Optional(Type.Number()), stability: Type.Optional(Type.Number()), currentStrength: Type.Optional(Type.Number()), tags: Type.Optional(Type.Array(Type.String())), replacementContent: Type.Optional(Type.String()) }),
    execute: async (_id, params) => toolResult(store.withWritableMemoryDatabase((db) => executeMemoryWrite(db, { ...params, sessionKey: getSessionKey?.() ?? null }))),
  })];
}

export function executeMemoryRead(db: SqliteDatabase, input: Record<string, unknown>): unknown {
  ensureSessionSchema(db);
  const limit = clampNumber(input.limit, 20, 1, 100);
  if (input.action === "search") {
    const query = asString(input.query).trim();
    if (!query) return { error: "query is required for search" };
    return { memories: searchMemoryItems(db, query, limit).map((memory) => formatMemory(memory)) };
  }
  if (input.action === "list_recent") return { memories: listMemoryItems(db, limit).map((memory) => formatMemory(memory)) };
  if (input.action === "get") {
    const memory = getMemory(db, asString(input.memoryId));
    if (!memory) return { error: "unknown memory ID" };
    return { memory: formatMemory(memory, input.includeLinks === true ? listLinks(db, memory.id) : undefined) };
  }
  return { error: `unsupported action: ${String(input.action)}` };
}

export function executeMemoryWrite(db: SqliteDatabase, input: Record<string, unknown>): MemoryWriteResult {
  ensureSessionSchema(db);
  const action = asString(input.action);
  if (!["create", "update", "delete", "supersede", "reinforce"].includes(action)) return { error: `unsupported action: ${action}` };
  const now = Date.now();
  if (action === "create") {
    const validation = validateContent(input.content);
    if (validation) return { error: validation };
    const type = normalizeMemoryType(input.memoryType ?? "fact"); if (!type) return { error: "invalid memory type" };
    const id = createId("memory");
    db.prepare("INSERT INTO memory_items (id, content, category, memory_type, importance, stability, current_strength, status, tags_json, thread_id, source_session_id, source_message_id, superseded_by_memory_id, recall_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL, ?, NULL, NULL, 0, ?, ?)").run(id, asString(input.content).trim(), memoryCategory(type), type, clampNumber(input.importance, 5, 1, 10), clampNumber(input.stability, 5, 1, 10), clampNumber(input.currentStrength, clampNumber(input.importance, 5, 1, 10), 1, 10), JSON.stringify(asTags(input.tags)), nullableString(input.sessionKey), now, now);
    return { updated: true, action, memoryId: id, changedFields: ["content", "memoryType", "importance", "stability", "currentStrength", "tags"] };
  }
  const existing = getMemory(db, asString(input.memoryId));
  if (!existing) return { error: "unknown memory ID" };
  if (action === "delete") { db.prepare("UPDATE memory_items SET status = 'deleted', updated_at = ? WHERE id = ?").run(now, existing.id); return { updated: true, action, memoryId: existing.id, changedFields: ["status"] }; }
  if (action === "reinforce") { db.prepare("UPDATE memory_items SET current_strength = min(10, current_strength + 1), recall_count = recall_count + 1, updated_at = ? WHERE id = ?").run(now, existing.id); return { updated: true, action, memoryId: existing.id, changedFields: ["currentStrength", "recallCount"] }; }
  if (action === "supersede") return supersedeMemory(db, existing, input, now);
  return updateMemory(db, existing, input, now);
}

function updateMemory(db: SqliteDatabase, existing: MemoryRecord, input: Record<string, unknown>, now: number): MemoryWriteResult {
  const fields: string[] = [];
  const content = input.content === undefined ? existing.content : asString(input.content).trim();
  if (input.content !== undefined) { const validation = validateContent(content); if (validation) return { error: validation }; fields.push("content"); }
  const type = input.memoryType === undefined ? existing.memoryType : normalizeMemoryType(input.memoryType); if (!type) return { error: "invalid memory type" }; if (input.memoryType !== undefined) fields.push("memoryType");
  const status = input.status === undefined ? existing.status : normalizeStatus(input.status); if (!status) return { error: "invalid memory status" }; if (input.status !== undefined) fields.push("status");
  if (input.importance !== undefined) fields.push("importance"); if (input.stability !== undefined) fields.push("stability"); if (input.currentStrength !== undefined) fields.push("currentStrength"); if (input.tags !== undefined) fields.push("tags");
  if (fields.length === 0) return { error: "no fields to update" };
  db.prepare("UPDATE memory_items SET content = ?, category = ?, memory_type = ?, status = ?, importance = ?, stability = ?, current_strength = ?, tags_json = ?, updated_at = ? WHERE id = ?").run(content, memoryCategory(type), type, status, clampNumber(input.importance, existing.importance, 1, 10), clampNumber(input.stability, existing.stability, 1, 10), clampNumber(input.currentStrength, existing.currentStrength, 1, 10), JSON.stringify(input.tags === undefined ? existing.tags : asTags(input.tags)), now, existing.id);
  return { updated: true, action: "update", memoryId: existing.id, changedFields: fields };
}

function supersedeMemory(db: SqliteDatabase, existing: MemoryRecord, input: Record<string, unknown>, now: number): MemoryWriteResult {
  const content = asString(input.replacementContent || input.content).trim();
  const validation = validateContent(content); if (validation) return { error: validation };
  const type = input.memoryType === undefined ? existing.memoryType : normalizeMemoryType(input.memoryType); if (!type) return { error: "invalid memory type" };
  const id = createId("memory");
  db.prepare("INSERT INTO memory_items (id, content, category, memory_type, importance, stability, current_strength, status, tags_json, thread_id, source_session_id, source_message_id, superseded_by_memory_id, recall_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL, ?, NULL, NULL, 0, ?, ?)").run(id, content, memoryCategory(type), type, existing.importance, existing.stability, existing.currentStrength, JSON.stringify(input.tags === undefined ? existing.tags : asTags(input.tags)), nullableString(input.sessionKey), now, now);
  db.prepare("UPDATE memory_items SET superseded_by_memory_id = ?, status = 'cold', updated_at = ? WHERE id = ?").run(id, now, existing.id);
  upsertLink(db, id, existing.id, "supersedes", 10, now);
  return { updated: true, action: "supersede", memoryId: id, changedFields: ["content", "supersededByMemoryId", "status"] };
}

function validateContent(value: unknown): string | null { const content = asString(value).trim(); if (!content) return "content is required"; if (SECRET_WORDS.test(content)) return "memory content looks like a secret; store it somewhere safer"; if (PROFILE_WORDS.test(content)) return "profile-like changes are not handled by memory_write; use profile_write"; return null; }
function normalizeMemoryType(value: unknown): MemoryType | null { return MEMORY_TYPES.has(value as MemoryType) ? value as MemoryType : null; }
function normalizeStatus(value: unknown): MemoryStatus | null { return STATUSES.has(value as MemoryStatus) ? value as MemoryStatus : null; }
function formatMemory(memory: MemoryRecord, links?: unknown[]): Record<string, unknown> { return { id: memory.id, content: memory.content, memoryType: memory.memoryType, category: memory.category, status: memory.status, importance: memory.importance, stability: memory.stability, currentStrength: memory.currentStrength, tags: memory.tags, createdAt: memory.createdAt, updatedAt: memory.updatedAt, sourceSessionId: memory.sourceSessionId, sourceMessageId: memory.sourceMessageId, ...(links ? { links } : {}) }; }
function getMemory(db: SqliteDatabase, id: string): MemoryRecord | null { if (!id) return null; const row = db.prepare("SELECT * FROM memory_items WHERE id = ?").get(id) as Row | undefined; return row ? rowToMemory(row) : null; }
function rowToMemory(row: Row): MemoryRecord { return { id: asString(row.id), content: asString(row.content), category: asString(row.category), memoryType: normalizeMemoryType(row.memory_type) ?? "fact", importance: asNumber(row.importance, 5), stability: asNumber(row.stability, 5), currentStrength: asNumber(row.current_strength, 5), status: normalizeStatus(row.status) ?? "active", tags: parseTags(row.tags_json), threadId: nullableString(row.thread_id), sourceSessionId: nullableString(row.source_session_id), sourceMessageId: nullableString(row.source_message_id), supersededByMemoryId: nullableString(row.superseded_by_memory_id), recallCount: asNumber(row.recall_count), createdAt: asNumber(row.created_at), updatedAt: asNumber(row.updated_at) }; }
function listLinks(db: SqliteDatabase, id: string): unknown[] { return (db.prepare("SELECT from_memory_id, to_memory_id, link_type, strength, created_at, updated_at FROM memory_links WHERE from_memory_id = ? OR to_memory_id = ? ORDER BY updated_at DESC").all(id, id) as Row[]).map((r) => ({ fromMemoryId: asString(r.from_memory_id), toMemoryId: asString(r.to_memory_id), linkType: asString(r.link_type), strength: asNumber(r.strength), createdAt: asNumber(r.created_at), updatedAt: asNumber(r.updated_at) })); }
function upsertLink(db: SqliteDatabase, fromId: string, toId: string, type: MemoryLinkType, strength: number, now: number): void { db.prepare("INSERT INTO memory_links (id, from_memory_id, to_memory_id, link_type, strength, last_activated_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(createId("link"), fromId, toId, type, strength, now, now, now); }
function toolResult(data: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], details: data }; }
function memoryCategory(type: MemoryType): string { return type === "preference" ? "preference" : type === "goal" ? "goal" : "fact"; }
function asTags(value: unknown): string[] { return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim()).slice(0, 20) : []; }
function parseTags(value: unknown): string[] { if (typeof value !== "string") return []; try { const parsed = JSON.parse(value) as unknown; return asTags(parsed); } catch { return []; } }
function clampNumber(value: unknown, fallback: number, min: number, max: number): number { return Math.max(min, Math.min(max, Math.trunc(asNumber(value, fallback)))); }
function asNumber(value: unknown, fallback = 0): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
function asString(value: unknown): string { return typeof value === "string" ? value : ""; }
function nullableString(value: unknown): string | null { return typeof value === "string" && value.length > 0 ? value : null; }
function createId(prefix: string): string { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`; }
