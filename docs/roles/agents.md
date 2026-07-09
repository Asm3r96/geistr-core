# Agents

Geistr is an agent-native desktop app. Agents are not a single chat box feature; they are a core app capability used in many places.

## Core Decision

Geistr core must support many agents, not only one foreground coding agent.

Agents may run as:

- the main interactive coding agent
- background runs
- in-app helper agents
- workflow-specific agents
- reviewer/planner/architect agents
- future extension-provided agents

## Pi Package Roles

Geistr should use Pi packages according to their strengths:

- `@earendil-works/pi-ai` provides unified multi-provider model access.
- `@earendil-works/pi-agent-core` provides lower-level agent runtime, tool calling, and state management.
- `@earendil-works/pi-coding-agent` provides higher-level coding-agent behavior, sessions, tools, skills, extensions, context, prompts, settings, and auth.

## Architecture Rule

Agent creation, lifecycle, events, state, and cancellation should be centralized in Geistr core.

Geistr can create many different agents with different configuration, but they must share the same core runtime model.

Different agents may vary by:

- system prompt
- model/provider
- thinking level
- available tools
- available skills
- workspace access
- permissions
- background vs foreground behavior
- app-specific role

But they should not be completely separate implementations.

UI screens and workflows should not each create their own unrelated agent wiring.

Good:

- one core agent runtime layer
- shared agent/session state model
- shared event mapping from Pi events to Geistr UI state
- shared cancellation/abort behavior
- shared background-run management
- shared model/provider handling through Pi AI

Bad:

- every feature manually creates agents differently
- background agents have a different state model than foreground agents
- tool events are parsed differently in different screens
- provider/model logic is duplicated in multiple UI areas

## Foreground vs Background Agents

Foreground agents are user-visible and interactive. They power the main chat/coding experience.

Background agents run tasks without taking over the main UI. They still need visibility, cancellation, logs, and clear status.

Both should use the same core concepts whenever possible.

## Provider Strategy

Because `pi-ai` supports multiple providers, Geistr should not hardcode one model provider into the app architecture.

Model/provider selection should be a core capability that can be reused by:

- main coding sessions
- background runs
- helper agents
- evaluation/reviewer agents
- future extension agents

## Constraint

Start simple. Support one main agent first, but design the core so adding background and in-app agents does not require rewriting the app.

## First Runtime Seam

`@geistr/core` exposes `createCoreAgentRuntime` as the first app-facing wrapper around Pi SDK sessions.

For now, this seam supports one foreground core agent with a small chat-oriented API: send a message, steer, follow up, subscribe to Pi events, abort, dispose, and read a simple snapshot.

Do not bypass this seam from app UI code unless the seam is intentionally changed. Future background agents and specialist app agents should extend the shared runtime model rather than creating unrelated Pi session wiring.
