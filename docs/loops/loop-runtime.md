# Loop Runtime

`@geistr/core` now includes a reusable loop runtime foundation under `packages/core/src/loops/`.

The generic runtime is workflow-agnostic. Session compaction is now implemented as a separate reusable loop definition on top of this runtime; compaction-specific behavior does not live in the runtime itself.

## Purpose

A loop is a bounded workflow made from explicit nodes, artifacts, validation, retries, steering, persistence, and progress events. Use it when a task needs more supervision than one open-ended chat turn.

## Public API

Core exports:

- `LoopRuntime` — creates and runs loop runs.
- `LoopRegistry` — registers loop definitions, deterministic handlers, and validators.
- `InMemoryLoopStateStore` — test/development state store.
- loop types such as `LoopDefinition`, `LoopNodeDefinition`, `LoopRunState`, `LoopModelRunner`, and `LoopEvent`.

The runtime depends on interfaces only. It has no Electron or React dependency and does not directly depend on Pi session APIs.

## Node kinds

The type model reserves these node kinds:

- `code`
- `llm`
- `room`
- `gate`
- `evaluator`
- `approval`
- `wait`
- `side_effect`
- `finalizer`

Day-one execution supports deterministic handler-backed `code`, `gate`, `room`, `side_effect`, and `finalizer` nodes, plus fake/testable `llm` nodes through `LoopModelRunner`. Unsupported node kinds fail safely with a clear runtime error.

## LLM modes

LLM nodes support:

- `single_request` — one model request and one structured result.
- `agent_session` — a controlled agent session through the same `LoopModelRunner` interface.

Loop definitions can provide model selection, timeout, instruction, input artifact selectors, output contracts, tool policy, retry policy, and steering rules.

## Context cleanup

The runtime never injects all previous state into an LLM node. Each LLM node receives only artifacts selected by `inputArtifacts`.

After a node completes, accepted artifacts are stored in `run.artifacts`. The next node must explicitly select the artifacts it needs. This prevents prior tool logs, research trails, stale reports, and unrelated artifacts from leaking into later prompts.

## Retry and recovery

Each node can set `retryPolicy.maxAttempts`; otherwise the runtime falls back to loop budgets or the default of three attempts. Exhaustion fails the run by default or routes to `needs_attention` when configured.

The type model includes a future `previous` transition target, but day-one runtime behavior focuses on retrying the current node and safe terminal states.

## Steering

Steering rules are first-class in node definitions. The initial implementation records and publishes steering events for testable trigger hooks. Desktop/Pi wiring can later connect live agent evidence to `LoopModelRunner.steer()`.

## Progress events

The runtime publishes generic events suitable for a future desktop background widget:

- `loop.started`
- `loop.node.started`
- `loop.node.completed`
- `loop.node.failed`
- `loop.retrying`
- `loop.steered`
- `loop.needs_attention`
- `loop.completed`
- `loop.failed`
- `loop.cancelled`

Events include loop label, run id, status, current node label, step index, total steps, attempt, timestamp, and summary text.

The desktop app now exposes the latest loop progress through `DesktopChatState.loopProgress` and renders a small top-of-chat widget while a loop is running. Manual and automatic compaction publish the same generic progress events; the widget stays separate from the visible chat transcript.

## Persistence

`LoopStateStore` is the persistence seam. `InMemoryLoopStateStore` is included for deterministic tests. SQLite persistence can be added later without changing loop definitions.

## Agent-callable catalog

Approved background loops are exposed through `LoopCatalog` and the `loop_read` / `loop_write` tools. Agents cannot pass arbitrary loop definitions or prompts; they can only list, inspect, start, cancel, or check status for catalog entries available to their scope. See `docs/loops/loop-catalog.md`.

## Background wake-up and artifacts

The desktop bridge now runs catalog starts through `BackgroundLoopRunner`. Completion writes hidden `loop_result` session events with small summaries and artifact IDs. The next runtime prompt includes a compact pending results section and never injects long artifact content automatically. See `docs/loops/background-loop-runner.md` and `docs/loops/artifact-store.md`.
