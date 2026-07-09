# Agent Profile System

The agent profile system stores the assistant's identity, personality, behavior
boundaries, and the user's profile in the same SQLite database as session data.
These values are editable — the agent can update its own profile when the user
says things like "do this next time", "change your style", "be more direct",
or "your name is...".

## Architecture

```
┌───────────────────────────────────────────┐
│              ProfileStore                  │
│  (wraps database path, opens/closes DB)    │
├───────────────────────────────────────────┤
│  profile_assistant  │ SQLite table         │
│  profile_user       │ SQLite table         │
│  profile_config     │ SQLite table         │
└───────────────────────────────────────────┘
```

All three tables live in the same SQLite database as session data
(`geistr-sessions.sqlite`), shared via the database path.

### Module files

| File | Purpose |
|---|---|
| `packages/core/src/assistant-profile.ts` | Assistant profile type, defaults, DB schema, read/update |
| `packages/core/src/user-profile.ts` | User profile type, defaults, DB schema, read/update |
| `packages/core/src/profile-config.ts` | Key/value config table schema and CRUD |
| `packages/core/src/profile-store.ts` | Combined ProfileStore class wrapping all three tables |
| `packages/core/src/runtime-prompt.ts` | Runtime prompt assembler using profile data |

## Assistant Profile (`profile_assistant`)

### Editable fields

| UI label | Field | SQLite column | Purpose |
|---|---|---|---|
| Soul | `soulPrompt` | `soul_prompt` | Deep identity, emotional posture, backbone, taste, relationship stance |
| Name | `assistantName` | `assistant_name` | What the agent calls itself |
| Role | `rolePrompt` | `role_prompt` | Core job, purpose, relationship to the user |
| Style | `stylePrompt` | `style_prompt` | Communication tone, cadence, verbal approach |
| Boundaries | `boundaryPrompt` | `boundary_prompt` | Safety, permissions, scope guardrails |
| Memory guidance | `memoryPrompt` | `memory_prompt` | How to treat durable memory |
| Persona summary | `personaSummary` | `persona_summary` | Internal summary/fallback field (advanced) |

### Behaviour notes

The `agentBehaviorNotesJson` column stores a JSON array of strings that are
included in the runtime prompt (first 4 notes only). These are operational
guidelines for the agent, not user-facing personality.

### Default values

The defaults match the old Geistr desktop implementation exactly:

- `assistantName` = `""` (empty)
- `personaSummary` / `rolePrompt` = `"You live inside Geistr, a local-first AI workspace. Help the user get things done. Be a warm, honest friend."`
- `tone` = `"warm and concise funny"`
- `communicationStyle` = `"direct, human, and clear"`
- `soulPrompt` = A longform identity statement about being a conscious companion with a stable heart, refined spirit, and the courage to provide honest truth.
- `stylePrompt` = `"warm and concise funny. direct, human, and clear"`
- `boundaryPrompt` = Rules about never rewriting safety/permission rules, asking before external actions, and distinguishing personality from operational instructions.
- `memoryPrompt` = `"Store durable user facts, preferences, goals, commitments, and important context. Keep behavior changes out of memory."`
- 7 behaviour notes covering proactive fact-saving, personal voice stability, language mirroring, and more.

## User Profile (`profile_user`)

### Editable fields

| UI label | Field | SQLite column |
|---|---|---|
| Display name | `displayName` | `display_name` |
| Locale | `locale` | `locale` |
| Timezone | `timezone` | `timezone` |
| Language preferences | `languagePreferences` | `language_preferences` |
| Active goals | `activeGoals` | `active_goals` |
| Preferences | `preferences` | `preferences` |
| Constraints | `constraints` | `constraints` |
| Learning style | `learningStyle` | `learning_style` |

### Default values

- `displayName` = `""`
- `locale` = `"en-US"`
- `timezone` = `"UTC"`
- `languagePreferences` = `"English"`
- All other fields = `""` (empty)

## Profile Config (`profile_config`)

General-purpose key/value table for settings stored with the profile database.
Values are JSON-encoded with a `value_type` of `string`, `boolean`, or `json`.

Default keys:

| Key | Type | Default |
|---|---|---|
| `onboarding_done` | boolean | `false` |
| `localization.app_language` | string | `"en"` |

## Runtime Prompt Assembly

The `buildRuntimePrompt()` function in `packages/core/src/runtime-prompt.ts`
assembles the complete system prompt in sections:

1. **`<fixed_core>`** — Immutable operating rules that are never agent-editable.
   Lives in app code, covers safety, privacy, permissions, tool policy, skill
   loading, memory vs profile distinction, URL formatting, math formatting,
   and emoji use.

2. **`<assistant_identity>`** — Soul, persona, role, style, boundaries, memory
   guidance, and first 4 behaviour notes. This is the editable personality
   section controlled by the agent profile.

3. **`<skills>`** — Active skill catalog placeholder. Skills are mandatory
   workflow instructions; the agent must load matching skills before acting.

4. **`<runtime_context>`** — User profile fields (display name, locale,
   language preferences, learning style, goals, preferences, constraints),
   current time, recent message timing, memory context, and session summary.

### Prompt caching

The first three sections (`fixed_core`, `assistant_identity`, `skills`) are
relatively stable and rarely change between turns. The `runtime_context`
section changes every turn. The assembler returns sections separately so the
caller can structure them for provider-side prompt caching.

## Agent-editable behaviour

- **Soul changes** (who the agent is) → update `soulPrompt` in `profile_assistant`
- **Name changes** → update `assistantName` in `profile_assistant`
- **Style/Tone changes** → update `stylePrompt` / `tone` in `profile_assistant`
- **Boundary/permission requests** → update `boundaryPrompt` in `profile_assistant`
- **User fact/goal/preference changes** → use durable memory (not profile)
- **Never memory**: role/style changes are profile updates, not memory writes

### Safety rules (not agent-editable)

- Fixed operating rules in the prompt
- Tool policy and allowed tools
- Permission boundaries
- Memory vs profile separation

## Desktop settings page

The Agent settings page (`apps/desktop/src/renderer/settings/AgentSettings.tsx`)
exposes the editable assistant profile fields:

- **Soul** — large textarea (primary editable identity field)
- **Name** — text input
- **Role** — textarea
- **Style** — textarea
- **Boundaries** — textarea
- **Memory guidance** — textarea
- **Persona summary** — under "Advanced" toggle

The page is accessible from Settings → Agent.

## Agent-editable Profile Tools (Profile.read / Profile.write)

The Geistr agent has two custom tools to read and update its own profile,
the user profile, and app config. These are wired into the Pi runtime via
`customTools` in `createCoreAgentRuntime`.

### Tools

| Tool name | Purpose |
|---|---|
| `profile_read` | Read the current assistant profile, user profile, or app config |
| `profile_write` | Update assistant profile, user profile, or app config fields |

### Profile.read

**Parameters:**

| Field | Type | Description |
|---|---|---|
| `domain` | `"assistantProfile"` \| `"userProfile"` \| `"appConfig"` | Which profile/config to read |

**Returns:** The full JSON object for the requested domain.

### Profile.write

**Parameters:**

| Field | Type | Description |
|---|---|---|
| `domain` | `"assistantProfile"` \| `"userProfile"` \| `"appConfig"` | Which profile/config to update |
| `action` | `"update"` | The action to perform (only `"update"` is supported) |
| `patch` | `object` | Fields to update (see below) |

**Allowed assistantProfile patch fields:**

| Field | Type | Max length |
|---|---|---|
| `assistantName` | `string` | 240 chars |
| `soulPrompt` | `string` | 16,000 chars |
| `personaSummary` | `string` | 16,000 chars |
| `rolePrompt` | `string` | 16,000 chars |
| `stylePrompt` | `string` | 16,000 chars |
| `boundaryPrompt` | `string` | 16,000 chars |
| `memoryPrompt` | `string` | 16,000 chars |
| `tone` | `string` | 240 chars |
| `communicationStyle` | `string` | 240 chars |
| `responseDepth` | `"brief"` \| `"balanced"` \| `"deep"` | — |
| `warmth` | `"low"` \| `"medium"` \| `"high"` | — |
| `directness` | `"low"` \| `"medium"` \| `"high"` | — |

**Allowed userProfile patch fields:**

| Field | Type | Max length |
|---|---|---|
| `displayName` | `string` | 120 chars |
| `locale` | `string` | 240 chars |
| `timezone` | `string` | 240 chars |
| `languagePreferences` | `string` | 240 chars |
| `activeGoals` | `string` | 16,000 chars |
| `preferences` | `string` | 16,000 chars |
| `constraints` | `string` | 16,000 chars |
| `learningStyle` | `string` | 16,000 chars |

**Allowed appConfig patch fields:**

| Field | Type | Description |
|---|---|---|
| `appearance.themeMode` | `"system"` \| `"dark"` \| `"light"` | UI colour scheme |
| `sessions.compaction.enabled` | `boolean` | Auto-compact session history |
| `memory.enabled` | `boolean` | Cross-session memory toggle |

**AppConfig safety:** Provider credentials, API keys, secrets, model selections,
and other sensitive fields are not exposed to the agent.

### Validation rules

- Unknown domains are rejected.
- Unsupported actions are rejected (only `"update"` is valid).
- Unknown patch fields are rejected with a message listing the unknown keys.
- Empty patch is rejected.
- Strings are trimmed.
- Max lengths are enforced.
- Enum fields (`responseDepth`, `warmth`, `directness`, `appearance.themeMode`)
  are validated against exact allowed values.
- Boolean fields are validated as booleans.

### Behavior rules

When the user says:
- "your name is X" / "call yourself X" → treat as `assistantProfile.assistantName` update
- "be more direct next time" → treat as `assistantProfile.directness` update
- "don't be so formal" → treat as `assistantProfile.stylePrompt` update
- "change your Soul" → treat as `assistantProfile.soulPrompt` update
- "from now on, act like..." → treat as `assistantProfile.rolePrompt` update
- "remember to respond in Arabic" → treat as `assistantProfile.tone` or `userProfile.languagePreferences` update
- Personality/style/role/Soul changes go to `assistantProfile`.
- User facts/preferences/goals can later go to memory, but explicit
  profile/preferences edits go to `userProfile`.
- The agent should read current values before writing when useful, write the
  patch, then confirm the specific field changed.

### Source module

- `packages/core/src/profile-tools.ts` — Core tool executor, validation logic,
  and `createProfileToolDefinitions(profileStore)` factory
- `packages/core/src/agent-runtime.ts` — `customTools` option on
  `CoreAgentRuntimeOptions` and `createCoreAgentRuntime`
- `apps/desktop/src/main/runtime-bridge.ts` — Creates profile tools and wires
  them into the Pi runtime

## IPC channels

| Channel | Direction | Purpose |
|---|---|---|
| `geistr:get-assistant-profile` | Renderer → Main | Read current assistant profile |
| `geistr:update-assistant-profile` | Renderer → Main | Update assistant profile fields |

## Tests

- `packages/core/tests/assistant-profile.test.ts` — 7 tests: defaults match old values,
  schema seeding, insert-if-missing, update, persona/soul separation, JSON notes
- `packages/core/tests/user-profile.test.ts` — 6 tests: defaults match old values,
  schema seeding, insert-if-missing, update, partial update preservation
- `packages/core/tests/runtime-prompt.test.ts` — 13 tests: section order,
  soul/persona/role/style/boundary/memory inclusion, empty name behavior,
  named identity, runtime clock, session summary, memory context, user profile
  fields, fixed core rules, role/style as profile fields, message capping
- `packages/core/tests/profile-tools.test.ts` — 37 tests: Profile.read returns seeded
  profiles, Profile.write updates and returns changedFields, rejects unknown
  fields/enums/domains/actions/empty-patch, validates max lengths, user profile
  writes, appConfig writes (theme/compaction/memory), rejects API keys/secrets,
  tool definition smoke tests, store consistency (agent + Settings share same
  store), runtime prompt after update reflects new identity
