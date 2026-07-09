import type { LoopEvidenceRecord, LoopNodeDefinition, LoopRunState } from "./types";

export function recordLoopSteering(run: LoopRunState, node: LoopNodeDefinition, message: string, type = "manual"): LoopEvidenceRecord {
  const event = { timestamp: new Date().toISOString(), type: `steering.${type}`, message, data: { nodeId: node.id } };
  run.evidence.push(event);
  run.metrics.steeringEvents += 1;
  return event;
}

export function shouldEmitInitialSteering(node: LoopNodeDefinition): string | null {
  const rule = node.steeringRules?.find((item) => item.trigger.type === "stalled" && item.trigger.idleMs === 0);
  return rule?.message ?? null;
}
