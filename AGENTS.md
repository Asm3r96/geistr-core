# AGENTS.md

## Geistr Agent Operating Contract

These rules are intentionally strict. Geistr agents should be cautious, direct, surgical, and verifiable.

## Required Reading Before Decisions

Before making architectural, product, UI, runtime, storage, provider, tool, skill, prompt, or workflow decisions, read:

- `README.md` — product/repo overview.
- Relevant docs under `docs/`.
- Relevant durable role docs under `docs/roles/`.

Do not guess project direction from old reference apps or screenshots. The docs in this repo are the source of truth.

## Project Direction

Geistr Core is a desktop-first reusable AI app foundation built around the Pi SDK.

Hard rules:

- Keep Geistr Core desktop-first and reusable.
- Do not add product-specific tutor behavior to this core repository.
- Avoid inheriting unnecessary architecture from reference apps or generic SaaS templates.
- Build the smallest useful foundation that other apps can run as-is or extend.

## Think Before Editing

Before non-trivial code changes, the agent must:

1. State the task in one sentence.
2. Identify the governing role docs.
3. Name the smallest intended change.
4. Name the validation command(s).
5. Ask if requirements are ambiguous, destructive, or architectural.

Do not silently choose between multiple interpretations. Surface ambiguity and tradeoffs before editing.

Push back when a simpler approach exists.

## Simplicity First

Use the minimum code that solves the requested Geistr workflow.

Do not:

- Add speculative abstractions.
- Add frameworks or large dependencies without an immediate need.
- Add configurability that no current workflow uses.
- Create single-use abstraction layers.
- Overbuild generic platform behavior before the app needs it.

If a solution feels clever, make it boring. If 200 lines can be 50, prefer 50.

## Surgical Changes Only

Every changed line should trace directly to the user's request.

Do not:

- Refactor unrelated code.
- Reformat unrelated files.
- Rename established concepts casually.
- Delete old code, docs, screenshots, or structure unless asked.
- Change behavior while presenting the work as a pure refactor.

Allowed cleanup:

- Remove imports, variables, functions, tests, or docs made stale by your own change.
- Mention unrelated dead code or risks in the final note instead of deleting them.

## Goal-Driven Execution

For every meaningful task, define success criteria and loop until verified.

Examples:

- Bug fix: reproduce or explain the failure, then validate the fix.
- Feature: implement the smallest vertical slice through a public seam and test it.
- Refactor: preserve behavior and prove it with existing or focused tests.
- Docs: update the canonical doc future agents will read.

A task is not complete just because the UI appears to work. It is complete when validation has passed or skipped validation is clearly explained.

## Geistr Role Routing

Use the relevant role docs as hard constraints:

| Work area | Required docs |
|---|---|
| UI/design/theme | `docs/roles/design.md` |
| Core/runtime/storage | `docs/roles/core.md`, `docs/roles/pi-sdk.md`, `docs/roles/code-quality.md` |
| Desktop app shell | `docs/roles/apps.md`, `docs/architecture/desktop-shell.md` |
| Providers/models/auth | `docs/roles/providers.md` |
| Loops/background work | `docs/roles/loops.md` |
| Settings/config | `docs/roles/settings.md` |
| Tools/permissions | `docs/roles/tools.md` |
| Skills | `docs/roles/skills.md` |
| Prompts/profile | `docs/roles/system-prompts.md` |
| Documentation | `docs/roles/docs.md` |
| Validation/workflow | `docs/roles/development-workflow.md`, `docs/roles/code-quality.md` |

When role docs conflict with an implementation impulse, the docs win unless Mohammed explicitly overrides them.

## Documentation Rules

- When defining a durable concept, create or update a file under `docs/roles/` or `docs/`.
- Keep architecture decisions explicit and easy to find.
- Update relevant docs in the same change when behavior, architecture, storage, app schema, tools, skills, prompts, providers, settings, or workflows change.
- Keep `README.md` and relevant docs updated before finishing meaningful public-facing work.

## Build and Code Quality Rules

- Prefer small, understandable modules.
- Prefer files under 500 lines.
- 750 lines is the soft maximum.
- 800 lines is the hard maximum.
- Split files by responsibility before they become hard to understand.
- Keep the frontend focused on UI and user control.
- Keep agent/runtime logic behind a clear Pi SDK integration layer.
- Ask before deleting or replacing major structure.
- Meaningful behavior changes require tests in the same change.
- Geistr should run on macOS and Windows first, with Linux later if practical.
- UI work must use the shared design system and semantic design tokens; avoid scattered hardcoded colors, spacing, radii, and typography.
- Theme architecture must support light and dark themes and future token-based user/agent-customized themes.

## Completion Gate

Before finishing meaningful work, the agent must:

1. Run focused validation.
2. Run broader validation when practical.
3. Update relevant docs with what changed, validation results, and risks when the change affects documented behavior.
4. Report skipped validation honestly.
5. Leave the working tree reviewable: small modules, no generated files, no unrelated cleanup.

## Local Skills

Workflow skills are vendored under `.agents/skills/`. Use them only when they fit the task:

- `tdd` — use for feature work and bug fixes where behavior should be protected by tests. Prefer red/green/refactor vertical slices.
- `code-review` — use after substantial implementation work to review the diff against standards and the intended spec.
- `codebase-design` — use when designing or refactoring core modules, public seams, runtime layers, app schema, tools, skills, memory, or agent architecture.
- `domain-modeling` — use when Geistr concepts need clearer names, boundaries, contexts, ADRs, or shared vocabulary.
- `diagnosing-bugs` — use for hard bugs, regressions, performance issues, or behavior that is not understood yet.
- `prototype` — use for throwaway UI/logic experiments before committing to a real implementation.
- `research` — use when implementation needs primary-source investigation or external/library documentation summarized into the repo.
- `grill-with-docs` — use when Mohammed wants to clarify a product/architecture decision while updating docs inline.
- `wayfinder` — use for large foggy work that cannot fit in one session; create a map and resolve one ticket per session.
- `geistr-loop-authoring` — use when designing, implementing, reviewing, or debugging Geistr loop workflows, background loops, loop artifacts, validators, session-management loops, or loop progress UI.
- `to-issues` — use to break a plan/spec into independently buildable vertical-slice issues.
- `to-prd` — use to turn a conversation or plan into a PRD before implementation.

Do not use a heavyweight skill when a small direct change is enough. For normal coding, default to reading the relevant Geistr docs/roles, using `tdd` for behavior changes, updating docs, and validating the result.
