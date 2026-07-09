# Memory System

This document explains how the Geistr memory system works: what memory is, how it gets created automatically, and when you should use explicit memory tools.

## Overview

Memory stores durable facts and context about the user and the world. It is separate from:

- **Profile** (identity, behavior, settings — use `profile_write`)
- **Session** (conversation transcript — managed automatically)
- **Session summary** (condensed history from compaction — automatic)

Memory is persisted in SQLite and lives across all sessions.

## Two ways memories are created

### 1. Automatic memory indexing (background)

After the database accumulates at least 50 unindexed visible user/assistant messages across all non-deleted chats, the automatic memory indexing loop runs in the background. It processes the oldest global batch, sending all available messages up to a 75-message cap. It:

1. Reads recent unindexed messages
2. Extracts high-signal context at the conversation level
3. Validates each candidate against the standard: "would a careful human save this as long-term memory?"
4. Creates memory items with type, importance, and tags
5. Links related memories together (up to 5 links per memory)

**You do not control automatic indexing.** It happens on its own. Do not try to trigger it or influence it through chat.

### 2. Explicit memory write (agent or user initiated)

When the user explicitly says something like:

- "Remember that my favorite color is blue"
- "Forget what I told you about X"
- "That memory is wrong, update it"
- "What do you know about X?"

Use the explicit memory tools:

- `memory_write` for create, update, delete, supersede, reinforce
- `memory_read` for search, list recent, get by ID

## When to use memory_write

Only use `memory_write` when the user explicitly asks you to remember, change, or delete something, or when the user's instruction clearly implies durable storage.

**Do not** use `memory_write` for:

- Changing your own name, identity, role, style, or behavior → use `profile_write` on assistantProfile
- Changing the user's display name, locale, or goals → use `profile_write` on userProfile
- Changing app settings like theme or permissions → use `profile_write` on appConfig
- Storing transient conversation context that won't matter next session → let the session handle it
- Screaming out about every minor preference you infer → let the background indexing loop handle automatic extraction
- Attempting to store skill instructions, tool definitions, or system configuration → these belong in files, not memory

## Memory_write actions

| Action | Purpose | When to use |
|--------|---------|-------------|
| `create` | Store a new durable fact | User says "remember X" |
| `update` | Change an existing memory | User says "that's not right, it's actually Y" |
| `delete` | Remove a memory permanently | User says "forget X" or "delete that" |
| `supersede` | Mark old memory as replaced by new | User corrects something you remembered; creates replacement with link to old |
| `reinforce` | Increase strength/importance of a memory | User confirms or repeats a fact |

## Memory_read actions

| Action | Purpose |
|--------|---------|
| `search` | Find memories by text query |
| `list_recent` | List recent active/cold memories |
| `get` | Get a single memory by ID, optionally with linked memories |

## Memory structure

Each memory has:

- **Content**: The stored fact or context
- **Type/category**: Preference, Profile, Goal, Fact, etc.
- **Status**: active, cold, deleted
- **Importance**: relative importance score
- **Stability**: how settled this memory is
- **Strength**: reinforcement count
- **Tags**: optional categorization tags
- **Source**: what session/message created it
- **Links**: up to 5 related memories

## Memory in the runtime prompt

When a session starts, the runtime retrieves relevant memories and injects them into the prompt under "Relevant long-term memory". This happens automatically.

Memory items in the prompt include:

- The category label (Preference, Profile, Goal, Fact)
- The content
- When it was created and last updated

This gives you durable context about the user without needing to search memory at the start of every session. If you need more context on a specific topic, use `memory_read search`.

## Important rules

- Do not silently add memory based only on inference during chat
- The background indexing loop handles automatic extraction — let it do its job
- Profile is source of truth over memory when they conflict
- If the user changes their display name in profile, do not keep an outdated memory about their name
- Supersede is preferred over delete+create for corrections because it preserves the history
- Memory content should be high-signal and human-valuable — the bar is "would a careful human save this?"
