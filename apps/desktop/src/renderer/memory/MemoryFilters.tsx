import type { MemoryType } from "@geistr/core";

import { DEFAULT_MEMORY_FILTERS, MEMORY_TYPE_LABELS, type MemoryGraphFilters } from "./memory-graph-model";

const MEMORY_TYPES: MemoryType[] = ["fact", "preference", "goal", "episode", "person_context", "lesson"];

export function MemoryFilters({
  filters,
  onChange,
}: {
  filters: MemoryGraphFilters;
  onChange: (next: MemoryGraphFilters) => void;
}) {
  return (
    <div className="memoryFilters" aria-label="Memory filters">
      <label className="memoryFilterField">
        <span>Search</span>
        <input
          type="search"
          placeholder="Search memories…"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
        />
      </label>
      <label className="memoryFilterField">
        <span>Type</span>
        <select
          value={filters.memoryType}
          onChange={(e) => onChange({ ...filters, memoryType: e.target.value as MemoryGraphFilters["memoryType"] })}
        >
          <option value="all">All types</option>
          {MEMORY_TYPES.map((t) => (
            <option key={t} value={t}>{MEMORY_TYPE_LABELS[t]}</option>
          ))}
        </select>
      </label>
      <label className="memoryFilterField">
        <span>Status</span>
        <select
          value={filters.status}
          onChange={(e) => onChange({ ...filters, status: e.target.value as MemoryGraphFilters["status"] })}
        >
          <option value="all">Active & cold</option>
          <option value="active">Active</option>
          <option value="cold">Cold</option>
        </select>
      </label>
      <label className="memoryFilterField">
        <span>Min importance</span>
        <input
          type="range"
          min={1}
          max={10}
          value={filters.minImportance}
          onChange={(e) => onChange({ ...filters, minImportance: Number(e.target.value) })}
        />
        <small>{filters.minImportance}</small>
      </label>
      <label className="memoryFilterField">
        <span>Min strength</span>
        <input
          type="range"
          min={1}
          max={10}
          value={filters.minStrength}
          onChange={(e) => onChange({ ...filters, minStrength: Number(e.target.value) })}
        />
        <small>{filters.minStrength}</small>
      </label>
      <button type="button" className="memoryFilterReset" onClick={() => onChange({ ...DEFAULT_MEMORY_FILTERS })}>
        Reset
      </button>
    </div>
  );
}