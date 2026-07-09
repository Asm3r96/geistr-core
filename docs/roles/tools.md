# Tools

Geistr should have the smallest useful tool surface possible.

## Core Decision

Keep tools minimal. Prefer a few powerful domain tools over many narrow CRUD tools.

Pi already provides a minimal coding-agent tool set, and Geistr should respect that direction. The agent can already use terminal/file operations for many tasks, so do not create extra tools unless they provide real app-level value.

## Tool Naming Rule

For any Geistr domain tool, there may be at most two operations:

- `Domain.read`
- `Domain.write`

Do not create separate tool names for create/update/delete/list/get/etc.

Bad:

- `Profile.create`
- `Profile.update`
- `Profile.delete`
- `Profile.get`
- `Config.set`
- `Config.remove`

Good:

- `Profile.read`
- `Profile.write`
- `Config.read`
- `Config.write`

## Read vs Write

### `Domain.read`

Use only for reading information.

It may support different read actions or filters through parameters, but it must not mutate state.

Examples:

- read current config
- read user profile
- read app state
- list available items
- inspect metadata

### `Domain.write`

Use for all mutations.

Write tools may create, update, or delete by accepting an `action` parameter.

Examples:

```json
{
  "action": "create",
  "data": {}
}
```

```json
{
  "action": "update",
  "id": "...",
  "patch": {}
}
```

```json
{
  "action": "delete",
  "id": "..."
}
```

The action belongs in parameters, not in the tool name.

## Smart Tool Rule

Prefer smart tools that cover a whole domain with a small interface.

A smart tool can do many related things through structured parameters while keeping the visible tool list small.

The goal is:

- minimal tool names
- broad capability
- predictable mental model
- less duplicated tool wiring
- easier permissions and UI display

## When Not to Create a Tool

Do not create a tool if the agent can already do the task clearly with existing capabilities such as:

- terminal commands
- file read/write/edit
- project scripts
- creating or editing skills/prompts/config files

Examples that usually do not need custom tools:

- updating config files if they are normal files
- creating project files
- creating skills
- updating skills
- updating system prompt files
- updating user profile files
- reading or editing SQLite-backed data when normal commands/libraries are enough
- running scripts
- reading logs from the filesystem

## When to Create a Tool

Create a Geistr tool only when it provides app-level value that normal shell/filesystem tools do not provide well.

Good reasons:

- access to internal app state not represented as files
- safer structured mutation of important app data
- integration with Geistr UI or runtime
- permissioned access to private app concepts
- background-run/session control
- cross-platform behavior that should not depend on shell commands

## Tool Scope

Geistr has two tool scopes:

1. Global/core tools
2. App-specific tools

### Global/Core Tools

Global tools are registered by Geistr core and may be available to any agent in the app, depending on permissions/configuration.

Examples:

- bash/terminal tools
- file read/write/edit tools
- load skill tools
- shared session tools
- shared app/runtime tools

These tools represent capabilities that are part of the whole Geistr agent platform.

### App-Specific Tools

If a tool exists only for one specific Geistr app, workflow, or app module, define it inside that app's files.

App-specific tools should only be available to agents running inside that app context.

They should not be registered globally unless they become a true shared core capability.

Good:

- a notes app defines `Notes.read` and `Notes.write` inside the notes app
- a memory app defines `Memory.read` and `Memory.write` inside the memory app
- a project app defines project-specific tools inside the project app

Bad:

- registering every app tool globally
- letting unrelated agents see tools for apps they are not using
- putting app-specific behavior in Geistr core just because it is a tool

## Registration Rule

Core registers core/global tools.

Apps register their own app tools.

Agents receive tools based on their role, permissions, and active app context.

This keeps the core small while still allowing each app to provide rich agent capabilities.

## Permission Rule

A smaller tool surface makes permissions easier.

Because `Domain.write` can mutate state, it should be treated as the permission boundary for that domain.

If a domain has both read and write tools:

- `Domain.read` can be allowed more freely
- `Domain.write` should be shown, approved, logged, or restricted depending on risk

## Constraint

Never add tool names casually. Before adding a tool, ask:

1. Can bash/file tools already do this?
2. Is this really app-level behavior?
3. Can it fit into an existing domain's `read` or `write` tool?
4. If this is a new domain, can it be represented with only `Domain.read` and `Domain.write`?

If the answer is no, do not add the tool.
