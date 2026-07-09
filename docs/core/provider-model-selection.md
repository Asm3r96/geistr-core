# Provider and Model Selection

Task 004 adds the first Geistr provider/model selection seam.

## Core API

`@geistr/core` exposes a small provider layer backed by Pi's model registry:

- `createCoreProviderLayer()`
- `listModelOptions({ configuredOnly? })`
- `resolveModelSelection(selection)`
- `CoreModelSelection` with `provider`, `modelId`, and optional `thinkingLevel`

The layer uses Pi SDK / Pi AI primitives:

- `ModelRegistry` from `@earendil-works/pi-coding-agent`
- model metadata and thinking-level helpers from `@earendil-works/pi-ai`

Geistr does not define its own parallel provider catalog. Provider IDs, model IDs, configured auth status, and thinking support come from Pi's registry. When a subscription transport is not available in Pi yet, Geistr registers it into Pi's `ModelRegistry` as a small adapter module so downstream runtime code still resolves it through the same provider layer.

## Runtime Selection

`createCoreAgentRuntime` now accepts:

```ts
modelSelection: {
  provider: "anthropic",
  modelId: "claude-test",
  thinkingLevel: "high"
}
```

The runtime resolves that selection through the provider layer before creating the Pi session and passes the resolved Pi model and clamped thinking level into `createAgentSession`.

The runtime also exposes:

- `getModelSelectionState()` — returns current selection plus listable model options.
- `selectModel(selection)` — resolves a selection and calls the underlying Pi session model/thinking setters when available.

## Desktop UI

The desktop shell composer includes minimal controls:

- model dropdown
- thinking-level dropdown when the selected model exposes thinking levels

The model dropdown only shows models whose provider is currently configured/connected according to provider auth status. Visible model options are grouped under small provider headings so a connected provider's models stay together. Unconfigured providers remain available in Settings for connection/API-key setup, but their models are hidden from the chat picker until connected.

Each visible model has a star action. Starred models also appear in a Favorites group at the top of the picker for quick switching while still remaining visible under their provider group. Favorites are currently renderer-local UI state and are not persisted across app restarts.

The controls call the preload/IPC bridge and the main process delegates to `DesktopRuntimeBridge`, which uses the core runtime API. The renderer does not import Pi SDK packages directly.

## Persistence

Model selection is persisted in the app config (`geistr-config.json`):

- `model.lastUsedProvider` / `lastUsedModelId` / `lastUsedThinkingLevel` — set whenever the user chooses a model or thinking level from the chat composer ModelPicker. These are the "sticky" values used after reloads.
- `model.defaultProvider` / `defaultModelId` / `defaultThinkingLevel` — set from Settings → Model. These serve only as fallbacks when no last-used selection exists (or is invalid).

On startup / runtime creation, `DesktopRuntimeBridge.resolveDefaultModelSelection()` prefers a valid last-used selection, then falls back to the explicit default, then no pre-selection. Both are validated against currently configured providers.

Selecting a model in the composer ModelPicker now persists the choice (as last-used) and the selection survives app restarts. The explicit default is only used when the user has not yet made a chat picker choice. After-run runtime refreshes and explicit `selectModel` calls carry the active selection forward within a session.

## Geistr-Registered Subscription Providers

- `google-oauth` registers the Antigravity/Gemini OAuth transport separately from normal Google API-key models.
- `xai-oauth` registers xAI/Grok OAuth separately from normal API-key `xai`. It uses the Grok subscription proxy base URL (`https://cli-chat-proxy.grok.com/v1`), the OpenAI Responses API shape, and a static fallback Grok model list based on the OpenClaw xAI provider reference.

Both are still resolved through Pi `ModelRegistry` and Pi stream APIs; the separate provider IDs prevent OAuth credentials from being interpreted as standard API keys for the built-in providers.

## Constraints

- No parallel Geistr provider catalog.
- Provider-specific subscription adapters should stay small and be removed or simplified when Pi ships equivalent native support.
