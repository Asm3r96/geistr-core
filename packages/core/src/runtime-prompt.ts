// ---------------------------------------------------------------------------
// Runtime Prompt Assembly
//
// Port of the old Geistr promptAssembly.ts into the new app's architecture.
// Builds layered system prompt sections from assistant profile, user profile,
// memory context, session summary, recent messages, active skill catalog, and
// runtime clock.
// ---------------------------------------------------------------------------

import { assembleSystemPrompt, type SystemPromptSection } from "./system-prompt";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const PROMPT_RECENT_MESSAGE_LIMIT = 16;

export interface PromptMemoryItem {
  readonly id: string;
  readonly content: string;
  readonly category: "preference" | "profile" | "goal" | "fact";
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface PromptRuntimeClock {
  readonly localDateTime: string;
  readonly timezone: string;
  readonly isoTimestamp: string;
  readonly unixTimestamp: number;
}

export interface RuntimePromptInput {
  /** Assistant profile with all identity fields. */
  assistantProfile: {
    assistantName: string;
    personaSummary: string;
    tone: string;
    communicationStyle: string;
    soulPrompt: string;
    rolePrompt: string;
    stylePrompt: string;
    boundaryPrompt: string;
    memoryPrompt: string;
    responseDepth: string;
    warmth: string;
    directness: string;
    agentBehaviorNotesJson: string;
  };

  /** User profile fields. */
  userProfile: {
    displayName: string;
    locale: string;
    languagePreferences: string;
    learningStyle: string;
    activeGoals: string;
    preferences: string;
    constraints: string;
  };

  /** Memory context items for prompt inclusion. */
  memoryContext: readonly (string | PromptMemoryItem)[];

  /** Session summary text from a prior compaction. */
  sessionSummary: string | null;

  /** Recent chat messages (capped internally to PROMPT_RECENT_MESSAGE_LIMIT). */
  recentMessages: readonly {
    id: string;
    role: string;
    content: string;
    createdAt: number;
  }[];

  /** Active skill catalog entries (name: description). */
  activeSkillCatalog?: readonly string[];


  /** Runtime clock if available. */
  runtimeClock?: PromptRuntimeClock | null;

  /** Timezone for formatting timestamps (from user profile or clock). */
  timezone?: string;

  /**
   * Absolute path to the agent documentation directory.
   * When provided, the prompt will include a section telling the agent
   * where to find documentation about each system.
   */
  agentDocsPath?: string;
}

export interface RuntimePromptResult {
  /** Full assembled system instruction string. */
  systemInstruction: string;

  /** All sections in presentation order. */
  sections: SystemPromptSection[];

  /** Recent messages after limit has been applied. */
  recentMessages: RuntimePromptInput["recentMessages"];
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatValue(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function formatValueOrEmpty(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function formatBulletList(items: readonly string[], emptyFallback: string): string {
  const normalized = items.map((item) => item.trim()).filter(Boolean);
  return normalized.length === 0
    ? `- ${emptyFallback}`
    : normalized.map((item) => `- ${item}`).join("\n");
}

function formatAssistantIdentityLine(assistantName: string | null | undefined, userName: string): string {
  const trimmedName = assistantName?.trim();
  return trimmedName
    ? `- You are ${trimmedName}, a calm and thoughtful personal assistant for ${userName}.`
    : `- You are a calm and thoughtful personal assistant for ${userName}. You do not have a confirmed name yet.`;
}

function formatPromptMemoryTime(timestamp: number, timezone: string): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "unknown time";
  try {
    return `${new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(new Date(timestamp))} (${timezone})`;
  } catch {
    return new Date(timestamp).toISOString();
  }
}

function formatMemoryContextItem(item: string | PromptMemoryItem, timezone: string): string {
  if (typeof item === "string") return item.trim();
  const categoryLabel =
    item.category === "preference" ? "Preference"
    : item.category === "profile" ? "Profile"
    : item.category === "goal" ? "Goal"
    : "Fact";
  return `${categoryLabel}: ${item.content.trim()} [saved: ${formatPromptMemoryTime(item.createdAt, timezone)}; updated: ${formatPromptMemoryTime(item.updatedAt, timezone)}]`;
}

function formatRuntimeClock(clock: PromptRuntimeClock): string {
  return `${clock.localDateTime} (${clock.timezone}) | ISO ${clock.isoTimestamp} | unix ${clock.unixTimestamp}`;
}

function formatRecentConversation(messages: RuntimePromptInput["recentMessages"]): string {
  return formatBulletList(
    messages.map((message) => `${message.role}: ${message.content.trim()}`),
    "No recent conversation yet.",
  );
}

function resolveTimezone(value: string | null | undefined): string {
  const tz = value?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(0);
    return tz;
  } catch {
    return "UTC";
  }
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Agent docs catalog for on-discover injection
// ---------------------------------------------------------------------------

const AGENT_DOCS_CATALOG: Array<{ topic: string; path: string }> = [
  { topic: "profile, soul, identity, profile tools", path: "profile-and-soul.md" },
  { topic: "memory system, memory tools, auto indexing", path: "memory.md" },
  { topic: "session, compaction, context window", path: "session-and-compaction.md" },
  { topic: "tool reference, all custom tools", path: "tools-reference.md" },
  { topic: "skills guide, creating skills, skill_load", path: "skills-guide.md" },
  { topic: "permissions, access modes, approval", path: "permissions.md" },
  { topic: "MCP servers, MCP tools", path: "mcp.md" },
  { topic: "background loops, loop tools", path: "loops.md" },
];

function buildAgentDocsSection(absolutePath: string): SystemPromptSection {
  const lines: string[] = [
    "Agent documentation:",
    "",
    `- Documentation is available at: ${absolutePath}`,
    `- Read index.json there for the full catalog.`,
    "",
    "When the user asks about any of these systems, read the corresponding documentation file before answering:",
    ...AGENT_DOCS_CATALOG.map((entry) => `  - ${entry.topic} → ${entry.path}`),
    "",
    "Do not guess or rely on pretraining knowledge alone. Read the actual doc and follow its contents.",
  ];

  return {
    tag: "agent_docs",
    content: lines.join("\n"),
  };
}

const FIXED_CORE_SECTION = buildFixedCoreSection();

function buildFixedCoreSection(): SystemPromptSection {
  return {
    tag: "fixed_core",
    content: [
      "Fixed operating rules:",
      "",
      "- Fixed operating rules live in app code and are never user-editable or agent-editable.",
      "- Never rewrite safety, privacy, permission, or tool-boundary rules.",
      "- Runtime role: choose the cheapest correct tool path and follow tool policy exactly.",
      "- Skills are mandatory workflow instructions, not optional hints.",
      "- When you want to do something and a matching skill exists for that task, you MUST call skill_load to load that skill's full instructions before using tools or answering.",
      "- skill_load is read-only; it does not create, edit, or delete skills.",
      "- To create, update, or delete skills, use normal file tools/commands under configured skill folders, subject to permission approval.",
      "- Only create, update, or delete skills when the user explicitly requests it.",
      "- Skill instructions are operational context for the current task; do not store them in memory or profiles.",
      "- MCP tools come from user-configured external servers and may be unavailable or untrusted.",
      "- Use MCP tools only when they are relevant to the user request.",
      "- Do not ask the user to paste secrets into chat for MCP setup; use the MCP Servers UI/settings flow.",
      "- If an MCP action requires approval, wait for the app approval UI/tool result.",
      "- Do not claim an MCP action succeeded unless the tool call returned success.",
      "- Use memory only for durable user context, not for changing your own behavior.",
      "- To change your own profile (name, tone, role), the user's profile, or app settings, use config/profile writes, not memory.",
      "- Treat role/style/personality changes as profile updates, not memory writes.",
      "- Always format URLs using Markdown like [Link Title](URL) so they are clickable in the UI.",
      "- Math formatting: use $...$ inline and fenced ```latex blocks for display formulas.",
      "- Use emojis sparingly.",
      "- To change your own Name, Soul, Role, Style, Boundaries, Memory guidance, tone, or recurring behavior, use Profile.write on assistantProfile.",
      "- Do not store assistant behavior, personality, role, or style changes as memory — they belong in the profile.",
      "- To change user profile fields (display name, locale, goals, preferences, constraints, etc.), use Profile.write on userProfile.",
      "- To change app preferences (theme mode, session compaction, memory), use Profile.write on appConfig.",
      "- Never claim a profile or config change succeeded unless Profile.write returned success with the expected changedFields.",
      "- Soul maps to the core field soulPrompt and the SQLite column soul_prompt.",
      "- Profile.write is the correct tool for name, identity, personality, and behavior changes. Do not use memory for these.",
      "- If the user explicitly says 'remember X', use memory_write create for durable non-profile user context.",
      "- If the user says 'forget X', 'delete that memory', or 'that memory is wrong', use memory_write delete/update/supersede as appropriate.",
      "- If the user asks 'what do you remember about X?', use memory_read.",
      "- Profile is source of truth over memory/session summaries when they conflict.",
      "- Do not silently edit memory based only on inference during chat; the background memory indexing loop handles automatic extraction.",
    ].join("\n"),
  };
}

function buildAssistantIdentitySection(input: RuntimePromptInput, userName: string): SystemPromptSection {
  const timezone = resolveTimezone(input.timezone);
  let assistantNotes: string[] = [];
  try {
    const parsed = JSON.parse(input.assistantProfile.agentBehaviorNotesJson) as unknown;
    assistantNotes = Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string").map((s) => s.trim()).filter(Boolean).slice(0, 4)
      : [];
  } catch {
    assistantNotes = [];
  }

  const lines: string[] = [
    "Assistant identity:",
    "",
    "Core identity:",
    formatAssistantIdentityLine(input.assistantProfile.assistantName, userName),
    "",
  ];

  // Build soul/persona/role/style/boundary/memory section
  const soul = formatValueOrEmpty(input.assistantProfile.soulPrompt);
  const persona = formatValue(input.assistantProfile.personaSummary, "Not set yet.");
  const role = formatValueOrEmpty(input.assistantProfile.rolePrompt) || persona;
  const style = formatValueOrEmpty(input.assistantProfile.stylePrompt) ||
    [formatValue(input.assistantProfile.tone, "Not set yet."), formatValue(input.assistantProfile.communicationStyle, "Not set yet.")].join(". ");
  const boundary = formatValueOrEmpty(input.assistantProfile.boundaryPrompt) || "Not set yet.";
  const memoryGuidance = formatValueOrEmpty(input.assistantProfile.memoryPrompt) || "Not set yet.";

  lines.push("User-requested role and style:");
  lines.push(`- Soul: ${soul || "Not set yet."}`);
  lines.push(`- Persona summary: ${persona}`);
  lines.push(`- Role: ${role}`);
  lines.push(`- Style: ${style}`);
  lines.push(`- Boundaries: ${boundary}`);
  lines.push(`- Memory guidance: ${memoryGuidance}`);

  if (assistantNotes.length > 0) {
    lines.push("");
    lines.push("Assistant notes:");
    lines.push(formatBulletList(assistantNotes, "No assistant notes yet."));

    // The last behavior note is the persona summary which is already shown
    // above; avoid repeating it
    if (assistantNotes.length > 0) {
      lines.push("");
    }
  }

  return {
    tag: "assistant_identity",
    content: lines.join("\n"),
  };
}

function buildSkillsSection(activeSkillCatalog: readonly string[]): SystemPromptSection {
  const catalog = activeSkillCatalog.map((item) => item.trim()).filter(Boolean);

  const lines: string[] = [
    "Skills:",
    "",
    "- Installed active skills are listed here by name and description only.",
    "- If a matching skill appears here, call skill_load to load its full instructions before acting.",
    catalog.length > 0
      ? formatBulletList([...catalog], "No active skills available.")
      : "- No active skills available.",
  ];

  return {
    tag: "skills",
    content: lines.join("\n"),
  };
}

function buildRuntimeContextSection(input: RuntimePromptInput, userName: string): SystemPromptSection {
  const timezone = resolveTimezone(input.timezone ?? input.runtimeClock?.timezone);
  const recentMessages = input.recentMessages.slice(-PROMPT_RECENT_MESSAGE_LIMIT);

  const memoryContext = formatBulletList(
    input.memoryContext.map((item) => formatMemoryContextItem(item, timezone)),
    "No durable memory items yet.",
  );

  const lines: string[] = [
    "Runtime context:",
    "",
    "User profile:",
    `- Display name: ${userName}`,
    `- Locale: ${formatValue(input.userProfile.locale, "Not set yet.")}`,
    `- Language preferences: ${formatValue(input.userProfile.languagePreferences, "Not set yet.")}`,
  ];

  if (formatValueOrEmpty(input.userProfile.learningStyle)) {
    lines.push(`- Learning style: ${formatValueOrEmpty(input.userProfile.learningStyle)}`);
  }
  if (formatValueOrEmpty(input.userProfile.activeGoals)) {
    lines.push(`- Active goals: ${formatValueOrEmpty(input.userProfile.activeGoals)}`);
  }
  if (formatValueOrEmpty(input.userProfile.preferences)) {
    lines.push(`- Preferences: ${formatValueOrEmpty(input.userProfile.preferences)}`);
  }
  if (formatValueOrEmpty(input.userProfile.constraints)) {
    lines.push(`- Constraints: ${formatValueOrEmpty(input.userProfile.constraints)}`);
  }

  if (input.runtimeClock) {
    lines.push("");
    lines.push("Current time:");
    lines.push(`- Local now: ${formatRuntimeClock(input.runtimeClock)}`);
  }

  if (recentMessages.length > 0) {
    lines.push("");
    lines.push("Recent conversation:");
    lines.push(formatRecentConversation(recentMessages));
  }

  lines.push("");
  lines.push("Relevant long-term memory:");
  lines.push(memoryContext);

  lines.push("");
  lines.push("Session summary:");
  lines.push(`- ${formatValue(input.sessionSummary, "No session summary yet.")}`);

  return {
    tag: "runtime_context",
    content: lines.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Main assembly function
// ---------------------------------------------------------------------------

/**
 * Build a complete runtime prompt from profile data, memory, and session
 * context. This is the direct port of the old Geistr `buildGeistrPromptAssembly`
 * function.
 *
 * Sections (in presentation order):
 * 1. `<fixed_core>` — immutable operating rules
 * 2. `<assistant_identity>` — soul, persona, role, style, boundaries, memory guidance, behavior notes
 * 3. `<skills>` — active skill catalog placeholder
 * 4. `<agent_docs>` — agent documentation directory pointer (if path available)
 * 5. `<runtime_context>` — user profile, current time, message timing, memory, session summary
 *
 * Sections 1-4 are relatively stable (good for prompt caching).
 * The runtime_context section changes every turn.
 */
export function buildRuntimePrompt(input: RuntimePromptInput): RuntimePromptResult {
  const recentMessages = input.recentMessages.slice(-PROMPT_RECENT_MESSAGE_LIMIT);
  const userName = formatValue(input.userProfile.displayName, "the user");

  const stableSections: SystemPromptSection[] = [
    FIXED_CORE_SECTION,
    buildAssistantIdentitySection(input, userName),
    buildSkillsSection(input.activeSkillCatalog ?? []),
    ...(input.agentDocsPath ? [buildAgentDocsSection(input.agentDocsPath)] : []),
  ];

  const dynamicSections: SystemPromptSection[] = [
    buildRuntimeContextSection(input, userName),
  ];

  const allSections = [...stableSections, ...dynamicSections];

  const systemInstruction = assembleSystemPrompt({
    stableSections,
    dynamicSections,
  });

  return {
    systemInstruction,
    sections: allSections,
    recentMessages,
  };
}
