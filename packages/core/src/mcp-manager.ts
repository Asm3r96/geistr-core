import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServerConfig } from "./app-config";

export interface McpRuntimeTool {
  serverId: string;
  serverName: string;
  toolName: string;
  runtimeName: string;
  description: string;
  inputSchema: unknown;
}

export interface McpServerRuntimeStatus {
  serverId: string;
  status: "disabled" | "connecting" | "connected" | "failed";
  toolCount: number;
  error?: string;
}

export class McpManager {
  private connections = new Map<string, { client: Client; transport: Transport; tools: McpRuntimeTool[] }>();
  private statuses = new Map<string, McpServerRuntimeStatus>();

  constructor(private readonly configs: readonly McpServerConfig[]) {}

  async startEnabled(): Promise<void> {
    await Promise.all(this.configs.map((config) => config.enabled ? this.connect(config) : Promise.resolve(this.setStatus(config.id, "disabled", 0))));
  }

  getStatuses(): McpServerRuntimeStatus[] {
    return this.configs.map((config) => this.statuses.get(config.id) ?? { serverId: config.id, status: config.enabled ? "connecting" : "disabled", toolCount: 0 });
  }

  getToolDefinitions(): ToolDefinition[] {
    return [...this.connections.values()].flatMap((connection) => connection.tools.map((tool) => createMcpToolDefinition(tool, connection.client)));
  }

  async dispose(): Promise<void> {
    const connections = [...this.connections.values()];
    this.connections.clear();
    await Promise.all(connections.map(async ({ client, transport }) => {
      await client.close().catch(() => undefined);
      await transport.close?.().catch(() => undefined);
    }));
  }

  private async connect(config: McpServerConfig): Promise<void> {
    this.setStatus(config.id, "connecting", 0);
    try {
      const transport = createTransport(config);
      const client = new Client({ name: "Geistr", version: "0.0.0" }, { capabilities: {} });
      await client.connect(transport);
      const listed = await client.listTools();
      const tools = (listed.tools ?? []).map((tool) => ({
        serverId: config.id,
        serverName: config.name,
        toolName: tool.name,
        runtimeName: toRuntimeToolName(config.name, tool.name),
        description: tool.description || `MCP tool ${tool.name} from ${config.name}`,
        inputSchema: tool.inputSchema ?? {},
      }));
      this.connections.set(config.id, { client, transport, tools });
      this.setStatus(config.id, "connected", tools.length);
    } catch (error) {
      this.setStatus(config.id, "failed", 0, error instanceof Error ? error.message : String(error));
    }
  }

  private setStatus(serverId: string, status: McpServerRuntimeStatus["status"], toolCount: number, error?: string): void {
    this.statuses.set(serverId, { serverId, status, toolCount, ...(error ? { error } : {}) });
  }
}

function createTransport(config: McpServerConfig): Transport {
  if (config.transport === "stdio") {
    if (!config.stdio?.command) throw new Error("STDIO MCP server is missing command.");
    const env = { ...getDefaultEnvironment() };
    for (const key of config.stdio.envPassthrough) if (process.env[key] !== undefined) env[key] = process.env[key]!;
    for (const row of config.stdio.env) if (row.value !== undefined) env[row.key] = row.value;
    return new StdioClientTransport({ command: config.stdio.command, args: config.stdio.args, ...(config.stdio.cwd ? { cwd: config.stdio.cwd } : {}), env, stderr: "pipe" });
  }
  if (!config.http?.url) throw new Error("HTTP MCP server is missing URL.");
  const headers: Record<string, string> = {};
  for (const row of config.http.headers ?? []) if (row.value !== undefined) headers[row.key] = row.value;
  return new StreamableHTTPClientTransport(new URL(config.http.url), Object.keys(headers).length ? { requestInit: { headers } } : undefined) as unknown as Transport;
}

function createMcpToolDefinition(tool: McpRuntimeTool, client: Client): ToolDefinition {
  return defineTool({
    name: tool.runtimeName,
    label: `MCP: ${tool.serverName} / ${tool.toolName}`,
    description: `${tool.description}\n\nExternal MCP tool from user-configured server "${tool.serverName}". Use only when relevant.`,
    promptSnippet: `${tool.runtimeName}: ${tool.description}`,
    parameters: Type.Unsafe(tool.inputSchema || { type: "object", additionalProperties: true }),
    execute: async (_id, params) => {
      const result = await client.callTool({ name: tool.toolName, arguments: params as Record<string, unknown> });
      return toolResult(result);
    },
  });
}

export function toRuntimeToolName(serverName: string, toolName: string): string {
  return `mcp_${sanitizeToolPart(serverName)}_${sanitizeToolPart(toolName)}`.slice(0, 96);
}

function sanitizeToolPart(value: string): string {
  const sanitized = value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return sanitized || "server";
}

function toolResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], details: data as Record<string, unknown> };
}
