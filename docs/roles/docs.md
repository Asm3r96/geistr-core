# Documentation and Agent-Readable References

Geistr should ship agent-readable documentation with the core app and with each installed app.

Docs are a core part of how agents learn how to work inside Geistr.

## Core Decision

Geistr will include docs folders that agents can read at runtime.

This follows the same useful pattern as Pi: when the user asks for work related to Pi, the agent can read Pi docs from installed files and follow the documented architecture instead of guessing.

Geistr should provide the same experience for Geistr core and app-specific behavior.

## Core Docs

Geistr core should include documentation for important app systems, such as:

- architecture
- app schema
- tools
- skills
- prompts
- memory
- profiles
- settings
- artifacts
- extension/app development
- agent communication/handoffs

These docs should be installed with the app and available locally.

## App Docs

Each app may include its own docs folder.

App docs explain how that app works and how agents should modify or extend it.

Examples:

```txt
apps/tutor/docs/
  README.md
  memory.md
  settings.md
  artifacts.md
  workflows.md
```

The app agent should be able to read these docs when doing app-specific work.

## Installable Apps

When a user installs a Geistr app, its docs should come with it.

The installed app should be self-describing enough that agents can inspect its docs and understand:

- what the app does
- what data it owns
- where its files live
- what tools/skills it exposes
- how to update settings
- how to create or modify artifacts
- how its memory works

## Agent Discovery Rule

Geistr should tell agents where relevant docs live.

Agents should not have to guess paths.

Core agents should know where core docs are.

App agents should know where both relevant core docs and their own app docs are.

## Docs vs Skills

Docs and skills have different jobs.

Docs explain durable systems and reference material.

Skills teach an agent how to perform a workflow or follow a behavior pattern.

Example:

- docs explain where user profile/settings live and their schema
- a `config` skill teaches the agent how to safely update user profile, agent profile, app settings, and related configuration

## Config Skill

Geistr should likely include a core/global config skill.

The config skill can explain:

- where user profile is stored
- where agent profiles are stored
- where app settings are stored
- where skill settings are stored
- how to update these files safely
- when to ask the user before changing something
- how to avoid creating unnecessary tools

This supports the rule that agents can update profile/settings/skills/prompts using existing file or shell capabilities instead of needing special tools.

## Constraint

Keep docs accurate and close to the systems they describe.

If an app's schema or storage changes, update its docs in the same change.
