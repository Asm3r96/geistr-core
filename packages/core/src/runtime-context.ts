import type { GeistrChatMessage } from "./session-persistence";
import type { SystemPromptSection } from "./system-prompt";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryContextItem {
  content: string;
  category: "preference" | "profile" | "goal" | "fact" | string;
}

export interface ProfileIdentity {
  assistantName?: string;
  personaSummary?: string;
  soulPrompt?: string;
  rolePrompt?: string;
  stylePrompt?: string;
  boundaryPrompt?: string;
  memoryPrompt?: string;
  agentBehaviorNotesJson?: string;
}

export interface RuntimeContextInput {
  /** Session identity. */
  sessionKey: string;
  sessionTitle: string;

  /** Session summary text from a prior compaction/summary event, or null. */
  sessionSummary: string | null;

  /** Recent visible messages to include in the prompt. */
  recentMessages: readonly GeistrChatMessage[];

  /** Memory context items (empty array = no relevant memory). */
  memoryContextItems: readonly MemoryContextItem[];

  // Runtime clock
  timezone: string;
  localDateTime: string;
  isoTimestamp: string;
  unixTimestamp: number;

  /** Additional stable sections inserted before runtime sections (prompt-cache-friendly). */
  additionalStableSections?: readonly SystemPromptSection[];

  /** Additional dynamic sections appended after built-in dynamic sections. */
  additionalDynamicSections?: readonly SystemPromptSection[];

  /** Optional profile identity data for richer assistant identity section. */
  profileIdentity?: ProfileIdentity;
}

export interface RuntimeContextResult {
  /** Stable sections (rarely change) — should go first for prompt caching. */
  stableSections: SystemPromptSection[];

  /** Dynamic sections (change every turn) — should go after stable sections. */
  dynamicSections: SystemPromptSection[];

  /** Full system instruction string assembled from sections. */
  systemInstruction: string;

  /** All sections in presentation order. */
  sections: SystemPromptSection[];
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildIdentitySection(input: RuntimeContextInput): SystemPromptSection {
  const profile = input.profileIdentity;
  if (profile) {
    const userName = "the user";
    const assistantName = profile.assistantName?.trim();
    const identityLine = assistantName
      ? `- You are ${assistantName}, a calm and thoughtful personal assistant for ${userName}.`
      : `- You are a calm and thoughtful personal assistant for ${userName}. You do not have a confirmed name yet.`;

    const lines: string[] = [
      `Current session: "${input.sessionTitle}" (${input.sessionKey}).`,
      identityLine,
    ];

    if (profile.soulPrompt?.trim()) {
      lines.push(`\nSoul: ${profile.soulPrompt.trim()}`);
    }

    if (profile.personaSummary?.trim()) {
      const persona = profile.personaSummary.trim();
      lines.push(`\nPersona: ${persona}`);
      lines.push(`Role: ${profile.rolePrompt?.trim() || persona}`);
    }

    if (profile.stylePrompt?.trim()) {
      lines.push(`\nStyle: ${profile.stylePrompt.trim()}`);
    }

    if (profile.boundaryPrompt?.trim()) {
      lines.push(`\nBoundaries: ${profile.boundaryPrompt.trim()}`);
    }

    if (profile.memoryPrompt?.trim()) {
      lines.push(`\nMemory guidance: ${profile.memoryPrompt.trim()}`);
    }

    // Include first 4 behavior notes
    let behaviorNotes: string[] = [];
    try {
      const parsed = JSON.parse(profile.agentBehaviorNotesJson ?? "[]") as unknown;
      behaviorNotes = Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string").slice(0, 4)
        : [];
    } catch {
      // ignore parse errors
    }

    if (behaviorNotes.length > 0) {
      lines.push("\nAssistant notes:");
      for (const note of behaviorNotes) {
        lines.push(`- ${note.trim()}`);
      }
    }

    return { tag: "identity", content: lines.join("\n") };
  }

  // Fallback: simple identity without profile
  return {
    tag: "identity",
    content: [
      `You are Geistr, a personal agent running in a desktop workspace.`,
      `Current session: "${input.sessionTitle}" (${input.sessionKey}).`,
    ].join("\n"),
  };
}

function buildRuntimeContextSection(input: RuntimeContextInput): SystemPromptSection {
  return {
    tag: "runtime_context",
    content: [
      `Local time: ${input.localDateTime}`,
      `Timezone: ${input.timezone}`,
      `ISO timestamp: ${input.isoTimestamp}`,
    ].join("\n"),
  };
}

function buildSessionSummarySection(input: RuntimeContextInput): SystemPromptSection | null {
  if (!input.sessionSummary || input.sessionSummary.trim().length === 0) return null;
  return {
    tag: "session_summary",
    content: input.sessionSummary.trim(),
  };
}

function buildRecentMessagesSection(input: RuntimeContextInput): SystemPromptSection {
  const formatted = input.recentMessages
    .map((msg) => `${msg.role}: ${msg.content}`)
    .join("\n");
  return {
    tag: "recent_messages",
    content: formatted || "(no messages yet)",
  };
}

function buildMemoryContextSection(input: RuntimeContextInput): SystemPromptSection {
  const items = input.memoryContextItems;
  if (!items || items.length === 0) {
    return {
      tag: "memory_context",
      content: "No relevant memory context loaded for this session.",
    };
  }

  const formatted = items
    .map((item) => `[${item.category}] ${item.content}`)
    .join("\n");
  return {
    tag: "memory_context",
    content: formatted,
  };
}

// ---------------------------------------------------------------------------
// Assemble
// ---------------------------------------------------------------------------

/**
 * Assemble runtime context for a model run.
 *
 * Returns separate `stableSections` (rarely change between turns — good for
 * provider-side prompt caching) and `dynamicSections` (change every turn).
 *
 * Built-in stable sections:
 *   1. `<identity>` — session identity (with optional profile data)
 *   2. (additional stable sections from caller)
 *
 * Built-in dynamic sections (in order):
 *   1. `<session_summary>` — compacted summary if present
 *   2. `<recent_messages>` — recent chat history
 *   3. `<runtime_context>` — local time, timezone, ISO timestamp
 *   4. `<memory_context>` — extracted memory items or placeholder
 *   5. (additional dynamic sections from caller)
 */
export function assembleRuntimeContext(input: RuntimeContextInput): RuntimeContextResult {
  // Stable sections rarely change between turns
  const stableSections: SystemPromptSection[] = [
    buildIdentitySection(input),
    ...(input.additionalStableSections ?? []),
  ];

  // Dynamic sections change every turn
  const dynamicSections: SystemPromptSection[] = [
    ...(buildSessionSummarySection(input) ? [buildSessionSummarySection(input)!] : []),
    buildRecentMessagesSection(input),
    buildRuntimeContextSection(input),
    buildMemoryContextSection(input),
    ...(input.additionalDynamicSections ?? []),
  ];

  const allSections = [...stableSections, ...dynamicSections];

  const systemInstruction = allSections
    .filter((s) => s.enabled !== false && s.content.trim().length > 0)
    .map((s) => `<${s.tag}>\n${s.content.trim()}\n</${s.tag}>`)
    .join("\n\n");

  return {
    stableSections,
    dynamicSections,
    systemInstruction,
    sections: allSections,
  };
}
