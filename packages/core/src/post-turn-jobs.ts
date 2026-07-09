import type { LoopModelRunner, LoopProgressSink } from "./loops";
import { DEFAULT_MEMORY_INDEX_BATCH_SIZE, DEFAULT_MEMORY_INDEX_THRESHOLD, runMemoryIndexingLoop } from "./memory-indexing-loop";
import { runSessionCompactionLoop } from "./session-compaction-loop";
import type { SessionPersistenceStore } from "./session-persistence";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PostTurnJobConfig {
  /** Whether cross-session memory indexing is enabled. */
  memoryEnabled: boolean;
  /** Whether session compaction is enabled. */
  compactionEnabled: boolean;
  /** Estimated context token threshold for compaction trigger. */
  compactionThresholdTokens: number;
}

export interface PostTurnJobContext {
  /** The session/chat key that was just written to. */
  sessionKey: string;
  /** The user message text that was just persisted. */
  userMessage: string;
  /** The assistant response text that was just persisted. */
  assistantMessage: string;
  /** Provider used for this turn (may be null on fallback). */
  providerId: string | null;
  /** Model used for this turn. */
  modelId: string | null;
  /** Turn identifier for idempotency. */
  turnId: string;
  /** Total message count in the session after this turn. */
  messageCount: number;
  /** App-level config relevant to post-turn decisions. */
  config: PostTurnJobConfig;
  /** Persistence store for reading/writing session metadata. */
  store: SessionPersistenceStore;
  /** Optional model runner used when a policy triggers the real compaction loop. */
  compactionModelRunner?: LoopModelRunner;
  /** Optional model runner used when a policy triggers the real memory indexing loop. */
  memoryModelRunner?: LoopModelRunner;
  /** Optional progress sink for background loop progress. */
  loopProgressSink?: LoopProgressSink;
}

export interface PostTurnJobResult {
  /** Name of the job that ran. */
  jobName: string;
  /** Whether the job decided to act. */
  acted: boolean;
  /** Human-readable description of what happened. */
  details: string;
  /** Error if the job threw. */
  error?: Error;
}

/** A single post-turn job definition. */
export interface PostTurnJob {
  /** Unique job name (e.g. "memory-index-policy", "compaction-policy"). */
  readonly name: string;
  /** Determine whether this job should run for the given context. */
  shouldRun(ctx: PostTurnJobContext): boolean;
  /** Execute the job. Should not throw — errors are caught and recorded. */
  run(ctx: PostTurnJobContext): Promise<PostTurnJobResult>;
}

/** Scheduler that runs all registered post-turn jobs. */
export interface PostTurnJobScheduler {
  /** Registered jobs in execution order. */
  readonly jobs: readonly PostTurnJob[];
  /** Run all applicable jobs and return their results. */
  runAll(ctx: PostTurnJobContext): Promise<PostTurnJobResult[]>;
}

// ---------------------------------------------------------------------------
// Memory indexing policy job
// ---------------------------------------------------------------------------

const memoryIndexPolicyJob: PostTurnJob = {
  name: "memory-index-policy",

  shouldRun(ctx: PostTurnJobContext): boolean {
    return ctx.config.memoryEnabled;
  },

  async run(ctx: PostTurnJobContext): Promise<PostTurnJobResult> {
    const unindexedCount = ctx.store.countGlobalUnindexedMessages();

    if (unindexedCount === 0) {
      return {
        jobName: this.name,
        acted: false,
        details: "No unindexed messages to process.",
      };
    }

    if (unindexedCount < DEFAULT_MEMORY_INDEX_THRESHOLD) {
      return { jobName: this.name, acted: false, details: `No memory indexing needed (${unindexedCount}/${DEFAULT_MEMORY_INDEX_THRESHOLD} global unindexed messages).` };
    }
    if (!ctx.memoryModelRunner) {
      return { jobName: this.name, acted: true, details: `Memory indexing threshold reached for ${unindexedCount} global message(s), but no model runner was configured.` };
    }
    const result = await runMemoryIndexingLoop({ store: ctx.store, modelRunner: ctx.memoryModelRunner, sessionKey: ctx.sessionKey, global: true, threshold: DEFAULT_MEMORY_INDEX_THRESHOLD, limit: DEFAULT_MEMORY_INDEX_BATCH_SIZE, ...(ctx.loopProgressSink ? { progressSink: ctx.loopProgressSink } : {}) });
    return { jobName: this.name, acted: result.processed > 0, details: `Memory indexing processed ${result.processed} message(s), created ${result.created}, updated ${result.updated}, ignored ${result.ignored}.` };
  },
};

// ---------------------------------------------------------------------------
// Compaction policy job
// ---------------------------------------------------------------------------

/** Minimum number of unsummarized user+assistant messages before compaction is considered. */
const MIN_MESSAGES_FOR_COMPACTION = 8;

const runningCompactions = new Set<string>();

const compactionPolicyJob: PostTurnJob = {
  name: "compaction-policy",

  shouldRun(ctx: PostTurnJobContext): boolean {
    if (!ctx.config.compactionEnabled) return false;
    if (ctx.messageCount < MIN_MESSAGES_FOR_COMPACTION) return false;
    return true;
  },

  async run(ctx: PostTurnJobContext): Promise<PostTurnJobResult> {
    if (runningCompactions.has(ctx.sessionKey)) {
      return { jobName: this.name, acted: false, details: "Compaction already running for this session." };
    }
    const prepared = ctx.store.prepareSessionCompaction(ctx.sessionKey, { thresholdTokens: ctx.config.compactionThresholdTokens, retainRecentMessages: 16 });
    if (!prepared) {
      const fallbackEstimate = 1000 + Math.ceil((ctx.messageCount * Math.max(200, ctx.userMessage.length + ctx.assistantMessage.length)) / 4);
      return { jobName: this.name, acted: fallbackEstimate >= ctx.config.compactionThresholdTokens, details: fallbackEstimate >= ctx.config.compactionThresholdTokens ? `Compaction threshold reached, but no compactable persisted event range was available.` : `No compaction needed (threshold: ${ctx.config.compactionThresholdTokens}).` };
    }
    if (!ctx.compactionModelRunner) return { jobName: this.name, acted: true, details: `Compaction threshold reached for ${prepared.eventsToCompact.length} event(s), but no model runner was configured.` };

    runningCompactions.add(ctx.sessionKey);
    try {
      const result = await runSessionCompactionLoop({ store: ctx.store, modelRunner: ctx.compactionModelRunner, target: { sessionKey: ctx.sessionKey, scope: "core" }, thresholdTokens: ctx.config.compactionThresholdTokens, retainRecentMessages: 16, ...(ctx.loopProgressSink ? { progressSink: ctx.loopProgressSink } : {}) });
      return { jobName: this.name, acted: result.compacted, details: result.compacted ? `Compacted ${result.coveredEventCount} event(s) into ${result.summaryEventId}.` : `Compaction did not complete: ${result.reason ?? "unknown"}` };
    } finally {
      runningCompactions.delete(ctx.sessionKey);
    }
  },
};

export function isSessionCompactionRunning(sessionKey: string): boolean { return runningCompactions.has(sessionKey); }

// ---------------------------------------------------------------------------
// Default scheduler
// ---------------------------------------------------------------------------

const DEFAULT_JOBS: readonly PostTurnJob[] = [
  memoryIndexPolicyJob,
  compactionPolicyJob,
];

/**
 * Create the default post-turn job scheduler.
 *
 * The scheduler holds two built-in jobs:
 * 1. `memory-index-policy` — checks unindexed message count; acts when `memoryEnabled`.
 * 2. `compaction-policy` — estimates token usage; acts when `compactionEnabled` and threshold exceeded.
 *
 * Both jobs are no-ops in this slice. They log their decisions and return
 * results without running an actual LLM-powered memory extraction or
 * compaction summarization. The structural seams are ready for future workers.
 */
export function createPostTurnJobScheduler(
  jobs: readonly PostTurnJob[] = DEFAULT_JOBS,
): PostTurnJobScheduler {
  return {
    jobs,

    async runAll(ctx: PostTurnJobContext): Promise<PostTurnJobResult[]> {
      const results: PostTurnJobResult[] = [];

      for (const job of jobs) {
        try {
          if (!job.shouldRun(ctx)) continue;
          const result = await job.run(ctx);
          results.push(result);
        } catch (error) {
          results.push({
            jobName: job.name,
            acted: false,
            details: `Job threw: ${error instanceof Error ? error.message : String(error)}`,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }

      return results;
    },
  };
}
