# Geistr Core Docs

Documentation for the reusable Geistr Core desktop AI app foundation.

## Start here

| Doc | Description |
|---|---|
| [`../README.md`](../README.md) | Public overview, stack, architecture, features, and extension points |
| [`../AGENTS.md`](../AGENTS.md) | Agent working rules and project conventions |
| [`roles/README.md`](roles/README.md) | Durable role docs for architecture and implementation decisions |

## Architecture

| Doc | Description |
|---|---|
| [`architecture/architecture.md`](architecture/architecture.md) | High-level architecture: core agent foundation, desktop app, local-first design |
| [`architecture/workspace-scaffold.md`](architecture/workspace-scaffold.md) | Repository layout, workspaces, and build tooling |
| [`architecture/desktop-shell.md`](architecture/desktop-shell.md) | Electron + React shell, IPC channels, startup flow, theme, settings |

## Core package — `@geistr/core`

| Doc | Description |
|---|---|
| [`core/core-agent-runtime.md`](core/core-agent-runtime.md) | `createCoreAgentRuntime()` public API, Pi SDK relationship, prompt behavior |
| [`core/system-prompt-assembly.md`](core/system-prompt-assembly.md) | System prompt section structure, stable vs dynamic sections |
| [`core/session-persistence.md`](core/session-persistence.md) | SQLite session schema, `SessionPersistenceStore`, runtime context assembly, post-turn jobs |
| [`core/agent-profile.md`](core/agent-profile.md) | Assistant/user/profile config, defaults, tools, IPC, runtime prompt assembly |
| [`core/provider-model-selection.md`](core/provider-model-selection.md) | Provider and model selection layer, thinking levels |
| [`core/provider-error-handling.md`](core/provider-error-handling.md) | Error classification, user-facing vs technical details, retry UX |
| [`core/settings-provider-auth.md`](core/settings-provider-auth.md) | Provider authentication: API keys, OAuth, login flow |
| [`core/app-config.md`](core/app-config.md) | App configuration storage and schema |
| [`core/tool-permissions.md`](core/tool-permissions.md) | Permission modes, risk tiers, approval flow |
| [`core/web-tools.md`](core/web-tools.md) | Built-in web search/fetch tools, Exa MCP adapter, config, error handling |
| [`core/memory-galaxy.md`](core/memory-galaxy.md) | Desktop Memory Galaxy read-only visualization API and UI |

## Loops and background workflows

| Doc | Description |
|---|---|
| [`loops/loop-runtime.md`](loops/loop-runtime.md) | Reusable generic loop runtime foundation |
| [`loops/loop-catalog.md`](loops/loop-catalog.md) | Agent-callable loop catalog and `loop_read` / `loop_write` tools |
| [`loops/background-loop-runner.md`](loops/background-loop-runner.md) | Background loop execution and same-session wake-up |
| [`loops/artifact-store.md`](loops/artifact-store.md) | Artifact/temp file store with TTL |
| [`loops/session-compaction-loop.md`](loops/session-compaction-loop.md) | First real loop: invisible session compaction |
| [`loops/memory-tools.md`](loops/memory-tools.md) | Memory read/write tools for the agent |

## Skills and MCP

| Doc | Description |
|---|---|
| [`skills-mcp/skills.md`](skills-mcp/skills.md) | Skill catalog, `skill_load`, built-in skills, installed skills |
| [`skills-mcp/mcp-servers.md`](skills-mcp/mcp-servers.md) | MCP server management: STDIO, Streamable HTTP, tool exposure, permissions |

## Role docs

| Doc | Description |
|---|---|
| [`roles/design.md`](roles/design.md) | Design system, tokens, theme architecture |
| [`roles/code-quality.md`](roles/code-quality.md) | Code quality standards and file-size guard |
| [`roles/development-workflow.md`](roles/development-workflow.md) | Development workflow and validation expectations |
| [`roles/core.md`](roles/core.md) | Core package architecture rules |
| [`roles/apps.md`](roles/apps.md) | Desktop app architecture rules |
| [`roles/agents.md`](roles/agents.md) | Agent responsibilities and runtime boundaries |
| [`roles/docs.md`](roles/docs.md) | Documentation conventions |
| [`roles/loops.md`](roles/loops.md) | Loop system architecture rules |
| [`roles/providers.md`](roles/providers.md) | Provider integration rules |
| [`roles/settings.md`](roles/settings.md) | Settings system rules |
| [`roles/skills.md`](roles/skills.md) | Skill system rules |
| [`roles/tools.md`](roles/tools.md) | Tool system rules |
| [`roles/system-prompts.md`](roles/system-prompts.md) | System prompt rules |
| [`roles/pi-sdk.md`](roles/pi-sdk.md) | Pi SDK abstraction rules |
| [`roles/artifacts.md`](roles/artifacts.md) | Artifact system rules |

## Flows and release

| Doc | Description |
|---|---|
| [`flows/message-lifecycle.md`](flows/message-lifecycle.md) | Critical message, attachment, and run-finalization flows |
| [`release/desktop-packaging.md`](release/desktop-packaging.md) | Local electron-builder packaging commands and outputs |
