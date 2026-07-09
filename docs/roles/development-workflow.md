# Development Workflow

Geistr development should be disciplined from the beginning.

Every meaningful code change should include tests and documentation updates.

## Core Decision

Do not build features first and add tests/docs later.

When implementing or changing behavior:

- write or update tests in the same change
- write or update relevant docs in the same change
- keep implementation slices small
- prefer behavior tests through public seams
- run validation before considering work complete

## Skills We Can Use

Geistr vendors the workflow skills it uses under:

```txt
.agents/skills/
```

Useful skills:

- `tdd` — red/green test-driven development, one vertical slice at a time
- `code-review` — two-axis review: standards and spec
- `codebase-design` — module/interface design discipline
- `domain-modeling` — sharpen domain language and ADRs
- `diagnosing-bugs` — disciplined bug diagnosis loop
- `prototype` — throwaway prototypes for UI/logic questions
- `research` — primary-source investigation captured as Markdown
- `to-issues` — break a plan into implementation issues
- `wayfinder` — map very large foggy work into issue tickets

## Test Rule

Tests are mandatory for meaningful behavior changes.

Tests should verify behavior through public interfaces/seams, not private implementation details.

Before writing tests for a new area, identify the seam being tested.

Good seams may include:

- core agent runtime API
- prompt assembly API
- app registration API
- tool registration/filtering API
- memory store API
- artifact/preview event API
- provider/model selection API

Avoid tests that are tightly coupled to internals or snapshots that do not prove behavior.

## Documentation Rule

Docs must be updated with code changes.

If a change affects architecture, behavior, storage, app schema, tools, skills, prompts, or workflows, update the relevant docs/roles in the same change.

Documentation is not optional because Geistr agents will read it to understand how to work inside the app.

## Implementation Flow

For normal feature work:

1. Read `README.md`, relevant `docs/`, and relevant `docs/roles/`.
2. Identify the smallest vertical slice.
3. Identify the public seam to test.
4. Write a failing test when practical.
5. Implement the minimum code to pass.
6. Update docs/roles if behavior or architecture changed.
7. Run focused tests.
8. Run broader validation before completion.
9. Use code review for substantial changes.

## Large Unclear Work

Use Wayfinder when the work is too large or foggy for one session.

Wayfinder creates a map and child tickets, then resolves one ticket per session.

Do not use Wayfinder for every small task. Use it when the route is unclear or the work is bigger than one agent session.

## Cross-Platform Rule

Geistr is a desktop app intended to run and install on:

- macOS
- Windows
- Linux later if practical

Initial priority:

1. macOS
2. Windows
3. Linux

Desktop implementation should avoid platform-specific assumptions unless explicitly handled.

Pay attention to:

- native window controls
- filesystem paths
- shell differences
- packaging/installers
- code signing/notarization later
- app data locations
- local database paths
- webview/security behavior per platform

## Completion Rule

A task is not complete just because the UI appears to work.

A task is complete when:

- code is implemented
- relevant tests pass
- docs are updated
- cross-platform implications are considered
- known risks are noted
