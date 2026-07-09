import { useEffect, useMemo, useState } from "react";

import type { MemoryGraph } from "@geistr/core";
import type { DesktopApi } from "../../shared/desktop-api";

import { MemoryFilters } from "./MemoryFilters";
import { MemoryGalaxyGraph } from "./MemoryGalaxyGraph";
import { MemoryInspector } from "./MemoryInspector";
import {
  DEFAULT_MEMORY_FILTERS,
  computeDisplayStats,
  filterMemoryGraph,
  type MemoryGraphFilters,
} from "./memory-graph-model";

export function MemoryPage({ api }: { api: DesktopApi }) {
  const [raw, setRaw] = useState<MemoryGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<MemoryGraphFilters>({ ...DEFAULT_MEMORY_FILTERS });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api.getMemoryGraph().then(
      (graph) => {
        if (!cancelled) {
          setRaw(graph);
          setError(null);
          setLoading(false);
        }
      },
      (err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load memories");
          setLoading(false);
        }
      },
    );
    return () => { cancelled = true; };
  }, [api]);

  const filtered = useMemo(() => (raw ? filterMemoryGraph(raw, filters) : { nodes: [], links: [] }), [raw, filters]);
  const nodesById = useMemo(() => new Map(filtered.nodes.map((n) => [n.id, n])), [filtered.nodes]);
  const selectedNode = selectedId ? nodesById.get(selectedId) ?? null : null;

  useEffect(() => {
    if (selectedId && !nodesById.has(selectedId)) setSelectedId(null);
  }, [selectedId, nodesById]);

  const stats = computeDisplayStats(filtered.nodes, filtered.links.length, selectedId, filtered.links);

  if (loading) {
    return <main className="memoryPage"><p className="memoryPageStatus">Loading memory galaxy…</p></main>;
  }
  if (error) {
    return <main className="memoryPage"><p className="memoryPageStatus memoryPageError">{error}</p></main>;
  }

  return (
    <main className="memoryPage" aria-label="Memory galaxy">
      <header className="memoryPageHeader">
        <div>
          <h1>Memory</h1>
          <p className="memoryPageSubtitle">Explore what Geistr remembers — read-only galaxy view.</p>
        </div>
        <div className="memoryStats" aria-label="Memory statistics">
          <span><strong>{stats.totalMemories}</strong> shown</span>
          <span><strong>{stats.activeCount}</strong> active</span>
          <span><strong>{stats.coldCount}</strong> cold</span>
          <span><strong>{stats.linkCount}</strong> links</span>
          {stats.neighborhoodCount != null ? (
            <span><strong>{stats.neighborhoodCount}</strong> in neighborhood</span>
          ) : null}
        </div>
      </header>
      <MemoryFilters filters={filters} onChange={setFilters} />
      {filtered.nodes.length === 0 ? (
        <div className="memoryEmptyState">
          <h2>No memories in view</h2>
          <p>
            {raw?.stats.totalMemories === 0
              ? "Geistr has not stored any memories yet. They appear here after indexing or when you ask the agent to remember something."
              : "Try relaxing filters or clearing the search."}
          </p>
        </div>
      ) : (
        <div className={selectedNode ? "memoryLayout inspectorOpen" : "memoryLayout"}>
          <MemoryGalaxyGraph
            nodes={filtered.nodes}
            links={filtered.links}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          {selectedNode ? (
            <MemoryInspector
              node={selectedNode}
              nodesById={nodesById}
              links={filtered.links}
              onSelectNode={setSelectedId}
              onClose={() => setSelectedId(null)}
            />
          ) : null}
        </div>
      )}
    </main>
  );
}