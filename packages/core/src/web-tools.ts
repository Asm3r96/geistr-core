// ---------------------------------------------------------------------------
// Web Tools — agent-facing web_search and web_fetch backed by Exa MCP
// ---------------------------------------------------------------------------
//
// Architecture:
//   Geistr custom tools → Exa MCP adapter → Exa remote MCP endpoint
//
// The agent sees clean Geistr tools named web_search and web_fetch.
// raw Exa MCP tool names are hidden behind the adapter boundary so another
// provider can replace Exa later without changing agent prompts or tool names.
// ---------------------------------------------------------------------------

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

// ---------------------------------------------------------------------------
// Web Access Config
// ---------------------------------------------------------------------------

export interface WebAccessConfig {
  /** Master toggle. When false, neither tool is registered. */
  enabled: boolean;
  /** Controls the web_search tool. Ignored when enabled is false. */
  searchEnabled: boolean;
  /** Controls the web_fetch tool. Ignored when enabled is false. */
  fetchEnabled: boolean;
  /** Which backend provider powers the tools. Currently only "exa". */
  provider: "exa";
}

export const DEFAULT_WEB_ACCESS_CONFIG: WebAccessConfig = {
  enabled: true,
  searchEnabled: true,
  fetchEnabled: true,
  provider: "exa",
};

// ---------------------------------------------------------------------------
// Exa MCP endpoint
// ---------------------------------------------------------------------------

const EXA_MCP_URL =
  "https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa";

// ---------------------------------------------------------------------------
// Tool definitions factory
// ---------------------------------------------------------------------------

/**
 * Create web tool definitions based on the provided config.
 *
 * Each tool is backed by an Exa MCP connection but exposed with clean
 * Geistr-facing names and schemas. The agent never sees raw Exa MCP
 * tool names.
 *
 * @param config - Web Access configuration controlling which tools are active.
 * @returns An array of ToolDefinition objects (0, 1, or 2 tools).
 */
export function createWebToolDefinitions(
  config: WebAccessConfig,
): ToolDefinition[] {
  if (!config.enabled) return [];

  const tools: ToolDefinition[] = [];

  if (config.searchEnabled) {
    tools.push(createWebSearchTool());
  }

  if (config.fetchEnabled) {
    tools.push(createWebFetchTool());
  }

  return tools;
}

// ---------------------------------------------------------------------------
// web_search tool
// ---------------------------------------------------------------------------

export interface WebSearchInput {
  query: string;
  maxResults?: number;
  includeContent?: boolean;
  domains?: string[];
}

function createWebSearchTool(): ToolDefinition {
  return defineTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the public web for current or external information. " +
      "Use when the user asks about recent events, facts you are not sure about, " +
      "or information that requires looking up external sources. " +
      "Returns a list of results with titles, URLs, and optional content snippets.",
    parameters: Type.Object({
      query: Type.String({
        description: "Search query.",
      }),
      maxResults: Type.Optional(
        Type.Number({
          description:
            "Maximum number of results to return (1–10, default 5).",
        }),
      ),
      includeContent: Type.Optional(
        Type.Boolean({
          description:
            "When true, includes full content of each result. " +
            "Use only when you need detailed information from the results.",
          default: false,
        }),
      ),
      domains: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Limit search to specific domains " +
            "(e.g. ['en.wikipedia.org', 'developer.mozilla.org']).",
        }),
      ),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      try {
        const result = await executeExaTool("web_search_exa", {
          query: params.query,
          maxResults: Math.min(Math.max(params.maxResults ?? 5, 1), 10),
          ...(params.includeContent
            ? { includeContent: true }
            : { includeContent: false }),
          ...(params.domains?.length ? { domains: params.domains } : {}),
        });
        return result;
      } catch (error) {
        return formatToolError("web_search", error);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// web_fetch tool
// ---------------------------------------------------------------------------

export interface WebFetchInput {
  url: string;
  maxChars?: number;
}

function createWebFetchTool(): ToolDefinition {
  return defineTool({
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch and read a specific URL supplied by the user or found via search. " +
      "Use to retrieve the full content of a webpage, document, or API response. " +
      "Returns the page content as text, truncated to maxChars.",
    parameters: Type.Object({
      url: Type.String({
        description: "The URL to fetch and read.",
      }),
      maxChars: Type.Optional(
        Type.Number({
          description:
            "Maximum characters to return (default 10000, max 50000).",
        }),
      ),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      try {
        // Exa expects urls as an array, not a single url string
        const result = await executeExaTool("web_fetch_exa", {
          urls: [params.url],
          ...(params.maxChars !== undefined
            ? { maxChars: Math.min(Math.max(params.maxChars, 100), 50000) }
            : { maxChars: 10000 }),
        });
        return result;
      } catch (error) {
        return formatToolError("web_fetch", error);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Exa MCP adapter (internal)
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 60_000; // 60s timeout for web requests

/**
 * Call an Exa MCP tool by creating a fresh connection, invoking the tool,
 * and closing the connection.
 *
 * Each call creates its own connection so there are no lifetime-management
 * issues and connections do not leak across tool invocations. The overhead of
 * a connection handshake is acceptable given the multi-second nature of web
 * search/fetch operations.
 */
async function executeExaTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }> {
  const url = new URL(EXA_MCP_URL);
  const transport = new StreamableHTTPClientTransport(url) as unknown as Transport;
  const client = new Client(
    { name: "Geistr", version: "0.0.0" },
    { capabilities: {} },
  );

  try {
    // Use Promise.race for overall timeout
    const connectPromise = client.connect(transport);
    const result = await raceWithTimeout(
      connectPromise.then(() => client.callTool({ name: toolName, arguments: args })),
      REQUEST_TIMEOUT_MS,
      `Exa MCP "${toolName}" timed out after ${REQUEST_TIMEOUT_MS}ms.`,
    );

    return formatMcpResult(result);
  } finally {
    await client.close().catch(() => {
      // Swallow close errors — the transport may already be closed
      // after a timeout or error.
    });
  }
}

/**
 * Format an MCP CallToolResult into the Geistr tool response shape.
 */
function formatMcpResult(
  result: unknown,
): { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> } {
  const data = result as Record<string, unknown>;
  const content = data.content as
    | Array<{ type: string; text?: string }>
    | undefined;

  return {
    content: Array.isArray(content)
      ? content.map((item) => ({
          type: "text" as const,
          text:
            typeof item.text === "string"
              ? item.text
              : JSON.stringify(item),
        }))
      : [
          {
            type: "text" as const,
            text: JSON.stringify(data, null, 2),
          },
        ],
    details: data as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

/**
 * Format a web tool failure into a clean user-facing error message.
 * The raw error stack / MCP SDK noise is never exposed to the agent.
 *
 * Exported for testing.
 */
export function formatToolError(
  toolName: string,
  error: unknown,
): { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> } {
  const message =
    error instanceof Error ? error.message : String(error);

  // Strip common MCP SDK prefix noise for readability
  const cleanMessage = message
    .replace(/^\[MCP\]\s*/i, "")
    .replace(/^Client\s*\d*\s*:\s*/i, "")
    .trim() || "Unknown error";

  const userMessage = `Web tool "${toolName}" failed: ${cleanMessage}`;

  return {
    content: [{ type: "text", text: userMessage }],
    details: {
      error: cleanMessage,
      toolName,
      failed: true,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function raceWithTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
