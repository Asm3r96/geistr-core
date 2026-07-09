# Skills Guide

This document explains what skills are, how to load and use them, and how to create, update, and delete them.

## What is a skill?

A skill is a structured markdown file that provides repeatable workflow instructions for a specific task. Skills exist to make your behavior predictable — following the same process every time for a given task.

Skills live in `SKILL.md` files, optionally with sibling reference files like `GLOSSARY.md`.

## Where skills live

There are two skill roots:

### Built-in skills

Bundled with the core package. Read-only. Example:

- `writing-great-skills`: Reference for writing and editing skills well

Built-in skills are always available but you cannot modify them through file tools.

### User-installed skills

Located in the user skills directory:

```
C:\Users\moham\AppData\Roaming\@geistr\desktop\skills\<skill-name>\SKILL.md
```

User skills are editable. You can create, update, or delete them using normal file tools and shell commands.

## How to use a skill

1. Check the active skills catalog in your system prompt. It lists skills by name and short description.
2. If a task matches an installed skill, use `skill_load({ name: "..." })` to load the full instructions.
3. Follow the skill's instructions for the current turn/task.

**Important:** Do not act on a task that has a matching skill without loading it first. The skill contains mandatory workflow instructions.

## How to create a skill (when the user asks)

1. Ask the user what the skill should do
2. Use `skill_load("writing-great-skills")` to load the skill authoring reference — it explains how to write good skills
3. Create the skill folder and files using file tools:

```
mkdir -p <user-skills-dir>/<skill-name>
write <user-skills-dir>/<skill-name>/SKILL.md
```

4. The skill should include:
   - YAML frontmatter with name and description
   - Clear instructions/steps
   - Completion criteria
   - References if needed

5. Confirm the skill was created and is now available

## How to update a skill (when the user asks)

Use normal file read/edit/write tools on the skill's `SKILL.md` and any reference files.

## How to delete a skill (when the user asks)

Use normal file tools or shell commands to remove the skill folder.

## Important rules

- `skill_load` is read-only. It does not create, edit, or delete skills.
- To create, update, or delete skills, use normal file tools/commands under the user skills directory — subject to permission approval.
- Only create, update, or delete skills when the user explicitly requests it.
- Do not silently rewrite skills just because you think they could be improved.
- Loaded skill instructions apply for the current turn/task. Do not permanently inject them into every prompt.
- Do not use memory or profile tools to store skill instructions.
- Skill content is operational instruction, not long-term memory or profile data.
- If a skill references a glossary or other sibling file, `skill_load` with `includeReferences: true` will load it too.
