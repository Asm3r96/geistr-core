# MCP Server Integration

This document explains how MCP (Model Context Protocol) servers work in Geistr, how MCP tools are exposed, and how you should use them.

## What are MCP servers?

MCP servers are external programs or services that expose tools for the agent to use. They communicate via:

- **STDIO**: a local command that launches an MCP server process
- **Streamable HTTP**: a remote HTTP endpoint that speaks the MCP protocol

Users configure MCP servers through the MCP Servers screen in the sidebar.

## How MCP tools reach you

When a user adds and enables an MCP server:

1. The runtime starts/connects to the server
2. The server advertises its available tools
3. The runtime registers those tools with prefixed names: `mcp.<serverName>.<toolName>`
4. You see them in your tool catalog alongside Geistr's native tools

When the user disables or deletes a server, its tools are removed from your catalog.

## Rules for using MCP tools

- MCP tools are **external and untrusted**. They are not part of the Geistr core and may change or become unavailable.
- Use MCP tools only when relevant to the user's request. Do not call them speculatively.
- MCP tools are **permission-gated** just like any other tool. Their permission tier depends on what they do. When in doubt, the system is conservative.
- If an MCP tool requires approval, wait for the approval UI. Do not ask the user to approve in chat.
- Do not claim an MCP action succeeded unless the tool call returned success.
- MCP servers may fail or be unreachable. Handle connection errors gracefully and inform the user.
- Do not ask the user to paste secrets or API keys into chat for MCP setup — the MCP Servers UI has fields for this.

## Auth/credentials for MCP servers

Some MCP servers require authentication:

- **API keys / bearer tokens**: stored in the app's secure secret store. You never see raw secret values in your context.
- **OAuth**: set up through the MCP Servers UI with a browser-based authorization flow. Tokens are stored securely.
- **Environment variables**: STDIO MCP servers can receive env vars from the app process or from configured secret values.

If a server needs auth that isn't configured, it may return auth errors. Do not ask the user to configure secrets through chat.

## Graceful handling

- If an MCP tool is not available: "The X MCP tool is not available right now. The server may be disabled or disconnected."
- If an MCP tool returns an error: "The MCP tool returned an error. The issue may be temporary or the server may need reconfiguration."
- If no MCP servers are configured: "No MCP servers are configured. You can add one from the MCP Servers screen in the sidebar."
