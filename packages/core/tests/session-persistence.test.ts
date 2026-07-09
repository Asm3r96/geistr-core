import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const BunDatabase = (await import("bun:sqlite")).Database;

import {
  SessionPersistenceStore,
  createGeistrSessionKey,
  ensureSessionSchema,
} from "../src/session-persistence";

let tempDir: string;
let dbPath: string;

beforeEach(async () => {
  tempDir = join(tmpdir(), `geistr-session-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempDir, { recursive: true });
  dbPath = join(tempDir, "geistr-sessions.sqlite");
});

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

describe("SessionPersistenceStore", () => {
  it("creates the Geistr session schema", () => {
    const db = new BunDatabase(dbPath);
    try {
      ensureSessionSchema(db as never);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>;
      expect(tables.map((table) => table.name)).toEqual([
        "memory_items",
        "memory_links",
        "session_events",
        "session_state",
        "session_transcripts",
      ]);
    } finally {
      db.close();
    }
  });

  it("creates and lists a persisted chat", () => {
    const store = new SessionPersistenceStore(dbPath);
    store.ensureReady();

    const chat = store.createChat(1000);
    const chats = store.listChats();

    expect(chat.title).toBe("New Chat");
    expect(chats).toEqual([chat]);
  });

  it("opens chat messages ordered by transcript sequence", () => {
    const store = new SessionPersistenceStore(dbPath);
    const chat = store.createChat(1000);

    const user = store.appendMessage({ sessionKey: chat.id, role: "user", content: "Hello", now: 1100 });
    const assistant = store.appendMessage({ sessionKey: chat.id, role: "assistant", content: "Hi there", now: 1200 });

    expect(store.openChat(chat.id)).toEqual({
      sessionKey: chat.id,
      title: "Hello",
      messages: [user, assistant],
    });
  });

  it("uses latest visible user or assistant message as chat preview", () => {
    const store = new SessionPersistenceStore(dbPath);
    const first = store.createChat(1000);
    store.appendMessage({ sessionKey: first.id, role: "user", content: "First question", now: 1100 });
    store.appendMessage({ sessionKey: first.id, role: "assistant", content: "First answer", now: 1200 });

    const second = store.createChat(2000);
    store.appendMessage({ sessionKey: second.id, role: "user", content: "Second question", now: 2100 });

    expect(store.listChats().map((chat) => ({ id: chat.id, preview: chat.preview }))).toEqual([
      { id: second.id, preview: "Second question" },
      { id: first.id, preview: "First answer" },
    ]);
  });

  it("renames and soft-deletes chats while scrubbing message content", () => {
    const store = new SessionPersistenceStore(dbPath);
    const chat = store.createChat(1000);
    const message = store.appendMessage({ sessionKey: chat.id, role: "user", content: "Sensitive content", now: 1100 });

    store.renameChat(chat.id, "Renamed session", 1200);
    expect(store.listChats()[0]?.title).toBe("Renamed session");

    store.deleteChat(chat.id, 1300);
    expect(store.listChats().some((item) => item.id === chat.id)).toBe(false);
    expect(store.openChat(chat.id).messages).toEqual([]);

    const db = new BunDatabase(dbPath);
    try {
      const state = db.prepare("SELECT status FROM session_state WHERE session_key = ?").get(chat.id) as { status: string };
      const event = db.prepare("SELECT payload_json, metadata_json FROM session_events WHERE event_id = ?").get(message.id) as { payload_json: string; metadata_json: string };
      expect(state.status).toBe("deleted");
      expect(JSON.parse(event.payload_json).content).toBe("");
      expect(JSON.parse(event.payload_json).deleted).toBe(1);
      expect(JSON.parse(event.metadata_json).deleted).toBe(1);
    } finally {
      db.close();
    }
  });

  it("appends a user/assistant turn idempotently by turn id", () => {
    const store = new SessionPersistenceStore(dbPath);
    const sessionKey = createGeistrSessionKey();

    const first = store.appendTurn({
      sessionKey,
      turnId: "turn-1",
      userMessage: "What is Geistr?",
      assistantMessage: "A local-first agent workspace.",
      providerId: "anthropic",
      modelId: "claude-test",
      now: 1000,
    });
    const duplicate = store.appendTurn({
      sessionKey,
      turnId: "turn-1",
      userMessage: "What is Geistr?",
      assistantMessage: "A local-first agent workspace.",
      providerId: "anthropic",
      modelId: "claude-test",
      now: 2000,
    });

    expect(first.persisted).toBe(true);
    expect(duplicate.persisted).toBe(false);
    expect(duplicate.messageCount).toBe(2);
    expect(store.openChat(sessionKey).messages.map((message) => message.content)).toEqual([
      "What is Geistr?",
      "A local-first agent workspace.",
    ]);
    expect(store.listChats()[0]).toMatchObject({
      id: sessionKey,
      title: "What is Geistr?",
      messageCount: 2,
      preview: "A local-first agent workspace.",
    });
  });

  it("loads or creates the current chat for startup", () => {
    const store = new SessionPersistenceStore(dbPath);

    const created = store.getOrCreateCurrentChat(1000);
    store.appendMessage({ sessionKey: created.sessionKey, role: "user", content: "Persist me", now: 1100 });

    const reopenedStore = new SessionPersistenceStore(dbPath);
    const reopened = reopenedStore.getOrCreateCurrentChat();

    expect(reopened.sessionKey).toBe(created.sessionKey);
    expect(reopened.messages.map((message) => message.content)).toEqual(["Persist me"]);
  });

  it("counts unindexed messages when memory_indexed_at is null", () => {
    const store = new SessionPersistenceStore(dbPath);
    const chat = store.createChat(1000);
    store.appendMessage({ sessionKey: chat.id, role: "user", content: "Hello", now: 1100 });
    store.appendMessage({ sessionKey: chat.id, role: "assistant", content: "Hi", now: 1200 });

    expect(store.countUnindexedMessages(chat.id)).toBe(2);
  });

  it("counts global unindexed messages across chats and excludes deleted chats", () => {
    const store = new SessionPersistenceStore(dbPath);
    const chatA = store.createChat(1000);
    const chatB = store.createChat(2000);
    store.appendMessage({ sessionKey: chatA.id, role: "user", content: "Hello", now: 1100 });
    store.appendMessage({ sessionKey: chatB.id, role: "assistant", content: "Hi", now: 2100 });

    expect(store.countGlobalUnindexedMessages()).toBe(2);

    store.deleteChat(chatB.id, 3000);
    expect(store.countGlobalUnindexedMessages()).toBe(1);
  });

  it("markEventsIndexed sets memory_indexed_at and reduces unindexed count", () => {
    const store = new SessionPersistenceStore(dbPath);
    const chat = store.createChat(1000);
    store.appendMessage({ sessionKey: chat.id, role: "user", content: "Hello", now: 1100 });
    store.appendMessage({ sessionKey: chat.id, role: "assistant", content: "Hi", now: 1200 });

    expect(store.countUnindexedMessages(chat.id)).toBe(2);

    const updated = store.markEventsIndexed(chat.id, 2000);
    expect(updated).toBe(2);
    expect(store.countUnindexedMessages(chat.id)).toBe(0);
  });

  it("updateSessionCompaction increments compaction_count and sets last_summary_event_id", () => {
    const store = new SessionPersistenceStore(dbPath);
    const chat = store.createChat(1000);

    store.updateSessionCompaction(chat.id, "summary-event-1", 2000);
    store.updateSessionCompaction(chat.id, "summary-event-2", 3000);

    // Verify by reading from DB directly
    const db = new BunDatabase(dbPath);
    try {
      const state = db.prepare("SELECT compaction_count, last_summary_event_id, updated_at FROM session_state WHERE session_key = ?").get(chat.id) as Record<string, unknown>;
      expect(state.compaction_count).toBe(2);
      expect(state.last_summary_event_id).toBe("summary-event-2");
      expect(state.updated_at).toBe(3000);
    } finally {
      db.close();
    }
  });

  it("getUnsummarizedEventCount returns events since last summary", () => {
    const store = new SessionPersistenceStore(dbPath);
    const chat = store.createChat(1000);
    const msg1 = store.appendMessage({ sessionKey: chat.id, role: "user", content: "Hello", now: 1100 });
    store.appendMessage({ sessionKey: chat.id, role: "assistant", content: "Hi", now: 1200 });

    // No summary yet: all user/assistant messages count
    expect(store.getUnsummarizedEventCount(chat.id)).toBe(2);
  });

  it("stores memory_indexed_at field in session_events", () => {
    const db = new BunDatabase(dbPath);
    try {
      ensureSessionSchema(db as never);
      const columns = db.prepare("PRAGMA table_info(session_events)").all() as Array<{ name: string }>;
      expect(columns.map((c) => c.name)).toContain("memory_indexed_at");
    } finally {
      db.close();
    }
  });

  it("stores compaction_count and last_summary_event_id in session_state", () => {
    const db = new BunDatabase(dbPath);
    try {
      ensureSessionSchema(db as never);
      const columns = db.prepare("PRAGMA table_info(session_state)").all() as Array<{ name: string }>;
      const names = columns.map((c) => c.name);
      expect(names).toContain("compaction_count");
      expect(names).toContain("last_summary_event_id");
    } finally {
      db.close();
    }
  });
});
