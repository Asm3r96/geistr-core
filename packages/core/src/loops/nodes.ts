import { formatLoopArtifactsForPrompt, selectLoopArtifacts } from "./artifacts";
import type { LoopModelRunner, LoopNodeDefinition, LoopNodeExecutionContext, LoopNodeHandlerResult, LoopRunState } from "./types";

export async function executeCodeLikeNode(ctx: LoopNodeExecutionContext, handler: ((ctx: LoopNodeExecutionContext) => Promise<LoopNodeHandlerResult> | LoopNodeHandlerResult) | undefined): Promise<LoopNodeHandlerResult> {
  if (!handler) return { status: "failed", summary: `No handler registered for node ${ctx.node.id}` };
  return handler(ctx);
}

export async function executeLlmNode(run: LoopRunState, node: LoopNodeDefinition, attempt: number, modelRunner: LoopModelRunner): Promise<LoopNodeHandlerResult> {
  const artifacts = selectLoopArtifacts(run.artifacts, node.inputArtifacts);
  const prompt = buildLoopNodePrompt(node, artifacts, attempt);
  const input = { runId: run.id, node, prompt, model: node.model, artifacts, outputContract: node.outputContract, timeoutMs: node.timeoutMs };
  const result = node.mode === "agent_session"
    ? await modelRunner.runAgentSession({ ...input, toolPolicy: node.toolPolicy, steeringRules: node.steeringRules })
    : await modelRunner.runSingleRequest(input);
  if (result.status === "failed") return { status: "failed", summary: result.error ?? result.summary, artifacts: result.artifacts };
  return { status: "completed", summary: result.summary, artifacts: result.artifacts, verdict: "pass" };
}

export function buildLoopNodePrompt(node: LoopNodeDefinition, artifacts: Record<string, unknown>, attempt: number): string {
  const parts = [`<loop_node>`, `Goal: ${node.goal}`, `Attempt: ${attempt}`, `</loop_node>`];
  if (node.instruction) parts.push(`<instruction>\n${node.instruction}\n</instruction>`);
  if (Object.keys(artifacts).length > 0) parts.push(`<selected_artifacts>\n${formatLoopArtifactsForPrompt(artifacts)}\n</selected_artifacts>`);
  if (node.outputContract?.description) parts.push(`<output_contract>\n${node.outputContract.description}\n</output_contract>`);
  return parts.join("\n\n");
}
