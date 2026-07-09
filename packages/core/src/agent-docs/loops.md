# Background Loops

This document explains the background loop system: what loops exist, how they work, and how to interact with them.

## What are background loops?

Background loops are reusable processes that run inside the app runtime. They handle maintenance and background work without blocking the chat.

Loops have:

- A **name** and **description** visible in the loop catalog
- A **lifecycle**: prepare → execute → validate → apply → finalize
- **Steps** that emit progress so the UI can show advancement
- A **result** stored as a hidden loop_result event
- Optional **needsAttention** flag if the loop encountered a problem

## Available loops

### session-compaction

- **Trigger**: Automatic when message token count exceeds the threshold (approx. 15,000 tokens)
- **Purpose**: Condenses older conversation into a plain text summary to keep the context window manageable
- **Result**: A summary event is saved; recent messages are retained in the window
- **needsAttention**: True only if compaction failed

### memory-indexing

- **Trigger**: Automatic after the database has at least 50 unindexed visible user/assistant messages across all non-deleted chats
- **Purpose**: Extracts high-signal durable facts from the conversation and stores them as memory items
- **Result**: New memories are created with links between related items
- **needsAttention**: True only if indexing failed

## How loops appear in the UI

- When a loop is running, the chat area shows a compact loop progress widget
- The widget shows: current step / total steps and a status label
- When the loop completes or fails, the widget clears
- Loop events are stored as hidden events — they are not visible chat messages

## Interacting with loops

There are two loop tools:

### loop_read (Safe)

- `loop_read({ action: "list" })` — see all available loops
- `loop_read({ action: "status", runId: "..." })` — check status of a loop run

### loop_write (Internal_mutate)

- `loop_write({ action: "start", loopName: "session-compaction" })` — start a loop manually
- `loop_write({ action: "start", loopName: "session-compaction", input: { force: true } })` — force compaction immediately

## Important rules

- Most loops run automatically. You rarely need to start them manually.
- Compaction runs on its own trigger (token count threshold).
- Memory indexing runs on its own global database trigger (unindexed visible message count).
- Only use loop_write when the user explicitly asks.
- If a loop fails, it sets needsAttention: true and the UI may show an indication.
- Loop results are stored as hidden events — do not treat them as visible chat messages.
- A queued run ID (queued_*) returned by loop_write is valid. Use it with loop_read status and it will resolve to the actual final run.
