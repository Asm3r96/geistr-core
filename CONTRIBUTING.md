# Contributing to Geistr Core

Thanks for helping improve Geistr Core.

## Setup

```bash
bun install
bun run typecheck
bun run test
```

Run the desktop app:

```bash
cd apps/desktop
bun run dev
```

## Development rules

- Keep changes focused and reviewable.
- Do not commit secrets, API keys, OAuth credentials, local databases, or generated release artifacts.
- Update docs when behavior, architecture, tools, skills, prompts, providers, settings, memory, loops, or workflows change.
- Add or update tests for meaningful behavior changes.
- Prefer small modules and clear public seams.

## Validation before PR

```bash
bun run check:file-size
bun run typecheck
bun run test
cd apps/desktop && bun run build
```

For packaging changes, also run:

```bash
bun run package:desktop:dir
```

## Architecture docs

Start with:

- `README.md`
- `docs/README.md`
- `docs/roles/core.md`
- `docs/roles/development-workflow.md`
- `docs/roles/code-quality.md`
