# Session Compaction Loop

Geistr session compaction is the first real workflow built on the reusable `@geistr/core` loop runtime.

## Reusable target

The loop is not specific to the core secretary chat. Callers pass a `SessionCompactionTarget`:

- `sessionKey`
- `transcriptId?`
- `scope` (`"core"`, `"app-agent"`, or another string)
- `appId?`
- `agentId?`

The core chat wires this with `scope: "core"`. Future app agents should call the same loop with `scope: "app-agent"`, `appId`, and `agentId`.

## Loop shape

1. `prepare_context` reads session events through `SessionPersistenceStore`, selects only unsummarized visible user/assistant messages, excludes summary/internal events, and retains recent messages.
2. `compact_room` runs a single-request LLM summarizer with only prepared artifacts. The model is asked for continuity summary text only; deterministic metadata is derived in code.
3. The validator checks non-empty summary text, target size, and no visible chat formatting. If a model returns JSON anyway, the loop can read `summary`, but JSON is not required.
4. `save_summary` inserts a hidden `session_events` summary row and updates transcript/session checkpoints.
5. `finalizer` returns compaction metrics.

## Persistence

Summary events use `event_type='summary'`, are hidden from chat, and store scope metadata (`scope`, `appId`, `agentId`, `sessionKey`, `transcriptId`) so summaries do not mix across Geistr-managed agent sessions.

The next runtime prompt reads the latest session summary and recent visible messages before each model run.

## Session-management behavior

Compaction is part of session management, not a one-off core-chat feature. The post-turn scheduler can run it for any Geistr-managed session using the same `SessionPersistenceStore` contract. Core chat is the first integration; future app-agent chats should pass their own target metadata.

The visible transcript remains intact in SQLite. The runtime prompt uses the latest hidden summary plus recent raw visible messages, so the agent gets both long-range continuity and immediate conversational context.

## Manual test command

For development/testing, the desktop bridge keeps a manual command:

- `/compact` — uses the normal threshold.
- `/compact!` — force-runs compaction with a tiny threshold and retains only one recent message.

Manual compaction logs progress to the Electron main-process console and does not insert visible test/status messages into the chat.
