# Pi SDK Foundation

Geistr uses the Pi SDK as its foundation.

## Core Decision

Pi SDK is the agent/runtime layer for Geistr. Geistr should not rebuild agent infrastructure that Pi already provides.

## What Geistr Reuses from Pi

- Agent sessions and streaming events.
- Tool execution and tool visibility.
- Skills and skill discovery.
- Steering and follow-up behavior.
- Model/auth/settings management where appropriate.
- Prompt templates and context files where useful.
- Extension concepts for adding capabilities without changing the app core.

## Architecture Rule

Geistr should be a desktop product layer around Pi, not a replacement for Pi.

Pi owns:

- agent lifecycle
- tool calling
- skills
- prompts/templates
- context loading
- session behavior
- model/auth integration

Geistr owns:

- desktop UI
- app-specific workflows
- workspace/project UX
- visualization of messages, tool calls, sessions, and state
- Geistr-specific extensions and product decisions

## Extensions

Geistr can reuse the Pi extension idea to keep the app flexible.

Extensions should be used for capabilities that can be added or removed cleanly, such as:

- custom tools
- commands
- event listeners
- integrations
- workflow helpers
- project-specific behavior

The core app should stay small. If a feature is optional, experimental, or integration-specific, prefer making it an extension instead of hardcoding it into the core.

## Constraint

Do not create a second plugin/extension system unless Pi's extension system cannot support the needed behavior.
