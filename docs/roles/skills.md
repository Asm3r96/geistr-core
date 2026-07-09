# Skills

Geistr should use the same basic skill model as Pi.

Skills are reusable instruction packages that agents can choose to load when relevant. They should not all be injected automatically.

## Core Decision

Geistr will have core/global skills and app-specific skills.

Skills can be made available to agents, but they are only active when explicitly included in an agent profile/configuration or enabled by user/app settings.

## Skill Scopes

### Core/Global Skills

Geistr core has a main skills folder for skills that may be useful to any agent.

These skills are globally available, but not automatically active.

An agent can receive one or more core skills by passing the skill names when creating or initializing that agent.

Examples:

- a coding skill
- a planning skill
- a design review skill
- a documentation skill
- a debugging skill

### App-Specific Skills

If a skill is only related to one specific app, put it inside that app's skill folder.

App-specific skills should only be available to agents running in that app context, unless deliberately promoted to core/global skills later.

Good:

- a notes app has notes-specific skills under the notes app
- a memory app has memory-specific skills under the memory app
- a project/workspace app has project-specific skills under that app

Bad:

- putting every app-specific skill in the global core folder
- auto-loading all skills into every agent
- forcing unrelated agents to see skills they cannot use

## Activation Rule

Skills are available, not automatically active.

A skill can become active through:

- agent creation config
- agent profile config
- app context config
- user settings
- explicit runtime selection

This allows different agents to share the same skill library while still having different behavior.

## Skill Passing

Agents receive skills by configuration.

An agent can receive:

- global/core skills
- app-specific skills
- a mix of both

App agents should not automatically receive every global skill. Pass only the skills needed for that agent/app context.

## Agent Skill Editing

Agents should be able to update skills when allowed.

Do not create special tools just for editing skills.

Skills are file-backed folders, so agents can use existing bash/read/write/edit capabilities to inspect and update skill files when they know where the skill folder is.

The app should make relevant skill locations discoverable to the agent through context/configuration.

## User Settings

Geistr may provide a settings screen where the user can activate or deactivate skills.

These settings should be saved in a normal place where the agent can inspect and update them through existing file/tool access or through a small Geistr settings domain tool if needed.

The goal is for both the user and agent to understand which skills are enabled for which agent/app context.

## Skill Format

Use the same folder-style skill format as Pi.

A skill is a folder containing at least:

```txt
SKILL.md
```

The `SKILL.md` file contains metadata at the top with the skill name and description. This metadata is loaded into the agent prompt so the agent knows the skill exists and when to use it.

When the agent decides to use the skill, it calls the load skill tool. The full `SKILL.md` is then read, and the agent may follow references to other files in the same skill folder.

A skill folder may contain:

- `SKILL.md`
- reference markdown files
- examples
- templates
- scripts or assets if needed

## Prompt Loading Rule

Only the skill summary/metadata should be exposed upfront.

Do not inject every full skill file into the prompt automatically. Full skill content should be loaded only when needed.

This keeps prompts smaller and lets the agent choose relevant skills.

## Relationship to Tools

Skills are instructions and workflows.

Tools are capabilities/actions.

A skill may explain how and when to use tools, but it should not create a large tool surface by itself.

Geistr should include useful operational skills when needed, such as a config skill that teaches agents how to safely update user profile, agent profiles, app settings, skill settings, and prompt files by using existing file/shell capabilities.

The tools role still applies:

- keep tools minimal
- max `Domain.read` and `Domain.write` per domain
- prefer existing bash/file capabilities when possible

## Constraint

Do not create a separate Geistr skill format unless Pi's skill format cannot support the needed behavior.

Start with Pi's model and extend only when there is a real product need.
