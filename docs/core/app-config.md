# App Config

Geistr stores durable user preferences and app configuration in a local JSON file. This document explains where the config lives, what it contains, what the agent or user may edit, and how the system reads and writes it.

## Config File Location

The desktop app stores the config file in Electron's standard `userData` directory:

| Platform | Path |
|---|---|
| macOS   | `~/Library/Application Support/Geistr/geistr-config.json` |
| Windows | `%APPDATA%/Geistr/geistr-config.json` |
| Linux   | `~/.config/Geistr/geistr-config.json` |

The file is plain JSON and can be read or edited with any text editor while the app is not running. The app reads the file on start and saves on preference changes.

## Config Schema

```jsonc
{
  "version": 1,

  "appearance": {
    // How the colour scheme is chosen. One of: "system", "dark", "light".
    "themeMode": "system",

    // Theme preset identifier. Only "geistr-default" exists in the first slice.
    "themeId": "geistr-default"
  },

  "model": {
    // Default / fallback provider (null = not set). Used only when no chat selection has been made.
    "defaultProvider": null,

    // Default / fallback model ID (null = not set).
    "defaultModelId": null,

    // Default / fallback thinking level (null = let the model decide).
    "defaultThinkingLevel": null,

    // Last explicitly chosen model from the chat composer picker. Takes precedence on startup.
    "lastUsedProvider": null,
    "lastUsedModelId": null,
    "lastUsedThinkingLevel": null,

    // Model keys ("provider/modelId") the user has starred as favourites.
    "favoriteModels": []
  },

  "sessions": {
    "compaction": {
      // Whether Geistr should compact long sessions to save tokens.
      "enabled": true
    }
  },

  "memory": {
    // Whether cross-session memory is enabled.
    "enabled": false
  }
}
```

## What the Agent May Edit

The agent may read the config file and explain its settings to the user. When asked, the agent may also propose or make changes through the app's existing IPC/preload API. The agent should **not** write to the config file directly with filesystem tools — it should use the public API methods:

- `getAppConfig()` — returns the full current config.
- `updateAppConfig(partial)` — merges a partial update and persists it.

The config file is also safe to hand-edit when the app is not running. If a field is missing or invalid, the app fills in defaults when it next reads the file.

## Security

The config file is **not** a secret store. API keys, auth tokens, and credentials live in Pi `AuthStorage`. The config only holds UI and experience preferences.

## Architecture

### Core (`@geistr/core`)

- **`packages/core/src/app-config.ts`** — defines the config types, defaults (`DEFAULT_APP_CONFIG`), version constant (`APP_CONFIG_VERSION`), `sanitizeAppConfig()` for defence in depth, and `mergeAppConfig()` for partial updates.
- The core module is framework-agnostic and reusable by any Geistr app (desktop, future server, etc.).

### Desktop storage (`apps/desktop/src/main/app-config-storage.ts`)

- **`getAppConfigPath()`** — resolves the file path inside Electron's `userData` directory.
- **`readAppConfig()`** — reads and sanitizes the JSON file; returns defaults if the file is missing or corrupt.
- **`writeAppConfig(config)`** — atomically writes the config to disk.

### IPC

| Channel | Direction | Payload |
|---|---|---|
| `geistr:get-app-config` | Renderer → Main | (none) |
| `geistr:update-app-config` | Renderer → Main | Partial `AppConfigUpdate` object |

The IPC handlers live in `apps/desktop/src/main/main.ts`. The prelayer in `apps/desktop/src/preload/preload.ts` exposes `window.geistr.getAppConfig()` and `window.geistr.updateAppConfig()`.

### Renderer

The Settings → Theme page reads the config and renders three radio buttons for System / Light / Dark. Changing the theme mode calls `updateAppConfig()` with the new `appearance.themeMode`. A React effect sets `data-geistr-theme-mode` on `<html>`, which the CSS uses to apply dark or light tokens.

The Settings → Model page allows the user to pick a default/fallback provider, model, and thinking level from the currently connected providers and their available models. The selection is saved to `model.defaultProvider`, `model.defaultModelId`, and `model.defaultThinkingLevel` in the config.

The chat composer ModelPicker saves its choice to `model.lastUsed*` fields. These take precedence over the explicit defaults when the runtime is created (on startup or after provider changes). The defaults only apply when `lastUsed*` is absent or invalid (e.g. provider no longer configured).

The Settings → General page provides foundation toggles for `sessions.compaction.enabled` and `memory.enabled`. Both toggle switches persist their state to the config immediately, even though the underlying systems are not yet implemented.

Model favorites (starred models in the composer picker) are persisted to config `model.favoriteModels` via a `useEffect` that syncs the renderer-local set with the config on each change.

All settings components live in `apps/desktop/src/renderer/settings/`:
- `ThemeSettings.tsx`
- `ProvidersSettings.tsx`
- `ModelSettings.tsx`
- `GeneralSettings.tsx`

## Theme Modes

| `themeMode` | CSS behaviour |
|---|---|
| `"system"` | No `data-geistr-theme-mode` attribute set. The existing `@media (prefers-color-scheme: light)` query in `styles.css` controls light/dark tokens. |
| `"dark"` | `data-geistr-theme-mode="dark"` is set on `<html>`. The `:root` (dark) tokens apply; the media-query light override is suppressed via `:root:not([data-geistr-theme-mode])`. |
| `"light"` | `data-geistr-theme-mode="light"` is set on `<html>`. The `[data-geistr-theme-mode="light"]` selector applies the same light tokens as the media query. |

The desktop window chrome (native title-bar colour and Windows title-bar overlay symbols) follows the persisted theme mode. The main process reads config on startup and updates existing windows when `appearance.themeMode` changes.

## Desktop Bridge Config Flow

The main process reads the app config during startup via `readAppConfig()` and passes it to `DesktopRuntimeBridge.setAppConfig()` before any IPC call arrives. The bridge resolves the initial model selection preferring `lastUsed*` (set by chat picker selections) over `default*` (set in Settings → Model), validating against currently configured providers:

1. If a valid last-used (or falling back to default) is found (provider+model exist and provider configured), it is passed as `modelSelection` to `createCoreAgentRuntime()`.
2. If neither is present/valid, the runtime starts without a pre-selected model — the user picks one from the composer picker, which is then saved as last-used and sticks across reloads.

This flow lives in `apps/desktop/src/main/runtime-bridge.ts` (`resolveDefaultModelSelection()`).

## Future Extensions

- **Custom themes** — the `themeId` field and `appearance` section are designed to support future token-based user/agent-customized themes.
- **Memory** — the `memory.enabled` toggle exists in the General settings page. The memory system itself is a future slice.
- **Sessions compaction** — the `sessions.compaction.enabled` toggle exists in the General settings page. The compaction system itself is a future slice.
- **Migrations** — if the schema needs to change, increment `APP_CONFIG_VERSION` and add a migration step in `sanitizeAppConfig()`.
