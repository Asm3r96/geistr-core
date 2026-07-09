# Workspace Scaffold

Task 001 created the first Geistr workspace shape.

## Package Manager and Language

Geistr uses a Bun workspace with TypeScript.

Root workspace packages:

- `apps/*` — runnable Geistr applications.
- `packages/*` — reusable Geistr packages.

Root commands:

```sh
bun install
bun test
bun run typecheck
```

## Applications

`apps/desktop/` is a placeholder for the future Electron + React desktop app. It exists now so future desktop work has a stable package boundary, but Task 001 intentionally does not include Electron, React, or UI code.

## Core Package

`packages/core/` contains reusable Geistr core logic. App code should prefer public exports from `@geistr/core` instead of duplicating core behavior.

The first core seam is structured system prompt assembly.
