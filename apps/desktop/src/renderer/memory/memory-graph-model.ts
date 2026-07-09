import type { MemoryGraph, MemoryGraphLink, MemoryGraphNode, MemoryType } from "@geistr/core";

export const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  fact: "Fact",
  preference: "Preference",
  goal: "Goal",
  episode: "Episode",
  person_context: "Person",
  lesson: "Lesson",
};

export interface MemoryGraphFilters {
  search: string;
  memoryType: MemoryType | "all";
  status: "all" | "active" | "cold";
  minImportance: number;
  minStrength: number;
}

export const DEFAULT_MEMORY_FILTERS: MemoryGraphFilters = {
  search: "",
  memoryType: "all",
  status: "all",
  minImportance: 1,
  minStrength: 1,
};

export interface DisplayGraphStats {
  totalMemories: number;
  activeCount: number;
  coldCount: number;
  linkCount: number;
  neighborhoodCount: number | null;
}

export function filterMemoryGraph(graph: MemoryGraph, filters: MemoryGraphFilters): { nodes: MemoryGraphNode[]; links: MemoryGraphLink[] } {
  const q = filters.search.trim().toLowerCase();
  const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
  const nodes = graph.nodes.filter((node) => {
    if (filters.memoryType !== "all" && node.memoryType !== filters.memoryType) return false;
    if (filters.status !== "all" && node.status !== filters.status) return false;
    if (node.importance < filters.minImportance) return false;
    if (node.currentStrength < filters.minStrength) return false;
    if (tokens.length === 0) return true;
    const hay = `${node.content} ${node.tags.join(" ")} ${node.memoryType}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
  const ids = new Set(nodes.map((n) => n.id));
  const links = graph.links.filter((l) => ids.has(l.source) && ids.has(l.target));
  return { nodes, links };
}

export function buildAdjacency(links: MemoryGraphLink[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const touch = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a)!.add(b);
  };
  for (const link of links) {
    touch(link.source, link.target);
    touch(link.target, link.source);
  }
  return adj;
}

export function neighborhoodIds(selectedId: string | null, links: MemoryGraphLink[]): Set<string> | null {
  if (!selectedId) return null;
  const set = new Set<string>([selectedId]);
  for (const link of links) {
    if (link.source === selectedId) set.add(link.target);
    if (link.target === selectedId) set.add(link.source);
  }
  return set;
}

export function nodeRadius(node: MemoryGraphNode): number {
  const score = (node.importance + node.currentStrength) / 2;
  return 2.5 + score * 0.55;
}

export function linkWidth(strength: number): number {
  return 0.35 + strength * 0.12;
}

export function previewText(content: string, max = 120): string {
  const one = content.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max - 1)}…`;
}

export function formatTimestamp(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function computeDisplayStats(
  nodes: MemoryGraphNode[],
  filteredLinkCount: number,
  selectedId: string | null,
  links: MemoryGraphLink[],
): DisplayGraphStats {
  const hood = neighborhoodIds(selectedId, links);
  let activeCount = 0;
  let coldCount = 0;
  for (const node of nodes) {
    if (node.status === "active") activeCount += 1;
    else coldCount += 1;
  }
  return {
    totalMemories: nodes.length,
    activeCount,
    coldCount,
    linkCount: filteredLinkCount,
    neighborhoodCount: hood ? hood.size : null,
  };
}