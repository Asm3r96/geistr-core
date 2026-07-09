import { InMemoryLoopStateStore, LoopRegistry, LoopRuntime, type LoopDefinition, type LoopModelRunner, type LoopProgressSink } from "./loops";
import type { MemoryCandidate, MemoryDecision, MemoryIndexingResult, MemoryRecord, MemoryType, SessionPersistenceStore } from "./session-persistence";

export const MEMORY_INDEXING_LOOP_ID = "memory-indexing";
export const DEFAULT_MEMORY_INDEX_BATCH_SIZE = 75;
export const DEFAULT_MEMORY_INDEX_THRESHOLD = 50;

const MEMORY_TYPES = new Set<MemoryType>(["fact", "preference", "goal", "episode", "person_context", "lesson"]);
const MEMORY_ACTIONS = new Set(["ignore", "create", "update", "reinforce", "supersede", "delete"]);

export interface RunMemoryIndexingLoopInput {
  store: SessionPersistenceStore;
  modelRunner: LoopModelRunner;
  sessionKey: string;
  /** When true, index the oldest visible unindexed messages across all chats. */
  global?: boolean;
  threshold?: number;
  limit?: number;
  force?: boolean;
  progressSink?: LoopProgressSink;
}

const EXTRACT_PROMPT = [
  "You are Geistr's long-term memory extraction room.",
  "You receive one ordered transcript batch. Infer 0-N durable memory candidates from the full conversation context.",
  "Do not classify messages one by one. A candidate may synthesize meaning spread across many messages.",
  "Mandatory gate for every candidate: Is this worth saving, and would a careful human intentionally save it as long-term memory? If not clearly yes, omit it.",
  "Save only high-signal durable facts, preferences, goals, constraints, recurring context, lessons, and meaningful relationship/context facts.",
  "Do not save filler, one-off chatter, temporary mood, assistant behavior/profile edits, ordinary task details, or facts already known unless they update/reinforce memory.",
  "Return JSON only: {\"candidates\":[{\"content\":string,\"memoryType\":\"fact|preference|goal|episode|person_context|lesson\",\"importance\":1-10,\"stability\":1-10,\"tags\":[string],\"threadId\":string|null}]}.",
  "It is valid to return {\"candidates\":[]}.",
].join("\n");

const RESOLVE_PROMPT = [
  "You are Geistr's memory resolution room.",
  "For each candidate, compare it with recalled existing memories and choose one action: ignore, create, update, reinforce, supersede, or delete.",
  "Avoid duplicates. Use update for refinements/corrections, reinforce for already-known stable facts, supersede when a replacement should point at an older memory, and ignore weak candidates.",
  "Return JSON only: {\"decisions\":[{\"candidateId\":string,\"action\":string,\"existingMemoryId\":string|null,\"content\":string|null,\"memoryType\":string|null,\"reason\":string}]}.",
].join("\n");

export function createMemoryIndexingLoopDefinition(): LoopDefinition {
  return { id: MEMORY_INDEXING_LOOP_ID, version: "1", label: "Indexing memories", description: "Invisible long-term memory indexing", trigger: { type: "background", name: "post-turn" }, budgets: { maxAttempts: 3 }, nodes: [
    { id: "prepare_memory_batch", kind: "code", label: "Preparing memory batch", goal: "Fetch unindexed visible transcript messages", handlerId: "memory.prepare" },
    { id: "extract_context_memories", kind: "llm", mode: "single_request", label: "Extracting memory candidates", goal: "Extract 0-N durable candidates from full batch context", instruction: EXTRACT_PROMPT, inputArtifacts: [{ key: "prepared" }, { key: "validatorFeedback", required: false }], validatorId: "memory.validate_candidates", retryPolicy: { maxAttempts: 3, onExhausted: "fail" } },
    { id: "recall_memory_neighborhoods", kind: "code", label: "Recalling memory neighborhoods", goal: "Find similar memories and graph neighbors", handlerId: "memory.recall", inputArtifacts: [{ key: "prepared" }, { key: "candidates" }] },
    { id: "resolve_candidates", kind: "llm", mode: "single_request", label: "Resolving candidates", goal: "Decide create/update/reinforce/supersede/delete/ignore", instruction: RESOLVE_PROMPT, inputArtifacts: [{ key: "candidates" }, { key: "neighborhoods" }, { key: "resolverFeedback", required: false }], validatorId: "memory.validate_decisions", retryPolicy: { maxAttempts: 3, onExhausted: "fail" } },
    { id: "apply_memory_decisions", kind: "side_effect", label: "Applying memory decisions", goal: "Persist accepted memory changes", handlerId: "memory.apply", inputArtifacts: [{ key: "prepared" }, { key: "candidates" }, { key: "decisions" }] },
    { id: "link_related_memories", kind: "code", label: "Linking related memories", goal: "Maintain memory graph links", handlerId: "memory.link", inputArtifacts: [{ key: "applyResult" }] },
    { id: "mark_messages_indexed", kind: "side_effect", label: "Marking messages indexed", goal: "Checkpoint processed messages after success", handlerId: "memory.mark", inputArtifacts: [{ key: "prepared" }, { key: "candidates" }, { key: "applyResult" }, { key: "linkResult" }] },
    { id: "finalizer", kind: "finalizer", label: "Finished", goal: "Return memory indexing counts", handlerId: "memory.finalize", inputArtifacts: [{ key: "final" }] },
  ], transitions: [{ from: "prepare_memory_batch", verdict: "terminal", target: { type: "complete" } }] };
}

export function createMemoryIndexingRuntime(input: RunMemoryIndexingLoopInput): LoopRuntime {
  const registry = new LoopRegistry();
  registry.registerDefinition(createMemoryIndexingLoopDefinition());
  registry.registerHandler("memory.prepare", () => {
    const options = { threshold: input.threshold ?? DEFAULT_MEMORY_INDEX_THRESHOLD, limit: input.limit ?? DEFAULT_MEMORY_INDEX_BATCH_SIZE, force: input.force ?? false };
    const prepared = input.global && "prepareGlobalMemoryIndexingBatch" in input.store
      ? input.store.prepareGlobalMemoryIndexingBatch(options)
      : input.store.prepareMemoryIndexingBatch(input.sessionKey, options);
    if (!prepared) return { summary: "No memory indexing needed", verdict: "terminal", artifacts: { final: emptyResult("below_threshold") } };
    return { summary: `Prepared ${prepared.events.length} message(s)`, artifacts: { prepared } };
  });
  registry.registerValidator("memory.validate_candidates", (_ctx, result) => {
    const parsed = parseCandidates(result.artifacts?.candidates ?? result.summary);
    if (!parsed.ok) return { status: "failed", summary: parsed.feedback, artifacts: { validatorFeedback: parsed.feedback } };
    return { summary: `Accepted ${parsed.value.length} candidate(s)`, artifacts: { candidates: parsed.value } };
  });
  registry.registerHandler("memory.recall", (ctx) => {
    const candidates = ctx.artifacts.candidates as MemoryCandidate[];
    return { summary: "Recalled neighborhoods", artifacts: { neighborhoods: input.store.recallMemoryNeighborhoods(candidates) } };
  });
  registry.registerValidator("memory.validate_decisions", (ctx, result) => {
    const candidates = ctx.artifacts.candidates as MemoryCandidate[];
    const parsed = parseDecisions(result.artifacts?.decisions ?? result.summary, candidates);
    if (!parsed.ok) return { status: "failed", summary: parsed.feedback, artifacts: { resolverFeedback: parsed.feedback } };
    return { summary: `Accepted ${parsed.value.length} decision(s)`, artifacts: { decisions: parsed.value } };
  });
  registry.registerHandler("memory.apply", (ctx) => {
    const prepared = ctx.artifacts.prepared as { eventIds: string[]; events?: { sessionKey?: string }[] };
    const candidates = ctx.artifacts.candidates as MemoryCandidate[];
    const decisions = ctx.artifacts.decisions as MemoryDecision[];
    const sourceSessionKey = prepared.events?.at(-1)?.sessionKey ?? input.sessionKey;
    const applyResult = input.store.applyMemoryDecisions({ sessionKey: sourceSessionKey, candidates, decisions, sourceMessageIds: prepared.eventIds });
    return { summary: "Applied memory decisions", artifacts: { applyResult } };
  });
  registry.registerHandler("memory.link", (ctx) => {
    const applyResult = ctx.artifacts.applyResult as { persistedMemoryIds: string[] };
    return { summary: "Linked related memories", artifacts: { linkResult: { linked: input.store.linkRelatedMemories(applyResult.persistedMemoryIds) } } };
  });
  registry.registerHandler("memory.mark", (ctx) => {
    const prepared = ctx.artifacts.prepared as { sessionKey?: string; eventIds: string[]; events: unknown[] };
    const applyResult = ctx.artifacts.applyResult as Partial<MemoryIndexingResult>;
    const linkResult = ctx.artifacts.linkResult as { linked: number };
    const marked = input.store.markMemoryIndexingEventsIndexed(prepared.sessionKey ?? input.sessionKey, prepared.eventIds);
    const remaining = input.global && "countGlobalUnindexedMessages" in input.store ? input.store.countGlobalUnindexedMessages() : input.store.countUnindexedMessages(input.sessionKey);
    const final: MemoryIndexingResult = { processed: marked, candidates: (ctx.artifacts.candidates as unknown[]).length, created: applyResult.created ?? 0, updated: applyResult.updated ?? 0, reinforced: applyResult.reinforced ?? 0, superseded: applyResult.superseded ?? 0, deleted: applyResult.deleted ?? 0, ignored: applyResult.ignored ?? 0, linked: linkResult.linked, remaining };
    return { summary: `Indexed ${marked} message(s)`, artifacts: { final } };
  });
  registry.registerHandler("memory.finalize", (ctx) => ({ summary: "Memory indexing complete", artifacts: { final: ctx.artifacts.final } }));
  return new LoopRuntime({ registry, modelRunner: input.modelRunner, stateStore: new InMemoryLoopStateStore(), ...(input.progressSink ? { progressSink: input.progressSink } : {}) });
}

export async function runMemoryIndexingLoop(input: RunMemoryIndexingLoopInput): Promise<MemoryIndexingResult> {
  const runtime = createMemoryIndexingRuntime(input);
  const run = await runtime.start(MEMORY_INDEXING_LOOP_ID, { sessionKey: input.sessionKey });
  return run.artifacts.final as MemoryIndexingResult ?? emptyResult(run.status);
}

function emptyResult(reason?: string): MemoryIndexingResult { return { processed: 0, candidates: 0, created: 0, updated: 0, reinforced: 0, superseded: 0, deleted: 0, ignored: 0, linked: 0, remaining: 0, ...(reason ? { reason } : {}) }; }

function parseCandidates(value: unknown): { ok: true; value: MemoryCandidate[] } | { ok: false; feedback: string } {
  const obj = parseLooseJson(value);
  const raw: unknown[] | null = Array.isArray(obj) ? obj : Array.isArray(obj?.candidates) ? obj.candidates as unknown[] : null;
  if (!raw) return { ok: false, feedback: "Expected JSON candidates array." };
  const candidates = raw.map((item: unknown, index: number) => normalizeCandidate(item, index)).filter((item): item is MemoryCandidate => item !== null);
  return { ok: true, value: candidates };
}

function normalizeCandidate(item: unknown, index: number): MemoryCandidate | null {
  if (!item || typeof item !== "object") return null;
  const rec = item as Record<string, unknown>;
  const content = typeof rec.content === "string" ? rec.content.trim() : "";
  if (content.length < 12) return null;
  const memoryType = MEMORY_TYPES.has(rec.memoryType as MemoryType) ? rec.memoryType as MemoryType : MEMORY_TYPES.has(rec.memory_type as MemoryType) ? rec.memory_type as MemoryType : "fact";
  return { candidateId: `cand_${index + 1}`, content, memoryType, importance: clampScore(rec.importance, 5), stability: clampScore(rec.stability, 5), tags: Array.isArray(rec.tags) ? rec.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 8) : [], threadId: typeof rec.threadId === "string" ? rec.threadId : typeof rec.thread_id === "string" ? rec.thread_id : null };
}

function parseDecisions(value: unknown, candidates: MemoryCandidate[]): { ok: true; value: MemoryDecision[] } | { ok: false; feedback: string } {
  const obj = parseLooseJson(value);
  const raw: unknown[] | null = Array.isArray(obj) ? obj : Array.isArray(obj?.decisions) ? obj.decisions as unknown[] : null;
  if (!raw) return { ok: false, feedback: "Expected JSON decisions array." };
  const candidateIds = new Set(candidates.map((candidate) => candidate.candidateId));
  const decisions = raw.map((item: unknown) => normalizeDecision(item)).filter((item): item is MemoryDecision => item !== null && candidateIds.has(item.candidateId));
  const decided = new Set(decisions.map((decision) => decision.candidateId));
  for (const candidate of candidates) if (!decided.has(candidate.candidateId)) decisions.push({ candidateId: candidate.candidateId, action: "ignore", existingMemoryId: null, content: null, memoryType: null, reason: "No resolver decision returned." });
  return { ok: true, value: decisions };
}

function normalizeDecision(item: unknown): MemoryDecision | null {
  if (!item || typeof item !== "object") return null;
  const rec = item as Record<string, unknown>;
  const action = typeof rec.action === "string" && MEMORY_ACTIONS.has(rec.action) ? rec.action as MemoryDecision["action"] : "ignore";
  return { candidateId: String(rec.candidateId ?? rec.candidate_id ?? ""), action, existingMemoryId: typeof rec.existingMemoryId === "string" ? rec.existingMemoryId : typeof rec.existing_memory_id === "string" ? rec.existing_memory_id : null, content: typeof rec.content === "string" ? rec.content.trim() : null, memoryType: MEMORY_TYPES.has(rec.memoryType as MemoryType) ? rec.memoryType as MemoryType : null, reason: typeof rec.reason === "string" ? rec.reason : "" };
}

function parseLooseJson(value: unknown): any {
  if (value && typeof value === "object") return value;
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(text)?.[1] ?? text;
  try { return JSON.parse(fenced); } catch {}
  const start = fenced.indexOf("{"); const end = fenced.lastIndexOf("}");
  if (start >= 0 && end > start) { try { return JSON.parse(fenced.slice(start, end + 1)); } catch {} }
  return null;
}

function clampScore(value: unknown, fallback: number): number { return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.min(10, Math.round(value))) : fallback; }
