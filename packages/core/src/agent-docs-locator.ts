import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_AGENT_DOCS_CONTENT } from "./builtin-agent-docs-content";

/**
 * Resolve the absolute path to the agent documentation directory.
 *
 * In dev mode (source files present), returns the source agent-docs directory.
 * In bundled mode (Vite dist), returns source directory which won't exist,
 * so callers should use {@link readAgentDoc} which has a fallback.
 */
export function resolveAgentDocsDir(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return path.join(path.dirname(currentFile), "agent-docs");
}

/**
 * Check if the agent documentation directory exists and contains an index.
 */
export function agentDocsAvailable(docsDir?: string): boolean {
  const dir = docsDir ?? resolveAgentDocsDir();
  try {
    return existsSync(path.join(dir, "index.json"));
  } catch {
    return false;
  }
}

/**
 * Cache all embedded agent docs to a writable directory.
 * This ensures docs are always available on disk regardless of bundling.
 *
 * @param targetDir - Absolute path where docs should be cached
 * @returns The targetDir if any docs were written, or the source dir if already present
 */
export function cacheAgentDocs(targetDir: string): string {
  const sourceDir = resolveAgentDocsDir();

  // If the source directory already exists (dev mode), just use it
  if (existsSync(path.join(sourceDir, "index.json"))) {
    return sourceDir;
  }

  // Otherwise cache embedded content to targetDir
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  for (const [fileName, content] of Object.entries(BUILTIN_AGENT_DOCS_CONTENT)) {
    const filePath = path.join(targetDir, fileName);
    if (!existsSync(filePath)) {
      writeFileSync(filePath, content, "utf-8");
    }
  }

  return targetDir;
}

/**
 * Read an agent documentation file, trying filesystem first and falling back
 * to embedded content.
 *
 * @param docName - File name like "profile-and-soul.md" or "index.json"
 * @param docsDir - Optional explicit directory path (if provided, filesystem is tried first)
 * @returns The file content, or null if not found
 */
export function readAgentDoc(docName: string, docsDir?: string): string | null {
  // Try filesystem first
  if (docsDir) {
    const filePath = path.join(docsDir, docName);
    if (existsSync(filePath)) {
      return readFileSync(filePath, "utf-8");
    }
  }

  // Fall back to embedded content
  return BUILTIN_AGENT_DOCS_CONTENT[docName] ?? null;
}

/**
 * List available agent doc file names.
 */
export function listAgentDocNames(docsDir?: string): string[] {
  return Object.keys(BUILTIN_AGENT_DOCS_CONTENT).sort();
}
