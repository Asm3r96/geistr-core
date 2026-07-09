export interface SystemPromptSection {
  /** XML-like tag name, for example `identity` or `memory_scope`. */
  tag: string;
  /** Section body. Blank content is omitted from the assembled prompt. */
  content: string;
  /** Set to false to omit a section for the current runtime context. */
  enabled?: boolean;
}

export interface AssembleSystemPromptInput {
  /** Ordered sections for simple prompts. Rendered after stable/dynamic sections if both styles are used. */
  sections?: readonly SystemPromptSection[];
  /** Stable sections should come first to preserve provider-side prompt caching. */
  stableSections?: readonly SystemPromptSection[];
  /** Dynamic sections should come after stable sections because they change more often. */
  dynamicSections?: readonly SystemPromptSection[];
}

const SECTION_TAG_PATTERN = /^[a-z][a-z0-9_:-]*$/;

export function assembleSystemPrompt(input: AssembleSystemPromptInput): string {
  const sections = [
    ...(input.stableSections ?? []),
    ...(input.dynamicSections ?? []),
    ...(input.sections ?? [])
  ];

  return sections
    .filter((section) => section.enabled !== false && section.content.trim().length > 0)
    .map(formatSection)
    .join("\n\n");
}

function formatSection(section: SystemPromptSection): string {
  assertValidSectionTag(section.tag);
  const content = section.content.trim();

  return `<${section.tag}>\n${content}\n</${section.tag}>`;
}

function assertValidSectionTag(tag: string): void {
  if (!SECTION_TAG_PATTERN.test(tag)) {
    throw new Error(`Invalid system prompt section tag: ${tag}`);
  }
}
