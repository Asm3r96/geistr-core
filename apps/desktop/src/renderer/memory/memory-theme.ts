import type { MemoryType } from "@geistr/core";

const MEMORY_TYPE_VARS: Record<MemoryType, string> = {
  fact: "--memory-type-fact",
  preference: "--memory-type-preference",
  goal: "--memory-type-goal",
  episode: "--memory-type-episode",
  person_context: "--memory-type-person_context",
  lesson: "--memory-type-lesson",
};

const GRAPH_THEME_VARS = [
  "--memory-link-default",
  "--memory-link-highlight",
  "--memory-link-dim",
  "--memory-canvas-bg",
] as const;

export interface MemoryGraphTheme {
  typeColors: Record<MemoryType, string>;
  linkDefault: string;
  linkHighlight: string;
  linkDim: string;
  canvasBg: string;
  isLight: boolean;
}

function readVar(
  styles: CSSStyleDeclaration,
  name: string,
  property: "color" | "backgroundColor" = "color",
  fallback = "#888",
): string {
  const raw = styles.getPropertyValue(name).trim();
  if (!raw || typeof document === "undefined") return fallback;

  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.pointerEvents = "none";
  probe.style.opacity = "0";
  probe.style[property] = raw;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe)[property].trim();
  probe.remove();
  return resolved || raw || fallback;
}

export function readMemoryGraphTheme(scope?: Element | null): MemoryGraphTheme {
  const rootStyles = getComputedStyle(document.documentElement);
  const styles = getComputedStyle(scope ?? document.documentElement);
  const isLight = rootStyles.colorScheme.includes("light") && !rootStyles.colorScheme.includes("dark");
  const typeColors = {} as Record<MemoryType, string>;
  const fallbackByType: Record<MemoryType, string> = {
    fact: "#5b9cf5",
    preference: "#c77dff",
    goal: "#e6b84d",
    episode: "#3dbf8a",
    person_context: "#f06b9d",
    lesson: "#4cc9f0",
  };
  for (const [type, varName] of Object.entries(MEMORY_TYPE_VARS) as [MemoryType, string][]) {
    typeColors[type] = readVar(styles, varName, "color", fallbackByType[type]);
  }
  return {
    typeColors,
    linkDefault: isLight ? "rgba(18, 24, 32, 0.34)" : "rgba(180, 190, 205, 0.22)",
    linkHighlight: isLight ? "rgba(28, 36, 48, 0.56)" : "rgba(210, 220, 235, 0.42)",
    linkDim: isLight ? "rgba(18, 24, 32, 0.12)" : "rgba(180, 190, 205, 0.08)",
    canvasBg: readVar(styles, GRAPH_THEME_VARS[3], "backgroundColor", "rgb(10, 14, 22)"),
    isLight,
  };
}

export function memoryTypeClassName(memoryType: MemoryType): string {
  return `memoryTypePill type-${memoryType}`;
}