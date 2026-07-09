# Artifacts and Preview

Geistr should include artifact viewing and interaction as a core capability from the beginning.

Agents are not only for chat. They should create useful files, documents, HTML, visual outputs, and app artifacts that the user can open directly inside Geistr.

## Core Decision

Geistr needs a built-in browser/webview/preview surface for viewing artifacts and files created by agents.

The user should not need to leave the app just to inspect an HTML file, generated document, or visual artifact.

## What the Preview Should Support

The preview system should support opening and displaying:

- HTML files
- generated artifacts
- local files when safe
- app-created documents
- visual outputs
- future app-specific artifact types

HTML artifacts are especially important. Geistr should be able to open and run HTML files directly inside the app.

## Built-In Artifact Design System

Geistr should provide a core design system and reusable components for artifacts.

The agent should not have to write a full custom HTML/CSS application every time it creates an artifact.

Instead, agents should be able to reuse Geistr-provided artifact primitives, such as:

- layout components
- cards
- typography
- buttons
- tables
- forms
- callouts
- navigation primitives
- theme variables
- interactive patterns

This helps agents create better artifacts with less code and more consistency.

## Agent Artifact Rule

When creating artifacts, agents should prefer reusable Geistr artifact components and design tokens over hand-writing large one-off HTML/CSS files.

One-off HTML is allowed when needed, but the long-term direction is a shared artifact component system.

## Selection Feedback Flow

The user must be able to select text inside an opened preview/artifact and send feedback to the agent.

When the user selects text, Geistr should show an inline popup/input near the selection, similar to the Codex-style design that will be referenced later.

The user can type a comment and send it.

The app should send the agent a structured message containing:

- selected quotation/text
- user comment
- file path or artifact id
- selection location/range when available
- artifact/app context
- relevant metadata

The agent receives this feedback inside the chat/session and can respond or modify the artifact.

## Example Flow

1. Agent creates an HTML lesson artifact.
2. User opens it inside Geistr preview.
3. User selects a paragraph.
4. A small popup input appears.
5. User writes: "Make this simpler."
6. Geistr sends the selected quote, file metadata, and comment to the agent.
7. Agent updates the artifact or explains the change.

## Preview and Agent Relationship

The preview is not just a passive viewer. It is part of the agent workflow.

The preview should help the user review, annotate, and guide generated work.

This means preview events can become structured agent messages.

## Security and Safety

Because HTML can execute scripts, the preview system must be designed carefully.

Rules to consider:

- isolate artifact execution where possible
- avoid giving arbitrary HTML direct access to Geistr internals
- expose controlled bridge APIs only when needed
- distinguish trusted Geistr artifact components from arbitrary generated HTML
- preserve local-first ownership while keeping the app safe

## Future Integration

Mohammed may provide open-source projects to evaluate for browser/webview/artifact preview integration.

Those projects should be treated as references or components to integrate only if they fit Geistr's architecture.

Do not let a preview library dictate the whole app architecture.
