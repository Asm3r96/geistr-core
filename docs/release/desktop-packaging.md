# Desktop app packaging (local)

Geistr Core ships a local packaging flow and a GitHub Actions release workflow using [electron-builder](https://www.electron.build/).

## Prerequisites

- [Bun](https://bun.sh/) (repo package manager)
- Dependencies installed at the repo root: `bun install`
- A successful production build of the desktop app (packaging scripts run `build` automatically)

Platform tooling (only when building installers on that OS):

- **Windows**: NSIS is bundled with electron-builder for Windows targets.
- **macOS**: DMG targets are built on macOS; cross-compiling mac installers from other OSes is not part of this milestone.

## What gets packaged

Packaging uses the existing production artifacts under `apps/desktop/`:

| Artifact | Role |
|---|---|
| `dist/main/main.js` | Electron main process entry (`package.json` `main`) |
| `dist/preload/preload.js` | Preload script (IPC bridge) |
| `dist/renderer/` | Vite-built React UI (`index.html` + assets) |
| `resources/` | App icons and static assets referenced from main |

The main bundle is produced by Vite SSR and already includes `@geistr/core` and Pi integration code compiled for Node/Electron. The packaged app does not run the monorepo TypeScript sources directly.

## Commands

From the repo root:

```bash
# Unpacked app folder (fastest sanity check)
bun run package:desktop:dir

# OS-specific installer (NSIS on Windows, DMG on macOS when built on macOS)
bun run package:desktop
```

From `apps/desktop/`:

```bash
bun run package:dir
bun run package
```

`package:dir` and `package` both run `bun run build` first.

## Output location

electron-builder writes under:

```txt
apps/desktop/release/
```

Typical layouts:

- **Unpacked (`--dir`)**: `apps/desktop/release/win-unpacked/` (Windows) or `apps/desktop/release/mac-arm64/Geistr.app` (macOS), etc.
- **Installer**: `apps/desktop/release/Geistr Core Setup x.y.z.exe` (Windows NSIS), `apps/desktop/release/Geistr Core-x.y.z.dmg` (macOS), or `apps/desktop/release/*.AppImage` (Linux)

This directory is gitignored (`release/`, `*.asar`).

## App metadata

Configured in `apps/desktop/electron-builder.yml`:

- **Product name**: Geistr Core
- **Application ID**: `app.geistr.core.desktop`
- **Windows target**: NSIS (optional install directory)
- **macOS target**: DMG
- **Linux**: AppImage

## GitHub release workflow

The repo includes `.github/workflows/release.yml`.

When a tag like `v1.0.0` is pushed, GitHub Actions builds packages on Windows, macOS, and Linux runners and uploads the release outputs to a GitHub Release.

```bash
git tag v1.0.0
git push origin v1.0.0
```

The workflow uses `RELEASE_NOTES.md` as the release body.

## Intentionally not supported yet

- Code signing (Windows/macOS)
- Apple notarization
- Auto-update / release channels
- App store publishing
- Linux AppImage/deb/rpm polish

Unsigned first-release builds may show Windows SmartScreen or macOS Gatekeeper warnings.

## Validation before marking packaging complete

After changing packaging config, run:

```bash
bun run check:file-size
bun run typecheck
cd apps/desktop && bun run test
cd packages/core && bun test
cd apps/desktop && bun run build
cd apps/desktop && bun run package:dir
```

Optionally run `bun run package` on the host OS to produce an installer.