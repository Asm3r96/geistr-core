# System Prompts

System prompts are a core part of Geistr's architecture.

Geistr should treat prompts as structured runtime configuration, not as random long text blobs.

## Core Decision

Geistr will use dynamic system prompts.

The runtime system prompt can be assembled from multiple sections that are injected, removed, or changed depending on context.

Examples of context:

- active app
- active agent role
- selected skills
- selected tools
- user profile availability
- memory scope
- permissions
- foreground vs background mode
- current task type
- app settings

## Prompt Style

System prompts must be direct, clear, and structured.

Avoid long free-form prose when a structured section is clearer.

Each important section should use an XML-like title written inside angle brackets.

Example:

```txt
<identity>
You are the Tutor app agent inside Geistr.
</identity>

<user_profile>
Relevant user profile context goes here.
</user_profile>

<tools_policy>
Use the smallest sufficient tool set. Prefer existing tools before requesting new ones.
</tools_policy>

<memory_scope>
You may use Tutor app memory. You may not directly read or write global user memory.
</memory_scope>
```

This makes prompts easier for agents to parse and easier for humans to maintain.

## Dynamic Sections

Prompt sections should be modular.

Geistr should be able to include or exclude sections such as:

- identity
- app role
- user profile
- active app context
- memory scope
- tool policy
- skills available
- output rules
- background task rules
- handoff protocol
- artifact rules
- safety/permission rules

## Cache Awareness

Geistr should manage system prompts and sessions in a way that preserves provider-side prompt caching as much as possible.

Pi already has strong session/prompt/cache-aware behavior, so Geistr should follow Pi's approach instead of casually rebuilding it.

Important principle:

- stable prompt sections should remain stable
- frequently changing context should be isolated into later/dynamic sections
- avoid rewriting the entire system prompt when only one small context part changes
- reuse Pi session management patterns where possible

## Relationship to Pi

Geistr should use Pi session and prompt management patterns as the foundation.

When possible, use Pi SDK mechanisms for:

- session creation
- system prompt/resource loading
- context files
- skills
- prompt templates
- caching-friendly prompt structure

Geistr can add its own prompt assembly layer on top, but it should not break Pi's strengths.

## Agent Prompt Editing

Agents should be able to update system prompt files when allowed.

Do not create special tools just for editing prompts.

System prompts and prompt sections should be file-backed or otherwise stored in a discoverable location. If they are files, the agent can use existing bash/read/write/edit tools. If they are stored in SQLite or another local store, the agent can use normal command access when appropriate.

The app should tell the agent where relevant prompt files or storage locations are.

## App Agents

Each app agent can have different prompt sections.

For example, the Tutor app agent may have:

```txt
<identity>
You are the Tutor app agent.
</identity>

<mission>
Help Mohammed learn topics deeply through lessons, missions, examples, and feedback.
</mission>

<memory_scope>
Use Tutor app memory. Do not directly read global user memory.
</memory_scope>
```

The Researcher app agent may have different sections for sources, claims, reports, and evidence quality.

## Core Agent

The core personal agent should have its own prompt sections defining it as Mohammed's secretary, partner, and orchestrator.

It may include sections for:

- personal assistant identity
- user profile
- global memory access rules
- app routing rules
- handoff protocol
- memory broker rules
- communication with specialist apps

## Constraint

Do not hide important behavior in vague prompt paragraphs.

If something is important, make it an explicit prompt section with a clear title.
