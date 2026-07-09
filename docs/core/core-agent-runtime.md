# Core Agent Runtime

Task 002 adds the first Geistr runtime seam in `@geistr/core`.

## Public API

```ts
import { createCoreAgentRuntime } from "@geistr/core";

const runtime = await createCoreAgentRuntime({
  cwd: workspacePath,
  prompt: {
    stableSections: [
      { tag: "identity", content: "You are Geistr's core personal agent." }
    ],
    dynamicSections: [
      { tag: "tools_policy", content: "Use only configured tools." }
    ]
  },
  tools: ["read", "bash"],
  modelSelection: {
    provider: "anthropic",
    modelId: "claude-test",
    thinkingLevel: "high"
  }
});
```

The returned runtime is intentionally small and suitable for a future desktop chat surface:

- `sessionId`
- `systemPrompt`
- `getSnapshot()`
- `getModelSelectionState()`
- `selectModel(selection)`
- `sendMessage(text)`
- `steer(text)`
- `followUp(text)`
- `subscribe(listener)`
- `abort()`
- `dispose()`

## Pi SDK Relationship

The runtime uses Pi SDK primitives instead of implementing agent infrastructure itself:

- `DefaultResourceLoader` supplies the assembled system prompt.
- `createAgentSession` creates the Pi `AgentSession`.
- `SessionManager.inMemory` is used for this first seam to avoid designing persistence too early.
- Pi session events are passed through to subscribers for now.
- Provider/model selection is resolved through Pi's `ModelRegistry` and Pi AI model metadata.

Geistr owns the app-facing wrapper and prompt assembly. Pi owns agent lifecycle, prompting, streaming, tools, model/auth behavior, and session internals.

## Prompt Behavior

`createCoreAgentRuntime` reuses `assembleSystemPrompt` from `@geistr/core`.

Stable sections render before dynamic sections. The assembled prompt is passed to Pi via `systemPromptOverride`, and appended system prompt fragments are disabled for this first controlled core-agent seam.

## Current Constraints

This seam does not yet include:

- persistent session storage
- persistent Geistr-owned model preference storage
- memory
- specialist app routing
- normalized UI event mapping
- Electron or React integration

Those concerns should be added in later vertical slices without widening this API prematurely.
