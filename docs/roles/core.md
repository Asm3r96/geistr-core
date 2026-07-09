# Geistr Core

Geistr must define every important reusable part of the app inside its own core layer.

## Core Decision

Important app concepts should be implemented once in Geistr core, then reused everywhere.

We should not rewrite agent logic, tool handling, session behavior, UI primitives, or app patterns in multiple places.

## Why

Geistr should feel understandable and consistent. Repeating the same logic in different screens or workflows makes the app harder to change and easier to break.

The core layer exists so the app has one source of truth for important behavior.

## What Belongs in Core

Core should own reusable Geistr-level abstractions for:

- agent orchestration
- Pi SDK session integration
- tool display and tool state mapping
- session management wrappers
- workspace/project state
- app navigation state
- shared UI components
- shared commands/actions
- shared event handling
- app settings and preferences

## Pi SDK Relationship

Geistr core should reuse Pi SDK instead of rebuilding it.

For example:

- Use Pi session management where it already fits.
- Use Pi agent/session events as the source of truth for agent state.
- Use Pi tools, skills, steering, prompt templates, and context loading instead of recreating those systems.
- Use Pi AI/model packages where appropriate instead of creating a separate model layer.

Geistr core can wrap Pi SDK with app-specific interfaces when that makes the rest of the app simpler.

## Rule

Screens and features should depend on Geistr core APIs, not directly duplicate Pi SDK wiring.

Good:

- one `agent-runtime` layer creates and manages Pi sessions
- UI screens subscribe to normalized Geistr session state
- tool call rendering uses shared components
- session switching uses one shared service

Bad:

- each screen creates Pi sessions differently
- each feature parses tool events separately
- each UI area has its own session state model
- duplicated tool rendering logic

## Constraint

Do not over-abstract before there is a real use case. Core should be shared because it removes duplication and clarifies ownership, not because we are guessing future needs.
