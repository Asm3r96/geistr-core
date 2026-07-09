import { createRequire } from "node:module";
import { applyMemoryDecisions, linkRelatedMemories, listMemoryItems, markMemoryIndexingEventsIndexed, prepareGlobalMemoryIndexingBatch, prepareMemoryIndexingBatch, recallMemoryNeighborhoods, searchMemoryItems } from "./memory-persistence";
import { acknowledgeLoopResults, listPendingLoopResults, prepareSessionCompaction, saveLoopResult, saveSessionSummary, updateSessionCompaction } from "./session-compaction-persistence";
import type { MemoryType, MemoryAction, MemoryLinkType, MemoryRecord, MemoryCandidate, MemoryDecision, MemoryIndexingPreparedEvent, MemoryIndexingPreparedBatch, MemoryIndexingResult } from "./memory-persistence";
import type { PendingLoopResult, SaveLoopResultInput, SaveSessionSummaryInput, SessionCompactionPreparedContext, SessionCompactionPrepareOptions } from "./session-compaction-persistence";
const require = createRequire(import.meta.url);
type DatabaseConstructor = new (path: string, options?: { readonly?: boolean }) => SqliteDatabase;
export interface SqliteDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): SqliteStatement;
  close(): void;
}
export interface SqliteStatement {
  run(...params: unknown[]): { changes?: number } | unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
const Database = resolveSqliteDatabase();
export type GeistrChatRole = "user" | "assistant" | "system" | "tool";
export type GeistrTranscriptEventType = "message" | "tool_call" | "tool_result" | "system_note" | "summary" | "compaction" | "loop_result";
export type { MemoryType, MemoryAction, MemoryLinkType, MemoryRecord, MemoryCandidate, MemoryDecision, MemoryIndexingPreparedEvent, MemoryIndexingPreparedBatch, MemoryIndexingResult } from "./memory-persistence";
export interface GeistrChatListItem {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  preview: string | null;
}
export interface MessageAttachment { id: string; name: string; type: "image" | "file"; mimeType: string; size: number; path: string; originalPath?: string }
export interface GeistrChatMessage { id: string; role: GeistrChatRole; content: string; createdAt: number; attachments?: MessageAttachment[] }
export interface GeistrOpenChatResult { sessionKey: string; title: string; messages: GeistrChatMessage[] }
export interface GeistrAppendMessageInput { sessionKey: string; role: GeistrChatRole; content: string; eventId?: string; providerId?: string | null; modelId?: string | null; metadata?: Record<string, unknown>; attachments?: MessageAttachment[]; now?: number }
export interface GeistrAppendTurnInput {
  sessionKey: string;
  turnId: string;
  userMessage: string;
  assistantMessage: string;
  providerId?: string | null;
  modelId?: string | null;
  status?: "success" | "error";
  errorMessage?: string | null;
  now?: number;
}
export interface GeistrAppendTurnResult {
  persisted: boolean;
  userEventId: string;
  assistantEventId: string;
  messageCount: number;
}
export type { PendingLoopResult, SaveLoopResultInput, SaveSessionSummaryInput, SessionCompactionPreparedContext, SessionCompactionPreparedEvent, SessionCompactionPrepareOptions } from "./session-compaction-persistence";
export { acknowledgeLoopResults, estimateCompactionTokens, listPendingLoopResults, prepareSessionCompaction, saveLoopResult, saveSessionSummary, updateSessionCompaction } from "./session-compaction-persistence";
type Row = Record<string, unknown>;
const SESSION_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS session_state (
    session_key TEXT PRIMARY KEY NOT NULL,
    active_transcript_id TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    provider_id TEXT,
    model_id TEXT,
    auth_profile_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_user_message_at INTEGER,
    last_assistant_message_at INTEGER,
    message_count INTEGER NOT NULL DEFAULT 0,
    tool_call_count INTEGER NOT NULL DEFAULT 0,
    compaction_count INTEGER NOT NULL DEFAULT 0,
    last_summary_event_id TEXT,
    last_run_status TEXT,
    last_run_error TEXT,
    origin_type TEXT,
    origin_id TEXT,
    metadata_json TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS session_transcripts (
    transcript_id TEXT PRIMARY KEY NOT NULL,
    session_key TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    closed_at INTEGER,
    reset_reason TEXT,
    summary_until_event_id TEXT,
    metadata_json TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS session_events (
    event_id TEXT PRIMARY KEY NOT NULL,
    transcript_id TEXT NOT NULL,
    session_key TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    role TEXT,
    tool_call_id TEXT,
    tool_name TEXT,
    provider_id TEXT,
    model_id TEXT,
    created_at INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    memory_indexed_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS memory_items (
    id TEXT PRIMARY KEY NOT NULL,
    content TEXT NOT NULL,
    category TEXT NOT NULL,
    memory_type TEXT NOT NULL,
    importance INTEGER NOT NULL DEFAULT 5,
    stability INTEGER NOT NULL DEFAULT 5,
    current_strength INTEGER NOT NULL DEFAULT 5,
    status TEXT NOT NULL DEFAULT 'active',
    tags_json TEXT NOT NULL DEFAULT '[]',
    thread_id TEXT,
    source_session_id TEXT,
    source_message_id TEXT,
    superseded_by_memory_id TEXT,
    recall_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS memory_links (
    id TEXT PRIMARY KEY NOT NULL,
    from_memory_id TEXT NOT NULL,
    to_memory_id TEXT NOT NULL,
    link_type TEXT NOT NULL,
    strength INTEGER NOT NULL DEFAULT 5,
    last_activated_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(from_memory_id, to_memory_id, link_type)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_session_state_updated_at ON session_state(updated_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_memory_items_status ON memory_items(status, updated_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_memory_links_memory ON memory_links(from_memory_id, to_memory_id)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_session_events_transcript_sequence ON session_events(transcript_id, sequence)",
] as const;
export function ensureSessionSchema(db: SqliteDatabase): void {
  for (const sql of SESSION_SCHEMA_SQL) db.exec(sql);
}
export function createGeistrSessionKey(): string {
  return `chat:${createId("session")}`;
}
export function createGeistrTranscriptId(sessionKey: string, epoch: number): string {
  return `${sessionKey}:transcript:${epoch}`;
}
export function geistrTurnEventIds(turnId: string): { userEventId: string; assistantEventId: string; userMessageId: string; assistantMessageId: string } {
  const safe = turnId.replace(/[^a-zA-Z0-9_-]+/g, "-");
  return {
    userEventId: `geistr-desktop-${safe}-user`,
    assistantEventId: `geistr-desktop-${safe}-assistant`,
    userMessageId: `geistr-desktop-${safe}-user-msg`,
    assistantMessageId: `geistr-desktop-${safe}-assistant-msg`,
  };
}
export class SessionPersistenceStore {
  constructor(private readonly databasePath: string) {}
  ensureReady(): void {
    const db = this.openWritable();
    try {
      ensureSessionSchema(db);
    } finally {
      db.close();
    }
  }
  getOrCreateCurrentChat(now = Date.now()): GeistrOpenChatResult {
    const chats = this.listChats();
    const current = chats[0] ?? this.createChat(now);
    return this.openChat(current.id);
  }
  listChats(): GeistrChatListItem[] {
    const db = this.openReadonly();
    try {
      ensureSessionSchema(db);
      const rows = db.prepare(`SELECT
        s.session_key,
        s.title,
        s.created_at,
        s.updated_at,
        s.message_count,
        e.payload_json AS preview_payload
      FROM session_state s
      LEFT JOIN session_events e ON e.event_id = (
        SELECT se.event_id
        FROM session_events se
        WHERE se.session_key = s.session_key
          AND se.event_type = 'message'
          AND se.role IN ('user', 'assistant')
          AND COALESCE(json_extract(se.payload_json, '$.hiddenFromChat'), 0) != 1
          AND length(trim(COALESCE(json_extract(se.payload_json, '$.content'), ''))) > 0
        ORDER BY se.created_at DESC, se.sequence DESC
        LIMIT 1
      )
      WHERE s.status != 'deleted'
      ORDER BY s.updated_at DESC
      LIMIT 200`).all() as Row[];
      return rows.map((row) => ({
        id: asString(row.session_key),
        title: asString(row.title, "Untitled chat") || "Untitled chat",
        createdAt: asNumber(row.created_at),
        updatedAt: asNumber(row.updated_at),
        messageCount: asNumber(row.message_count),
        preview: extractMessageContent(row.preview_payload).slice(0, 240) || null,
      }));
    } finally {
      db.close();
    }
  }
  createChat(now = Date.now()): GeistrChatListItem {
    const db = this.openWritable();
    try {
      ensureSessionSchema(db);
      return insertGeistrEmptyChat(db, now);
    } finally {
      db.close();
    }
  }
  openChat(sessionKey: string): GeistrOpenChatResult {
    const db = this.openReadonly();
    try {
      ensureSessionSchema(db);
      const state = db.prepare("SELECT title, status FROM session_state WHERE session_key = ?").get(sessionKey) as Row | undefined;
      return {
        sessionKey,
        title: asString(state?.title, "New Chat") || "New Chat",
        messages: asString(state?.status) === "deleted" ? [] : readCurrentChatMessages(db, sessionKey),
      };
    } finally {
      db.close();
    }
  }
  renameChat(sessionKey: string, title: string, now = Date.now()): GeistrChatListItem[] {
    const trimmed = title.trim().slice(0, 120);
    if (!trimmed) return this.listChats();
    const db = this.openWritable();
    try {
      ensureSessionSchema(db);
      db.prepare("UPDATE session_state SET title = ?, updated_at = ? WHERE session_key = ? AND status != 'deleted'").run(trimmed, now, sessionKey);
      return this.listChats();
    } finally {
      db.close();
    }
  }
  deleteChat(sessionKey: string, now = Date.now()): GeistrChatListItem[] {
    const db = this.openWritable();
    try {
      ensureSessionSchema(db);
      db.exec("BEGIN");
      try {
        db.prepare("UPDATE session_state SET status = 'deleted', title = 'Deleted chat', message_count = 0, updated_at = ?, last_user_message_at = NULL, last_assistant_message_at = NULL, last_run_status = NULL, last_run_error = NULL, metadata_json = json_set(COALESCE(metadata_json, '{}'), '$.deletedAt', ?) WHERE session_key = ?").run(now, now, sessionKey);
        db.prepare("UPDATE session_transcripts SET status = 'deleted', closed_at = COALESCE(closed_at, ?), reset_reason = 'deleted', updated_at = ?, metadata_json = json_set(COALESCE(metadata_json, '{}'), '$.deletedAt', ?) WHERE session_key = ?").run(now, now, now, sessionKey);
        db.prepare("UPDATE session_events SET payload_json = json_set(COALESCE(payload_json, '{}'), '$.content', '', '$.summary', '', '$.hiddenFromChat', 1, '$.deleted', 1), metadata_json = json_set(COALESCE(metadata_json, '{}'), '$.deleted', 1, '$.deletedAt', ?, '$.hiddenFromChat', 1) WHERE session_key = ?").run(now, sessionKey);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return this.listChats();
    } finally {
      db.close();
    }
  }
  appendMessage(input: GeistrAppendMessageInput): GeistrChatMessage {
    const db = this.openWritable();
    try {
      ensureSessionSchema(db);
      return appendGeistrMessage(db, input);
    } finally {
      db.close();
    }
  }
  appendTurn(input: GeistrAppendTurnInput): GeistrAppendTurnResult {
    const db = this.openWritable();
    try {
      ensureSessionSchema(db);
      return appendGeistrChatTurn(db, input);
    } finally {
      db.close();
    }
  }
  countUnindexedMessages(sessionKey: string): number {
    const db = this.openReadonly();
    try {
      ensureSessionSchema(db);
      return countUnindexedMessages(db, sessionKey);
    } finally {
      db.close();
    }
  }
  countGlobalUnindexedMessages(): number {
    const db = this.openReadonly();
    try {
      ensureSessionSchema(db);
      return countGlobalUnindexedMessages(db);
    } finally {
      db.close();
    }
  }
  markEventsIndexed(sessionKey: string, now = Date.now()): number {
    const db = this.openWritable();
    try {
      ensureSessionSchema(db);
      return markEventsIndexed(db, sessionKey, now);
    } finally {
      db.close();
    }
  }
  updateSessionCompaction(sessionKey: string, summaryEventId: string | null, now = Date.now()): void {
    const db = this.openWritable();
    try {
      ensureSessionSchema(db);
      updateSessionCompaction(db, sessionKey, summaryEventId, now);
    } finally {
      db.close();
    }
  }
  getUnsummarizedEventCount(sessionKey: string): number {
    const db = this.openReadonly();
    try {
      ensureSessionSchema(db);
      return getUnsummarizedEventCount(db, sessionKey);
    } finally {
      db.close();
    }
  }
  getLatestSessionSummary(sessionKey: string): string | null {
    const db = this.openReadonly();
    try {
      ensureSessionSchema(db);
      return getLatestSessionSummary(db, sessionKey);
    } finally {
      db.close();
    }
  }
  prepareSessionCompaction(sessionKey: string, options: SessionCompactionPrepareOptions): SessionCompactionPreparedContext | null {
    const db = this.openReadonly();
    try {
      ensureSessionSchema(db);
      return prepareSessionCompaction(db, sessionKey, options);
    } finally {
      db.close();
    }
  }
  saveSessionSummary(input: SaveSessionSummaryInput): string {
    const db = this.openWritable();
    try {
      ensureSessionSchema(db);
      return saveSessionSummary(db, input);
    } finally {
      db.close();
    }
  }
  saveLoopResult(input: SaveLoopResultInput): string {
    const db = this.openWritable();
    try {
      ensureSessionSchema(db);
      return saveLoopResult(db, input);
    } finally {
      db.close();
    }
  }
  listPendingLoopResults(sessionKey: string, limit = 5): PendingLoopResult[] {
    const db = this.openReadonly();
    try {
      ensureSessionSchema(db);
      return listPendingLoopResults(db, sessionKey, limit);
    } finally {
      db.close();
    }
  }
  acknowledgeLoopResults(sessionKey: string, eventIds: string[], now = Date.now()): number {
    const db = this.openWritable();
    try {
      ensureSessionSchema(db);
      return acknowledgeLoopResults(db, sessionKey, eventIds, now);
    } finally {
      db.close();
    }
  }
  prepareMemoryIndexingBatch(sessionKey: string, options: { threshold: number; limit: number; force?: boolean }): MemoryIndexingPreparedBatch | null {
    const db = this.openReadonly();
    try {
      ensureSessionSchema(db);
      return prepareMemoryIndexingBatch(db, sessionKey, options);
    } finally {
      db.close();
    }
  }
  prepareGlobalMemoryIndexingBatch(options: { threshold: number; limit: number; force?: boolean }): MemoryIndexingPreparedBatch | null {
    const db = this.openReadonly();
    try {
      ensureSessionSchema(db);
      return prepareGlobalMemoryIndexingBatch(db, options);
    } finally {
      db.close();
    }
  }
  markMemoryIndexingEventsIndexed(sessionKey: string, eventIds: string[], now = Date.now()): number {
    const db = this.openWritable();
    try {
      ensureSessionSchema(db);
      return markMemoryIndexingEventsIndexed(db, sessionKey, eventIds, now);
    } finally {
      db.close();
    }
  }
  listMemoryItems(limit = 200): MemoryRecord[] {
    const db = this.openReadonly();
    try {
      ensureSessionSchema(db);
      return listMemoryItems(db, limit);
    } finally {
      db.close();
    }
  }
  recallMemoryNeighborhoods(candidates: MemoryCandidate[]): Record<string, MemoryRecord[]> {
    const db = this.openReadonly();
    try {
      ensureSessionSchema(db);
      return recallMemoryNeighborhoods(db, candidates);
    } finally {
      db.close();
    }
  }
  applyMemoryDecisions(input: { sessionKey: string; candidates: MemoryCandidate[]; decisions: MemoryDecision[]; sourceMessageIds: string[] }): MemoryIndexingResult & { persistedMemoryIds: string[] } {
    const db = this.openWritable();
    try {
      ensureSessionSchema(db);
      return applyMemoryDecisions(db, input);
    } finally {
      db.close();
    }
  }
  linkRelatedMemories(memoryIds: string[]): number {
    const db = this.openWritable();
    try {
      ensureSessionSchema(db);
      return linkRelatedMemories(db, memoryIds);
    } finally {
      db.close();
    }
  }
  getRelevantMemoryContext(query: string, limit = 8): MemoryRecord[] {
    const db = this.openReadonly();
    try {
      ensureSessionSchema(db);
      return searchMemoryItems(db, query, limit);
    } finally {
      db.close();
    }
  }
  withWritableMemoryDatabase<T>(run: (db: SqliteDatabase) => T): T {
    const db = this.openWritable();
    try {
      ensureSessionSchema(db);
      return run(db);
    } finally {
      db.close();
    }
  }
  withReadonlyMemoryDatabase<T>(run: (db: SqliteDatabase) => T): T {
    const db = this.openReadonly();
    try {
      ensureSessionSchema(db);
      return run(db);
    } finally {
      db.close();
    }
  }
  private openWritable(): SqliteDatabase {
    const db = new Database(this.databasePath);
    db.exec("PRAGMA journal_mode = WAL");
    return db;
  }
  private openReadonly(): SqliteDatabase {
    return new Database(this.databasePath);
  }
}
export function insertGeistrEmptyChat(db: SqliteDatabase, now: number): GeistrChatListItem {
  ensureSessionSchema(db);
  const sessionKey = createGeistrSessionKey();
  const transcriptId = createGeistrTranscriptId(sessionKey, 0);
  withTransaction(db, () => {
    db.prepare("INSERT INTO session_transcripts (transcript_id, session_key, epoch, status, created_at, updated_at, closed_at, reset_reason, summary_until_event_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(transcriptId, sessionKey, 0, "active", now, now, null, null, null, "{}");
    db.prepare("INSERT INTO session_state (session_key, active_transcript_id, title, status, provider_id, model_id, auth_profile_id, created_at, updated_at, last_user_message_at, last_assistant_message_at, message_count, tool_call_count, compaction_count, last_summary_event_id, last_run_status, last_run_error, origin_type, origin_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(sessionKey, transcriptId, "New Chat", "active", null, null, null, now, now, null, null, 0, 0, 0, null, null, null, null, null, "{}");
  });
  return { id: sessionKey, title: "New Chat", createdAt: now, updatedAt: now, messageCount: 0, preview: null };
}
export function readCurrentChatMessages(db: SqliteDatabase, sessionKey: string): GeistrChatMessage[] {
  ensureSessionSchema(db);
  const rows = db.prepare(`SELECT event_id, role, created_at, payload_json
    FROM session_events
    WHERE session_key = ?
      AND event_type = 'message'
      AND role IN ('user', 'assistant', 'system', 'tool')
      AND COALESCE(json_extract(payload_json, '$.hiddenFromChat'), 0) != 1
    ORDER BY sequence ASC`).all(sessionKey) as Row[];
  return rows
    .map((row) => {
      const parsed = parseJsonObject(row.payload_json);
      const attachments = extractAttachments(parsed);
      return {
        id: asString(row.event_id),
        role: normalizeRole(row.role),
        content: extractMessageContent(row.payload_json),
        createdAt: asNumber(row.created_at),
        ...(attachments ? { attachments } : {}),
      };
    })
    .filter((message) => message.id.length > 0 && (message.content.trim().length > 0 || Boolean(message.attachments?.length)));
}
export function appendGeistrMessage(db: SqliteDatabase, input: GeistrAppendMessageInput): GeistrChatMessage {
  ensureSessionSchema(db);
  const now = input.now ?? Date.now();
  const eventId = input.eventId ?? createId("event");
  return withTransaction(db, () => {
    const state = ensureSessionState(db, input.sessionKey, now);
    if (eventExists(db, eventId)) {
      const existing = db.prepare("SELECT event_id, role, created_at, payload_json FROM session_events WHERE event_id = ?").get(eventId) as Row;
      return {
        id: asString(existing.event_id),
        role: normalizeRole(existing.role),
        content: extractMessageContent(existing.payload_json),
        createdAt: asNumber(existing.created_at),
      };
    }
    const sequence = nextTranscriptSequence(db, state.transcriptId);
    const payload: Record<string, unknown> = { content: input.content, messageType: "text", hiddenFromChat: false };
    if (input.attachments && input.attachments.length > 0) {
      payload.attachments = input.attachments;
    }
    db.prepare("INSERT INTO session_events (event_id, transcript_id, session_key, sequence, event_type, role, tool_call_id, tool_name, provider_id, model_id, created_at, payload_json, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(eventId, state.transcriptId, input.sessionKey, sequence, "message", input.role, null, null, input.providerId ?? null, input.modelId ?? null, now, JSON.stringify(payload), JSON.stringify(input.metadata ?? { source: "runtime", hiddenFromChat: false }));
    const nextTitle = input.role === "user" && state.title === "New Chat" ? deriveGeistrChatTitle(input.content) : state.title;
    updateSessionStateForMessages(db, {
      sessionKey: input.sessionKey,
      title: nextTitle,
      providerId: input.providerId ?? state.providerId,
      modelId: input.modelId ?? state.modelId,
      now,
      userAt: input.role === "user" ? now : null,
      assistantAt: input.role === "assistant" ? now : null,
      insertedMessages: 1,
      runStatus: input.role === "assistant" ? "success" : state.lastRunStatus,
      runError: null,
    });
    return { id: eventId, role: input.role, content: input.content, createdAt: now, ...(input.attachments?.length ? { attachments: input.attachments } : {}) };
  });
}
export function appendGeistrChatTurn(db: SqliteDatabase, input: GeistrAppendTurnInput): GeistrAppendTurnResult {
  ensureSessionSchema(db);
  const ids = geistrTurnEventIds(input.turnId);
  const now = input.now ?? Date.now();
  if (eventExists(db, ids.assistantEventId)) {
    const existing = db.prepare("SELECT message_count FROM session_state WHERE session_key = ?").get(input.sessionKey) as Row | undefined;
    return { persisted: false, userEventId: ids.userEventId, assistantEventId: ids.assistantEventId, messageCount: asNumber(existing?.message_count) };
  }
  return withTransaction(db, () => {
    const state = ensureSessionState(db, input.sessionKey, now);
    let sequence = nextTranscriptSequence(db, state.transcriptId);
    let inserted = 0;
    if (!eventExists(db, ids.userEventId)) {
      insertMessageEvent(db, { eventId: ids.userEventId, transcriptId: state.transcriptId, sessionKey: input.sessionKey, sequence, role: "user", providerId: null, modelId: null, createdAt: now, content: input.userMessage, metadata: { source: "runtime", userTurn: true, hiddenFromChat: false } });
      sequence += 1;
      inserted += 1;
    }
    insertMessageEvent(db, { eventId: ids.assistantEventId, transcriptId: state.transcriptId, sessionKey: input.sessionKey, sequence, role: "assistant", providerId: input.providerId ?? null, modelId: input.modelId ?? null, createdAt: now, content: input.assistantMessage, metadata: { source: "runtime", hiddenFromChat: false, ...(input.status === "error" ? { failed: true, errorMessage: input.errorMessage ?? null } : {}) } });
    inserted += 1;
    const nextTitle = state.title === "New Chat" ? deriveGeistrChatTitle(input.userMessage) : state.title;
    const nextCount = state.messageCount + inserted;
    updateSessionStateForMessages(db, { sessionKey: input.sessionKey, title: nextTitle, providerId: input.providerId ?? null, modelId: input.modelId ?? null, now, userAt: now, assistantAt: now, insertedMessages: inserted, runStatus: input.status === "error" ? "error" : "success", runError: input.status === "error" ? input.errorMessage ?? input.assistantMessage : null });
    return { persisted: true, userEventId: ids.userEventId, assistantEventId: ids.assistantEventId, messageCount: nextCount };
  });
}
function ensureSessionState(db: SqliteDatabase, sessionKey: string, now: number): { transcriptId: string; title: string; messageCount: number; providerId: string | null; modelId: string | null; lastRunStatus: string | null } {
  const state = db.prepare("SELECT active_transcript_id, title, message_count, provider_id, model_id, last_run_status FROM session_state WHERE session_key = ?").get(sessionKey) as Row | undefined;
  if (state) {
    return { transcriptId: asString(state.active_transcript_id) || createGeistrTranscriptId(sessionKey, 0), title: asString(state.title, "New Chat") || "New Chat", messageCount: asNumber(state.message_count), providerId: nullableString(state.provider_id), modelId: nullableString(state.model_id), lastRunStatus: nullableString(state.last_run_status) };
  }
  const transcriptId = createGeistrTranscriptId(sessionKey, 0);
  db.prepare("INSERT INTO session_transcripts (transcript_id, session_key, epoch, status, created_at, updated_at, closed_at, reset_reason, summary_until_event_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(transcript_id) DO NOTHING")
    .run(transcriptId, sessionKey, 0, "active", now, now, null, null, null, "{}");
  db.prepare("INSERT INTO session_state (session_key, active_transcript_id, title, status, provider_id, model_id, auth_profile_id, created_at, updated_at, last_user_message_at, last_assistant_message_at, message_count, tool_call_count, compaction_count, last_summary_event_id, last_run_status, last_run_error, origin_type, origin_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(sessionKey, transcriptId, "New Chat", "active", null, null, null, now, now, null, null, 0, 0, 0, null, null, null, null, null, "{}");
  return { transcriptId, title: "New Chat", messageCount: 0, providerId: null, modelId: null, lastRunStatus: null };
}
function insertMessageEvent(db: SqliteDatabase, event: { eventId: string; transcriptId: string; sessionKey: string; sequence: number; role: GeistrChatRole; providerId: string | null; modelId: string | null; createdAt: number; content: string; metadata: Record<string, unknown> }): void {
  db.prepare("INSERT INTO session_events (event_id, transcript_id, session_key, sequence, event_type, role, tool_call_id, tool_name, provider_id, model_id, created_at, payload_json, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(event.eventId, event.transcriptId, event.sessionKey, event.sequence, "message", event.role, null, null, event.providerId, event.modelId, event.createdAt, JSON.stringify({ content: event.content, messageType: "text", hiddenFromChat: false }), JSON.stringify(event.metadata));
}
function updateSessionStateForMessages(db: SqliteDatabase, input: { sessionKey: string; title: string; providerId: string | null; modelId: string | null; now: number; userAt: number | null; assistantAt: number | null; insertedMessages: number; runStatus: string | null; runError: string | null }): void {
  db.prepare(`UPDATE session_state SET
    title = ?,
    provider_id = COALESCE(?, provider_id),
    model_id = COALESCE(?, model_id),
    updated_at = ?,
    last_user_message_at = COALESCE(?, last_user_message_at),
    last_assistant_message_at = COALESCE(?, last_assistant_message_at),
    message_count = message_count + ?,
    last_run_status = COALESCE(?, last_run_status),
    last_run_error = ?,
    active_transcript_id = active_transcript_id
    WHERE session_key = ?`)
    .run(input.title, input.providerId, input.modelId, input.now, input.userAt, input.assistantAt, input.insertedMessages, input.runStatus, input.runError, input.sessionKey);
  db.prepare("UPDATE session_transcripts SET updated_at = ? WHERE session_key = ? AND status = 'active'").run(input.now, input.sessionKey);
}
function eventExists(db: SqliteDatabase, eventId: string): boolean {
  return db.prepare("SELECT event_id FROM session_events WHERE event_id = ?").get(eventId) != null;
}
function nextTranscriptSequence(db: SqliteDatabase, transcriptId: string): number {
  const row = db.prepare("SELECT COALESCE(MAX(sequence), -1) + 1 AS next FROM session_events WHERE transcript_id = ?").get(transcriptId) as Row | undefined;
  return asNumber(row?.next, 0);
}
function deriveGeistrChatTitle(userMessage: string): string {
  const firstLine = userMessage.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (!firstLine) return "New Chat";
  return firstLine.length > 60 ? `${firstLine.slice(0, 57).trimEnd()}…` : firstLine;
}
function extractMessageContent(payload: unknown): string {
  const object = parseJsonObject(payload);
  const content = object.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === "string" ? part : part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : "").filter(Boolean).join("\n");
  }
  return "";
}
function extractAttachments(payload: Record<string, unknown>): MessageAttachment[] | undefined {
  const raw = payload.attachments;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw.map((item: unknown) => {
    const a = item as Record<string, unknown>;
    return { id: asString(a.id), name: asString(a.name), type: a.type === "image" ? "image" : "file", mimeType: asString(a.mimeType), size: asNumber(a.size), path: asString(a.path), ...(a.originalPath ? { originalPath: asString(a.originalPath) } : {}) };
  });
}
function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || value.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
function normalizeRole(value: unknown): GeistrChatRole {
  return value === "user" || value === "assistant" || value === "system" || value === "tool" ? value : "assistant";
}
function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function createId(prefix: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}
function resolveSqliteDatabase(): DatabaseConstructor {
  if (typeof process !== "undefined" && process.versions && "bun" in process.versions) {
    return (require("bun:sqlite") as { Database: DatabaseConstructor }).Database;
  }
  return (require("node:sqlite") as { DatabaseSync: DatabaseConstructor }).DatabaseSync;
}
export function countUnindexedMessages(db: SqliteDatabase, sessionKey: string): number {
  const row = db.prepare(
    `SELECT COUNT(*) AS cnt FROM session_events
     WHERE session_key = ? AND event_type = 'message'
       AND role IN ('user', 'assistant')
       AND memory_indexed_at IS NULL
       AND COALESCE(json_extract(payload_json, '$.hiddenFromChat'), 0) != 1
       AND COALESCE(json_extract(metadata_json, '$.deleted'), 0) != 1`
  ).get(sessionKey) as Row | undefined;
  return asNumber(row?.cnt, 0);
}
export function countGlobalUnindexedMessages(db: SqliteDatabase): number {
  const row = db.prepare(
    `SELECT COUNT(*) AS cnt FROM session_events se
     JOIN session_state ss ON ss.session_key = se.session_key
     WHERE ss.status != 'deleted'
       AND se.event_type = 'message'
       AND se.role IN ('user', 'assistant')
       AND se.memory_indexed_at IS NULL
       AND COALESCE(json_extract(se.payload_json, '$.hiddenFromChat'), 0) != 1
       AND COALESCE(json_extract(se.metadata_json, '$.deleted'), 0) != 1`
  ).get() as Row | undefined;
  return asNumber(row?.cnt, 0);
}
export function markEventsIndexed(db: SqliteDatabase, sessionKey: string, now: number): number {
  const result = db.prepare(
    `UPDATE session_events SET memory_indexed_at = ?
     WHERE session_key = ? AND event_type = 'message'
       AND role IN ('user', 'assistant')
       AND memory_indexed_at IS NULL`
  ).run(now, sessionKey);
  return (result as { changes?: number }).changes ?? 0;
}
export function getUnsummarizedEventCount(db: SqliteDatabase, sessionKey: string): number {
  const state = db.prepare(
    "SELECT last_summary_event_id FROM session_state WHERE session_key = ?"
  ).get(sessionKey) as Row | undefined;
  const summaryEventId = state ? asString(state.last_summary_event_id) || null : null;
  const params = summaryEventId ? [sessionKey, summaryEventId] : [sessionKey];
  const row = db.prepare(
    `SELECT COUNT(*) AS cnt FROM session_events
     WHERE session_key = ? AND event_type = 'message'
       AND role IN ('user', 'assistant')
       AND (coalesce(json_extract(payload_json, '$.hiddenFromChat'), 0) = 0 OR json_extract(payload_json, '$.hiddenFromChat') IS NULL)
       ${summaryEventId ? "AND sequence > (SELECT sequence FROM session_events WHERE event_id = ?)" : ""}`
  ).get(...params) as Row | undefined;
  return asNumber(row?.cnt, 0);
}
export function getLatestSessionSummary(db: SqliteDatabase, sessionKey: string): string | null {
  const row = db.prepare(`SELECT payload_json FROM session_events
    WHERE session_key = ? AND event_type = 'summary'
    ORDER BY sequence DESC LIMIT 1`).get(sessionKey) as Row | undefined;
  const payload = parseJsonObject(row?.payload_json);
  const summary = payload.summary;
  return typeof summary === "string" && summary.trim() ? summary.trim() : null;
}
function withTransaction<T>(db: SqliteDatabase, run: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = run();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
