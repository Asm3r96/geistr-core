import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionPersistenceStore } from "../src/session-persistence";
import {
  createPostTurnJobScheduler,
  type PostTurnJobContext,
  type PostTurnJobScheduler,
} from "../src/post-turn-jobs";

let tempDir: string;
let dbPath: string;
let store: SessionPersistenceStore;

/** Fresh context for each test. */
function freshCtx(overrides: Partial<PostTurnJobContext> & { sessionKey: string }): PostTurnJobContext {
  return {
    userMessage: "Hello",
    assistantMessage: "Hi there!",
    providerId: "anthropic",
    modelId: "claude-sonnet-4",
    turnId: "turn-1",
    messageCount: 2,
    config: {
      memoryEnabled: false,
      compactionEnabled: false,
      compactionThresholdTokens: 15000,
    },
    store,
    ...overrides,
  };
}

beforeEach(async () => {
  tempDir = join(tmpdir(), `geistr-postturn-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempDir, { recursive: true });
  dbPath = join(tempDir, "geistr-sessions.sqlite");
  store = new SessionPersistenceStore(dbPath);
  store.ensureReady();
});

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

describe("createPostTurnJobScheduler", () => {
  it("returns a scheduler with memory and compaction job slots", () => {
    const scheduler = createPostTurnJobScheduler();
    expect(scheduler.jobs).toHaveLength(2);
    expect(scheduler.jobs.map((j) => j.name).sort()).toEqual(["compaction-policy", "memory-index-policy"]);
  });

  it("runs memory job when memory is enabled", async () => {
    const chat = store.createChat(1000);
    store.appendMessage({ sessionKey: chat.id, role: "user", content: "Hello", now: 1100 });

    const scheduler = createPostTurnJobScheduler();
    const results = await scheduler.runAll(
      freshCtx({ sessionKey: chat.id, config: { memoryEnabled: true, compactionEnabled: false, compactionThresholdTokens: 15000 } }),
    );

    expect(results.some((r) => r.jobName === "memory-index-policy")).toBe(true);
    expect(results.some((r) => r.acted)).toBe(false);
  });

  it("skips memory job when memory is disabled", async () => {
    const chat = store.createChat(1000);

    const scheduler = createPostTurnJobScheduler();
    const results = await scheduler.runAll(
      freshCtx({ sessionKey: chat.id, config: { memoryEnabled: false, compactionEnabled: false, compactionThresholdTokens: 15000 } }),
    );

    expect(results.some((r) => r.jobName === "memory-index-policy")).toBe(false);
    expect(results).toHaveLength(0);
  });

  it("runs compaction job when compaction is enabled and threshold exceeded", async () => {
    const chat = store.createChat(2000);

    const scheduler = createPostTurnJobScheduler();
    const results = await scheduler.runAll(
      freshCtx({
        sessionKey: chat.id,
        messageCount: 20,
        config: { memoryEnabled: false, compactionEnabled: true, compactionThresholdTokens: 50 },
      }),
    );

    expect(results.some((r) => r.jobName === "compaction-policy")).toBe(true);
    expect(results.some((r) => r.acted)).toBe(true);
  });

  it("skips compaction when config disables it", async () => {
    const chat = store.createChat(2000);

    const scheduler = createPostTurnJobScheduler();
    const results = await scheduler.runAll(
      freshCtx({
        sessionKey: chat.id,
        messageCount: 20,
        config: { memoryEnabled: false, compactionEnabled: false, compactionThresholdTokens: 50 },
      }),
    );

    expect(results.some((r) => r.jobName === "compaction-policy")).toBe(false);
    expect(results).toHaveLength(0);
  });

  it("collects results from multiple jobs", async () => {
    const chat = store.createChat(3000);

    const scheduler = createPostTurnJobScheduler();
    const results = await scheduler.runAll(
      freshCtx({
        sessionKey: chat.id,
        messageCount: 20,
        config: { memoryEnabled: true, compactionEnabled: true, compactionThresholdTokens: 50 },
      }),
    );

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.jobName === "memory-index-policy")).toBe(true);
  });

  it("does not throw when a job throws", async () => {
    const chat = store.createChat(4000);

    // Create a scheduler with a job that throws
    const scheduler = createPostTurnJobScheduler([
      {
        name: "faulty-job",
        shouldRun: () => true,
        run: async () => { throw new Error("Kaboom"); },
      },
    ]);

    const results = await scheduler.runAll(
      freshCtx({ sessionKey: chat.id, config: { memoryEnabled: false, compactionEnabled: false, compactionThresholdTokens: 15000 } }),
    );

    expect(results).toHaveLength(1);
    const firstResult = results[0]!;
    expect(firstResult.error).toBeDefined();
    expect(firstResult.error!.message).toBe("Kaboom");
  });

  it("handles empty config gracefully", async () => {
    const chat = store.createChat(5000);

    const scheduler = createPostTurnJobScheduler();
    const results = await scheduler.runAll(
      freshCtx({ sessionKey: chat.id, config: { memoryEnabled: false, compactionEnabled: false, compactionThresholdTokens: 15000 } }),
    );

    expect(results).toHaveLength(0);
  });

  it("memory job reports count when there are unindexed messages", async () => {
    const chat = store.createChat(6000);
    store.appendMessage({ sessionKey: chat.id, role: "user", content: "Test", now: 6100 });

    const scheduler = createPostTurnJobScheduler();
    const results = await scheduler.runAll(
      freshCtx({
        sessionKey: chat.id,
        config: { memoryEnabled: true, compactionEnabled: false, compactionThresholdTokens: 15000 },
      }),
    );

    expect(results.some((r) => r.jobName === "memory-index-policy")).toBe(true);
    const memResult = results.find((r) => r.jobName === "memory-index-policy")!;
    expect(memResult.acted).toBe(false);
    expect(memResult.details).toContain("1/50 global unindexed");
  });

  it("memory job triggers from global unindexed messages across chats", async () => {
    const chatA = store.createChat(8000);
    const chatB = store.createChat(9000);
    for (let i = 0; i < 30; i += 1) store.appendMessage({ sessionKey: chatA.id, role: "user", content: `A ${i}`, now: 8100 + i });
    for (let i = 0; i < 20; i += 1) store.appendMessage({ sessionKey: chatB.id, role: "assistant", content: `B ${i}`, now: 9100 + i });

    const scheduler = createPostTurnJobScheduler();
    const results = await scheduler.runAll(
      freshCtx({
        sessionKey: chatA.id,
        config: { memoryEnabled: true, compactionEnabled: false, compactionThresholdTokens: 15000 },
      }),
    );

    const memResult = results.find((r) => r.jobName === "memory-index-policy")!;
    expect(memResult.acted).toBe(true);
    expect(memResult.details).toContain("50 global message");
  });

  it("memory job reports zero when all messages are already indexed", async () => {
    const chat = store.createChat(7000);
    store.appendMessage({ sessionKey: chat.id, role: "user", content: "Test", now: 7100 });
    store.markEventsIndexed(chat.id, 7200);

    const scheduler = createPostTurnJobScheduler();
    const results = await scheduler.runAll(
      freshCtx({
        sessionKey: chat.id,
        config: { memoryEnabled: true, compactionEnabled: false, compactionThresholdTokens: 15000 },
      }),
    );

    expect(results.some((r) => r.jobName === "memory-index-policy")).toBe(true);
    const memResult = results.find((r) => r.jobName === "memory-index-policy")!;
    expect(memResult.acted).toBe(false);
    expect(memResult.details).toContain("No unindexed");
  });
});
