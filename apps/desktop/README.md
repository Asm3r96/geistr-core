# Geistr Desktop

First Electron + React desktop shell for Geistr.

The renderer talks to the agent through the preload `window.geistr` API. The Electron main process owns the `DesktopRuntimeBridge`, which uses `@geistr/core` and keeps Pi SDK wiring out of UI code.

Run the app from this folder with:

```sh
bun run dev
```

See `../../docs/architecture/desktop-shell.md` for shell behavior and boundaries.

Local packaging: `bun run package:dir` (unpacked) or `bun run package` (installer). Details in `../../docs/release/desktop-packaging.md`.
