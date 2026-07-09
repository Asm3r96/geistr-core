import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const preferredMaxLines = 500;
const hardMaxLines = 800;

const checkedExtensions = new Set([
  ".ts",
  ".tsx",
  ".css",
]);

const ignoredDirectoryNames = new Set([
  ".git",
  ".agents",
  "dist",
  "build",
  "coverage",
  "node_modules",
  ".vite",
]);

function extensionOf(path: string): string {
  const match = /\.[^.]+$/.exec(path);
  return match?.[0] ?? "";
}

const ignoredFileNames = new Set([
  "builtin-agent-docs-content.ts",
]);

function shouldCheckFile(path: string): boolean {
  return checkedExtensions.has(extensionOf(path));
}

function isIgnoredFile(filePath: string): boolean {
  // Handle both Windows and POSIX paths
  const normalized = filePath.split("\\").join("/");
  const basename = normalized.split("/").pop() ?? "";
  return ignoredFileNames.has(basename);
}

function walk(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolute = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (ignoredDirectoryNames.has(entry.name)) continue;
      files.push(...walk(absolute));
      continue;
    }

    if (entry.isFile() && shouldCheckFile(absolute) && !isIgnoredFile(absolute)) {
      files.push(absolute);
    }
  }

  return files;
}

function countLines(path: string): number {
  const stat = statSync(path);
  if (stat.size === 0) return 0;

  const text = readFileSync(path, "utf8");
  if (text.length === 0) return 0;

  return text.split(/\r\n|\r|\n/).length;
}

const results = walk(root)
  .map((path) => ({
    path: relative(root, path).replace(/\\/g, "/"),
    lines: countLines(path),
  }))
  .sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));

const hardFailures = results.filter((result) => result.lines > hardMaxLines);
const warnings = results.filter(
  (result) => result.lines > preferredMaxLines && result.lines <= hardMaxLines,
);

if (warnings.length > 0) {
  console.warn(`Files above preferred ${preferredMaxLines}-line target:`);
  for (const result of warnings) {
    console.warn(`  ${result.lines.toString().padStart(4, " ")}  ${result.path}`);
  }
  console.warn("");
}

if (hardFailures.length > 0) {
  console.error(`Files above hard ${hardMaxLines}-line maximum:`);
  for (const result of hardFailures) {
    console.error(`  ${result.lines.toString().padStart(4, " ")}  ${result.path}`);
  }
  console.error("\nSplit these files by responsibility before continuing.");
  process.exit(1);
}

console.log(`File size check passed (${results.length} files checked, hard max ${hardMaxLines} lines).`);
