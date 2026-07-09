# MCP Servers

Geistr has a first-pass Settings → MCP Servers management page for custom MCP server configuration.

## Built-in Web Provider

Geistr includes a **built-in Exa-backed web provider** that exposes agent-facing `web_search` and `web_fetch` tools. This is the default web access method — no manual MCP server config is required. The built-in provider is controlled by the **Web access** toggle in Settings → General.

Exa can be used in two ways:

1. **Managed built-in web provider** (default) — activated automatically. The agent sees clean Geistr tool names (`web_search`, `web_fetch`). See `docs/core/web-tools.md` for details.

2. **Optional user-added raw MCP server** — advanced users can add Exa as a Streamable HTTP MCP server through Settings → MCP Servers if they need direct access to Exa's full tool set or custom tool selections.

## Current scope

- Add custom STDIO MCP server config with command, arguments, environment rows, passthrough environment keys, and optional working directory.
- Add Streamable HTTP MCP server config with URL and optional API-key header metadata.
- Enable, disable, configure/edit, and delete configured server rows.
- Store non-secret MCP config in app config (`geistr-config.json`) under `mcp.servers`.

Enabled STDIO and Streamable HTTP servers are connected when the agent runtime is created. Tool discovery failures are isolated per server, and discovered tools are exposed as Geistr custom tools with permission gating. SecretStore/keychain persistence and OAuth are still follow-up slices; first-pass testing should use MCP servers that do not require secrets, or environment passthrough for STDIO servers.

## Exa MCP test config

Exa's remote MCP endpoint is:

```text
https://mcp.exa.ai/mcp
```

Default tools from Exa are `web_search_exa` and `web_fetch_exa`. To request more tools, add the `tools` query parameter, for example:

```text
https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa,web_search_advanced_exa
```

For API-key mode, use header `x-api-key` with the Exa API key. This first pass still needs a real SecretStore/keychain follow-up; avoid long-term secret use until that lands.

## Config model

MCP server entries use this shape:

```ts
type McpServerConfig = {
  id: string;
  name: string;
  enabled: boolean;
  transport: "stdio" | "streamable-http";
  stdio?: {
    command: string;
    args: string[];
    cwd?: string | null;
    env: Array<{ key: string; secretRef?: string; value?: string }>;
    envPassthrough: string[];
  };
  http?: {
    url: string;
    auth: "none" | "api-key" | "oauth";
    headers?: Array<{ key: string; secretRef?: string; value?: string }>;
  };
  createdAt: number;
  updatedAt: number;
};
```

Enabled servers are started/connected by the runtime. Disabling or deleting a server refreshes the runtime so its tools disappear on the next turn.
