import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { BUILTIN_SKILL_CONTENT } from "./builtin-skill-content";

export type SkillSource = "builtin" | "user" | "workspace";

export interface SkillCatalogEntry {
  name: string;
  description: string;
  source: SkillSource;
}

export interface LoadedSkill {
  name: string;
  description: string | null;
  source: SkillSource;
  files: Array<{ path: string; content: string }>;
}

export interface SkillRoot {
  source: SkillSource;
  rootDir: string;
}

export interface SkillLoadError { error: string }

const BUILTIN_SKILLS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "builtin-skills");
const SAFE_SKILL_NAME = /^[a-z0-9][a-z0-9_-]*$/i;
const MARKDOWN_LINK_PATTERN = /\[[^\]]+\]\(([^)]+\.md)(?:#[^)]+)?\)/gi;

export function createDefaultSkillRoots(options: { userSkillsDir?: string | null; workspaceSkillsDir?: string | null } = {}): SkillRoot[] {
  const roots: SkillRoot[] = [{ source: "builtin", rootDir: BUILTIN_SKILLS_DIR }];
  if (options.userSkillsDir) roots.push({ source: "user", rootDir: options.userSkillsDir });
  if (options.workspaceSkillsDir) roots.push({ source: "workspace", rootDir: options.workspaceSkillsDir });
  return roots;
}

export class SkillRegistry {
  constructor(private readonly roots: readonly SkillRoot[] = createDefaultSkillRoots()) {}

  list(): SkillCatalogEntry[] {
    const entries: SkillCatalogEntry[] = [];
    for (const root of this.roots) {
      for (const name of listCandidateSkillNames(root)) {
        const loaded = this.load(name, { includeReferences: false });
        if ("error" in loaded) continue;
        entries.push({ name: loaded.name, description: loaded.description ?? "", source: loaded.source });
      }
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  load(name: string, options: { includeReferences?: boolean } = {}): LoadedSkill | SkillLoadError {
    const validation = validateSkillName(name);
    if (validation) return { error: validation };

    const match = findSkillDirectory(this.roots, name);
    if (!match) return { error: `unknown skill: ${name}` };

    const skillContent = readSkillFile(match, "SKILL.md");
    if (skillContent === null) return { error: `skill ${name} is missing SKILL.md` };
    const metadata = parseSkillFrontmatter(skillContent);
    const files = [{ path: "SKILL.md", content: skillContent }];

    if (options.includeReferences !== false) {
      for (const referencePath of findSiblingMarkdownReferences(skillContent)) {
        const content = readSkillFile(match, referencePath);
        if (content === null) continue;
        files.push({ path: normalizeRelativePath(referencePath), content });
      }
    }

    return {
      name: metadata.name || name,
      description: metadata.description || null,
      source: match.source,
      files,
    };
  }
}

export function createSkillLoadToolDefinition(registry: SkillRegistry = new SkillRegistry(), options: { disabledSkillNames?: readonly string[] } = {}): ToolDefinition {
  const disabled = new Set(options.disabledSkillNames ?? []);
  return defineTool({
    name: "skill_load",
    label: "Skill Load",
    description: "Load full instructions for an installed skill by name. Read-only; does not create, update, or delete skills.",
    parameters: Type.Object({ name: Type.String(), includeReferences: Type.Optional(Type.Boolean()) }),
    execute: async (_id, params) => {
      const name = asString(params.name);
      if (disabled.has(name)) return toolResult({ error: `skill is deactivated: ${name}` });
      return toolResult(registry.load(name, { includeReferences: params.includeReferences !== false }));
    },
  });
}

export function createSkillToolDefinitions(registry: SkillRegistry = new SkillRegistry(), options: { disabledSkillNames?: readonly string[] } = {}): ToolDefinition[] {
  return [createSkillLoadToolDefinition(registry, options)];
}

function listCandidateSkillNames(root: SkillRoot): string[] {
  const names = new Set<string>();
  if (root.source === "builtin") Object.keys(BUILTIN_SKILL_CONTENT).forEach((name) => names.add(name));
  try {
    for (const entry of readdirSync(root.rootDir, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(path.join(root.rootDir, entry.name, "SKILL.md"))) names.add(entry.name);
    }
  } catch {
    // Built-in fallback content still works when Markdown files are not present beside a production bundle.
  }
  return [...names].sort();
}

function findSkillDirectory(roots: readonly SkillRoot[], name: string): { source: SkillSource; skillDir: string; name: string } | null {
  for (const root of roots) {
    const skillDir = path.join(root.rootDir, name);
    const resolvedRoot = path.resolve(root.rootDir);
    const resolvedSkill = path.resolve(skillDir);
    if (!isInsideOrEqual(resolvedSkill, resolvedRoot)) continue;
    if (existsSync(path.join(resolvedSkill, "SKILL.md")) || (root.source === "builtin" && BUILTIN_SKILL_CONTENT[name]?.["SKILL.md"])) return { source: root.source, skillDir: resolvedSkill, name };
  }
  return null;
}

function readSkillFile(skill: { source: SkillSource; skillDir: string; name: string }, relativePath: string): string | null {
  const normalized = normalizeRelativePath(relativePath);
  const absolute = safeResolveInside(skill.skillDir, normalized);
  if (absolute && existsSync(absolute)) return readFileSync(absolute, "utf8");
  if (skill.source === "builtin") return BUILTIN_SKILL_CONTENT[skill.name]?.[normalized] ?? null;
  return null;
}

function validateSkillName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "skill name is required";
  if (!SAFE_SKILL_NAME.test(trimmed) || trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) {
    return "invalid skill name";
  }
  return null;
}

function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
  if (!content.startsWith("---\n")) return {};
  const end = content.indexOf("\n---", 4);
  if (end === -1) return {};
  const frontmatter = content.slice(4, end).split(/\r?\n/);
  const result: { name?: string; description?: string } = {};
  for (const line of frontmatter) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['\"]|['\"]$/g, "");
    if (key === "name") result.name = value;
    if (key === "description") result.description = value;
  }
  return result;
}

function findSiblingMarkdownReferences(content: string): string[] {
  const found = new Set<string>();
  for (const match of content.matchAll(MARKDOWN_LINK_PATTERN)) {
    const target = match[1]?.trim();
    if (!target || target.startsWith("http://") || target.startsWith("https://")) continue;
    const normalized = normalizeRelativePath(decodeURIComponent(target));
    if (normalized && !normalized.startsWith("../") && !path.isAbsolute(normalized)) found.add(normalized);
  }
  return [...found].sort();
}

function safeResolveInside(rootDir: string, relativePath: string): string | null {
  const resolvedRoot = path.resolve(rootDir);
  const resolved = path.resolve(rootDir, relativePath);
  return isInsideOrEqual(resolved, resolvedRoot) ? resolved : null;
}

function isInsideOrEqual(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toolResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], details: data as Record<string, unknown> };
}
