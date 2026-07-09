export type LoopNodeKind = "code" | "llm" | "room" | "gate" | "evaluator" | "approval" | "wait" | "side_effect" | "finalizer";
export type LoopLlmMode = "agent_session" | "single_request";
export type LoopRunStatus = "running" | "paused" | "completed" | "failed" | "cancelled" | "needs_attention";
export type LoopNodeStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type LoopGateVerdict = "pass" | "correctable" | "uncertain" | "terminal";
export type LoopEventType = "loop.started" | "loop.node.started" | "loop.node.completed" | "loop.node.failed" | "loop.retrying" | "loop.steered" | "loop.needs_attention" | "loop.completed" | "loop.failed" | "loop.cancelled";

export interface LoopModelSelection { provider?: string; modelId?: string; thinkingLevel?: string }
export interface LoopRetryPolicy { maxAttempts?: number; backoffMs?: number; onExhausted?: "fail" | "needs_attention" }
export interface LoopBudget { maxAttempts?: number; maxWallClockMs?: number; maxTurns?: number; maxToolCalls?: number; maxSteeringEvents?: number; maxCost?: number }
export interface LoopSteeringRule { trigger: { type: "stalled" | "repeated_tool_failure" | "required_tool_not_used" | "too_much_reading" | "edits_without_validation" | "forbidden_action" | "context_too_large"; maxCount?: number; idleMs?: number; toolName?: string }; message: string }
export interface LoopArtifactSelector { key: string; as?: string; required?: boolean }
export interface LoopOutputContract { description?: string; schema?: unknown; requiredArtifactKeys?: string[] }
export interface LoopToolPolicy { allowedTools?: string[]; prohibitedTools?: string[]; prohibitedActions?: string[] }

export interface LoopNodeDefinition {
  id: string; kind: LoopNodeKind; label: string; goal: string;
  mode?: LoopLlmMode; model?: LoopModelSelection; timeoutMs?: number; retryPolicy?: LoopRetryPolicy;
  steeringRules?: LoopSteeringRule[]; inputArtifacts?: LoopArtifactSelector[]; instruction?: string;
  outputContract?: LoopOutputContract; validatorId?: string; handlerId?: string; toolPolicy?: LoopToolPolicy;
}
export type LoopTransitionTarget = { type: "node"; nodeId: string } | { type: "retry" } | { type: "previous"; nodeId?: string } | { type: "needs_attention" } | { type: "fail" } | { type: "complete" };
export interface LoopTransitionRule { from: string; verdict?: LoopGateVerdict; onStatus?: "completed" | "failed"; target: LoopTransitionTarget; feedback?: string }
export interface LoopDefinition { id: string; version: string; label: string; description: string; trigger?: { type: "manual" | "event" | "background"; name?: string }; nodes: LoopNodeDefinition[]; transitions?: LoopTransitionRule[]; budgets?: LoopBudget; finalOutput?: Record<string, unknown> }

export interface LoopLlmResult { status: "ready_for_validation" | "completed" | "failed"; summary: string; artifacts?: Record<string, unknown>; confidence?: "low" | "medium" | "high"; evidence?: LoopEvidenceRecord[]; metrics?: Record<string, unknown>; error?: string }
export interface LoopSingleRequestInput { runId: string; node: LoopNodeDefinition; prompt: string; systemInstruction?: string; model?: LoopModelSelection | undefined; artifacts: Record<string, unknown>; outputContract?: LoopOutputContract | undefined; timeoutMs?: number | undefined }
export interface LoopAgentSessionInput extends LoopSingleRequestInput { toolPolicy?: LoopToolPolicy | undefined; steeringRules?: LoopSteeringRule[] | undefined; onSteer?: ((message: string) => void) | undefined }
export interface LoopModelRunner { runSingleRequest(input: LoopSingleRequestInput): Promise<LoopLlmResult>; runAgentSession(input: LoopAgentSessionInput): Promise<LoopLlmResult>; steer?(runId: string, nodeId: string, message: string): Promise<void> | void }

export interface LoopNodeHandlerResult { status?: "completed" | "failed" | undefined; summary: string; artifacts?: Record<string, unknown> | undefined; verdict?: LoopGateVerdict | undefined; feedback?: string | undefined }
export type LoopNodeHandler = (ctx: LoopNodeExecutionContext) => Promise<LoopNodeHandlerResult> | LoopNodeHandlerResult;
export type LoopValidator = (ctx: LoopNodeExecutionContext, result: LoopNodeHandlerResult | LoopLlmResult) => Promise<LoopNodeHandlerResult> | LoopNodeHandlerResult;
export interface LoopNodeExecutionContext { run: LoopRunState; node: LoopNodeDefinition; input: Record<string, unknown>; artifacts: Record<string, unknown>; attempt: number }

export interface LoopEvidenceRecord { timestamp: string; type: string; message: string; data?: unknown }
export interface LoopNodeAttempt { attempt: number; status: LoopNodeStatus; startedAt: string; completedAt?: string | undefined; summary?: string | undefined; error?: string | undefined; steeringEvents: LoopEvidenceRecord[] }
export interface LoopNodeState { id: string; status: LoopNodeStatus; attempts: LoopNodeAttempt[]; summary?: string | undefined; verdict?: LoopGateVerdict | undefined }
export interface LoopRunState { id: string; loopId: string; loopVersion: string; status: LoopRunStatus; currentNodeId?: string | undefined; nodeStates: Record<string, LoopNodeState>; artifacts: Record<string, unknown>; evidence: LoopEvidenceRecord[]; metrics: { totalTurns: number; totalToolCalls: number; steeringEvents: number }; input: Record<string, unknown>; startedAt: string; updatedAt: string; completedAt?: string | undefined }

export interface LoopEvent { type: LoopEventType; runId: string; loopId: string; loopLabel: string; status: LoopRunStatus; nodeId?: string | undefined; nodeLabel?: string | undefined; stepIndex?: number | undefined; totalSteps?: number | undefined; attempt?: number | undefined; summary?: string | undefined; timestamp: string }
export interface LoopStateStore { save(run: LoopRunState): Promise<void> | void; load(runId: string): Promise<LoopRunState | null> | LoopRunState | null }
export interface LoopProgressSink { publish(event: LoopEvent): void }
export interface LoopApprovalRequest { runId: string; nodeId: string; summary: string; artifacts: Record<string, unknown> }
export interface LoopApprovalResult { approved: boolean; feedback?: string }
export interface LoopApprovalProvider { requestApproval(input: LoopApprovalRequest): Promise<LoopApprovalResult> }
