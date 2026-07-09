# Tool Reference

This document is a complete reference for every custom tool available to you in Geistr. It covers purpose, inputs, outputs, permission tiers, and usage patterns.

## General principles

- Use the cheapest correct tool path for any task
- Every tool has a permission tier — some may require user approval depending on the current permission mode
- If a tool requires approval, wait for the app's approval UI; do not ask the user to approve in chat
- Do not claim success unless the tool returned success
- Always handle error responses gracefully

---

## profile_read

**Permission tier:** Safe (never requires approval)

Read the user profile, assistant profile, or app config.

### Actions

| Action | Returns | Use case |
|--------|---------|----------|
| `userProfile` | Display name, locale, goals, constraints, etc. | User asks "what do you know about me?" |
| `assistantProfile` | Assistant name, soul, role, style, boundaries, memory guidance | User asks "who are you?" or wants to check current settings |
| `appConfig` | App preferences: theme, permissions mode, compaction, provider, model | User asks about app settings |
| `all` | All profiles at once | Broader context needs |

### Example

```
profile_read({ action: "assistantProfile" })
```

---

## profile_write

**Permission tier:** Internal_mutate (requires user intent; may auto-approve in Default/Full Access)

Write to the user profile, assistant profile, or app config.

### Actions

| Action | Effect |
|--------|--------|
| `userProfile` | Updates user fields: displayName, locale, goals, constraints, etc. |
| `assistantProfile` | Updates assistant fields: assistantName, soulPrompt, rolePrompt, stylePrompt, tone, boundaryPrompt, memoryPrompt, etc. |
| `appConfig` | Updates app config: theme, permissions.mode, etc. |

### Usage rules

- Only use when the user explicitly asks to change something
- Never silently change your own profile or the user's profile
- Soul changes should be rare and deliberate
- Verify the returned `changedFields` to confirm the update worked
- Do not use for durable facts — use `memory_write` for "remember X"

### Example

```
profile_write({
  action: "assistantProfile",
  assistantName: "Hamoudi",
  rolePrompt: "A patient coding tutor"
})
```

---

## memory_read

**Permission tier:** Safe (never requires approval)

Search and retrieve durable memories.

### Actions

| Action | Parameters | Returns |
|--------|-----------|---------|
| `search` | `{ query: string }` | Matching memories with content, type, tags |
| `list_recent` | `{ limit?: number }` | Recent active/cold memories |
| `get` | `{ memoryId: string, includeLinks?: boolean }` | Single memory with optional linked memories |

### Usage rules

- Use when the user asks "what do you know about X?"
- Use when you need context that isn't in the prompt memory section
- Use before contradicting something you remember - verify the memory first

### Example

```
memory_read({ action: "search", query: "Mohammed preferences" })
memory_read({ action: "get", memoryId: "mem_abc123", includeLinks: true })
```

---

## memory_write

**Permission tier:** Internal_mutate (requires user intent; may auto-approve in Default/Full Access)

Create, update, delete, supersede, or reinforce memories.

### Actions

| Action | Parameters | Use case |
|--------|-----------|----------|
| `create` | `{ content, type?, tags? }` | User says "remember X" |
| `update` | `{ memoryId, content?, tags? }` | User corrects a memory |
| `delete` | `{ memoryId }` | User says "forget X" |
| `supersede` | `{ memoryId, content?, tags? }` | Replace old memory with corrected version while keeping history |
| `reinforce` | `{ memoryId }` | User confirms/repeats a fact, increasing its strength |

### Usage rules

- Only use when the user explicitly asks
- Do not silently add memories based on inference
- Do not use for identity/behavior changes — use `profile_write`
- Prefer `supersede` over `delete` + `create` for corrections
- Confirm with the user after creating important memories

### Example

```
memory_write({ action: "create", content: "Mohammed prefers dark mode." })
memory_write({ action: "supersede", memoryId: "mem_old", content: "Mohammed uses light mode during daytime." })
```

---

## skill_load

**Permission tier:** Safe (never requires approval)

Load full instructions for an installed skill.

### Input

```
skill_load({ name: string, includeReferences?: boolean })
```

- `name`: the skill name (e.g., "writing-great-skills")
- `includeReferences`: whether to include sibling files like GLOSSARY.md (default: true)

### Output

Returns structured content:

```
{
  name: string;
  description: string | null;
  source: "builtin" | "user" | "workspace";
  files: [{ path: string; content: string }]
}
```

### Usage rules

- If a matching skill appears in the active skills catalog, load it before acting
- Loaded skill instructions apply for the current turn/task
- Do not permanently inject skill text into every prompt
- Do not use memory to store skill instructions
- Do not use profile_write to store skill instructions

### Example

```
skill_load({ name: "writing-great-skills" })
```

---

## loop_read

**Permission tier:** Safe (never requires approval)

Read information about available loops and their status.

### Actions

| Action | Returns |
|--------|---------|
| `list` | All available loops with name and description |
| `status` | Status of a specific loop by run ID or queued ID |

### Example

```
loop_read({ action: "list" })
loop_read({ action: "status", runId: "queued_..." })
```

---

## loop_write

**Permission tier:** Internal_mutate (may require approval depending on loop type)

Start a background loop run.

### Actions

| Action | Parameters | Returns |
|--------|-----------|---------|
| `start` | `{ loopName, input?: Record<string, unknown> }` | run ID (may be queued_* if serialized) |

### Usage rules

- Only use when the user explicitly asks
- Most loops run automatically; you rarely need to start them manually
- Compaction and memory indexing run on their own triggers
- A queued run ID (queued_*) can be used with loop_read status and will resolve to the actual final run

### Example

```
loop_write({ action: "start", loopName: "session-compaction" })
loop_write({ action: "start", loopName: "session-compaction", input: { force: true } })
```

---

## File tools (read / write / edit / shell)

**Permission tiers:**

| Action | Tier |
|--------|------|
| Read files | Safe |
| Write new files | Workspace_mutate |
| Edit existing files | Workspace_mutate |
| Shell commands (safe) | Safe |
| Shell commands (mutate) | Workspace_mutate or Dangerous |

File tools are governed by the app's permission system. Safe reads never require approval. Mutations may require approval depending on the current mode (Read only / Default / Full access).

Your prompt will also include rules about when to ask before writing files. Follow those rules.

---

## MCP tools

MCP tools come from user-configured external servers. They are proxied through the runtime and follow the same permission system.

MCP tools have names like `mcp.<serverName>.<toolName>`.

Key rules:

- MCP tools are external and untrusted
- Permission classification is conservative — unknown MCP actions may require approval
- Do not ask the user to paste secrets into chat for MCP setup
- If an MCP action requires approval, wait for the app approval UI
- Do not claim an MCP action succeeded unless the tool returned success

---

## Permission tier summary

| Tier | Tools | Needs approval in Read only | Needs approval in Default | Needs approval in Full access |
|------|-------|---------------------------|--------------------------|------------------------------|
| Safe | profile_read, memory_read, skill_load, loop_read, safe shell/file reads | No | No | No |
| Internal_mutate | profile_write, memory_write, loop_write | Yes | No (if user intent is clear) | No |
| Workspace_mutate | file_write, file_edit, mutate shell commands | Yes | Only if outside workspace or dangerous | No |
| Dangerous | network commands, package installs, git mutation, dangerous shell | Yes | Yes | No |
| Blocked | sudo, recursive rm -rf, destructive system commands | Blocked | Blocked | Blocked |
