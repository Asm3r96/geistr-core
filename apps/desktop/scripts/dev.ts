import { spawn } from "node:child_process";

const devServerUrl = "http://127.0.0.1:5173";
const children = new Set<ReturnType<typeof spawn>>();

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env,
  });
  children.add(child);
  child.on("exit", () => children.delete(child));
  return child;
}

async function isServerUp(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer(url: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await isServerUp(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for Vite dev server at ${url}`);
}

function shutdown(code = 0) {
  for (const child of children) child.kill();
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

if (await isServerUp(devServerUrl)) {
  console.log(`[geistr] using existing Vite renderer dev server at ${devServerUrl}`);
} else {
  console.log("[geistr] starting Vite renderer dev server...");
  run("bun", ["run", "dev:renderer"]);
  await waitForServer(devServerUrl);
}

console.log("[geistr] building Electron main/preload...");
const build = run("bun", ["run", "build:main"]);
const buildCode = await new Promise<number | null>((resolve) => build.on("exit", resolve));
if (buildCode !== 0) shutdown(buildCode ?? 1);

console.log("[geistr] launching Electron desktop app...");
const electron = run("electron", ["."], {
  ...process.env,
  VITE_DEV_SERVER_URL: devServerUrl,
});

electron.on("exit", (code) => shutdown(code ?? 0));
