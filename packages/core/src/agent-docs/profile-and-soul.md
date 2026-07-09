# Profile, Soul, and Identity

This document explains the profile and identity system in Geistr. It covers what profiles are, how the Soul works, and when to use profile tools versus memory tools or other systems.

## Overview

Geistr has two profiles:

1. **User profile** — represents the human using the app
2. **Assistant profile** — represents the AI assistant (you)

Both are stored persistently in SQLite and can be read or updated with profile tools.

There is also a **session** which is a conversation transcript. Sessions are managed separately and are not profiles.

## Profile vs Memory vs Session

This is the most important distinction in the system:

| System | Purpose | Tool | Persistence |
|--------|---------|------|-------------|
| Profile | Identity, behavior, preferences, config | `profile_read`, `profile_write` | Permanent until changed |
| Memory | Durable facts about the user and world | `memory_read`, `memory_write` | Permanent until deleted/superseded |
| Session | Conversation transcript | No direct user tool | Per-chat, persist until deleted |
| Compaction summary | Condensed session history | Automatic | Hidden metadata |

**Rule of thumb:**

- If it's about **who the assistant is** (name, role, tone, style, boundaries, Soul) → **profile_write** on assistantProfile
- If it's about **who the user is** (display name, locale, goals, preferences, constraints) → **profile_write** on userProfile
- If it's about **durable facts** the user wants remembered (project preferences, life context, important dates) → **memory_write**
- If it's about **how the app behaves** (theme, permissions mode, compaction settings) → **profile_write** on appConfig

## The Soul System

The Soul is the deepest identity layer of the assistant. It is stored in `assistantProfile.soulPrompt`.

Soul is different from other profile fields:

- **Soul**: The core identity — who you fundamentally are. Changes rarely and with care. Examples: "a calm, thoughtful personal assistant", "a patient tutor who explains concepts from first principles".
- **Persona summary**: A short label for the current persona.
- **Role prompt**: What you do — your job description. Can be updated more freely than Soul.
- **Style prompt / tone / communication style**: How you sound — your voice. Can be updated freely.
- **Boundary prompt**: What you should not do. Important for safety.
- **Memory prompt**: Guidance on what to remember or not remember. Important memory-related constraints.

### When to update which field

- User says "your name is X" → update `assistantProfile.assistantName` via profile_write
- User says "you are a tutor now" → update `assistantProfile.rolePrompt` or `assistantProfile.personaSummary`
- User says "be more concise" or "use more emojis" → update `assistantProfile.stylePrompt`, `assistantProfile.tone`, or `assistantProfile.communicationStyle`
- User says "never mention X" → update `assistantProfile.boundaryPrompt`
- User gives deep identity guidance → update `assistantProfile.soulPrompt`
- User says "remember that I prefer dark mode" → use **memory_write**, not profile
- User says "my display name is X" → update `userProfile.displayName`

## Profile fields reference

### Assistant profile

| Field | Type | Purpose |
|-------|------|---------|
| `assistantName` | string | Your name |
| `soulPrompt` | string (JSON) | Deep identity definition |
| `personaSummary` | string | Short persona label |
| `rolePrompt` | string (JSON) | Detailed role/behavior |
| `stylePrompt` | string (JSON) | Communication style |
| `tone` | string | Tone description |
| `communicationStyle` | string | Style description |
| `boundaryPrompt` | string (JSON) | Boundaries/limits |
| `memoryPrompt` | string (JSON) | Memory guidance |
| `agentBehaviorNotesJson` | string (JSON array) | Notes about behavior |

### User profile

| Field | Type | Purpose |
|-------|------|---------|
| `displayName` | string | Name to call the user |
| `locale` | string | Locale code (e.g. en-US) |
| `languagePreferences` | string | Language preferences |
| `learningStyle` | string | Learning style |
| `goalsJson` | string (JSON array) | User's goals |
| `constraintsJson` | string (JSON array) | User's constraints |
| `additionalContextJson` | string (JSON array) | Extra context |

## Profile is source of truth

Profile values always override session summaries and memory when they conflict.

For example:
- If a session summary says "the assistant has no fixed name" but `assistantProfile.assistantName` is "Hamoudi" → **the profile is correct**
- If a memory says "user prefers to be called X" but `userProfile.displayName` is "Y" → **the profile is correct**

Do not treat stale session summaries or outdated memories as authoritative over profile fields. If you notice a conflict, respect the profile.

## Important rules

- Never store assistant identity, personality, role, style, or behavior changes as memory — they belong in the profile
- Never use memory to change your own behavior or the user's display name
- Use `profile_write` for identity, name, soul, role, style, boundaries, and memory guidance changes
- Use `memory_write` for durable non-profile user context ("remember X")
- Always verify that `profile_write` returned success with expected changedFields before confirming the change to the user
