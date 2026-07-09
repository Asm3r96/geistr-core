# Agent-facing memory tools

Geistr exposes two safe custom tools for explicit user-directed memory work before the broader permission system lands.

## `memory_read`

Read-only durable memory access.

Actions:

- `search` — query active/cold memories by text.
- `list_recent` — list recent active/cold memories.
- `get` — fetch a memory by ID, optionally including `memory_links`.

Returned memory fields include `id`, `content`, `memoryType`, `category`, `status`, `importance`, `stability`, `currentStrength`, `tags`, timestamps, source session/message IDs, and optional links.

Use when the user asks what Geistr remembers, for example: “what do you remember about TypeScript?”

## `memory_write`

Mutating durable memory access. The assistant should use it only when the user explicitly asks to remember, correct, forget, reinforce, or replace a memory.

Actions:

- `create`
- `update`
- `delete` — soft delete by setting `status = deleted`.
- `supersede` — creates a replacement memory, marks the old memory cold, and links replacement → old with `supersedes`.
- `reinforce` — increments strength/recall metadata.

Safety checks reject unsupported actions, unknown IDs, empty content, invalid memory type/status, secret-looking content, and profile-like edits. Assistant identity, role, soul, style, personality, user profile fields, and app config changes belong in `profile_write`, not memory.

The automatic memory indexing loop remains responsible for inferred extraction. `memory_write` is for explicit user intent only.
