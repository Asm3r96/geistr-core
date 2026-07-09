import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMemoryIndexingLoop, type LoopModelRunner, type LoopSingleRequestInput, type LoopLlmResult, SessionPersistenceStore } from "../src";

let tempDir: string;
let store: SessionPersistenceStore;

beforeEach(async () => {
  tempDir = join(tmpdir(), `geistr-memory-loop-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempDir, { recursive: true });
  store = new SessionPersistenceStore(join(tempDir, "geistr-sessions.sqlite"));
  store.ensureReady();
});

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

function fakeRunner(responses: unknown[], prompts: string[] = []): LoopModelRunner {
  return {
    runAgentSession: async (input) => run(input),
    runSingleRequest: async (input) => run(input),
  };
  async function run(input: LoopSingleRequestInput): Promise<LoopLlmResult> {
    prompts.push(input.prompt);
    const next = responses.shift() ?? { decisions: [] };
    return { status: "completed", summary: JSON.stringify(next), artifacts: input.node.id.includes("extract") ? { candidates: next } : { decisions: next }, confidence: "medium" };
  }
}

function addMessages(sessionKey: string, count: number): void {
  for (let i = 0; i < count; i += 1) store.appendMessage({ sessionKey, role: i % 2 === 0 ? "user" : "assistant", content: `message ${i} about Mohammed preferring concise durable answers`, now: 1000 + i });
}

describe("memory indexing loop", () => {
  it("below-threshold batch does not run the model", async () => {
    const chat = store.createChat(1000);
    addMessages(chat.id, 2);
    let calls = 0;
    const runner = fakeRunner([]);
    runner.runSingleRequest = async (input) => { calls += 1; return fakeRunner([]).runSingleRequest(input); };
    const result = await runMemoryIndexingLoop({ store, modelRunner: runner, sessionKey: chat.id });
    expect(calls).toBe(0);
    expect(result.processed).toBe(0);
  });

  it("forced extraction receives the whole transcript batch and can mark zero candidates indexed", async () => {
    const chat = store.createChat(1000);
    addMessages(chat.id, 3);
    const prompts: string[] = [];
    const result = await runMemoryIndexingLoop({ store, modelRunner: fakeRunner([{ candidates: [] }, { decisions: [] }], prompts), sessionKey: chat.id, force: true, threshold: 50 });
    expect(prompts[0]).toContain("message 0");
    expect(prompts[0]).toContain("message 1");
    expect(result.processed).toBe(3);
    expect(result.candidates).toBe(0);
    expect(store.countUnindexedMessages(chat.id)).toBe(0);
  });

  it("global indexing processes all available messages between threshold and max batch", async () => {
    const chatA = store.createChat(1000);
    const chatB = store.createChat(2000);
    addMessages(chatA.id, 30);
    addMessages(chatB.id, 30);
    const result = await runMemoryIndexingLoop({ store, modelRunner: fakeRunner([{ candidates: [] }, { decisions: [] }]), sessionKey: chatA.id, global: true });
    expect(result.processed).toBe(60);
    expect(store.countGlobalUnindexedMessages()).toBe(0);
  });

  it("global indexing caps each batch at 75 messages", async () => {
    const chatA = store.createChat(1000);
    const chatB = store.createChat(2000);
    addMessages(chatA.id, 45);
    addMessages(chatB.id, 45);
    const result = await runMemoryIndexingLoop({ store, modelRunner: fakeRunner([{ candidates: [] }, { decisions: [] }]), sessionKey: chatA.id, global: true });
    expect(result.processed).toBe(75);
    expect(store.countGlobalUnindexedMessages()).toBe(15);
  });

  it("creates a synthesized memory and related graph links", async () => {
    const chat = store.createChat(1000);
    addMessages(chat.id, 4);
    const result = await runMemoryIndexingLoop({
      store,
      modelRunner: fakeRunner([
        { candidates: [{ content: "Mohammed prefers concise durable answers across Geistr work.", memoryType: "preference", importance: 8, stability: 8, tags: ["geistr"], threadId: "geistr" }] },
        { decisions: [{ candidateId: "cand_1", action: "create", existingMemoryId: null, content: null, memoryType: null, reason: "Durable preference" }] },
      ]),
      sessionKey: chat.id,
      force: true,
    });
    expect(result.created).toBe(1);
    expect(store.listMemoryItems()[0]?.content).toContain("concise durable answers");
  });

  it("failed loop does not mark messages indexed", async () => {
    const chat = store.createChat(1000);
    addMessages(chat.id, 2);
    const badRunner: LoopModelRunner = { runAgentSession: async () => ({ status: "failed", summary: "bad" }), runSingleRequest: async () => ({ status: "failed", summary: "bad" }) };
    const result = await runMemoryIndexingLoop({ store, modelRunner: badRunner, sessionKey: chat.id, force: true });
    expect(result.processed).toBe(0);
    expect(store.countUnindexedMessages(chat.id)).toBe(2);
  });
});
