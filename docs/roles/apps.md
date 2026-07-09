# Apps

Geistr apps are self-contained specialist workspaces inside the main desktop app.

Apps reuse Geistr core systems instead of rebuilding their own foundation.

## Core Decision

Each Geistr app should live in a self-contained folder inside the main app.

Apps may be built-in at first, but the architecture should allow installable third-party or user-created apps later.

Because of this, the app schema must be clear and stable from the beginning.

## App Purpose

A Geistr app represents a focused specialist brain and workspace.

Examples:

- Tutor app / Learning Brain
- Researcher app / Research Brain
- Job app / Career Brain

Each app can have its own:

- app metadata
- app UI/sidebar entries
- app agent profile
- app-specific system prompt parts
- app memory
- app-specific tools
- app-specific skills
- app workflows
- app artifacts/data
- app docs

## Reuse Core Systems

Apps should reuse as much of Geistr core as possible.

Creating an app should be easy because the hard parts already exist in core:

- desktop shell
- left sidebar layout
- chat UI
- preview/artifact UI
- agent runtime
- tool registration model
- skill loading model
- memory system
- provider/model selection
- session/background run concepts

Apps customize the content and behavior, not the whole foundation.

## UI Rule

Apps use the same main Geistr layout as the core app.

The user should clearly know which app they are inside, but the shell remains consistent.

Shared layout:

- left sidebar
- main preview area when open
- chat on the right when preview is open
- chat as main area when preview is closed
- settings accessible from the bottom/sidebar area

The left sidebar can show different elements depending on the active app.

Example: inside Tutor app, the sidebar may show learning topics, lessons, missions, or app-specific navigation.

But preview and chat should remain the same core components.

## Data Location

App-specific data should be saved inside that app's folder or app data area.

An app owns its own local data, memory, artifacts, and configuration.

This keeps apps understandable and portable.

## Memory Rule

The memory system should be defined once in Geistr core and reused automatically by:

- the core personal agent
- each app agent
- background agents

Each app has its own app memory.

Apps must not directly read the core/global user memory.

The core/global memory belongs to the personal brain. App agents may receive selected user profile/context, but they should not get unrestricted access to global memory.

## User Profile Access

App agents may receive relevant user profile information.

This helps app agents adapt to Mohammed's preferences, learning style, language, and goals.

But app agents should not automatically receive the full global memory.

## App Agent Prompt

Each app agent can have a different system prompt and role.

The app agent should share the same Geistr/Pi runtime foundation, but its behavior is shaped by app-specific prompt parts, tools, skills, memory, and permissions.

System prompt structure is defined in `system-prompts.md`.

App prompts should use structured XML-like sections such as `<identity>`, `<mission>`, `<memory_scope>`, `<tools_policy>`, and app-specific sections.

## App Tools and Skills

App-specific tools and skills should live inside the app folder.

Apps receive tools and skills by passing them into the app agent configuration.

An app agent can receive:

- app-specific tools from the app folder
- global/core tools from Geistr core
- app-specific skills from the app folder
- global/core skills from Geistr core

They are available only to agents running inside that app context unless explicitly promoted to core/global.

Apps should still follow the global tool rule:

- max `Domain.read` and `Domain.write` per domain
- avoid extra CRUD tool names
- prefer existing core/file/bash capabilities when enough

## Installable Future

Built-in apps are allowed first.

But future app installation should be possible without rewriting the foundation.

A future app package/folder should be able to declare:

- metadata
- routes/navigation
- sidebar entries
- agent config
- tools
- skills
- memory schema
- artifact types
- settings

## Constraint

Do not let each app become its own separate product architecture.

Apps are specialist modules inside Geistr. They extend the core, but they do not replace it.
