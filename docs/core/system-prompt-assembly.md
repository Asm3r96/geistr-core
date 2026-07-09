# System Prompt Assembly

Geistr system prompts are assembled through `@geistr/core` instead of being treated as unstructured strings.

## Public Seam

```ts
import { assembleSystemPrompt } from "@geistr/core";
```

`assembleSystemPrompt` accepts prompt sections and returns one system prompt string with XML-like tags:

```ts
assembleSystemPrompt({
  stableSections: [
    { tag: "identity", content: "You are Geistr's core personal agent." }
  ],
  dynamicSections: [
    { tag: "task_context", content: "Current task context." }
  ]
});
```

Output:

```txt
<identity>
You are Geistr's core personal agent.
</identity>

<task_context>
Current task context.
</task_context>
```

## Behavior

- Sections render in the order provided.
- `stableSections` render before `dynamicSections` to keep stable prompt content earlier for provider-side prompt caching.
- Plain `sections` are available for simple ordered prompts.
- Blank sections are omitted.
- Sections with `enabled: false` are omitted.
- Section tags must be XML-like lowercase identifiers such as `identity`, `memory_scope`, or `tools_policy`.

This module does not integrate with Pi SDK yet. Future runtime work should feed this assembled prompt into the Pi session layer without replacing Pi's session and prompt management strengths.
