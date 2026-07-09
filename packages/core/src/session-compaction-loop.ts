import { LoopRegistry, LoopRuntime, InMemoryLoopStateStore, type LoopDefinition, type LoopModelRunner, type LoopProgressSink } from "./loops";
import type { SessionPersistenceStore } from "./session-persistence";

export const SESSION_COMPACTION_LOOP_ID = "session-compaction";
export const DEFAULT_COMPACTION_THRESHOLD_TOKENS = 15_000;
export const DEFAULT_RETAIN_RECENT_MESSAGES = 16;
export const SUMMARY_VERSION = 1;

export interface CompactionEvent { eventId: string; role: string | null; content: string; sequence: number; createdAt: number }
export interface PreparedCompactionContext {
  sessionKey: string; transcriptId: string; eventsToCompact: CompactionEvent[]; retainedEventIds: string[];
  priorSummary: string | null; targetSummarySize: number; summaryUntilEventId: string;
  estimatedTokens: number; retainedRecentCount: number;
}
export interface CompactionSummaryArtifact { summary: string; summaryUntilEventId: string; coveredEventIds: string[]; continuity: Record<string, unknown> }
export interface SessionCompactionResult { compacted: boolean; summaryEventId: string | null; coveredEventCount: number; retainedRecentCount: number; estimatedTokens: number; reason?: string }

export const NO_COMPACTION_NEEDED_RESULT: SessionCompactionResult = { compacted: false, summaryEventId: null, coveredEventCount: 0, retainedRecentCount: 0, estimatedTokens: 0, reason: "No compaction needed" };

export interface SessionCompactionTarget { sessionKey: string; transcriptId?: string; scope: "core" | "app-agent" | string; appId?: string; agentId?: string }
export interface RunSessionCompactionInput { store: SessionPersistenceStore; modelRunner: LoopModelRunner; target: SessionCompactionTarget; thresholdTokens?: number; retainRecentMessages?: number; progressSink?: LoopProgressSink; domainInstructions?: string }

const STABLE_SYSTEM_PROMPT = [
  "You are Geistr's conversation continuity summarizer.",
  "Summarize older chat context so the main assistant can continue naturally in one long-running chat.",
  "Only summarize events_to_compact and the prior_summary. Do not invent facts.",
  "Return only the continuity summary text. No JSON, no markdown fences, no commentary about the task.",
  "Preserve decisions, user preferences/goals, open threads, unresolved tasks, and important facts.",
].join("\n");

export function createSessionCompactionLoopDefinition(): LoopDefinition {
  return { id: SESSION_COMPACTION_LOOP_ID, version: "1", label: "Compacting session", description: "Invisible session continuity compaction", trigger: { type: "background", name: "post-turn" }, budgets: { maxAttempts: 3 }, nodes: [
    { id: "prepare_context", kind: "code", label: "Preparing context", goal: "Select compactable events and retained recent messages", handlerId: "session_compaction.prepare" },
    { id: "compact_room", kind: "llm", mode: "single_request", label: "Summarizing continuity", goal: "Create a strict continuity summary", instruction: STABLE_SYSTEM_PROMPT, inputArtifacts: [{ key: "prepared" }, { key: "target" }, { key: "domainInstructions", required: false }, { key: "validatorFeedback", required: false }], retryPolicy: { maxAttempts: 3, onExhausted: "fail" }, validatorId: "session_compaction.validate" },
    { id: "save_summary", kind: "side_effect", label: "Saving summary", goal: "Persist hidden summary event and update checkpoints", handlerId: "session_compaction.save", inputArtifacts: [{ key: "prepared" }, { key: "acceptedSummary" }] },
    { id: "finalizer", kind: "finalizer", label: "Finished", goal: "Return compaction result", handlerId: "session_compaction.finalize", inputArtifacts: [{ key: "prepared" }, { key: "saveResult" }] },
  ], transitions: [{ from: "prepare_context", verdict: "terminal", target: { type: "complete" } }] };
}

export function createSessionCompactionRuntime(input: RunSessionCompactionInput): LoopRuntime {
  const registry = new LoopRegistry();
  registry.registerDefinition(createSessionCompactionLoopDefinition());
  registry.registerHandler("session_compaction.prepare", () => {
    const prepared = input.store.prepareSessionCompaction(input.target.sessionKey, { thresholdTokens: input.thresholdTokens ?? DEFAULT_COMPACTION_THRESHOLD_TOKENS, retainRecentMessages: input.retainRecentMessages ?? DEFAULT_RETAIN_RECENT_MESSAGES, ...(input.target.transcriptId ? { transcriptId: input.target.transcriptId } : {}) });
    if (!prepared) return { summary: "No compaction needed", verdict: "terminal", artifacts: { final: NO_COMPACTION_NEEDED_RESULT } };
    return { summary: `Prepared ${prepared.eventsToCompact.length} event(s) for compaction`, artifacts: { prepared, target: input.target, ...(input.domainInstructions ? { domainInstructions: input.domainInstructions } : {}) } };
  });
  registry.registerValidator("session_compaction.validate", (ctx, result) => {
    const prepared = ctx.artifacts.prepared as PreparedCompactionContext;
    const parsed = parseSummaryArtifact(result.artifacts?.summary ?? result.summary, prepared);
    if (!parsed.ok) return { status: "failed", summary: parsed.feedback, artifacts: { validatorFeedback: parsed.feedback } };
    return { summary: "Summary accepted", artifacts: { acceptedSummary: parsed.value } };
  });
  registry.registerHandler("session_compaction.save", (ctx) => {
    const prepared = ctx.artifacts.prepared as PreparedCompactionContext;
    const summary = ctx.artifacts.acceptedSummary as CompactionSummaryArtifact;
    const summaryEventId = input.store.saveSessionSummary({ sessionKey: prepared.sessionKey, transcriptId: prepared.transcriptId, summary: summary.summary, summaryUntilEventId: prepared.summaryUntilEventId, continuity: summary.continuity, coveredEventIds: summary.coveredEventIds, target: input.target, now: Date.now() });
    return { summary: `Saved summary ${summaryEventId}`, artifacts: { saveResult: { summaryEventId } } };
  });
  registry.registerHandler("session_compaction.finalize", (ctx) => {
    const prepared = ctx.artifacts.prepared as PreparedCompactionContext;
    const save = ctx.artifacts.saveResult as { summaryEventId: string };
    return { summary: "Session compacted", artifacts: { final: { compacted: true, summaryEventId: save.summaryEventId, coveredEventCount: prepared.eventsToCompact.length, retainedRecentCount: prepared.retainedRecentCount, estimatedTokens: prepared.estimatedTokens } } };
  });
  return new LoopRuntime({ registry, modelRunner: input.modelRunner, stateStore: new InMemoryLoopStateStore(), ...(input.progressSink ? { progressSink: input.progressSink } : {}) });
}

export async function runSessionCompactionLoop(input: RunSessionCompactionInput): Promise<SessionCompactionResult> {
  const runtime = createSessionCompactionRuntime(input);
  const run = await runtime.start(SESSION_COMPACTION_LOOP_ID, { target: input.target });
  const final = run.artifacts.final as SessionCompactionResult | undefined;
  if (run.status !== "completed" || !final) return { compacted: false, summaryEventId: null, coveredEventCount: 0, retainedRecentCount: 0, estimatedTokens: 0, reason: run.nodeStates[run.currentNodeId ?? ""]?.summary ?? run.status };
  return final;
}

function parseSummaryArtifact(value: unknown, prepared: PreparedCompactionContext): { ok: true; value: CompactionSummaryArtifact } | { ok: false; feedback: string } {
  const text = cleanSummaryText(typeof value === "string" ? value : JSON.stringify(value ?? ""));
  const parsed = parseOptionalSummaryJson(value, text);
  const obj = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  const summary = (obj && typeof obj.summary === "string" ? obj.summary : text).trim();
  if (!summary) return { ok: false, feedback: "Summary is empty." };
  if (summary.length > prepared.targetSummarySize) return { ok: false, feedback: `Summary exceeds target size ${prepared.targetSummarySize} characters.` };
  if (/^(user|assistant):/im.test(summary)) return { ok: false, feedback: "Summary must not use visible chat-message formatting." };
  const covered = obj && Array.isArray(obj.coveredEventIds) ? obj.coveredEventIds.filter((id): id is string => typeof id === "string") : prepared.eventsToCompact.map((event) => event.eventId);
  return { ok: true, value: { summary, summaryUntilEventId: prepared.summaryUntilEventId, coveredEventIds: covered, continuity: obj && typeof obj.continuity === "object" && obj.continuity ? obj.continuity as Record<string, unknown> : {} } };
}

function parseOptionalSummaryJson(value: unknown, text: string): unknown | null {
  if (typeof value === "object" && value !== null) return value;
  try { return JSON.parse(text); } catch {}
  const extracted = extractJsonObjectText(text);
  if (!extracted) return null;
  try { return JSON.parse(extracted); } catch { return null; }
}

function cleanSummaryText(text: string): string {
  const fenced = /```(?:json|markdown|md)?\s*([\s\S]*?)\s*```/i.exec(text);
  return (fenced?.[1] ?? text).trim();
}

function extractJsonObjectText(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return candidate.slice(start, end + 1);
}
