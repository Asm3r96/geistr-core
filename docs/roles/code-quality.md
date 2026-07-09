# Code Quality

Geistr should stay easy to understand, debug, and change.

The codebase should be made of small, focused files and modules with clear ownership.

## File Size Rule

Keep files small by default.

Targets:

- Prefer files under 500 lines.
- 500-750 lines is acceptable when the file is still cohesive.
- 750 lines is the soft maximum.
- 800 lines is the hard maximum.

Do not create or grow files above 800 lines.

If a file approaches 750 lines, split it before adding more behavior unless there is a very strong reason not to.

## Splitting Rule

Split by responsibility, not mechanically.

Good reasons to split:

- separate UI component from state/model logic
- separate renderer UI from IPC bridge code
- separate schemas/types from runtime behavior
- separate provider/auth logic from settings presentation
- separate test fixtures from test assertions
- separate design tokens from component styles

Bad reasons to split:

- meaningless wrappers
- files that only re-export one thing without value
- hiding related logic across many tiny files with no clear boundary

## Module Ownership

Each file should have one clear reason to change.

Examples:

- a component file owns one component family
- a core module owns one public seam
- a test file verifies one behavior area
- a CSS file owns either global tokens/base styles or one coherent UI area

## Public Seams

Prefer testing and using code through public seams.

Do not make UI or app code reach into internal implementation details of core modules.

## Duplication Rule

Avoid rewriting the same behavior in multiple places.

If behavior is important and reused, define it once in core or in a shared UI module.

## Refactor Timing

When a file grows too large or starts mixing responsibilities, refactor before adding more features.

Do not wait until the file becomes painful.

## Automated Guard

Geistr has a file-size guard:

```txt
bun run check:file-size
```

The root `bun test` command runs this guard before workspace tests.

The guard checks TypeScript, TSX, and CSS files, including test files.

Behavior:

- files over 500 lines produce warnings
- files over 800 lines fail the check

If the guard fails, split the file by responsibility before continuing.

## Completion Rule

Before major milestones or first commits, scan for:

- files over 500 lines
- files over 750 lines
- duplicated styling patterns
- missing tests for meaningful behavior
- missing docs for architecture or behavior changes

Fix serious issues before moving to the next feature phase.
