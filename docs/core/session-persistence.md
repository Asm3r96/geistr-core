# Session Persistence

Geistr stores local chat/session history in a non-secret SQLite database owned by the desktop app.

## Location

The desktop app creates the database under Electron `userData`:

- `geistr-sessions.sqlite`

This is separate from `geistr-config.json` and from Pi auth storage. API keys and auth tokens must never be written to the session database.

## Schema

The persisted session slice uses the Geistr runtime/memory-compatible tables from the current desktop Geistr schema:

- `session_state` — one row per chat/session, including active transcript, title, status, provider/model metadata, counters, timestamps, and compaction/memory fields.
- `session_transcripts` — transcript epochs for a session. The first slice creates one active epoch (`0`) per chat.
- `session_events` — ordered transcript events. Chat messages are stored as `event_type = "message"` with `role` set to `user`, `assistant`, `system`, or `tool`.
- `memory_items` — durable long-term memories extracted from transcript batches.
- `memory_links` — graph edges between memories (`same_topic`, `related`, `supersedes`).

Message text is stored in `session_events.payload_json.content`. Runtime/UI metadata is stored in `metadata_json`.

The schema includes the following fields reserved for future memory indexing and compaction:

- `session_state.compaction_count` — incremented each time a compaction pass runs.
- `session_state.last_summary_event_id` — points to the `session_events` row containing the latest session summary.
- `session_events.memory_indexed_at` — set when a memory indexing worker processes this event.

Background loop completion also writes hidden/internal `session_events` rows with `event_type = "loop_result"`. These rows are pending same-session wake-up state, not visible chat transcript messages.

## Core seam

`@geistr/core` owns the framework-independent persistence seam in `packages/core/src/session-persistence.ts`:

- `ensureSessionSchema(db)`
- `SessionPersistenceStore`
- `createGeistrSessionKey()`
- `createGeistrTranscriptId()`
- `geistrTurnEventIds()`

The store supports:

- schema creation
- create chat
- list chats from `session_state`
- open chat messages from `session_events`
- append individual message events
- append idempotent user/assistant turns by turn id
- get-or-create current chat for startup
- save/list/acknowledge hidden pending loop results for same-session wake-up
- **`countUnindexedMessages(sessionKey)`** — count unindexed user/assistant events
- **`markEventsIndexed(sessionKey, now)`** — set `memory_indexed_at` on unindexed events
- **`updateSessionCompaction(sessionKey, summaryEventId, now)`** — increment `compaction_count` and set `last_summary_event_id`
- **`getUnsummarizedEventCount(sessionKey)`** — count events since the last summary checkpoint

The core store is testable without Electron. It uses `bun:sqlite` during Bun tests and `better-sqlite3` under Electron/Node.

## Runtime Context Assembly

`packages/core/src/runtime-context.ts` provides a reusable seam for assembling structured prompt context before every model run.

```typescript
import { assembleRuntimeContext } from "@geistr/core";

const context = assembleRuntimeContext({
  sessionKey,
  sessionTitle,
  sessionSummary,          // from last compaction, or null
  recentMessages,          // last N visible messages
  memoryContextItems,      // extracted memory items, or empty
  timezone: "America/New_York",
  localDateTime: "Jul 6, 2026, 9:00 PM",
  isoTimestamp: "2026-07-07T01:00:00.000Z",
  unixTimestamp: 1770858000,
  additionalStableSections,   // rarely change → good for prompt caching
  additionalDynamicSections,  // change every turn
});
```

### Section structure

Sections are split into **stable** (rarely change between turns) and **dynamic** (change every turn) for prompt-cache-friendly assembly:

**Stable sections** (in order):
1. `<identity>` — session title and key
2. Caller-supplied additional stable sections

**Dynamic sections** (in order):
1. `<session_summary>` — compacted summary from prior compaction, if present
2. `<recent_messages>` — recent chat history with `role:` prefixes
3. `<runtime_context>` — local time, timezone, ISO timestamp
4. `<memory_context>` — extracted memory items with `[category]` labels, or a placeholder
5. Caller-supplied additional dynamic sections

## Post-Turn Background Jobs

`packages/core/src/post-turn-jobs.ts` provides a scheduler for invisible post-turn jobs.

After a successful send+persist, the `DesktopRuntimeBridge` schedules two jobs:

### Memory Index Policy (`memory-index-policy`)

- **When it runs**: config `memory.enabled` is `true` and the database has at least 50 unindexed visible user/assistant messages across all non-deleted chats.
- **What it does**: runs the invisible `memory-indexing` loop over the oldest global transcript batch, sending all currently available messages between the 50-message trigger and the 75-message batch cap. It extracts 0-N durable memory candidates, resolves them against existing memories, writes/updates `memory_items` and `memory_links`, then marks exactly the processed message events indexed.
- **Failure behavior**: errors are logged and messages remain unindexed for a later retry.
- **Prompt behavior**: the first extraction LLM receives the full batch context, never per-message save/ignore prompts.

### Compaction Policy (`compaction-policy`)

- **When it runs**: config `sessions.compaction.enabled` is `true` AND the session has at least 8 messages
- **What it does**: prepares unsummarized visible user/assistant events, estimates context tokens, and compares against the `compactionThresholdTokens` (default `15000`)
- **Implemented**: when the threshold is reached and a model runner is supplied, the reusable session compaction loop creates a hidden `summary` event and updates `last_summary_event_id`, `compaction_count`, and `summary_until_event_id`.
- **Reuse**: the same loop is session-management infrastructure for all Geistr-managed chats. Core chat currently passes `scope="core"`; future app agents should pass their own `scope`, `appId`, and `agentId`.

See `docs/loops/session-compaction-loop.md` for the reusable target API and loop shape.

Post-turn job errors are silently logged (console.error) and never surface in the user-facing chat.

## Desktop startup flow

On app ready, `main.ts` creates a `SessionPersistenceStore` at `userData/geistr-sessions.sqlite` and passes it to `DesktopRuntimeBridge`.

The bridge startup flow is:

1. Ensure the session schema exists.
2. Open the most recently updated chat from `session_state`, or create a new chat if none exists.
3. Load that chat's visible message events ordered by transcript sequence.
4. Return the chat list and active messages through `geistr:get-state`.

## Sidebar behavior

The sidebar now uses real `session_state` rows:

- New chat calls `geistr:create-chat` and creates a persisted chat.
- Clicking a chat calls `geistr:open-chat` and loads messages from `session_events`.
- Chat list ordering is `updated_at DESC`.
- Preview is the latest visible user/assistant message event.

## Send behavior

Sending a message:

1. Appends the user message immediately as a `session_events` row so the UI shows it.
2. Runs the Pi-backed core runtime with streaming assistant text.
3. Persists the final assistant response when text is available.
4. Updates `session_state` title, counters, timestamps, provider/model metadata, and run status fields.
5. Post-turn background jobs are scheduled for memory indexing and compaction policy checks.

This slice persists final visible text messages only. Rich tool rendering, artifact previews, and LLM-based memory extraction are deferred. LLM-based session compaction is implemented through the reusable loop runtime.
