import { describe, expect, it } from "vitest";
import { LoopCatalog, createLoopToolDefinitions, type LoopCatalogRunner } from "../src/loop-catalog";

const available = { loopId: "safe", label: "Safe", description: "Safe loop", status: "available" as const, inputSchema: {}, defaultMode: "background" as const, requiresApproval: false, allowedScopes: ["agent"], resultPolicy: "artifact-required" as const };
const disabled = { ...available, loopId: "off", status: "disabled" as const };

describe("LoopCatalog tools", () => {
  it("loop_read list only exposes approved loops", async () => {
    const catalog = new LoopCatalog([available, disabled]);
    const runner = fakeRunner();
    const [read] = createLoopToolDefinitions({ catalog, runner, getSessionKey: () => "s1" });
    expect(read).toBeDefined();
    const result = await read!.execute("tool", { action: "list" }, new AbortController().signal, () => undefined, {} as never);
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("safe");
    expect(text).not.toContain("off");
  });

  it("loop_write rejects unknown/disabled loops and starts approved loops with inferred session", async () => {
    const catalog = new LoopCatalog([available, disabled]);
    const starts: unknown[] = [];
    const runner = fakeRunner(starts);
    const [, write] = createLoopToolDefinitions({ catalog, runner, getSessionKey: () => "active-session" });
    expect(write).toBeDefined();
    const rejected = await write!.execute("tool", { action: "start", loopId: "off" }, new AbortController().signal, () => undefined, {} as never);
    expect(JSON.stringify(rejected.details)).toContain("unavailable");
    const started = await write!.execute("tool", { action: "start", loopId: "safe", input: { ok: true } }, new AbortController().signal, () => undefined, {} as never);
    expect(started.details).toMatchObject({ started: true, loopId: "safe", resultDelivery: "same-session-wakeup" });
    expect(starts).toEqual([{ loopId: "safe", sessionKey: "active-session", input: { ok: true } }]);
  });
});

function fakeRunner(starts: unknown[] = []): LoopCatalogRunner {
  return {
    start: async (input) => { starts.push(input); return { runId: "run1", status: "queued" }; },
    cancel: async () => true,
    status: async (runId) => ({ runId, loopId: "safe", status: "completed", summary: "done" }),
  };
}
