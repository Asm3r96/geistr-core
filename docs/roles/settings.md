# Settings

Geistr needs a first-class settings surface from the beginning because providers, auth, config, theme, and future app/user preferences must be understandable and editable.

## Entry Point

Settings should open from the user card/menu in the left sidebar.

Clicking the user card can show a small menu. For now, that menu should include Settings.

## Layout

Settings should use a Codex-like desktop settings layout:

- left settings navigation column
- right active settings page/content area
- back-to-app action at the top
- clean dark modern UI consistent with the main shell

Initial settings pages:

- Theme — placeholder/dummy page for now
- Providers — real first settings page for provider setup

## Providers Page

The Providers page should support two provider setup categories:

1. Subscription/login providers
2. API key providers

### API Key Providers

For API key providers, the user should be able to:

- choose the provider
- enter an API key
- save it securely through the app/runtime layer
- see configured/unconfigured status

Use Pi auth/model registry behavior where possible. Do not create a parallel auth system unless Pi cannot support the needed provider.

### Subscription/Login Providers

For subscription/login providers, the user should be able to:

- choose the provider
- click Connect/Login
- run the provider login workflow inside or launched from Geistr
- return to Geistr with the provider configured
- disconnect when needed later

This should follow Pi's provider auth workflow where possible, adapted for the desktop app.

## Antigravity Reference

The current `denkr-desktop` app has Antigravity auth/provider code that can be used as a reference.

Relevant areas include:

- `apps/server/src/provider/geminiAntigravity.ts`
- `apps/server/src/provider/geminiAntigravityTransport.ts`
- `apps/server/src/ws.ts` provider connect/disconnect handlers
- `apps/web/src/components/settings/SettingsPanels.tsx`
- `apps/web/src/components/settings/ProviderSettingsForm.tsx`
- `apps/web/src/components/settings/AddProviderInstanceDialog.tsx`
- `packages/contracts/src/settings.ts`
- `packages/contracts/src/server.ts`

Use the ideas, not the whole old architecture.

## Constraint

Settings should be built as Geistr core/app UI, not copied wholesale from denkr-desktop.

Keep the first slice small: settings shell, dummy Theme page, Providers page, API key path, and subscription/login path shape.

## Task 005 Implementation

The first settings screen lives in the desktop renderer and opens from the sidebar user card. Provider auth behavior is not implemented in the renderer directly; it uses preload/IPC and `DesktopRuntimeBridge`.

API keys are saved through `@geistr/core`'s Pi-backed provider auth layer, which uses Pi `AuthStorage`. Subscription/login providers are listed from Pi OAuth providers and connected through the same core auth layer. The initial UI is deliberately minimal and may show progress text rather than a polished login wizard.
