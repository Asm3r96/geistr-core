import type { LoopArtifactSelector } from "./types";

export function selectLoopArtifacts(all: Record<string, unknown>, selectors: LoopArtifactSelector[] = []): Record<string, unknown> {
  const selected: Record<string, unknown> = {};
  for (const selector of selectors) {
    if (!(selector.key in all)) {
      if (selector.required) throw new Error(`Required artifact "${selector.key}" is missing`);
      continue;
    }
    selected[selector.as ?? selector.key] = all[selector.key];
  }
  return selected;
}

export function mergeLoopArtifacts(current: Record<string, unknown>, next?: Record<string, unknown>): Record<string, unknown> {
  return next ? { ...current, ...next } : current;
}

export function formatLoopArtifactsForPrompt(artifacts: Record<string, unknown>): string {
  return Object.entries(artifacts)
    .map(([key, value]) => `<artifact key="${key}">\n${formatValue(value)}\n</artifact>`)
    .join("\n\n");
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}
