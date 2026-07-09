# Loops

## Purpose

Geistr loops are reusable, controlled workflow runners for background and supervised agent work.

A loop is not a single prompt. It is a bounded process made from explicit nodes, artifacts, validation, retries, steering, and progress events. Use loops when a feature needs reliable multi-step behavior instead of an open-ended chat turn.

Loops will live in Geistr core so desktop, specialist apps, memory, compaction, imports, artifact generation, and future background workers can reuse the same runtime.

## Why Geistr Uses Loops

Loops give Geistr:

- predictable step-by-step agent work
- per-step model/tool control
- deterministic validation before state changes
- clean context between LLM steps
- bounded retries and self-healing
- background execution with visible progress
- reusable workflow definitions for many app features

The user should not have to babysit long-running agent work. The loop runtime should behave like a careful supervisor: it scopes each step, watches for stalls, validates outputs, retries correctable failures, and only saves durable results after checks pass.

## When To Use a Loop

Use a loop when work has two or more of these traits:

- it has clear stages, such as prepare, generate, validate, save
- it may run in the background
- it must be recoverable after a failed or stuck step
- it needs deterministic code checks around LLM output
- it should use a specific model, tool set, or prompt per step
- it needs progress surfaced to the user
- it writes durable state such as summaries, memories, artifacts, or app data

Do not use a loop for simple direct chat replies or one-off deterministic operations that can be completed with a normal function call.

## Core Runtime vs Loop Definition

Keep the runtime generic and keep workflow logic in loop definitions.

The core loop runtime owns:

- run and node lifecycle
- node status and progress events
- transitions and retry mechanics
- pause, resume, cancel, and needs-attention states
- context cleanup between LLM nodes
- artifact passing
- model/tool policy enforcement
- deterministic gates
- steering triggers and steering messages
- background execution
- persistence of run state
- generic evidence and metrics

A loop definition owns:

- node IDs, labels, goals, and order
- workflow-specific prompts
- workflow-specific output schemas
- which artifacts are passed to each node
- model choices per node
- allowed tools per node
- validation criteria for that workflow
- final side effects for that workflow

If logic would only make sense for compaction, memory, onboarding, or one specialist app, it does not belong in the core loop runtime.

## Node Types

Geistr loops should support a broad set of node kinds:

- `code` — deterministic logic such as fetching, parsing, validation, cleanup, and file/database writes.
- `llm` — bounded model work. Can be either an agent session with tools or a single request/response call.
- `room` — a first-class internal phase that coordinates one or more workers, reducers, and validators.
- `gate` — deterministic validation over artifacts, evidence, and node output.
- `evaluator` — future evaluation/scoring node for more advanced quality checks.
- `approval` — human decision point.
- `wait` — scheduled or external-event wait point.
- `side_effect` — durable write or external action after validation.
- `finalizer` — completes the loop and emits final output.

Prefer `code` over `llm` when the work is deterministic.

## LLM Node Modes

LLM nodes must support more than one execution style.

`agent_session` mode:

- starts a controlled agent run
- can use scoped tools
- can think, inspect, edit, and go back and forth
- must finish with a structured loop report or equivalent completion object

`single_request` mode:

- sends one model request
- waits for a response
- usually has no tool loop
- is useful for summarization, classification, extraction, scoring, and small transformations

Both modes must have explicit prompts, output contracts, timeouts, budgets, and validation.

## Mandatory Context Cleanup

Context cleanup is a core requirement.

After an LLM node finishes, the next LLM node must not inherit the messy internal context from the previous node. Tool calls, research trails, intermediate reasoning, repeated reads, and old chat noise should be removed.

The runtime should pass only explicit accepted artifacts, reports, summaries, and validation feedback to the next node.

This keeps each node focused, reduces tokens, improves provider cache behavior, and prevents stale context from contaminating later steps.

A loop should work like this:

1. LLM node receives only the input artifacts it needs.
2. The LLM performs internal work.
3. The LLM returns a structured report/artifact.
4. Gates validate the report.
5. The runtime stores accepted artifacts.
6. The next node starts clean with only explicitly selected artifacts.

Never rely on implicit artifact injection. Each LLM node should declare exactly which artifacts it receives.

## Self-Healing and Recovery

Loops should be self-healing where possible.

The runtime should handle:

- invalid output
- missing reports
- failed validation
- transient model/tool errors
- timeouts
- stuck or stalled nodes
- retryable side effects

Recovery options should include:

- retry the same node with clean context and feedback
- rerun a previous preparation node
- route to an approval or needs-attention state
- fail safely after budget exhaustion

Every retry must be bounded. A common default is three attempts, but each loop can choose a tighter or looser policy.

## Steering

Steering is a first-class supervision mechanism.

The runtime should observe agent behavior during LLM nodes and inject guidance when rules trigger. Steering is how Geistr supervises a background agent as if a human were watching the work.

Examples:

- if the agent repeats the same failed command, tell it to stop repeating and use another approach
- if the agent reads too broadly for too long, tell it to start working
- if the node requires a tool and the agent has not used it after several tool calls, steer it toward that tool
- if the node stalls, ask it to make progress or submit a report
- if the agent writes without validating, ask it to run the required checks

Steering rules should be generic in the runtime and configured by loop definitions.

## Background Execution and UI Progress

Loops must run in the background. They should continue if the user navigates to another page, changes settings, or minimizes the window.

The desktop UI should subscribe to loop progress events and show a small progress widget, for example above the chat messages:

```text
Compacting session · Step 2/4 · Validating summary
```

The widget should show:

- loop label
- run status
- current node
- completed step count / total steps
- needs-attention or failure states

After successful completion, the UI may keep the completed widget visible briefly, such as around three minutes, and then hide it.

The loop runtime must not depend on React or Electron. It should emit generic progress events that desktop renders.

## Prompt and Cache Discipline

Loop prompts should preserve provider-side prompt caching where practical.

Use stable sections for invariant instructions, output style, and workflow rules. Put dynamic artifacts and context later. Do not include irrelevant tool logs or stale context in later nodes.

For Geistr-specific loops, use the same structured prompt style as Geistr runtime prompts when possible.

## First Package Task

The first implementation task is only the reusable loop package. Do not implement the compaction loop in the same task unless explicitly asked.

The package should establish reusable types, runtime state, node execution interfaces, transition/retry logic, context cleanup rules, steering interfaces, background progress events, and tests with dummy loops.

Compaction will become the first real workflow after the reusable package is stable.
