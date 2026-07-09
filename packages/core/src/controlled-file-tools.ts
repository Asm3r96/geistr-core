import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function createControlledFileToolDefinitions(cwd: string): ToolDefinition[] {
  return [
    defineTool({
      name: "file_write",
      label: "File Write",
      description: "Create or overwrite a text file. Requires approval depending on permission mode.",
      parameters: Type.Object({ path: Type.String(), content: Type.String() }),
      execute: async (_id, params) => {
        const path = resolvePath(cwd, params.path);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, params.content, "utf8");
        return result({ ok: true, path });
      },
    }),
    defineTool({
      name: "file_edit",
      label: "File Edit",
      description: "Edit a text file by replacing exact text. Requires approval depending on permission mode.",
      parameters: Type.Object({ path: Type.String(), oldText: Type.String(), newText: Type.String() }),
      execute: async (_id, params) => {
        const path = resolvePath(cwd, params.path);
        const current = await readFile(path, "utf8");
        if (!current.includes(params.oldText)) throw new Error("oldText not found");
        await writeFile(path, current.replace(params.oldText, params.newText), "utf8");
        return result({ ok: true, path });
      },
    }),
    defineTool({
      name: "shell_run",
      label: "Shell Run",
      description: "Run a shell command. Requires approval depending on permission mode.",
      parameters: Type.Object({ command: Type.String() }),
      execute: async (_id, params) => {
        const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
        const args = process.platform === "win32" ? ["/d", "/s", "/c", params.command] : ["-lc", params.command];
        const { stdout, stderr } = await execFileAsync(shell, args, { cwd, timeout: 120_000, maxBuffer: 1024 * 1024 });
        return result({ ok: true, stdout, stderr });
      },
    }),
  ];
}

function resolvePath(cwd: string, path: string): string {
  return resolve(cwd, path);
}

function result(details: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(details, null, 2) }], details };
}
