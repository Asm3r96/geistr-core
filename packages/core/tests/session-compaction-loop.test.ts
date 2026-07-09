import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";

import { runSessionCompactionLoop, type LoopModelRunner, SessionPersistenceStore } from "../src";

let tempDir: string;
let dbPath: string;
let store: SessionPersistenceStore;

beforeEach(async () => {
  tempDir = join(tmpdir(), `geistr-compaction-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempDir, { recursive: true });
  dbPath = join(tempDir, "sessions.sqlite");
  store = new SessionPersistenceStore(dbPath);
  store.ensureReady();
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

function runner(): LoopModelRunner {
  return {
    runAgentSession: async () => ({ status: "failed", summary: "not used" }),
    runSingleRequest: async (input) => {
      const prepared = input.artifacts.prepared as { summaryUntilEventId: string; eventsToCompact: { eventId: string }[] };
      return { status: "completed", summary: "ok", artifacts: { summary: JSON.stringify({ summary: "Continuity: user and assistant discussed the compacted range.", summaryUntilEventId: prepared.summaryUntilEventId, coveredEventIds: prepared.eventsToCompact.map((event) => event.eventId), continuity: { openThreads: [] } }) } };
    },
  };
}

function addMessages(sessionKey: string, base: number): void {
  for (let i = 0; i < 8; i += 1) {
    store.appendMessage({ sessionKey, role: i % 2 === 0 ? "user" : "assistant", content: `message ${i} `.repeat(80), now: base + i });
  }
}

describe("session compaction loop", () => {
  it("returns a completed no-op result when compaction is not needed", async () => {
    const chat = store.createChat(2500);
    store.appendMessage({ sessionKey: chat.id, role: "user", content: "short", now: 2510 });
    let modelCalls = 0;
    const unusedRunner: LoopModelRunner = {
      runAgentSession: async () => ({ status: "failed", summary: "not used" }),
      runSingleRequest: async () => { modelCalls += 1; return { status: "failed", summary: "should not be called" }; },
    };

    const result = await runSessionCompactionLoop({ store, modelRunner: unusedRunner, target: { sessionKey: chat.id, scope: "core" } });

    expect(result).toEqual({ compacted: false, summaryEventId: null, coveredEventCount: 0, retainedRecentCount: 0, estimatedTokens: 0, reason: "No compaction needed" });
    expect(modelCalls).toBe(0);
  });

  it("uses normal threshold by default and only compacts low-token sessions when forced", async () => {
    const normal = store.createChat(2600);
    const forced = store.createChat(2700);
    addMessages(normal.id, 2610);
    addMessages(forced.id, 2710);

    const normalResult = await runSessionCompactionLoop({ store, modelRunner: runner(), target: { sessionKey: normal.id, scope: "core" } });
    const forcedResult = await runSessionCompactionLoop({ store, modelRunner: runner(), target: { sessionKey: forced.id, scope: "core" }, thresholdTokens: 1, retainRecentMessages: 2 });

    expect(normalResult.compacted).toBe(false);
    expect(normalResult.reason).toBe("No compaction needed");
    expect(forcedResult.compacted).toBe(true);
  });

  it("accepts plain summary text and derives deterministic metadata in code", async () => {
    const chat = store.createChat(3000);
    addMessages(chat.id, 3100);
    let attempts = 0;
    const plainTextRunner: LoopModelRunner = {
      runAgentSession: async () => ({ status: "failed", summary: "not used" }),
      runSingleRequest: async () => {
        attempts += 1;
        return { status: "completed", summary: "ok", artifacts: { summary: "Continuity: the compacted range discussed Geistr loop testing and manual compaction." } };
      },
    };

    const result = await runSessionCompactionLoop({ store, modelRunner: plainTextRunner, target: { sessionKey: chat.id, scope: "core" }, thresholdTokens: 10, retainRecentMessages: 2 });

    expect(result.compacted).toBe(true);
    expect(attempts).toBe(1);
  });

  it("accepts JSON wrapped in model commentary or markdown fences", async () => {
    const chat = store.createChat(4000);
    addMessages(chat.id, 4100);
    const chattyRunner: LoopModelRunner = {
      runAgentSession: async () => ({ status: "failed", summary: "not used" }),
      runSingleRequest: async (input) => {
        const prepared = input.artifacts.prepared as { summaryUntilEventId: string; eventsToCompact: { eventId: string }[] };
        return { status: "completed", summary: "ok", artifacts: { summary: `Here is the JSON:\n\n\`\`\`json\n${JSON.stringify({ summary: "Continuity from fenced JSON.", summaryUntilEventId: prepared.summaryUntilEventId, coveredEventIds: prepared.eventsToCompact.map((event) => event.eventId), continuity: {} })}\n\`\`\`` } };
      },
    };

    const result = await runSessionCompactionLoop({ store, modelRunner: chattyRunner, target: { sessionKey: chat.id, scope: "core" }, thresholdTokens: 10, retainRecentMessages: 2 });

    expect(result.compacted).toBe(true);
  });

  it("compacts core and app-agent sessions independently with scoped metadata", async () => {
    const core = store.createChat(1000);
    const app = store.createChat(2000);
    addMessages(core.id, 1100);
    addMessages(app.id, 2100);

    const coreResult = await runSessionCompactionLoop({ store, modelRunner: runner(), target: { sessionKey: core.id, scope: "core" }, thresholdTokens: 10, retainRecentMessages: 2 });
    const appResult = await runSessionCompactionLoop({ store, modelRunner: runner(), target: { sessionKey: app.id, scope: "app-agent", appId: "notes", agentId: "researcher" }, thresholdTokens: 10, retainRecentMessages: 2 });

    expect(coreResult.compacted).toBe(true);
    expect(appResult.compacted).toBe(true);
    expect(coreResult.summaryEventId).not.toBe(appResult.summaryEventId);

    const db = new Database(dbPath);
    const rows = db.query("SELECT event_id, session_key, metadata_json FROM session_events WHERE event_type = 'summary' ORDER BY created_at ASC").all() as { event_id: string; session_key: string; metadata_json: string }[];
    db.close();

    expect(rows).toHaveLength(2);
    expect(rows[0]?.session_key).toBe(core.id);
    expect(JSON.parse(rows[0]!.metadata_json)).toMatchObject({ scope: "core", sessionKey: core.id });
    expect(rows[1]?.session_key).toBe(app.id);
    expect(JSON.parse(rows[1]!.metadata_json)).toMatchObject({ scope: "app-agent", appId: "notes", agentId: "researcher", sessionKey: app.id });
    expect(store.openChat(core.id).messages.every((message) => !message.id.startsWith("summary"))).toBe(true);
  });
});
