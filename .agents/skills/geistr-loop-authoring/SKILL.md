---
name: geistr-loop-authoring
description: Geistr loop authoring. Use when designing, implementing, reviewing, or debugging a Geistr loop workflow, including background loops, session-management loops, validators, loop artifacts, loop UI progress, or loop runtime changes.
---

# Geistr Loop Authoring

Use this skill to author a **tight loop**: a bounded workflow whose process is predictable, validated, and reusable.

## Steps

1. **Load the loop map.** Read `README.md`, `docs/roles/loops.md`, `docs/loops/loop-runtime.md`, and any domain doc for the loop. If the loop touches sessions, also read `docs/core/session-persistence.md` and `docs/loops/session-compaction-loop.md`. Completion: you can state the target domain, side effects, and caller.
2. **Place the seam.** Keep generic behavior in `packages/core/src/loops/`; put workflow behavior in a loop definition, handlers, validators, and docs. Completion: every planned runtime change is either clearly generic or moved out of the runtime.
3. **Design the artifact path.** Name the explicit artifacts each node accepts and produces. Completion: no LLM node depends on implicit prior context.
4. **Prefer deterministic code.** Use code for IDs, timestamps, scopes, counters, coverage, persistence metadata, thresholds, and safety checks. Completion: the model only produces content that needs judgment.
5. **Validate before side effects.** Add deterministic validation and bounded retry with feedback for correctable failures. Completion: durable writes can happen only after accepted artifacts exist.
6. **Keep the transcript clean.** Background/internal loops publish progress events or hidden/internal records; they do not write visible chat status messages unless explicitly requested. Completion: user-facing messages and internal loop telemetry are separate.
7. **Test the loop seam.** Cover no-op path, happy path, validation failure, retry feedback, side effects after validation, metadata isolation, and context cleanup. Completion: tests would fail for the main bug classes listed in the checklist.
8. **Document and hand off.** Update canonical docs and run validation. Completion: the next agent can continue from repo docs without conversation history.

## Defaults

Recommended node shape:

`prepare_* (code)` → `*_room or *_draft (llm)` → validator/gate → `save_* (side_effect)` → `finalizer`

Do not force JSON unless structured model choices are truly needed. Prefer plain reports/summaries plus deterministic metadata filled in code.

For detailed rules and gotchas, read [`REFERENCE.md`](REFERENCE.md) when implementing or reviewing the loop.
