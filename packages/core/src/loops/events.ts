import type { LoopDefinition, LoopEvent, LoopEventType, LoopNodeDefinition, LoopRunState } from "./types";

export function createLoopEvent(type: LoopEventType, definition: LoopDefinition, run: LoopRunState, node?: LoopNodeDefinition, summary?: string, attempt?: number): LoopEvent {
  const stepIndex = node ? definition.nodes.findIndex((n) => n.id === node.id) + 1 : undefined;
  return { type, runId: run.id, loopId: definition.id, loopLabel: definition.label, status: run.status, nodeId: node?.id, nodeLabel: node?.label, stepIndex, totalSteps: definition.nodes.length, attempt, summary, timestamp: new Date().toISOString() };
}
