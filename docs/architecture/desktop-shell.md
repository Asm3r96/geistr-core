# Desktop Shell

Task 003 adds the first Electron + React desktop shell for Geistr.

## Shape

The desktop app lives in `apps/desktop` and has three process boundaries:

- Electron main process creates the native window and owns IPC.
- Preload exposes a small `window.geistr` API with context isolation enabled.
- React renderer displays the shell and calls only the preload API.

The renderer must not import Pi SDK packages directly. Agent behavior goes through `@geistr/core` in the main-process `DesktopRuntimeBridge`.

## Current UI

The first shell is intentionally minimal:

- persistent left sidebar with real persisted chat history
- top-level sidebar entries for New chat, Scheduled, and Memory (read-only galaxy graph), plus Skills and MCP Servers deep links into Settings
- main chat panel
- message list loaded from the active persisted chat
- message input
- send button
- runtime status text/indicator
- minimal model and thinking-level selectors in the chat composer

The visual direction follows Mohammed's reference screenshot: dark, calm, desktop-first, with a stable sidebar and a focused chat surface. Artifact preview is not implemented yet; when preview is added later, it should open in the middle and move chat to the right as described in `../roles/design.md`.

## Design Tokens

Renderer styling is centralized in `apps/desktop/src/renderer/styles.css` through semantic CSS custom properties. Raw color values belong in the `:root` dark theme and the `prefers-color-scheme: light` override, not in component rules. Component styles should consume semantic tokens such as `--app-bg`, `--surface-sidebar`, `--text-primary`, `--border-default`, `--field-bg`, `--radius-*`, `--space-*`, and `--font-*`.

The Electron window chrome uses `apps/desktop/src/main/desktop-window-theme.ts` for the native background and title-bar overlay colors so main-process chrome stays aligned with renderer tokens without scattering raw values through `main.ts`.

## App Config Storage

Durable user preferences live in a local JSON file at Electron's `userData/geistr-config.json`. The storage layer is in `apps/desktop/src/main/app-config-storage.ts`:

- `getAppConfigPath()` — resolves the full filesystem path.
- `readAppConfig()` — reads, JSON-parses, and sanitizes the file; returns defaults on error.
- `writeAppConfig(config)` — writes a sanitized config to disk.

Model favorites (starred models) are persisted to config `model.favoriteModels` so they survive app restarts.

## Session Database

Local chat/session history is stored in Electron `userData/geistr-sessions.sqlite`. The desktop main process owns this SQLite file through `@geistr/core`'s `SessionPersistenceStore`; the renderer only receives chat state over IPC. The database is non-secret and stores messages, session titles, counters, provider/model ids, and runtime metadata. Provider API keys and auth tokens remain in Pi auth storage.

## Theme Application

The renderer applies the `appearance.themeMode` from config via a `data-geistr-theme-mode` attribute on `<html>`:

- `"system"` — attribute is removed, letting the CSS `@media (prefers-color-scheme: light)` query control tokens.
- `"dark"` — attribute set to `"dark"`, the `:root` dark tokens apply unconditionally.
- `"light"` — attribute set to `"light"`, the `[data-geistr-theme-mode="light"]` selector applies light tokens.

The media query in `styles.css` uses `:root:not([data-geistr-theme-mode])` to avoid conflicting with explicit attribute-driven themes.

The main-process window chrome (`desktop-window-theme.ts`) is wired to the persisted theme config. On Windows, `BrowserWindow.setTitleBarOverlay()` updates the native title-bar overlay color and symbol color when `appearance.themeMode` changes. In System mode, Electron's `nativeTheme.updated` event reapplies the matching light/dark chrome.

## IPC Channels

| Channel | Direction | Payload | Description |
|---|---|---|---|
| `geistr:get-state` | Renderer → Main | — | Returns full chat state (messages, model, status, providers). |
| `geistr:get-skills-state` | Renderer → Main | — | Returns built-in/user skill summaries and the user skills directory. |
| `geistr:get-skill-details` | Renderer → Main | `name: string` | Loads a skill's `SKILL.md` for read-only display in the Skills screen. |
| `geistr:open-path` | Renderer → Main | `path: string` | Opens a local folder/path with the OS shell; used by user skill rows. |
| `geistr:send-message` | Renderer → Main | `string` | Persists a user message, runs the runtime, persists assistant text when available, and returns updated state. Runtime/provider failures are normalized into structured chat errors, with raw details kept for logs/debug details. |
| `geistr:retry-last-message` | Renderer → Main | — | Reruns the latest user message without appending a duplicate user bubble; used by the provider error card retry action. |
| `geistr:stop-run` | Renderer → Main | — | Aborts the active foreground runtime run, disposes that Pi session to stop in-flight model/tool work, clears the streaming UI, and creates a fresh runtime on the next turn. |
| `geistr:create-chat` | Renderer → Main | — | Creates a new persisted chat and makes it active. |
| `geistr:open-chat` | Renderer → Main | `sessionKey: string` | Opens an existing persisted chat and loads its messages. |
| `geistr:select-model` | Renderer → Main | `DesktopModelSelection` | Changes {provider, modelId, thinkingLevel}. |
| `geistr:save-provider-api-key` | Renderer → Main | `provider, apiKey` | Saves API key via Pi AuthStorage. |
| `geistr:connect-login-provider` | Renderer → Main | `provider` | Starts OAuth login for a subscription provider. |
| `geistr:get-app-config` | Renderer → Main | — | Returns the full `AppConfig`. |
| `geistr:update-app-config` | Renderer → Main | `AppConfigUpdate` | Deep-merges a partial config update, persists, returns the new config. MCP server management currently persists through this config path. |
| `geistr:state-changed` | Main → Renderer | `DesktopChatState` | Pushed when the runtime state changes (streaming, messages, model, providers). |

Foreground agent turns now keep visible persisted messages separate from ephemeral run UI state. During a run, the bridge publishes `runUi` with a stable run id, elapsed timer, compact progress items, tool summaries, current status label, and streamed final text. Text the assistant streams before it starts or continues tool work is treated as working narration: when a tool event arrives, any already-streamed draft text is moved into `progressItems` and cleared from the final-answer buffer. The renderer displays everything as one `RunTranscriptBlock`: each active run opens its work details by default, while running it shows `Working for Ns`, subtle status/progress rows, compact collapsed-style tool rows, and any current final-answer text as it streams; when finished it shows `Worked for Ns`, collapses work details by default, and keeps the final assistant answer below. Only the final assistant message is appended to `session_events`; thinking/progress/tool rows and timers remain runtime/UI-only and are not reloaded as chat history.

Model selection flows from the renderer to the bridge and then through `@geistr/core`; the renderer does not talk to Pi's model registry directly.

Settings now open from the sidebar user card. Provider setup actions also flow through preload/IPC to `DesktopRuntimeBridge`, which delegates API key and login work to the core Pi-backed provider auth layer.

The sidebar intentionally hides Search until a real app-wide search system exists. Scheduled remains a clean app-level placeholder page with no fake controls. Memory loads the persisted memory graph via `getMemoryGraph` / `geistr:get-memory-graph` and renders a read-only 3D galaxy (see `../core/memory-galaxy.md`). Skills and MCP Servers are sidebar deep links into Settings: Skills opens a first-pass overview screen that lists built-in and installed skills as simple name/description cards with a gear menu for activate/deactivate and user-skill deletion; MCP Servers opens a first-pass management screen for adding STDIO or Streamable HTTP server configs and toggling/deleting configured servers.

Chat history rows show only the session title. Each row has a three-dot menu for renaming or deleting the session. Deleting is a soft delete: the session and event rows remain for referential safety, but the session is marked deleted, hidden from the chat list, and message/summary content is scrubbed from persisted event payloads.

## Startup Flow

On app ready, `main.ts` reads the persisted app config via `readAppConfig()` and calls `bridge.setAppConfig(config)` before any IPC handler runs. It also creates a `SessionPersistenceStore` at `userData/geistr-sessions.sqlite`, ensures the session schema, and opens the most recently updated chat or creates the first persisted chat when the database is empty.

The main process resolves the desktop window theme from `appearance.themeMode` and Electron's `nativeTheme.shouldUseDarkColors` for System mode. The bridge stores the config and, on first `getRuntime()`, extracts `model.defaultProvider`, `model.defaultModelId`, and `model.defaultThinkingLevel`. It validates these against the currently configured provider models via the core provider layer. If valid and configured, the default is passed as `modelSelection` to `createCoreAgentRuntime()`. If the saved default is invalid or the provider is disconnected, the session starts without a pre-selected model.

## Commands

From the repo root:

```sh
bun run --filter '*' test
bun run --filter '*' typecheck
```

From `apps/desktop`:

```sh
bun run dev
bun run build
bun run package:dir
```

`bun run dev` starts the Vite renderer server, builds Electron main/preload code, and launches the desktop app. Use `bun run dev:renderer` only when you intentionally want the browser renderer server without Electron.

Local installers and unpacked builds use electron-builder; see `../release/desktop-packaging.md`.
