import type { ArtifactStore } from "./artifacts";
import type { LoopCatalog, LoopCatalogRunner, LoopCatalogRunStatus, LoopCatalogStartInput } from "./loop-catalog";
import type { LoopEvent, LoopRunState } from "./loops";
import type { SessionPersistenceStore } from "./session-persistence";

export interface BackgroundLoopDefinitionStarter { (input: LoopCatalogStartInput & { artifactStore?: ArtifactStore | undefined; publish: (event: LoopEvent) => void }): Promise<{ run: LoopRunState; summary?: string; artifactIds?: string[] }> }
export interface BackgroundLoopRunnerOptions { catalog: LoopCatalog; sessionStore: SessionPersistenceStore; artifactStore?: ArtifactStore; starters: Record<string, BackgroundLoopDefinitionStarter>; onProgress?: (event: LoopEvent) => void; onComplete?: (run: LoopRunState) => void }

export class BackgroundLoopRunner implements LoopCatalogRunner {
  private readonly runs = new Map<string, LoopCatalogRunStatus>();
  private readonly runAliases = new Map<string, string>();
  private readonly promises = new Map<string, Promise<void>>();
  constructor(private readonly options: BackgroundLoopRunnerOptions) {}

  async start(input: LoopCatalogStartInput): Promise<{ runId: string; status: LoopCatalogRunStatus["status"] }> {
    const entry = this.options.catalog.getRaw(input.loopId);
    if (!entry || entry.status === "disabled") throw new Error(`Loop ${input.loopId} is not startable`);
    const starter = this.options.starters[input.loopId];
    if (!starter) throw new Error(`Loop ${input.loopId} has no starter`);
    const runId = `queued_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    this.runs.set(runId, { runId, loopId: input.loopId, status: "queued", summary: "Queued" });
    const startInput = { ...input, publish: (event: LoopEvent) => this.publish(runId, event), ...(this.options.artifactStore ? { artifactStore: this.options.artifactStore } : {}) };
    const promise = starter(startInput).then((result) => {
      const artifactIds = result.artifactIds ?? collectArtifactIds(result.run.artifacts);
      const summary = result.summary ?? terminalSummary(result.run);
      const finalStatus = { runId: result.run.id, loopId: result.run.loopId, status: result.run.status, summary, artifactIds };
      this.runAliases.set(runId, result.run.id);
      this.runs.set(runId, finalStatus);
      this.runs.set(result.run.id, finalStatus);
      this.options.sessionStore.saveLoopResult({ sessionKey: input.sessionKey, runId: result.run.id, loopId: result.run.loopId, status: result.run.status, summary, artifactIds, needsAttention: result.run.status === "failed" || result.run.status === "needs_attention" });
      console.info(`[geistr] Background loop completed: runId=${result.run.id} status=${result.run.status} summary=${summary}`);
      this.options.onComplete?.(result.run);
    }).catch((error) => {
      const summary = error instanceof Error ? error.message : String(error);
      this.runs.set(runId, { runId, loopId: input.loopId, status: "failed", summary });
      this.options.sessionStore.saveLoopResult({ sessionKey: input.sessionKey, runId, loopId: input.loopId, status: "failed", summary, artifactIds: [], needsAttention: true });
      console.info(`[geistr] Background loop completed: runId=${runId} status=failed summary=${summary}`);
    }).finally(() => this.promises.delete(runId));
    this.promises.set(runId, promise);
    return { runId, status: "queued" };
  }

  async cancel(runId: string): Promise<boolean> {
    const run = this.runs.get(runId);
    if (!run || run.status !== "queued") return false;
    this.runs.set(runId, { ...run, status: "cancelled", summary: "Cancelled before start" });
    return true;
  }

  async status(runId: string): Promise<LoopCatalogRunStatus | null> {
    const actualRunId = this.runAliases.get(runId);
    return (actualRunId ? this.runs.get(actualRunId) : null) ?? this.runs.get(runId) ?? null;
  }

  private publish(aliasRunId: string, event: LoopEvent): void {
    const status = { runId: event.runId, loopId: event.loopId, status: event.status, ...(event.summary ? { summary: event.summary } : {}) };
    if (aliasRunId !== event.runId) this.runAliases.set(aliasRunId, event.runId);
    this.runs.set(event.runId, status);
    if (aliasRunId !== event.runId) this.runs.set(aliasRunId, status);
    this.options.onProgress?.(event);
  }
}

function terminalSummary(run: LoopRunState): string {
  const states = Object.values(run.nodeStates);
  for (let index = states.length - 1; index >= 0; index -= 1) {
    const summary = states[index]?.summary;
    if (summary) return summary;
  }
  return `Loop ${run.status}`;
}
function collectArtifactIds(artifacts: Record<string, unknown>): string[] {
  return Object.values(artifacts).flatMap((value) => value && typeof value === "object" && "artifactId" in value && typeof (value as { artifactId?: unknown }).artifactId === "string" ? [(value as { artifactId: string }).artifactId] : []);
}
