import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { CoreModelSelection, SystemPromptSection } from "@geistr/core";

export interface SystemPromptLogInput {
  rootDir: string;
  sessionKey: string | null;
  modelSelection: CoreModelSelection | null;
  sections: readonly SystemPromptSection[];
  systemPrompt: string;
}

export function logSystemPromptSnapshot(input: SystemPromptLogInput): string {
  const dir = path.join(input.rootDir, "system-prompts");
  mkdirSync(dir, { recursive: true });
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const session = sanitizePathPart(input.sessionKey ?? "no-session");
  const filePath = path.join(dir, `${stamp}_${session}.json`);
  writeFileSync(filePath, JSON.stringify({
    createdAt: now.toISOString(),
    sessionKey: input.sessionKey,
    modelSelection: input.modelSelection,
    sectionTags: input.sections.map((section) => section.tag),
    sections: input.sections,
    systemPrompt: input.systemPrompt,
  }, null, 2));
  return filePath;
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 80) || "session";
}
