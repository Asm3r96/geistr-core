import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

export type ToolPermissionMode = "read-only" | "ask-always" | "auto" | "full-access";
export type ToolPermissionTier = "safe" | "internal_mutate" | "file_mutate" | "dangerous" | "blocked";
export type ToolPermissionDecision = "allow" | "ask" | "block";

export interface ToolPermissionRequest {
  toolName: string;
  action?: string;
  command?: string;
  path?: string;
  cwd?: string;
  explicitUserIntent?: boolean;
}

export interface ToolPermissionAssessment {
  tier: ToolPermissionTier;
  decision: ToolPermissionDecision;
  reason: string;
}

export interface PendingToolApproval extends ToolPermissionRequest, ToolPermissionAssessment {
  id: string;
  createdAt: number;
}

const SAFE_TOOLS = new Set(["profile_read", "memory_read", "loop_read", "skill_load", "read", "file_read", "web_search", "web_fetch"]);
const INTERNAL_MUTATE_TOOLS = new Set(["profile_write", "memory_write", "loop_write"]);
const FILE_MUTATE_TOOLS = new Set(["write", "edit", "file_write", "file_edit"]);
const DANGEROUS_TOOLS = new Set(["bash", "shell_run", "computer"]);

const BLOCKED_COMMAND_PATTERNS: RegExp[] = [
  /(^|\s)sudo\b/,
  /(^|\s)dd\b/,
  /(^|\s)mkfs(\.|\b)/,
  /(^|\s)shutdown\b/,
  /(^|\s)reboot\b/,
  /rm\s+(-[^\s]*r[^\s]*f|-f[^\s]*r|-[^\s]*rf)\s+(\/|~|\$HOME|%USERPROFILE%)(\s|$)/i,
  /Remove-Item\s+.*(-Recurse).*(-Force)|Remove-Item\s+.*(-Force).*(-Recurse)/i,
];

const DANGEROUS_COMMAND_PATTERNS: RegExp[] = [
  /(^|\s)git\s+(commit|push|reset|clean|checkout|switch|merge|rebase)\b/i,
  /(^|\s)(npm|pnpm|bun|yarn)\s+(install|update|add|remove|upgrade|ci|audit\s+fix)\b/i,
  /(^|\s)(curl|wget|Invoke-WebRequest|iwr)\b/i,
  /(^|\s)(ssh|scp|rsync)\b/i,
  /(^|\s)(chmod|chown|icacls)\b/i,
  /(^|\s)(psql|mysql|sqlite3|mongosh)\b.*\b(delete|drop|truncate|update)\b/i,
];

const FILE_MUTATION_COMMAND_PATTERNS: RegExp[] = [
  />|>>|\b(touch|mkdir|mv|cp|rm|del|erase|ren|rename|New-Item|Set-Content|Add-Content|Out-File)\b/i,
];

export function classifyToolPermission(request: ToolPermissionRequest): Pick<ToolPermissionAssessment, "tier" | "reason"> {
  const name = request.toolName;
  if (name === "bash" || name === "shell_run") return classifyBashCommand(request.command ?? "");
  if (name.startsWith("mcp_")) return { tier: "dangerous", reason: `MCP tool ${name} is external and untrusted by default.` };
  if (SAFE_TOOLS.has(name)) return { tier: "safe", reason: `${name} is a read-only tool.` };
  if (INTERNAL_MUTATE_TOOLS.has(name)) return { tier: "internal_mutate", reason: `${name} changes Geistr internal state.` };
  if (FILE_MUTATE_TOOLS.has(name)) return { tier: "file_mutate", reason: `${name} changes files.` };
  if (DANGEROUS_TOOLS.has(name)) return { tier: "dangerous", reason: `${name} can affect the computer outside Geistr state.` };
  return { tier: "dangerous", reason: `Unknown tool ${name} requires approval.` };
}

export function classifyBashCommand(command: string): Pick<ToolPermissionAssessment, "tier" | "reason"> {
  const trimmed = command.trim();
  if (!trimmed) return { tier: "safe", reason: "Empty shell command has no effect." };
  if (BLOCKED_COMMAND_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return { tier: "blocked", reason: "Command matches a blocked destructive system pattern." };
  }
  if (DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return { tier: "dangerous", reason: "Command can mutate packages, git/network/system state, or databases." };
  }
  if (FILE_MUTATION_COMMAND_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return { tier: "file_mutate", reason: "Command appears to create, update, move, or delete files." };
  }
  return { tier: "safe", reason: "Command appears read-only." };
}

export function decideToolPermission(mode: ToolPermissionMode, request: ToolPermissionRequest): ToolPermissionAssessment {
  const classified = classifyToolPermission(request);
  if (classified.tier === "blocked") return { ...classified, decision: "block" };
  if (mode === "read-only") return { ...classified, decision: classified.tier === "safe" ? "allow" : "block" };
  if (mode === "full-access") return { ...classified, decision: "allow" };
  if (classified.tier === "safe") return { ...classified, decision: "allow" };
  if (mode === "ask-always") {
    if (classified.tier === "internal_mutate" && request.explicitUserIntent === true) return { ...classified, decision: "allow" };
    return { ...classified, decision: "ask" };
  }
  if (classified.tier === "internal_mutate") return { ...classified, decision: "allow" };
  if (classified.tier === "file_mutate") return { ...classified, decision: "allow" };
  return { ...classified, decision: "ask" };
}

export interface ToolApprovalGate {
  approve(request: ToolPermissionRequest, assessment: ToolPermissionAssessment): Promise<boolean>;
}

export function gateToolDefinition(tool: ToolDefinition, options: { mode: ToolPermissionMode; gate: ToolApprovalGate; explicitUserIntent?: boolean }): ToolDefinition {
  const execute = tool.execute;
  if (!execute) return tool;
  return {
    ...tool,
    execute: async (id, params, signal, onUpdate, ctx) => {
      const request = toolRequestFromParams(tool.name, asRecord(params), options.explicitUserIntent);
      const assessment = decideToolPermission(options.mode, request);
      if (assessment.decision === "block") throw new Error(`Blocked ${tool.name}: ${assessment.reason}`);
      if (assessment.decision === "ask") {
        const approved = await options.gate.approve(request, assessment);
        if (!approved) throw new Error(`Denied ${tool.name}: user denied approval`);
      }
      return execute(id, params, signal, onUpdate, ctx);
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function toolRequestFromParams(toolName: string, params: Record<string, unknown>, explicitUserIntent?: boolean): ToolPermissionRequest {
  const request: ToolPermissionRequest = { toolName };
  if (typeof params.action === "string") request.action = params.action;
  if (typeof params.command === "string") request.command = params.command;
  if (typeof params.path === "string") request.path = params.path;
  else if (typeof params.filePath === "string") request.path = params.filePath;
  if (explicitUserIntent !== undefined) request.explicitUserIntent = explicitUserIntent;
  return request;
}
