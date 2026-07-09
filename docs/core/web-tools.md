# Web Tools — `web_search` and `web_fetch`

Geistr provides two built-in agent-facing web tools:

- **`web_search`** — search the public web
- **`web_fetch`** — fetch and read a specific URL

These tools are backed by an Exa MCP adapter but exposed with clean, vendor-neutral Geistr names and schemas. The agent never sees raw Exa MCP tool names.

## Architecture

```
Geistr custom tools (web_search / web_fetch)
    → Exa MCP adapter (internal to @geistr/core)
        → Exa remote MCP endpoint
```

The adapter boundary lives in `packages/core/src/web-tools.ts`. The Exa MCP `Client` is created per tool invocation (connect → call → close), keeping lifetime management simple. Another provider can replace Exa by swapping the adapter without changing agent prompts or tool names.

## Web Access Config

The `webAccess` field in `AppConfig` controls which tools are available:

```ts
type WebAccessConfig = {
  enabled: boolean;       // Master toggle (default: true)
  searchEnabled: boolean; // Controls web_search (default: true)
  fetchEnabled: boolean;  // Controls web_fetch (default: true)
  provider: "exa";
};
```

| Config state | Tools registered |
|---|---|
| `enabled: false` | Neither |
| `enabled: true`, `searchEnabled: false` | `web_fetch` only |
| `enabled: true`, `fetchEnabled: false` | `web_search` only |
| `enabled: true`, both enabled (default) | Both |

Missing config fields are treated as enabled by the `DEFAULT_WEB_ACCESS_CONFIG`.

## Tool Schemas

### `web_search`

```ts
type WebSearchInput = {
  query: string;
  maxResults?: number;      // 1–10, default 5
  includeContent?: boolean; // false by default
  domains?: string[];       // Optional domain filter
};
```

Returns a list of search results with titles, URLs, and optional content snippets.

### `web_fetch`

```ts
type WebFetchInput = {
  url: string;
  maxChars?: number; // 100–50000, default 10000
};
```

Returns the page content as text, truncated to `maxChars`.

## Security & Permissions

Both `web_search` and `web_fetch` are classified as **safe/read-only** tools in the permission system. They make network calls but do not mutate local state or files.

## Settings

A single **Web access** toggle in Settings → General controls `webAccess.enabled`. When disabled, both web tools are removed from the agent.

The individual `searchEnabled` and `fetchEnabled` fields exist in the config for future granular UI but are not exposed in the settings UI in the first slice.

## Error Handling

Network errors, timeouts, and MCP failures are caught and formatted as clean user-facing messages:

```
Web tool "web_search" failed: <short error description>
```

Raw stack traces, MCP SDK noise, and connection internals are never exposed to the agent.

## Exa MCP Endpoint

```
https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa
```

No OAuth or API key is required. If API-key support is added later, it is made optional and does not block the free/no-auth path.

## Implementation

- **`packages/core/src/web-tools.ts`** — `WebAccessConfig` type, `createWebToolDefinitions()` factory, Exa MCP adapter, error formatting
- **`apps/desktop/src/main/runtime-bridge.ts`** — wires web tools into the agent runtime based on the active config
- **`apps/desktop/src/renderer/settings/GeneralSettings.tsx`** — Web access toggle in General settings
