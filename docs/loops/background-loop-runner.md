# Background Loop Runner

The background loop runner starts approved catalog loops asynchronously and reports completion back to the same session without adding visible chat messages.

## Core seam

`@geistr/core` exports `BackgroundLoopRunner`.

It implements the catalog runner interface used by `loop_read` / `loop_write`:

- `start(input)` — returns a queued run ID immediately.
- `cancel(runId)`
- `status(runId)` — accepts either the queued ID returned by `start` or the actual loop runtime ID after the loop begins/completes.

Callers provide:

- a `LoopCatalog`
- a `SessionPersistenceStore`
- optional `ArtifactStore`
- per-loop starter functions
- optional progress/completion callbacks

## Desktop integration

The desktop bridge creates:

- `FilesystemArtifactStore` under `runtime-artifacts/`
- `LoopCatalog`
- `BackgroundLoopRunner`
- `loop_read` and `loop_write` tool definitions

Loop progress events continue to flow to the existing top-of-chat loop progress widget. They are not written as visible chat messages.

## Same-session wake-up

When a background loop completes or fails, the runner writes a hidden `session_events` row. Successful no-op loops, such as session compaction when there is nothing to compact, are saved as `status: "completed"` with `needsAttention: false` and the loop's actual summary (for example, `No compaction needed`). Real failures are saved as `status: "failed"` with `needsAttention: true`.

- `event_type = "loop_result"`
- payload: `runId`, `loopId`, `status`, `summary`, `artifactIds`, `completedAt`, `needsAttention`
- metadata: `hidden: true`, `internal: true`, `source: "loop_runner"`, `pending: true`, `sessionKey`, `transcriptId`

Visible chat loading ignores these internal events.

Background completion emits state but does not refresh/dispose the foreground Pi runtime, so an active assistant/tool-call turn is not interrupted. Before the next normal user turn creates a fresh agent runtime, the desktop bridge reads recent pending loop results and adds a small `<pending_loop_results>` section to the runtime prompt. It includes an explicit instruction that these are completed background loop results for the same session and are the source of truth when the user asks whether a background loop finished. It includes summaries and artifact IDs only, never full artifact text. After the assistant has a chance to respond, consumed pending loop results are acknowledged.
