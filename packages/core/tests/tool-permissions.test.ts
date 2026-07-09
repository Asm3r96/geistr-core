import { describe, expect, test } from "bun:test";
import {
  classifyBashCommand,
  classifyToolPermission,
  decideToolPermission,
  gateToolDefinition,
  type ToolApprovalGate,
} from "../src/tool-permissions";

describe("tool permissions", () => {
  test("classifies safe internal reads", () => {
    expect(classifyToolPermission({ toolName: "profile_read" }).tier).toBe("safe");
    expect(classifyToolPermission({ toolName: "memory_read" }).tier).toBe("safe");
    expect(classifyToolPermission({ toolName: "loop_read" }).tier).toBe("safe");
  });

  test("classifies internal writes and file mutations", () => {
    expect(classifyToolPermission({ toolName: "profile_write" }).tier).toBe("internal_mutate");
    expect(classifyToolPermission({ toolName: "memory_write" }).tier).toBe("internal_mutate");
    expect(classifyToolPermission({ toolName: "edit", path: "src/a.ts" }).tier).toBe("file_mutate");
  });

  test("classifies bash read, mutation, dangerous, and blocked commands", () => {
    expect(classifyBashCommand("ls packages/core").tier).toBe("safe");
    expect(classifyBashCommand("echo hi > note.txt").tier).toBe("file_mutate");
    expect(classifyBashCommand("git reset --hard HEAD~1").tier).toBe("dangerous");
    expect(classifyBashCommand("sudo rm -rf /").tier).toBe("blocked");
  });

  test("applies mode decisions", () => {
    expect(decideToolPermission("read-only", { toolName: "profile_read" }).decision).toBe("allow");
    expect(decideToolPermission("read-only", { toolName: "file_write" }).decision).toBe("block");
    expect(decideToolPermission("ask-always", { toolName: "profile_read" }).decision).toBe("allow");
    expect(decideToolPermission("ask-always", { toolName: "memory_write" }).decision).toBe("ask");
    expect(decideToolPermission("ask-always", { toolName: "memory_write", explicitUserIntent: true }).decision).toBe("allow");
    expect(decideToolPermission("auto", { toolName: "memory_write" }).decision).toBe("allow");
    expect(decideToolPermission("auto", { toolName: "bash", command: "git push" }).decision).toBe("ask");
    expect(decideToolPermission("full-access", { toolName: "bash", command: "git push" }).decision).toBe("allow");
    expect(decideToolPermission("full-access", { toolName: "bash", command: "sudo reboot" }).decision).toBe("block");
  });

  test("gated tool waits for approval before executing", async () => {
    let executed = false;
    let approvalSeen = false;
    const gate: ToolApprovalGate = {
      async approve(request, assessment) {
        approvalSeen = request.toolName === "unknown_tool" && assessment.decision === "ask";
        expect(executed).toBe(false);
        return true;
      },
    };
    const okResult = { content: [{ type: "text" as const, text: "ok" }], details: { ok: true } };
    const tool = gateToolDefinition({ name: "unknown_tool", label: "Unknown", description: "", parameters: {} as never, execute: async () => { executed = true; return okResult; } } as never, { mode: "auto", gate });
    const result = await tool.execute?.("id", {}, undefined, undefined, {} as never);
    expect(result).toBe(okResult);
    expect(approvalSeen).toBe(true);
    expect(executed).toBe(true);
  });

  test("gated tool blocks catastrophic command without approval", async () => {
    const gate: ToolApprovalGate = { approve: async () => { throw new Error("should not ask"); } };
    const tool = gateToolDefinition({ name: "bash", label: "Bash", description: "", parameters: {} as never, execute: async () => ({ content: [{ type: "text" as const, text: "ok" }], details: { ok: true } }) } as never, { mode: "full-access", gate });
    await expect(tool.execute?.("id", { command: "sudo reboot" }, undefined, undefined, {} as never)).rejects.toThrow(/Blocked bash/);
  });
});
