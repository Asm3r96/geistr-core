# Geistr Loop Authoring Reference

## Runtime vs Definition

Runtime owns generic lifecycle: progress events, node status, transitions, retry mechanics, context cleanup, artifact passing, model runner interface, steering hooks, and persistence seams.

Loop definitions own workflow details: nodes, labels, goals, prompts, selected artifacts, model/tool policy, validation criteria, side effects, and final result shape.

Do not add compaction-, memory-, research-, or app-specific logic to `packages/core/src/loops/runtime.ts` unless the behavior is reusable by unrelated loops.

## LLM Contracts

Avoid asking models for deterministic metadata. Code should fill:

- event IDs
- timestamps
- sequence numbers
- scopes/app IDs/agent IDs
- retained/covered IDs
- counters
- persistence metadata
- threshold decisions

Good pattern:

1. model returns the content requiring judgment, such as a summary, report, extraction, or plan
2. validator checks non-empty, size, safety, and domain constraints
3. code derives metadata from prepared artifacts

Bad pattern:

1. model returns strict JSON containing IDs the code already knows
2. useful content fails because formatting was imperfect
3. saved output accidentally includes wrapper/prompt/event text

JSON can be accepted as an optional compatibility path, but should not be the only valid output unless the structure is genuinely the model's job.

## Artifact Discipline

Every LLM node must declare `inputArtifacts`. Pass only what it needs.

Useful artifacts:

- `prepared` — normalized deterministic input
- `target` — session/app/user scope
- `domainInstructions` — optional caller-specific instructions
- `validatorFeedback` — concise retry feedback
- `accepted*` — validated model output
- `saveResult` — side-effect result IDs

Do not pass full run state, old tool logs, failed drafts, hidden prompts, or unrelated artifacts to later LLM nodes.

For retries, preserve validator feedback artifacts and retry with clean context plus that feedback.

## Session-Management Loops

Session-management loops must be reusable across core chat and future app-agent chats. Use target metadata:

- `sessionKey`
- optional `transcriptId`
- `scope` such as `core` or `app-agent`
- optional `appId`
- optional `agentId`

Do not delete visible chat history from SQLite just because it was summarized. Compaction changes runtime context, not the durable transcript.

The next runtime context should combine:

- latest hidden summary/artifact for long-range continuity
- recent raw visible messages for immediate continuity

## Progress UI

Background loops should publish generic loop events. Desktop can render these as a small widget with loop label, current step, total steps, node label, and status.

Invisible maintenance loops should not insert visible chat messages for progress, success, or failure. Use progress events, console logs, hidden/internal persistence, or future notifications.

## Streaming Extraction Gotcha

When using Pi runtime events for single-request loop output, collect only actual assistant text deltas.

Safe pattern:

- `assistantMessageEvent.type === "text_delta" && typeof delta === "string"`
- or top-level `type === "text_delta" && typeof delta === "string"`

Unsafe fallback:

- arbitrary `text`, `content`, or serialized event fields from any runtime event

The unsafe fallback can capture prompt artifacts, wrapper JSON, debug payloads, or duplicated event text.

## Validation Checklist

Tests should prove the important failure modes:

- no-op/threshold path avoids unnecessary model calls
- happy path returns expected final result
- validator rejects empty/unsafe/oversized output
- correctable validation failure retries with feedback
- side effects happen only after validation
- scope metadata stays isolated across core/app-agent targets
- LLM context cleanup passes only selected artifacts
- hidden/internal outputs do not pollute visible chat
- progress events expose loop label, node label, step index, and total steps when UI depends on them

## Docs and Validation

For meaningful loop work, update:

- loop-specific doc under `docs/loops/` or the relevant feature docs area
- `docs/loops/loop-runtime.md` only for generic runtime changes
- relevant `docs/roles/*.md` for durable rules
- `README.md` when the public feature surface changes

Run the normal validation set unless the user explicitly narrows scope:

```bash
bun run check:file-size
bun test
bun run typecheck
cd apps/desktop && bun run test
cd apps/desktop && bun run build
```
