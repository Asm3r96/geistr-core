# Settings and Provider Authentication

Task 005 adds Geistr's first settings surface and provider authentication foundation.

## Desktop Settings Surface

Settings open from the user card at the bottom of the left sidebar. The settings screen replaces the chat area and uses a Codex-like two-column layout:

- left settings navigation
- right active settings page
- back-to-app action

Initial pages:

- **Theme** — placeholder page. Geistr still follows the system color scheme.
- **Providers** — first real provider setup page.

## Provider Setup Categories

The Providers page is intentionally small and split into two setup categories.

### API Key Providers

API key providers are derived from the Pi-backed model registry options already used by the model picker. Saving a key calls the desktop preload/IPC API, then the main-process `DesktopRuntimeBridge`, then `@geistr/core`'s provider auth layer.

The core auth layer persists keys through Pi `AuthStorage`, so Geistr does not create a parallel secret store in this slice.

### Subscription / Login Providers

Subscription/login providers are listed from Pi `AuthStorage.getOAuthProviders()` plus Geistr-owned built-ins that adapt subscription auth flows Pi does not ship yet. The desktop bridge exposes a Connect action that calls the core provider auth layer.

Current Geistr built-ins:

- `google-oauth` — Google OAuth for the Antigravity/Gemini subscription transport.
- `xai-oauth` — xAI/Grok OAuth for eligible X Premium or SuperGrok accounts. This uses xAI's device-code flow, opens the verification URL in the system browser, and stores the resulting OAuth credential under the separate `xai-oauth` provider id so it does not collide with normal API-key `xai`.

The first UI exposes the seam and status/progress text. Device-code providers show the code/verification URL in the auth notice while polling. Full embedded browser handling and provider-specific polish are later work.

## Core API

`@geistr/core` exposes:

- `createCoreProviderAuthLayer()`
- `listStatuses(providers)`
- `saveApiKey(provider, apiKey)`
- `removeProviderAuth(provider)`
- `listLoginProviders()`
- `loginProvider(provider, callbacks)`

The layer returns auth status without exposing stored secrets.

## Reference Used

The old `denkr-desktop` Antigravity implementation was used as a reference for the shape of provider status, connect actions, provider settings, and OAuth handoff events. Geistr does not copy its server/settings architecture; the first slice stays inside the desktop app bridge and core Pi-backed auth layer.

## Known Constraints

- API key storage relies on Pi `AuthStorage` at the Pi agent auth location.
- The Connect/Login path starts Pi/Geistr OAuth workflows but does not yet provide a complete polished manual-code UI.
- Provider rows are minimal and derived from available Pi registry/auth data, not a Geistr-specific provider catalog.
