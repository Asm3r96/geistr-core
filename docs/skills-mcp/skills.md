# Skills

Geistr supports installed skills as operational instructions for agents.

## Prompt catalog

The runtime prompt lists active installed skills compactly by name and description only. Full skill files are not injected into every turn.

Example catalog entry:

```text
- writing-great-skills: Reference for writing and editing skills well — the vocabulary and principles that make a skill predictable.
```

## Loading skill instructions

Agents load full skill instructions on demand with the single read-only tool:

```text
skill_load({ name: "writing-great-skills", includeReferences?: boolean })
```

`skill_load` returns `SKILL.md` and, by default, sibling Markdown files explicitly linked from `SKILL.md`, such as `GLOSSARY.md`. The tool only reads from configured skill roots and rejects path traversal names.

## Skill roots

Geistr creates an empty user skills folder at app startup:

- macOS: `~/Library/Application Support/Geistr/skills`
- Windows: `%APPDATA%/Geistr/skills`
- Linux: `~/.config/Geistr/skills`

Each user skill should be a folder under that directory with a `SKILL.md` file and any referenced sibling files.

## Built-in skills

This slice bundles one built-in skill in `@geistr/core`:

- `writing-great-skills`

The built-in `writing-great-skills` skill tells agents to look in the user skills folder when explicitly asked to find, create, or update skills.

## Skills screen

Settings has a first-pass Skills screen, with a sidebar deep link from the main app navigation. It lists built-in and installed skills separately using simple cards with each skill's name and description. Each card has a small gear menu: active skills can be deactivated, deactivated skills can be activated, and installed user skills can also be deleted. Built-in skills cannot be deleted.

Deactivated skills are hidden from the runtime prompt skill catalog and `skill_load` refuses to load them. The screen does not include a custom skill editor or file browser controls.

## Skill editing

There is no skill write/update/delete tool. Creating, editing, or deleting skills uses ordinary file tools or shell commands against configured skill folders, governed by the normal permission mode and approval UI.

Agents must only create, update, or delete skills when the user explicitly asks. Skill content is operational instruction, not memory or profile data.
