import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { SessionPersistenceStore, executeMemoryWrite, getMemoryGraph } from "../src";

let tempDir: string;
let store: SessionPersistenceStore;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "geistr-memory-graph-"));
  store = new SessionPersistenceStore(join(tempDir, "sessions.sqlite"));
  store.ensureReady();
});

describe("getMemoryGraph", () => {
  it("returns an empty graph with zero stats when no memories exist", () => {
    const graph = withDb((db) => getMemoryGraph(db));
    expect(graph.nodes).toEqual([]);
    expect(graph.links).toEqual([]);
    expect(graph.stats).toEqual({ totalMemories: 0, activeCount: 0, coldCount: 0, linkCount: 0 });
  });

  it("includes active and cold non-deleted memories and excludes deleted", () => {
    const a = withDb((db) => executeMemoryWrite(db, { action: "create", content: "Active fact", memoryType: "fact" }));
    const b = withDb((db) => executeMemoryWrite(db, { action: "create", content: "Preference note", memoryType: "preference" }));
    const aId = "memoryId" in a ? a.memoryId : "";
    withDb((db) => executeMemoryWrite(db, { action: "update", memoryId: aId, status: "cold" }));
    const c = withDb((db) => executeMemoryWrite(db, { action: "create", content: "To delete", memoryType: "episode" }));
    const cId = "memoryId" in c ? c.memoryId : "";
    withDb((db) => executeMemoryWrite(db, { action: "delete", memoryId: cId }));

    const graph = withDb((db) => getMemoryGraph(db));
    expect(graph.stats.totalMemories).toBe(2);
    expect(graph.stats.activeCount).toBe(1);
    expect(graph.stats.coldCount).toBe(1);
    const ids = graph.nodes.map((n) => n.id).sort();
    const bId = "memoryId" in b ? b.memoryId : "";
    expect(ids).toEqual([aId, bId].sort());
    expect(graph.nodes.some((n) => n.id === cId)).toBe(false);
  });

  it("includes links only between included memories", () => {
    const first = withDb((db) => executeMemoryWrite(db, { action: "create", content: "First memory", memoryType: "fact" }));
    const second = withDb((db) => executeMemoryWrite(db, { action: "create", content: "Second memory", memoryType: "goal" }));
    const firstId = "memoryId" in first ? first.memoryId : "";
    const secondId = "memoryId" in second ? second.memoryId : "";
    const now = Date.now();
    withDb((db) => {
      db.prepare(
        `INSERT INTO memory_links (id, from_memory_id, to_memory_id, link_type, strength, last_activated_at, created_at, updated_at)
         VALUES ('link_test', ?, ?, 'related', 7, ?, ?, ?)`,
      ).run(firstId, secondId, now, now, now);
    });

    const graph = withDb((db) => getMemoryGraph(db));
    expect(graph.stats.linkCount).toBe(1);
    expect(graph.links[0]).toMatchObject({ source: firstId, target: secondId, linkType: "related", strength: 7 });
  });

  it("returns stable stats for a fixed dataset", () => {
    for (let i = 0; i < 3; i += 1) {
      withDb((db) => executeMemoryWrite(db, { action: "create", content: `Memory ${i}`, memoryType: "fact", importance: 5 + i }));
    }
    const g1 = withDb((db) => getMemoryGraph(db));
    const g2 = withDb((db) => getMemoryGraph(db));
    expect(g1.stats).toEqual(g2.stats);
    expect(g1.stats).toEqual({ totalMemories: 3, activeCount: 3, coldCount: 0, linkCount: 0 });
  });
});

function withDb<T>(run: (db: Parameters<Parameters<SessionPersistenceStore["withWritableMemoryDatabase"]>[0]>[0]) => T): T {
  return store.withWritableMemoryDatabase(run);
}