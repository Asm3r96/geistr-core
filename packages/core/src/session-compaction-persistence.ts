import type { SqliteDatabase } from "./session-persistence";

export interface SessionCompactionPrepareOptions { thresholdTokens: number; retainRecentMessages: number; transcriptId?: string }
export interface SessionCompactionPreparedEvent { eventId: string; role: string | null; content: string; sequence: number; createdAt: number }
export interface SessionCompactionPreparedContext {
  sessionKey: string; transcriptId: string; eventsToCompact: SessionCompactionPreparedEvent[]; retainedEventIds: string[];
  priorSummary: string | null; targetSummarySize: number; summaryUntilEventId: string; estimatedTokens: number; retainedRecentCount: number;
}
export interface SaveSessionSummaryInput { sessionKey: string; transcriptId: string; summary: string; summaryUntilEventId: string; continuity?: Record<string, unknown>; coveredEventIds?: string[]; target?: { scope: string; appId?: string; agentId?: string }; now?: number }
export interface SaveLoopResultInput { sessionKey: string; transcriptId?: string; runId: string; loopId: string; status: string; summary: string; artifactIds?: string[]; needsAttention?: boolean; now?: number }
export interface PendingLoopResult { eventId: string; runId: string; loopId: string; status: string; summary: string; artifactIds: string[]; completedAt: number; needsAttention: boolean }

type Row = Record<string, unknown>;

export function updateSessionCompaction(db: SqliteDatabase, sessionKey: string, summaryEventId: string | null, now: number): void {
  db.prepare(`UPDATE session_state SET
       compaction_count = compaction_count + 1,
       last_summary_event_id = ?,
       updated_at = ?
     WHERE session_key = ?`).run(summaryEventId, now, sessionKey);
}

export function prepareSessionCompaction(db: SqliteDatabase, sessionKey: string, options: SessionCompactionPrepareOptions): SessionCompactionPreparedContext | null {
  const state = db.prepare("SELECT active_transcript_id, last_summary_event_id FROM session_state WHERE session_key = ?").get(sessionKey) as Row | undefined;
  if (!state) return null;
  const transcriptId = options.transcriptId ?? asString(state.active_transcript_id);
  const lastSummaryEventId = nullableString(state.last_summary_event_id);
  const boundaryClause = lastSummaryEventId ? "AND sequence > (SELECT sequence FROM session_events WHERE event_id = ? AND transcript_id = ?)" : "";
  const params = lastSummaryEventId ? [sessionKey, transcriptId, lastSummaryEventId, transcriptId] : [sessionKey, transcriptId];
  const rows = db.prepare(`SELECT event_id, role, sequence, created_at, payload_json FROM session_events
    WHERE session_key = ? AND transcript_id = ? AND event_type = 'message' AND role IN ('user', 'assistant')
      AND COALESCE(json_extract(payload_json, '$.hiddenFromChat'), 0) != 1
      ${boundaryClause}
    ORDER BY sequence ASC`).all(...params) as Row[];
  const events = rows.map((row) => ({ eventId: asString(row.event_id), role: nullableString(row.role), content: extractMessageContent(row.payload_json), sequence: asNumber(row.sequence), createdAt: asNumber(row.created_at) })).filter((event) => event.content.trim());
  const estimatedTokens = estimateCompactionTokens(events);
  const retain = Math.max(1, Math.trunc(options.retainRecentMessages));
  if (estimatedTokens < options.thresholdTokens || events.length <= retain) return null;
  const eventsToCompact = events.slice(0, -retain);
  if (eventsToCompact.length === 0) return null;
  const retained = events.slice(-retain);
  const priorSummary = getLatestSessionSummary(db, sessionKey);
  return { sessionKey, transcriptId, eventsToCompact, retainedEventIds: retained.map((event) => event.eventId), priorSummary, targetSummarySize: Math.max(1200, Math.ceil(eventsToCompact.reduce((sum, event) => sum + event.content.length, 0) / 6)), summaryUntilEventId: eventsToCompact.at(-1)!.eventId, estimatedTokens, retainedRecentCount: retained.length };
}

export function saveSessionSummary(db: SqliteDatabase, input: SaveSessionSummaryInput): string {
  const now = input.now ?? Date.now();
  const eventId = createId("summary");
  return withTransaction(db, () => {
    const sequence = nextTranscriptSequence(db, input.transcriptId);
    db.prepare("INSERT INTO session_events (event_id, transcript_id, session_key, sequence, event_type, role, tool_call_id, tool_name, provider_id, model_id, created_at, payload_json, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(eventId, input.transcriptId, input.sessionKey, sequence, "summary", null, null, null, null, null, now, JSON.stringify({ summary: input.summary, summaryUntilEventId: input.summaryUntilEventId, summaryVersion: 1, summaryKind: "session", continuity: input.continuity ?? {}, coveredEventIds: input.coveredEventIds ?? [], hiddenFromChat: true }), JSON.stringify({ source: "compaction_loop", hidden: true, internal: true, scope: input.target?.scope ?? "core", appId: input.target?.appId ?? null, agentId: input.target?.agentId ?? null, sessionKey: input.sessionKey, transcriptId: input.transcriptId }));
    db.prepare("UPDATE session_transcripts SET summary_until_event_id = ?, updated_at = ? WHERE transcript_id = ?").run(input.summaryUntilEventId, now, input.transcriptId);
    updateSessionCompaction(db, input.sessionKey, eventId, now);
    return eventId;
  });
}

export function saveLoopResult(db: SqliteDatabase, input: SaveLoopResultInput): string {
  const now = input.now ?? Date.now();
  const state = db.prepare("SELECT active_transcript_id FROM session_state WHERE session_key = ?").get(input.sessionKey) as Row | undefined;
  const transcriptId = input.transcriptId ?? asString(state?.active_transcript_id);
  const eventId = createId("loop_result");
  return withTransaction(db, () => {
    const sequence = nextTranscriptSequence(db, transcriptId);
    db.prepare("INSERT INTO session_events (event_id, transcript_id, session_key, sequence, event_type, role, tool_call_id, tool_name, provider_id, model_id, created_at, payload_json, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(eventId, transcriptId, input.sessionKey, sequence, "loop_result", null, null, null, null, null, now, JSON.stringify({ runId: input.runId, loopId: input.loopId, status: input.status, summary: input.summary, artifactIds: input.artifactIds ?? [], completedAt: now, needsAttention: input.needsAttention ?? false }), JSON.stringify({ source: "loop_runner", hidden: true, internal: true, pending: true, sessionKey: input.sessionKey, transcriptId }));
    return eventId;
  });
}

export function listPendingLoopResults(db: SqliteDatabase, sessionKey: string, limit = 5): PendingLoopResult[] {
  const rows = db.prepare(`SELECT event_id, payload_json FROM session_events
    WHERE session_key = ? AND event_type = 'loop_result'
      AND COALESCE(json_extract(metadata_json, '$.pending'), 0) = 1
    ORDER BY sequence DESC LIMIT ?`).all(sessionKey, limit) as Row[];
  return rows.map((row) => {
    const payload = parseJsonObject(row.payload_json);
    return { eventId: asString(row.event_id), runId: asString(payload.runId), loopId: asString(payload.loopId), status: asString(payload.status), summary: asString(payload.summary), artifactIds: Array.isArray(payload.artifactIds) ? payload.artifactIds.filter((id): id is string => typeof id === "string") : [], completedAt: asNumber(payload.completedAt), needsAttention: Boolean(payload.needsAttention) };
  }).filter((result) => result.runId && result.loopId);
}

export function acknowledgeLoopResults(db: SqliteDatabase, sessionKey: string, eventIds: string[], now: number): number {
  if (eventIds.length === 0) return 0;
  const placeholders = eventIds.map(() => "?").join(", ");
  const result = db.prepare(`UPDATE session_events SET metadata_json = json_set(metadata_json, '$.pending', 0, '$.acknowledgedAt', ?)
    WHERE session_key = ? AND event_id IN (${placeholders})`).run(now, sessionKey, ...eventIds);
  return (result as { changes?: number }).changes ?? 0;
}

export function estimateCompactionTokens(events: readonly SessionCompactionPreparedEvent[]): number {
  return 1000 + events.reduce((sum, event) => sum + 6 + Math.ceil(event.content.length / 4), 0);
}

function getLatestSessionSummary(db: SqliteDatabase, sessionKey: string): string | null {
  const row = db.prepare(`SELECT payload_json FROM session_events
    WHERE session_key = ? AND event_type = 'summary'
    ORDER BY sequence DESC LIMIT 1`).get(sessionKey) as Row | undefined;
  const payload = parseJsonObject(row?.payload_json);
  const summary = payload.summary;
  return typeof summary === "string" && summary.trim() ? summary.trim() : null;
}
function nextTranscriptSequence(db: SqliteDatabase, transcriptId: string): number { const row = db.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM session_events WHERE transcript_id = ?").get(transcriptId) as Row | undefined; return asNumber(row?.next_sequence, 1); }
function extractMessageContent(payload: unknown): string { const object = parseJsonObject(payload); const content = object.content; return typeof content === "string" ? content : ""; }
function parseJsonObject(value: unknown): Record<string, unknown> { if (typeof value !== "string" || value.trim().length === 0) return {}; try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; } }
function asString(value: unknown, fallback = ""): string { return typeof value === "string" ? value : fallback; }
function nullableString(value: unknown): string | null { return typeof value === "string" && value.length > 0 ? value : null; }
function asNumber(value: unknown, fallback = 0): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
function createId(prefix: string): string { const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10); return `${prefix}_${Date.now().toString(36)}_${random}`; }
function withTransaction<T>(db: SqliteDatabase, run: () => T): T { db.exec("BEGIN IMMEDIATE"); try { const result = run(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } }
