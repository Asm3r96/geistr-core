import type { SqliteDatabase } from "./session-persistence";

export type MemoryType = "fact" | "preference" | "goal" | "episode" | "person_context" | "lesson";
export type MemoryAction = "ignore" | "create" | "update" | "reinforce" | "supersede" | "delete";
export type MemoryLinkType = "same_topic" | "related" | "supersedes";
export interface MemoryRecord { id: string; content: string; memoryType: MemoryType; category: string; importance: number; stability: number; currentStrength: number; status: "active" | "cold" | "deleted"; tags: string[]; threadId: string | null; sourceSessionId: string | null; sourceMessageId: string | null; supersededByMemoryId: string | null; recallCount: number; createdAt: number; updatedAt: number }
export interface MemoryCandidate { candidateId: string; content: string; memoryType: MemoryType; importance: number; stability: number; tags: string[]; threadId: string | null }
export interface MemoryDecision { candidateId: string; action: MemoryAction; existingMemoryId: string | null; content: string | null; memoryType: MemoryType | null; reason: string }
export interface MemoryIndexingPreparedEvent { eventId: string; sessionKey?: string; transcriptId?: string; role: "user" | "assistant"; content: string; sequence: number; createdAt: number }
export interface MemoryIndexingPreparedBatch { sessionKey: string; transcriptId: string; events: MemoryIndexingPreparedEvent[]; eventIds: string[]; transcript: string }
export interface MemoryIndexingResult { processed: number; candidates: number; created: number; updated: number; reinforced: number; superseded: number; deleted: number; ignored: number; linked: number; remaining: number; reason?: string }

type Row = Record<string, unknown>;

export function prepareMemoryIndexingBatch(db: SqliteDatabase, sessionKey: string, options: { threshold: number; limit: number; force?: boolean }): MemoryIndexingPreparedBatch | null {
  const state = db.prepare("SELECT active_transcript_id FROM session_state WHERE session_key = ?").get(sessionKey) as Row | undefined;
  if (!state) return null;
  const transcriptId = asString(state.active_transcript_id);
  const limit = Math.max(1, Math.min(200, Math.trunc(options.limit)));
  const rows = db.prepare(`SELECT event_id, session_key, transcript_id, role, sequence, created_at, payload_json FROM session_events
    WHERE session_key = ? AND transcript_id = ? AND event_type = 'message' AND role IN ('user', 'assistant')
      AND memory_indexed_at IS NULL
      AND COALESCE(json_extract(payload_json, '$.hiddenFromChat'), 0) != 1
      AND COALESCE(json_extract(metadata_json, '$.deleted'), 0) != 1
    ORDER BY sequence ASC LIMIT ?`).all(sessionKey, transcriptId, limit) as Row[];
  return prepareMemoryBatchFromRows(rows, { threshold: options.threshold, force: options.force ?? false, sessionKey, transcriptId });
}

export function prepareGlobalMemoryIndexingBatch(db: SqliteDatabase, options: { threshold: number; limit: number; force?: boolean }): MemoryIndexingPreparedBatch | null {
  const limit = Math.max(1, Math.min(200, Math.trunc(options.limit)));
  const rows = db.prepare(`SELECT se.event_id, se.session_key, se.transcript_id, se.role, se.sequence, se.created_at, se.payload_json
    FROM session_events se
    JOIN session_state ss ON ss.session_key = se.session_key
    WHERE ss.status != 'deleted'
      AND se.event_type = 'message' AND se.role IN ('user', 'assistant')
      AND se.memory_indexed_at IS NULL
      AND COALESCE(json_extract(se.payload_json, '$.hiddenFromChat'), 0) != 1
      AND COALESCE(json_extract(se.metadata_json, '$.deleted'), 0) != 1
    ORDER BY se.created_at ASC, se.session_key ASC, se.sequence ASC LIMIT ?`).all(limit) as Row[];
  return prepareMemoryBatchFromRows(rows, { threshold: options.threshold, force: options.force ?? false, sessionKey: "__global__", transcriptId: "__global__" });
}

function prepareMemoryBatchFromRows(rows: Row[], options: { threshold: number; force: boolean; sessionKey: string; transcriptId: string }): MemoryIndexingPreparedBatch | null {
  if (!options.force && rows.length < options.threshold) return null;
  const events = rows.map((row) => ({ eventId: asString(row.event_id), sessionKey: asString(row.session_key), transcriptId: asString(row.transcript_id), role: normalizeRole(row.role) as "user" | "assistant", content: normalizeMemoryText(extractMessageContent(row.payload_json)), sequence: asNumber(row.sequence), createdAt: asNumber(row.created_at) })).filter((event) => event.content && (event.role === "user" || event.role === "assistant"));
  if (events.length === 0) return null;
  return { sessionKey: options.sessionKey, transcriptId: options.transcriptId, events, eventIds: events.map((event) => event.eventId), transcript: events.map((event, index) => `${index + 1}. ${event.role} [${event.eventId}${event.sessionKey ? ` @ ${event.sessionKey}` : ""}]: ${event.content}`).join("\n") };
}

export function markMemoryIndexingEventsIndexed(db: SqliteDatabase, sessionKey: string, eventIds: string[], now: number): number {
  if (eventIds.length === 0) return 0;
  const placeholders = eventIds.map(() => "?").join(", ");
  const sql = sessionKey === "__global__"
    ? `UPDATE session_events SET memory_indexed_at = ? WHERE event_id IN (${placeholders}) AND memory_indexed_at IS NULL`
    : `UPDATE session_events SET memory_indexed_at = ? WHERE session_key = ? AND event_id IN (${placeholders}) AND memory_indexed_at IS NULL`;
  const result = sessionKey === "__global__"
    ? db.prepare(sql).run(now, ...eventIds)
    : db.prepare(sql).run(now, sessionKey, ...eventIds);
  return (result as { changes?: number }).changes ?? 0;
}

export function listMemoryItems(db: SqliteDatabase, limit = 200): MemoryRecord[] {
  const rows = db.prepare("SELECT * FROM memory_items WHERE status != 'deleted' ORDER BY updated_at DESC LIMIT ?").all(limit) as Row[];
  return rows.map(rowToMemoryRecord);
}

export function searchMemoryItems(db: SqliteDatabase, query: string, limit = 8): MemoryRecord[] {
  const tokens = new Set(toMemoryTokens(query));
  return listMemoryItems(db, 500).map((memory) => ({ memory, score: scoreTokens(memory.content + " " + memory.tags.join(" "), tokens) + (memory.status === "active" ? 1 : 0) })).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || b.memory.updatedAt - a.memory.updatedAt).slice(0, limit).map((entry) => entry.memory);
}

export function recallMemoryNeighborhoods(db: SqliteDatabase, candidates: MemoryCandidate[]): Record<string, MemoryRecord[]> {
  const result: Record<string, MemoryRecord[]> = {};
  for (const candidate of candidates) {
    const direct = searchMemoryItems(db, `${candidate.content} ${candidate.tags.join(" ")}`, 6);
    const neighborIds = new Set<string>();
    for (const memory of direct) {
      const links = db.prepare("SELECT from_memory_id, to_memory_id FROM memory_links WHERE from_memory_id = ? OR to_memory_id = ? LIMIT 8").all(memory.id, memory.id) as Row[];
      for (const link of links) neighborIds.add(asString(link.from_memory_id) === memory.id ? asString(link.to_memory_id) : asString(link.from_memory_id));
    }
    const neighbors = [...neighborIds].map((id) => getMemoryById(db, id)).filter((memory): memory is MemoryRecord => Boolean(memory));
    result[candidate.candidateId] = [...direct, ...neighbors].filter((memory, index, all) => all.findIndex((other) => other.id === memory.id) === index).slice(0, 10);
  }
  return result;
}

export function applyMemoryDecisions(db: SqliteDatabase, input: { sessionKey: string; candidates: MemoryCandidate[]; decisions: MemoryDecision[]; sourceMessageIds: string[] }): MemoryIndexingResult & { persistedMemoryIds: string[] } {
  const now = Date.now();
  const byId = new Map(input.candidates.map((candidate) => [candidate.candidateId, candidate]));
  const counts = { processed: 0, candidates: input.candidates.length, created: 0, updated: 0, reinforced: 0, superseded: 0, deleted: 0, ignored: 0, linked: 0, remaining: 0, persistedMemoryIds: [] as string[] };
  return withTransaction(db, () => {
    for (const decision of input.decisions) {
      const candidate = byId.get(decision.candidateId);
      if (!candidate || decision.action === "ignore") { counts.ignored += 1; continue; }
      const existing = decision.existingMemoryId ? getMemoryById(db, decision.existingMemoryId) : null;
      if (decision.action === "delete") { if (existing) { db.prepare("UPDATE memory_items SET status = 'deleted', updated_at = ? WHERE id = ?").run(now, existing.id); counts.deleted += 1; } else counts.ignored += 1; continue; }
      if (decision.action === "reinforce" && existing) { db.prepare("UPDATE memory_items SET current_strength = min(10, current_strength + 1), recall_count = recall_count + 1, updated_at = ? WHERE id = ?").run(now, existing.id); counts.reinforced += 1; counts.persistedMemoryIds.push(existing.id); continue; }
      if (decision.action === "supersede" && existing) {
        const createdId = createMemoryItem(db, { ...candidate, content: decision.content?.trim() || candidate.content, memoryType: decision.memoryType ?? candidate.memoryType }, input.sessionKey, input.sourceMessageIds.at(-1) ?? null, now);
        upsertMemoryLink(db, createdId, existing.id, "supersedes", 10, now);
        db.prepare("UPDATE memory_items SET superseded_by_memory_id = ?, updated_at = ? WHERE id = ?").run(createdId, now, existing.id);
        counts.created += 1; counts.superseded += 1; counts.persistedMemoryIds.push(createdId);
        continue;
      }
      if (decision.action === "update" && existing) {
        const content = decision.content?.trim() || candidate.content;
        const memoryType = decision.memoryType ?? candidate.memoryType;
        db.prepare("UPDATE memory_items SET content = ?, memory_type = ?, category = ?, importance = ?, stability = ?, current_strength = max(current_strength, ?), tags_json = ?, thread_id = ?, source_session_id = ?, source_message_id = ?, updated_at = ? WHERE id = ?")
          .run(content, memoryType, memoryCategory(memoryType), candidate.importance, candidate.stability, candidate.importance, JSON.stringify(candidate.tags), candidate.threadId, input.sessionKey, input.sourceMessageIds.at(-1) ?? null, now, existing.id);
        counts.updated += 1; counts.persistedMemoryIds.push(existing.id);
        continue;
      }
      const createdId = createMemoryItem(db, { ...candidate, content: decision.content?.trim() || candidate.content, memoryType: decision.memoryType ?? candidate.memoryType }, input.sessionKey, input.sourceMessageIds.at(-1) ?? null, now);
      counts.created += 1; counts.persistedMemoryIds.push(createdId);
    }
    return counts;
  });
}

export function linkRelatedMemories(db: SqliteDatabase, memoryIds: string[]): number {
  const now = Date.now();
  let linked = 0;
  const all = listMemoryItems(db, 500);
  for (const id of memoryIds) {
    const source = all.find((memory) => memory.id === id);
    if (!source) continue;
    const tokens = new Set(toMemoryTokens(source.content));
    const related = all.filter((memory) => memory.id !== id && !memory.supersededByMemoryId).map((memory) => ({ memory, score: scoreTokens(memory.content, tokens) + (memory.memoryType === source.memoryType ? 1 : 0) })).filter((entry) => entry.score >= 2).sort((a, b) => b.score - a.score).slice(0, 5);
    for (const entry of related) { upsertMemoryLink(db, source.id, entry.memory.id, source.memoryType === entry.memory.memoryType ? "same_topic" : "related", Math.min(10, entry.score), now); linked += 1; }
  }
  return linked;
}

function createMemoryItem(db: SqliteDatabase, candidate: MemoryCandidate, sessionKey: string, sourceMessageId: string | null, now: number): string {
  const id = createId("memory");
  db.prepare("INSERT INTO memory_items (id, content, category, memory_type, importance, stability, current_strength, status, tags_json, thread_id, source_session_id, source_message_id, superseded_by_memory_id, recall_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, NULL, 0, ?, ?)")
    .run(id, candidate.content, memoryCategory(candidate.memoryType), candidate.memoryType, candidate.importance, candidate.stability, candidate.importance, JSON.stringify(candidate.tags), candidate.threadId, sessionKey, sourceMessageId, now, now);
  return id;
}

function getMemoryById(db: SqliteDatabase, id: string): MemoryRecord | null {
  const row = db.prepare("SELECT * FROM memory_items WHERE id = ?").get(id) as Row | undefined;
  return row ? rowToMemoryRecord(row) : null;
}

function upsertMemoryLink(db: SqliteDatabase, fromId: string, toId: string, linkType: MemoryLinkType, strength: number, now: number): void {
  if (!fromId || !toId || fromId === toId) return;
  db.prepare("INSERT INTO memory_links (id, from_memory_id, to_memory_id, link_type, strength, last_activated_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(from_memory_id, to_memory_id, link_type) DO UPDATE SET strength = max(strength, excluded.strength), updated_at = excluded.updated_at")
    .run(createId("link"), fromId, toId, linkType, strength, now, now, now);
}

function rowToMemoryRecord(row: Row): MemoryRecord {
  return { id: asString(row.id), content: asString(row.content), category: asString(row.category), memoryType: normalizeMemoryType(row.memory_type), importance: asNumber(row.importance, 5), stability: asNumber(row.stability, 5), currentStrength: asNumber(row.current_strength, 5), status: asString(row.status, "active") as MemoryRecord["status"], tags: parseStringArray(row.tags_json), threadId: nullableString(row.thread_id), sourceSessionId: nullableString(row.source_session_id), sourceMessageId: nullableString(row.source_message_id), supersededByMemoryId: nullableString(row.superseded_by_memory_id), recallCount: asNumber(row.recall_count), createdAt: asNumber(row.created_at), updatedAt: asNumber(row.updated_at) };
}

function normalizeMemoryType(value: unknown): MemoryType { return value === "preference" || value === "goal" || value === "episode" || value === "person_context" || value === "lesson" ? value : "fact"; }
function memoryCategory(type: MemoryType): string { return type === "preference" ? "preference" : type === "goal" ? "goal" : "fact"; }
function normalizeMemoryText(value: string): string { return value.replace(/\s+/g, " ").trim(); }
function parseStringArray(value: unknown): string[] { if (typeof value !== "string") return []; try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; } catch { return []; } }
function toMemoryTokens(value: string): string[] { return value.toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? []; }
function scoreTokens(value: string, queryTokens: ReadonlySet<string>): number { const tokens = new Set(toMemoryTokens(value)); let score = 0; for (const token of queryTokens) if (tokens.has(token)) score += 1; return score; }

function extractMessageContent(payload: unknown): string {
  const object = parseJsonObject(payload);
  const content = object.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => typeof part === "string" ? part : part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : "").filter(Boolean).join("\n");
  return "";
}
function parseJsonObject(value: unknown): Record<string, unknown> { if (typeof value !== "string" || value.trim().length === 0) return {}; try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; } }
function normalizeRole(value: unknown): "user" | "assistant" | "system" | "tool" { return value === "user" || value === "assistant" || value === "system" || value === "tool" ? value : "assistant"; }
function asString(value: unknown, fallback = ""): string { return typeof value === "string" ? value : fallback; }
function nullableString(value: unknown): string | null { return typeof value === "string" && value.length > 0 ? value : null; }
function asNumber(value: unknown, fallback = 0): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
function createId(prefix: string): string { const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10); return `${prefix}_${Date.now().toString(36)}_${random}`; }
function withTransaction<T>(db: SqliteDatabase, run: () => T): T { db.exec("BEGIN IMMEDIATE"); try { const result = run(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } }
