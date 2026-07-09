import { describe, expect, it } from "vitest";

import type { MemoryGraph } from "@geistr/core";

import { DEFAULT_MEMORY_FILTERS, filterMemoryGraph, neighborhoodIds } from "./memory-graph-model";

const sampleGraph: MemoryGraph = {
  nodes: [
    {
      id: "a",
      content: "TypeScript preference",
      memoryType: "preference",
      category: "preference",
      status: "active",
      importance: 8,
      stability: 5,
      currentStrength: 7,
      tags: ["typescript"],
      createdAt: 1,
      updatedAt: 2,
      sourceSessionId: null,
      sourceMessageId: null,
      recallCount: 0,
    },
    {
      id: "b",
      content: "Old fact",
      memoryType: "fact",
      category: "fact",
      status: "cold",
      importance: 3,
      stability: 4,
      currentStrength: 2,
      tags: [],
      createdAt: 1,
      updatedAt: 2,
      sourceSessionId: null,
      sourceMessageId: null,
      recallCount: 1,
    },
  ],
  links: [{ id: "l1", source: "a", target: "b", linkType: "related", strength: 6, createdAt: 1, updatedAt: 1 }],
  stats: { totalMemories: 2, activeCount: 1, coldCount: 1, linkCount: 1 },
};

describe("filterMemoryGraph", () => {
  it("filters by search, type, status, and minimum scores", () => {
    const bySearch = filterMemoryGraph(sampleGraph, { ...DEFAULT_MEMORY_FILTERS, search: "typescript" });
    expect(bySearch.nodes.map((n) => n.id)).toEqual(["a"]);

    const byType = filterMemoryGraph(sampleGraph, { ...DEFAULT_MEMORY_FILTERS, memoryType: "fact" });
    expect(byType.nodes.map((n) => n.id)).toEqual(["b"]);

    const byStatus = filterMemoryGraph(sampleGraph, { ...DEFAULT_MEMORY_FILTERS, status: "cold" });
    expect(byStatus.nodes.map((n) => n.id)).toEqual(["b"]);

    const byImportance = filterMemoryGraph(sampleGraph, { ...DEFAULT_MEMORY_FILTERS, minImportance: 5 });
    expect(byImportance.nodes.map((n) => n.id)).toEqual(["a"]);
  });
});

describe("neighborhoodIds", () => {
  it("returns selected node and direct neighbors", () => {
    const hood = neighborhoodIds("a", sampleGraph.links);
    expect(hood).toEqual(new Set(["a", "b"]));
  });
});