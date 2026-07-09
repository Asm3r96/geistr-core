# Session and Compaction

This document explains how sessions work, what compaction is, and how it affects your context window.

## Sessions

A session is a conversation transcript. It persists in SQLite under the user data directory.

Key facts about sessions:

- Every chat you have belongs to a session
- Sessions persist across app restarts
- Sessions have a unique key and are listed in the sidebar
- The runtime loads the most recent messages into your context window
- Sessions store: messages, profile snapshots, compaction summaries, and metadata events

## The context window limit

Your context window has a practical limit. As a session grows longer, the runtime needs to keep your context manageable. It does this through compaction.

## Compaction

Compaction is an automatic background loop that:

1. Triggers when the estimated token count of visible messages reaches the threshold (default: approximately 15,000 tokens)
2. Condenses the older portion of the conversation into a plain text summary
3. Saves the summary as a hidden event in the session
4. Retains only the most recent visible messages in the window
5. The summary plus recent messages become the ongoing context

### What compaction means for you

After compaction, your context will contain:

- The session summary (condensed history)
- Recent raw visible messages
- Profile data
- Relevant memories

The session summary is a continuity device. It tells you what happened earlier in the conversation so you don't lose context. But it is:

- **A summary, not a transcript** — details may be compressed or omitted
- **Potentially stale** — profile changes that happened after the summary was written may not be reflected in it
- **Not authoritative over profile** — if the summary says something that conflicts with the current profile, the profile wins

### Manual compaction

The user can also manually trigger compaction with:

- `/compact` — suggests a compact action
- `/compact!` — forces immediate compaction

These are user-initiated. You do not need to suggest or manage them.

### Your role in compaction

- You do not need to think about or manage compaction
- Compaction is an invisible system process
- If the user asks about compaction, you can explain it using this document
- If you notice context gaps from compaction, acknowledge them naturally

## Session summary vs memory

| Aspect | Session Summary | Memory |
|--------|----------------|--------|
| Scope | Current conversation only | Cross-session durable facts |
| Created by | Compaction loop (automatic) | Indexing loop (automatic) or explicit memory_write |
| Purpose | Continuity within a session | Long-term context across sessions |
| Stale risk | Yes, not updated until next compaction | Updated by indexing or explicit write |
| Conflict with profile | Profile wins | Profile wins |

## Multiple sessions

Users can have multiple sessions. Each session has its own transcript and compaction state. When switching sessions:

- The new session's context is loaded from scratch
- Session summaries from other sessions are not mixed in
- Memories are shared across all sessions

If the user asks about something from another session, use `memory_read` to find relevant memories, or ask the user for context.
