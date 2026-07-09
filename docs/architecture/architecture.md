# Geistr Architecture

Geistr is a private AI working space built around a core personal agent and focused specialist apps.

It is not primarily a coding app. Agents may write code when creating artifacts, automations, or app-specific outputs, but coding is not the main product purpose.

## High-Level Idea

Geistr is organized around one core personal brain and many smaller specialist app brains.

The core agent acts like Mohammed's personal secretary, partner, and orchestrator.

The specialist apps act like focused employees. Each app has its own purpose, memory, tools, skills, and background agents.

The user can speak to the core agent naturally, and the core agent can decide whether to:

- answer directly
- use its own tools and skills
- route work to a specialist app agent
- ask an app agent to run a background task
- receive a handoff/result from that app agent
- summarize the result back to the user

Example:

> "I want to learn about LLMs, especially how to train them."

The core agent can understand this as a learning goal, send a task to the Tutor app, let the Tutor app agent work in the background, then receive a handoff message when the Tutor app has created a learning plan, lessons, or artifacts.

## Product Identity

Geistr is:

- local-first/private by default
- personal and memory-aware
- app-based, not just chat-based
- agent-native
- extensible by design
- built on Pi SDK foundations

Geistr is not:

- only a coding assistant
- just another chatbot
- a clone of T3Code or Codex
- a giant monolithic app where every feature is hardcoded into one agent

## Core Agent / Personal Brain

The core agent is the central personal agent.

It should know the user across all apps through selected profile and memory context.

It can use:

- user profile
- global user memory
- core/global tools
- core/global skills
- communication channels to app agents
- app summaries and handoff messages

The core agent should feel like a trusted secretary or partner:

- understands who the user is
- understands how the user talks
- understands goals, interests, and preferences
- knows what specialist apps exist
- can delegate work to the right app
- can receive results and explain what happened

## User Profile and Global Memory

Geistr has a personal layer that knows the user across apps.

This may include:

- who the user is
- how the user talks
- how the user learns
- goals and interests
- general preferences
- cross-app memory
- long-term context
- shared preferences
- relevant personal insights

Global memory should not become an uncontrolled dump. Specialist agents should not write directly into the global personal brain.

## Memory Broker and Agent Communication Layer

Geistr needs a communication layer between the core agent and specialist app agents.

This layer routes:

- agent requests
- background tasks
- responses
- handoff messages
- memory proposals

Specialist app agents should not write directly into the big global brain.

Instead, they send structured messages or memory proposals to the broker/core layer. The core/broker decides what should stay local to the app and what should become global memory.

This protects the user's global memory from noise while still allowing useful cross-app learning.

## Apps and Specialist App Brains

Geistr apps are self-contained specialist workspaces inside the main app. Built-in apps come first, but the schema should support installable apps later.

Each app reuses the Geistr core shell, chat, preview, memory system, and agent runtime. The app customizes its sidebar content, agent prompt, tools, skills, memory, workflows, and artifacts.

Each focused app can have its own specialist brain.

Examples:

- Tutor app / Learning Brain
- Job app / Career Brain
- Researcher app / Research Brain

Each app can own:

- app memory
- app-specific tools
- app-specific skills
- app-specific agents
- app workflows
- app artifacts

The app brain is specialized. It should know its domain deeply, but it does not need full access to everything unless the core agent or permissions allow it.

## Background Work and Handoffs

Specialist app agents can run in the background.

The flow should be:

1. User tells the core agent what they want.
2. Core agent chooses a specialist app/agent when needed.
3. Core agent sends a structured task through the communication layer.
4. Specialist app agent works in the background.
5. Specialist app agent creates or updates app artifacts/memory.
6. Specialist app agent sends a handoff message back.
7. Core agent explains the result to the user.

The user should not need to manually manage every app agent. The core agent should coordinate work like a secretary assigning work to employees.

## Local-First Ownership

Messages, memory, files, and artifacts should stay on the user's computer or user-owned storage by default.

Geistr may use remote model APIs today and stronger local models later, but the app architecture should not require giving up ownership of the user's workspace.

## Main Desktop Layout

Geistr uses a clean desktop shell with a persistent collapsible left sidebar.

When no preview is open, the main area is the chat/session view. When a preview or artifact is open, the preview appears in the middle and chat moves to the right. The preview can also open in full-view mode.

The top area must respect native desktop window controls: macOS controls on the left and Windows controls on the right.

## Artifacts and Built-In Preview

Geistr should include a built-in preview surface for files and artifacts created by agents.

The user should be able to open generated HTML, documents, and visual artifacts inside the desktop app.

The preview should support selecting text and sending a quoted comment back to the agent with file/artifact metadata. This makes artifact review part of the agent conversation instead of a separate workflow.

Geistr should also provide reusable artifact design components so agents can create useful outputs without rewriting full HTML/CSS from scratch every time.

## Extensible by Design

New focused apps should be addable later without rebuilding the foundation.

A new app can provide:

- its own UI
- its own app memory
- its own tools
- its own skills
- its own agents
- its own workflows

The core should discover or register the app and allow the core agent to route work to it through the shared communication layer.

## Settings and Provider Authentication

Geistr should include a settings surface opened from the user card/menu in the sidebar.

Settings use a Codex-like two-column layout: settings navigation on the left and active settings content on the right. Initial pages are Theme and Providers.

Providers must support both API key setup and subscription/login setup. Use Pi auth/model registry behavior where possible, and use the existing denkr-desktop Antigravity auth implementation as a reference without copying its whole architecture.

## Providers and Models

Geistr uses `@earendil-works/pi-ai` for model and provider access.

The app should not hardcode one provider. Different agents can use different models, providers, and thinking levels, but all should go through the same core model/provider layer.

The chat UI should include a model picker/dropdown or popover where the user can choose provider, model, and thinking level.

## Dynamic System Prompts

Geistr treats system prompts as structured runtime configuration.

Prompts should be assembled from clear XML-like sections such as `<identity>`, `<memory_scope>`, `<tools_policy>`, and app-specific sections. Sections can be injected or removed depending on agent role, active app, selected skills, tools, memory scope, and task context.

Geistr should follow Pi's session/prompt management patterns and preserve provider-side prompt caching as much as possible.

## Agent-Readable Docs

Geistr core and each installed app should include local docs folders that agents can read.

These docs let agents understand Geistr systems, app schemas, settings, memory, tools, skills, artifacts, and extension points without guessing. This follows the same pattern as Pi's local docs.

Docs are reference material; skills are workflow instructions. Geistr can use both.

## Relationship to Pi SDK

Pi SDK is the foundation for the agent runtime.

Geistr should reuse Pi concepts for:

- agent sessions
- tools
- skills
- extensions
- steering/follow-up
- model/provider access
- settings/auth where appropriate

Geistr adds the product architecture on top:

- core personal brain
- specialist app brains
- app memory boundaries
- agent communication and handoffs
- local-first personal workspace UX

## First Architecture Target

Start simple:

- one desktop app
- one core agent
- one or two example specialist apps
- one communication/handoff path
- simple local memory/profile files
- Pi SDK integration through Geistr core

Do not build the full platform first. Build a working slice that proves the secretary-to-specialist-agent model.
