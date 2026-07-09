import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { SessionPersistenceStore, createMemoryToolDefinitions, executeMemoryRead, executeMemoryWrite } from "../src";

let tempDir: string;
let store: SessionPersistenceStore;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "geistr-memory-tools-"));
  store = new SessionPersistenceStore(join(tempDir, "sessions.sqlite"));
  store.ensureReady();
});

describe("memory_read", () => {
  it("searches, lists recent memories, and gets by id with links", () => {
    const created = withDb((db) => executeMemoryWrite(db, { action: "create", content: "User prefers concise TypeScript explanations", memoryType: "preference", tags: ["typescript"] }));
    expect(created).toMatchObject({ updated: true, action: "create" });
    const memoryId = "memoryId" in created ? created.memoryId : "";

    const search = withDb((db) => executeMemoryRead(db, { action: "search", query: "TypeScript", limit: 5 })) as { memories: Array<{ id: string }> };
    expect(search.memories.map((m) => m.id)).toContain(memoryId);

    const recent = withDb((db) => executeMemoryRead(db, { action: "list_recent", limit: 5 })) as { memories: Array<{ id: string }> };
    expect(recent.memories[0]?.id).toBe(memoryId);

    const get = withDb((db) => executeMemoryRead(db, { action: "get", memoryId, includeLinks: true })) as { memory: { id: string; links: unknown[] } };
    expect(get.memory).toMatchObject({ id: memoryId, links: [] });
  });
});

describe("memory_write", () => {
  it("creates, updates, reinforces, soft-deletes, and supersedes memories", () => {
    const created = withDb((db) => executeMemoryWrite(db, { action: "create", content: "User uses Bun for tests", memoryType: "fact", importance: 6, tags: ["tooling"] }));
    expect(created).toMatchObject({ updated: true, action: "create", changedFields: expect.arrayContaining(["content", "memoryType"]) });
    const memoryId = "memoryId" in created ? created.memoryId : "";

    const updated = withDb((db) => executeMemoryWrite(db, { action: "update", memoryId, content: "User prefers Bun for JavaScript tests", status: "active", currentStrength: 7 }));
    expect(updated).toMatchObject({ updated: true, action: "update", memoryId, changedFields: expect.arrayContaining(["content", "currentStrength"]) });

    const reinforced = withDb((db) => executeMemoryWrite(db, { action: "reinforce", memoryId }));
    expect(reinforced).toMatchObject({ updated: true, action: "reinforce", changedFields: expect.arrayContaining(["currentStrength"]) });

    const superseded = withDb((db) => executeMemoryWrite(db, { action: "supersede", memoryId, replacementContent: "User now uses Vitest through Bun for JS tests" }));
    expect(superseded).toMatchObject({ updated: true, action: "supersede" });
    const newId = "memoryId" in superseded ? superseded.memoryId : "";
    const old = withDb((db) => executeMemoryRead(db, { action: "get", memoryId })) as { memory: { status: string } };
    expect(old.memory.status).toBe("cold");
    const replacement = withDb((db) => executeMemoryRead(db, { action: "get", memoryId: newId, includeLinks: true })) as { memory: { links: Array<{ linkType: string }> } };
    expect(replacement.memory.links.some((link) => link.linkType === "supersedes")).toBe(true);

    const deleted = withDb((db) => executeMemoryWrite(db, { action: "delete", memoryId: newId }));
    expect(deleted).toMatchObject({ updated: true, action: "delete", changedFields: ["status"] });
    const afterDelete = withDb((db) => executeMemoryRead(db, { action: "get", memoryId: newId })) as { memory: { status: string } };
    expect(afterDelete.memory.status).toBe("deleted");
  });

  it("rejects unknown actions, unknown ids, empty content, invalid enums, secrets, and profile-like writes", () => {
    expect(withDb((db) => executeMemoryWrite(db, { action: "merge", content: "x" }))).toMatchObject({ error: expect.stringContaining("unsupported action") });
    expect(withDb((db) => executeMemoryWrite(db, { action: "update", memoryId: "missing", content: "x" }))).toMatchObject({ error: "unknown memory ID" });
    expect(withDb((db) => executeMemoryWrite(db, { action: "create", content: "   " }))).toMatchObject({ error: "content is required" });
    expect(withDb((db) => executeMemoryWrite(db, { action: "create", content: "remember this", memoryType: "unknown" }))).toMatchObject({ error: "invalid memory type" });
    expect(withDb((db) => executeMemoryWrite(db, { action: "create", content: "my api key is abc" }))).toMatchObject({ error: expect.stringContaining("secret") });
    expect(withDb((db) => executeMemoryWrite(db, { action: "create", content: "Change your assistant name to Nova" }))).toMatchObject({ error: expect.stringContaining("profile_write") });
  });

  it("wires memory_read and memory_write tool definitions through the runtime bridge surface", async () => {
    const tools = createMemoryToolDefinitions(store, () => "chat:active");
    expect(tools.map((tool) => tool.name)).toEqual(["memory_read", "memory_write"]);
    const write = tools.find((tool) => tool.name === "memory_write")!;
    const result = await write.execute("tool", { action: "create", content: "User likes small commits", memoryType: "preference" }, new AbortController().signal, () => undefined, {} as never);
    expect(result.details).toMatchObject({ updated: true, action: "create" });
    const read = tools.find((tool) => tool.name === "memory_read")!;
    const search = await read.execute("tool", { action: "search", query: "commits" }, new AbortController().signal, () => undefined, {} as never);
    expect(JSON.stringify(search.details)).toContain("small commits");
  });
});

function withDb<T>(run: (db: Parameters<Parameters<SessionPersistenceStore["withWritableMemoryDatabase"]>[0]>[0]) => T): T {
  return store.withWritableMemoryDatabase(run);
}
