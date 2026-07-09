import { mergeLoopArtifacts, selectLoopArtifacts } from "./artifacts";
import { createLoopEvent } from "./events";
import { executeCodeLikeNode, executeLlmNode } from "./nodes";
import { InMemoryLoopStateStore } from "./persistence";
import { LoopRegistry } from "./registry";
import { recordLoopSteering, shouldEmitInitialSteering } from "./steering";
import type { LoopDefinition, LoopModelRunner, LoopNodeDefinition, LoopNodeHandlerResult, LoopProgressSink, LoopRunState, LoopStateStore } from "./types";

export interface LoopRuntimeOptions { registry?: LoopRegistry; modelRunner?: LoopModelRunner; stateStore?: LoopStateStore; progressSink?: LoopProgressSink; idFactory?: () => string }

export class LoopRuntime {
  private registry: LoopRegistry;
  private stateStore: LoopStateStore;
  private progressSink: LoopProgressSink | undefined;
  private modelRunner: LoopModelRunner | undefined;
  private idFactory: () => string;

  constructor(options: LoopRuntimeOptions = {}) {
    this.registry = options.registry ?? new LoopRegistry();
    this.stateStore = options.stateStore ?? new InMemoryLoopStateStore();
    this.progressSink = options.progressSink;
    this.modelRunner = options.modelRunner;
    this.idFactory = options.idFactory ?? (() => `loop_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  }

  getRegistry(): LoopRegistry { return this.registry; }

  createRun(definition: LoopDefinition, input: Record<string, unknown> = {}): LoopRunState {
    const now = new Date().toISOString();
    const run: LoopRunState = { id: this.idFactory(), loopId: definition.id, loopVersion: definition.version, status: "running", currentNodeId: definition.nodes[0]?.id, nodeStates: {}, artifacts: {}, evidence: [], metrics: { totalTurns: 0, totalToolCalls: 0, steeringEvents: 0 }, input, startedAt: now, updatedAt: now };
    for (const node of definition.nodes) run.nodeStates[node.id] = { id: node.id, status: "pending", attempts: [] };
    this.save(run);
    return run;
  }

  async start(definitionOrId: LoopDefinition | string, input: Record<string, unknown> = {}): Promise<LoopRunState> {
    const definition = typeof definitionOrId === "string" ? this.mustGetDefinition(definitionOrId) : definitionOrId;
    const run = this.createRun(definition, input);
    this.publish("loop.started", definition, run, undefined, "Loop started");
    return this.continue(run, definition);
  }

  async continue(run: LoopRunState, definition = this.mustGetDefinition(run.loopId)): Promise<LoopRunState> {
    while (run.status === "running" && run.currentNodeId) {
      const node = definition.nodes.find((item) => item.id === run.currentNodeId);
      if (!node) return this.terminal(run, definition, "failed", `Node ${run.currentNodeId} not found`);
      await this.executeNode(run, definition, node);
      if (run.status !== "running") break;
      this.advance(run, definition, node);
    }
    return run;
  }

  pause(run: LoopRunState, definition = this.mustGetDefinition(run.loopId)): LoopRunState { run.status = "paused"; this.touchSave(run); return run; }
  cancel(run: LoopRunState, definition = this.mustGetDefinition(run.loopId)): LoopRunState { return this.terminal(run, definition, "cancelled", "Loop cancelled"); }

  private async executeNode(run: LoopRunState, definition: LoopDefinition, node: LoopNodeDefinition): Promise<void> {
    const state = run.nodeStates[node.id];
    if (!state) throw new Error(`Missing node state for ${node.id}`);
    const attemptNo = state.attempts.length + 1;
    state.status = "running";
    state.attempts.push({ attempt: attemptNo, status: "running", startedAt: new Date().toISOString(), steeringEvents: [] });
    this.touchSave(run); this.publish("loop.node.started", definition, run, node, node.goal, attemptNo);

    const steering = shouldEmitInitialSteering(node);
    if (steering) {
      const ev = recordLoopSteering(run, node, steering, "stalled");
      state.attempts.at(-1)?.steeringEvents.push(ev);
      await this.modelRunner?.steer?.(run.id, node.id, steering);
      this.publish("loop.steered", definition, run, node, steering, attemptNo);
    }

    const result = await this.runNode(run, node, attemptNo);
    const validated = await this.validateIfNeeded(run, node, attemptNo, result);
    const resultStatus = validated.status ?? "completed";
    if (validated.artifacts) run.artifacts = mergeLoopArtifacts(run.artifacts, validated.artifacts);
    state.status = resultStatus === "completed" ? "completed" : "failed";
    state.summary = validated.summary;
    state.verdict = validated.verdict;
    const attempt = state.attempts.at(-1)!;
    attempt.status = state.status; attempt.completedAt = new Date().toISOString(); attempt.summary = validated.summary; attempt.error = state.status === "failed" ? validated.summary : undefined;
    this.touchSave(run);
    this.publish(state.status === "completed" ? "loop.node.completed" : "loop.node.failed", definition, run, node, validated.summary, attemptNo);
    if (state.status === "failed") this.retryOrExhaust(run, definition, node, validated.summary);
  }

  private async runNode(run: LoopRunState, node: LoopNodeDefinition, attempt: number): Promise<LoopNodeHandlerResult> {
    try {
      const artifacts = selectLoopArtifacts(run.artifacts, node.inputArtifacts);
      const ctx = { run, node, input: run.input, artifacts, attempt };
      if (node.kind === "llm") {
        if (!this.modelRunner) return { status: "failed", summary: "LLM node requires a LoopModelRunner" };
        return executeLlmNode(run, { ...node, mode: node.mode ?? "single_request" }, attempt, this.modelRunner);
      }
      if (["code", "gate", "side_effect", "finalizer", "room"].includes(node.kind)) return executeCodeLikeNode(ctx, node.handlerId ? this.registry.getHandler(node.handlerId) : undefined);
      return { status: "failed", summary: `Node kind "${node.kind}" is not supported by this runtime yet` };
    } catch (error) { return { status: "failed", summary: error instanceof Error ? error.message : String(error) }; }
  }

  private async validateIfNeeded(run: LoopRunState, node: LoopNodeDefinition, attempt: number, result: LoopNodeHandlerResult): Promise<LoopNodeHandlerResult> {
    if (!node.validatorId) return result;
    const validator = this.registry.getValidator(node.validatorId);
    if (!validator) return { status: "failed", summary: `Validator "${node.validatorId}" not found` };
    return validator({ run, node, input: run.input, artifacts: selectLoopArtifacts(run.artifacts, node.inputArtifacts), attempt }, result);
  }

  private retryOrExhaust(run: LoopRunState, definition: LoopDefinition, node: LoopNodeDefinition, summary?: string): void {
    const max = node.retryPolicy?.maxAttempts ?? definition.budgets?.maxAttempts ?? 3;
    const state = run.nodeStates[node.id];
    if (!state) throw new Error(`Missing node state for ${node.id}`);
    if (state.attempts.length < max) { state.status = "pending"; this.publish("loop.retrying", definition, run, node, summary, state.attempts.length + 1); this.touchSave(run); return; }
    this.terminal(run, definition, node.retryPolicy?.onExhausted === "needs_attention" ? "needs_attention" : "failed", summary ?? "Retry attempts exhausted", node);
  }

  private advance(run: LoopRunState, definition: LoopDefinition, node: LoopNodeDefinition): void {
    const state = run.nodeStates[node.id];
    if (!state || state.status !== "completed") return;
    const verdict = state.verdict;
    const rule = definition.transitions?.find((item) => item.from === node.id && (!item.verdict || item.verdict === verdict) && (!item.onStatus || item.onStatus === "completed"));
    if (node.kind === "finalizer") return void this.terminal(run, definition, "completed", state.summary ?? "Loop completed", node);

    switch (rule?.target.type) {
      case "complete":
        return void this.terminal(run, definition, "completed", state.summary ?? "Loop completed", node);
      case "node":
        run.currentNodeId = rule.target.nodeId;
        this.resetNodeForFreshExecution(run, rule.target.nodeId);
        break;
      case "retry":
        this.retryOrExhaust(run, definition, node, rule.feedback ?? state.summary);
        return;
      case "previous": {
        const currentIndex = definition.nodes.findIndex((item) => item.id === node.id);
        const previousNodeId = rule.target.nodeId ?? definition.nodes[currentIndex - 1]?.id;
        if (!previousNodeId) return void this.terminal(run, definition, "failed", "Previous transition target not found", node);
        run.currentNodeId = previousNodeId;
        this.resetNodeForFreshExecution(run, previousNodeId);
        break;
      }
      case "needs_attention":
        return void this.terminal(run, definition, "needs_attention", rule.feedback ?? state.summary ?? "Loop needs attention", node);
      case "fail":
        return void this.terminal(run, definition, "failed", rule.feedback ?? state.summary ?? "Loop failed", node);
      default: {
        const index = definition.nodes.findIndex((item) => item.id === node.id);
        run.currentNodeId = definition.nodes[index + 1]?.id;
      }
    }

    if (!run.currentNodeId) this.terminal(run, definition, "completed", "Loop completed", node);
    else this.touchSave(run);
  }

  private resetNodeForFreshExecution(run: LoopRunState, nodeId: string): void {
    const target = run.nodeStates[nodeId];
    if (!target) return;
    target.status = "pending";
    target.summary = undefined;
    target.verdict = undefined;
  }

  private terminal(run: LoopRunState, definition: LoopDefinition, status: "completed" | "failed" | "cancelled" | "needs_attention", summary: string, node?: LoopNodeDefinition): LoopRunState {
    run.status = status; run.completedAt = new Date().toISOString(); run.updatedAt = run.completedAt; this.save(run);
    this.publish(status === "needs_attention" ? "loop.needs_attention" : status === "completed" ? "loop.completed" : status === "cancelled" ? "loop.cancelled" : "loop.failed", definition, run, node, summary);
    return run;
  }
  private mustGetDefinition(id: string): LoopDefinition { const definition = this.registry.getDefinition(id); if (!definition) throw new Error(`Loop definition "${id}" not registered`); return definition; }
  private touchSave(run: LoopRunState): void { run.updatedAt = new Date().toISOString(); this.save(run); }
  private save(run: LoopRunState): void { void this.stateStore.save(run); }
  private publish(type: Parameters<typeof createLoopEvent>[0], definition: LoopDefinition, run: LoopRunState, node?: LoopNodeDefinition, summary?: string, attempt?: number): void { this.progressSink?.publish(createLoopEvent(type, definition, run, node, summary, attempt)); }
}
