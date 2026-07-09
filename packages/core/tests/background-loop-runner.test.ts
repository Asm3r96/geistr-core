import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BackgroundLoopRunner, LoopCatalog, SessionPersistenceStore, type LoopRunState } from "../src";

let tempDir: string;

beforeEach(async () => {
  tempDir = join(tmpdir(), `geistr-bg-loop-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempDir, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

describe("BackgroundLoopRunner", () => {
  it("starts in the background and writes hidden pending loop result state", async () => {
    const store = new SessionPersistenceStore(join(tempDir, "sessions.sqlite"));
    const chat = store.createChat();
    const catalog = new LoopCatalog([{ loopId: "demo", label: "Demo", description: "Demo", status: "available", inputSchema: {}, defaultMode: "background", requiresApproval: false, allowedScopes: ["agent"], resultPolicy: "artifact-required" }]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const runner = new BackgroundLoopRunner({
      catalog,
      sessionStore: store,
      starters: { demo: async () => { await gate; return { run: completedRun("run_demo"), summary: "Finished demo", artifactIds: ["artifact_1"] }; } },
    });

    const started = await runner.start({ loopId: "demo", sessionKey: chat.id });
    expect(started.status).toBe("queued");
    expect(store.listPendingLoopResults(chat.id)).toEqual([]);

    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const pending = store.listPendingLoopResults(chat.id);
    expect(pending).toHaveLength(1);
    expect(await runner.status(started.runId)).toMatchObject({ runId: "run_demo", loopId: "demo", status: "completed", summary: "Finished demo", artifactIds: ["artifact_1"] });
    expect(await runner.status("run_demo")).toMatchObject({ runId: "run_demo", loopId: "demo", status: "completed", summary: "Finished demo", artifactIds: ["artifact_1"] });
    expect(pending[0]).toMatchObject({ runId: "run_demo", loopId: "demo", status: "completed", summary: "Finished demo", artifactIds: ["artifact_1"], needsAttention: false });
    expect(store.openChat(chat.id).messages).toEqual([]);
  });

  it("saves no-op completion as non-attention with the actual loop summary", async () => {
    const store = new SessionPersistenceStore(join(tempDir, "noop.sqlite"));
    const chat = store.createChat();
    const catalog = new LoopCatalog([{ loopId: "session-compaction", label: "Compaction", description: "Compaction", status: "available", inputSchema: {}, defaultMode: "background", requiresApproval: false, allowedScopes: ["agent"], resultPolicy: "hidden-only" }]);
    const runner = new BackgroundLoopRunner({ catalog, sessionStore: store, starters: { "session-compaction": async () => ({ run: completedRun("run_noop", "session-compaction", "No compaction needed"), summary: "No compaction needed" }) } });

    await runner.start({ loopId: "session-compaction", sessionKey: chat.id });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(store.listPendingLoopResults(chat.id)[0]).toMatchObject({ runId: "run_noop", loopId: "session-compaction", status: "completed", summary: "No compaction needed", needsAttention: false });
  });

  it("saves failed loops with accurate summary and attention flag", async () => {
    const store = new SessionPersistenceStore(join(tempDir, "failed.sqlite"));
    const chat = store.createChat();
    const catalog = new LoopCatalog([{ loopId: "demo", label: "Demo", description: "Demo", status: "available", inputSchema: {}, defaultMode: "background", requiresApproval: false, allowedScopes: ["agent"], resultPolicy: "artifact-required" }]);
    const runner = new BackgroundLoopRunner({ catalog, sessionStore: store, starters: { demo: async () => ({ run: failedRun("run_failed", "provider error") }) } });

    await runner.start({ loopId: "demo", sessionKey: chat.id });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(store.listPendingLoopResults(chat.id)[0]).toMatchObject({ runId: "run_failed", loopId: "demo", status: "failed", summary: "provider error", needsAttention: true });
  });
});

function completedRun(id: string, loopId = "demo", summary = "done"): LoopRunState {
  return { id, loopId, loopVersion: "1", status: "completed", currentNodeId: "final", nodeStates: { final: { id: "final", status: "completed", attempts: [], summary } }, artifacts: {}, evidence: [], metrics: { totalTurns: 0, totalToolCalls: 0, steeringEvents: 0 }, input: {}, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: new Date().toISOString() };
}

function failedRun(id: string, summary: string): LoopRunState {
  return { id, loopId: "demo", loopVersion: "1", status: "failed", currentNodeId: "final", nodeStates: { final: { id: "final", status: "failed", attempts: [], summary } }, artifacts: {}, evidence: [], metrics: { totalTurns: 0, totalToolCalls: 0, steeringEvents: 0 }, input: {}, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: new Date().toISOString() };
}
