import type { LoopRunState, LoopStateStore } from "./types";

export class InMemoryLoopStateStore implements LoopStateStore {
  private runs = new Map<string, LoopRunState>();
  save(run: LoopRunState): void { this.runs.set(run.id, structuredClone(run)); }
  load(runId: string): LoopRunState | null { const run = this.runs.get(runId); return run ? structuredClone(run) : null; }
  list(): LoopRunState[] { return Array.from(this.runs.values()).map((run) => structuredClone(run)); }
}
