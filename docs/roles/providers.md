# Providers and Models

Geistr should use Pi's AI/model provider layer instead of rebuilding model integration from scratch.

## Core Decision

Use `@earendil-works/pi-ai` as the foundation for model and provider access.

Pi AI already supports many providers, so Geistr should not create a separate provider abstraction unless there is a clear product need that Pi AI cannot cover.

## Provider Types

Geistr should support different provider access styles through the Pi model/provider system:

- API key providers
- OAuth/subscription providers
- local model providers when available
- future provider integrations

Some providers may work through direct API keys. Others may work through user subscriptions or account-based auth.

## Future Provider Additions

If a provider is missing, prefer extending or adapting the Pi provider system rather than creating a parallel Geistr-only model layer.

Example future provider:

- Antigravity subscription/provider support

The rule is to keep model/provider behavior centralized and reusable by all agents.

## Core Provider Layer

Geistr core exposes provider/model selection as a thin wrapper over Pi's `ModelRegistry` and Pi AI model metadata. The wrapper may shape data for Geistr UI, but it must not maintain a separate provider catalog.

The core selection object is provider-flexible:

- `provider`
- `modelId`
- optional `thinkingLevel`

The runtime resolves this object through Pi before creating or updating an agent session.

## Model Selection UI

Inside chat and agent configuration surfaces, Geistr should provide a model picker.

The picker should allow the user to choose:

- provider
- model
- thinking level when supported
- possibly profile/default model settings later

The UI can be a dropdown, popover, or command-style picker. The first desktop shell uses simple dropdowns in the chat header.

## Agent Relationship

All agent types should use the same provider/model foundation:

- core personal agent
- specialist app agents
- background agents
- reviewer/planner/helper agents
- extension-provided agents

Different agents may use different model configs, but they should all go through the same Geistr core model/provider layer backed by Pi AI.

## Thinking Levels

Where supported, thinking level should be part of the agent/model config.

The user should be able to see and change thinking level from relevant UI surfaces.

Examples:

- off
- minimal
- low
- medium
- high
- extra/highest levels if supported by Pi/model config

## Constraint

Do not hardcode Geistr around one provider.

Geistr should remain provider-flexible from the beginning because different agents and tasks may need different models.

Geistr-specific persistence for a default model should be added only after the app settings location is explicit; until then, rely on the runtime/Pi behavior and document the limitation.

## Provider Authentication

Geistr's first provider authentication seam is `createCoreProviderAuthLayer()` in `@geistr/core`. It wraps Pi `AuthStorage` for API key credentials and Pi OAuth login providers. UI surfaces must call this through app/runtime bridges; they must not create their own secret storage or provider catalog.

The desktop Providers settings page currently derives API key provider rows from Pi model registry providers and derives login provider rows from Pi OAuth providers. This is enough for the first setup surface while keeping provider/auth ownership in Pi-backed core code.
