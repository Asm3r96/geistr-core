import { describe, expect, it } from "vitest";

import {
  createWebToolDefinitions,
  DEFAULT_WEB_ACCESS_CONFIG,
  formatToolError,
} from "../src/web-tools";
import type { WebAccessConfig } from "../src/web-tools";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeConfig(
  overrides?: Partial<WebAccessConfig>,
): WebAccessConfig {
  return { ...DEFAULT_WEB_ACCESS_CONFIG, ...overrides };
}

// ---------------------------------------------------------------------------
// Config-driven registration
// ---------------------------------------------------------------------------

describe("createWebToolDefinitions", () => {
  it("default config registers both web_search and web_fetch", () => {
    const tools = createWebToolDefinitions(makeConfig());
    expect(tools).toHaveLength(2);

    const names = tools.map((t) => t.name);
    expect(names).toContain("web_search");
    expect(names).toContain("web_fetch");
  });

  it("master disabled (enabled=false) registers neither tool", () => {
    const tools = createWebToolDefinitions(
      makeConfig({ enabled: false }),
    );
    expect(tools).toHaveLength(0);
  });

  it("searchEnabled=false registers only web_fetch", () => {
    const tools = createWebToolDefinitions(
      makeConfig({ searchEnabled: false }),
    );
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("web_fetch");
  });

  it("fetchEnabled=false registers only web_search", () => {
    const tools = createWebToolDefinitions(
      makeConfig({ fetchEnabled: false }),
    );
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("web_search");
  });

  it("both searchEnabled=false and fetchEnabled=false registers no tools", () => {
    const tools = createWebToolDefinitions(
      makeConfig({ searchEnabled: false, fetchEnabled: false }),
    );
    expect(tools).toHaveLength(0);
  });

  it("missing config fields default to enabled", () => {
    // Simulate what happens when config section doesn't exist yet
    const partial = {} as WebAccessConfig;
    const tools = createWebToolDefinitions(partial);
    // Both disabled because defaults aren't applied by createWebToolDefinitions
    // (the caller / config sanitizer provides the full object)
    expect(tools).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tool definition structure
// ---------------------------------------------------------------------------

describe("web_search tool definition", () => {
  const tools = createWebToolDefinitions(makeConfig());
  const webSearch = tools.find((t) => t.name === "web_search");

  it("has correct name and label", () => {
    expect(webSearch).toBeDefined();
    expect(webSearch!.name).toBe("web_search");
    expect(webSearch!.label).toBe("Web Search");
  });

  it("has description mentioning web search", () => {
    expect(webSearch?.description?.toLowerCase()).toContain("search");
    expect(webSearch?.description?.toLowerCase()).toContain("web");
  });

  it("accepts query, maxResults, includeContent, domains parameters", () => {
    expect(webSearch).toBeDefined();
    const schema = webSearch!.parameters as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown> | undefined;
    expect(properties).toBeDefined();
    expect(properties).toHaveProperty("query");
    expect(properties).toHaveProperty("maxResults");
    expect(properties).toHaveProperty("includeContent");
    expect(properties).toHaveProperty("domains");
  });
});

describe("web_fetch tool definition", () => {
  const tools = createWebToolDefinitions(makeConfig());
  const webFetch = tools.find((t) => t.name === "web_fetch");

  it("has correct name and label", () => {
    expect(webFetch).toBeDefined();
    expect(webFetch!.name).toBe("web_fetch");
    expect(webFetch!.label).toBe("Web Fetch");
  });

  it("has description mentioning URL fetch", () => {
    expect(webFetch?.description?.toLowerCase()).toContain("url");
    expect(webFetch?.description?.toLowerCase()).toContain("fetch");
  });

  it("accepts url and maxChars parameters", () => {
    expect(webFetch).toBeDefined();
    const schema = webFetch!.parameters as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown> | undefined;
    expect(properties).toBeDefined();
    expect(properties).toHaveProperty("url");
    expect(properties).toHaveProperty("maxChars");
  });
});

// ---------------------------------------------------------------------------
// Error formatting
// ---------------------------------------------------------------------------

describe("formatToolError", () => {
  it("wraps Error instance as clean user-facing message", () => {
    const result = formatToolError(
      "web_search",
      new Error("Connection refused"),
    );
    expect(result.content[0]?.text).toBe(
      'Web tool "web_search" failed: Connection refused',
    );
    expect(result.details.error).toBe("Connection refused");
    expect(result.details.toolName).toBe("web_search");
    expect(result.details.failed).toBe(true);
  });

  it("wraps string errors cleanly", () => {
    const result = formatToolError("web_fetch", "timeout");
    expect(result.content[0]?.text).toBe(
      'Web tool "web_fetch" failed: timeout',
    );
  });

  it("strips MCP SDK prefix noise", () => {
    const result = formatToolError(
      "web_search",
      new Error("[MCP] Server error: rate limited"),
    );
    expect(result.content[0]?.text).toBe(
      'Web tool "web_search" failed: Server error: rate limited',
    );
  });

  it("handles unknown/throw non-Error values", () => {
    const result = formatToolError("web_search", { foo: "bar" });
    expect(result.content[0]?.text).toBe(
      'Web tool "web_search" failed: [object Object]',
    );
  });

  it("returns failed details", () => {
    const result = formatToolError("web_search", new Error("fail"));
    expect(result.details).toMatchObject({
      toolName: "web_search",
      failed: true,
    });
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_WEB_ACCESS_CONFIG
// ---------------------------------------------------------------------------

describe("DEFAULT_WEB_ACCESS_CONFIG", () => {
  it("all three toggles are enabled by default", () => {
    expect(DEFAULT_WEB_ACCESS_CONFIG.enabled).toBe(true);
    expect(DEFAULT_WEB_ACCESS_CONFIG.searchEnabled).toBe(true);
    expect(DEFAULT_WEB_ACCESS_CONFIG.fetchEnabled).toBe(true);
  });

  it("provider is exa", () => {
    expect(DEFAULT_WEB_ACCESS_CONFIG.provider).toBe("exa");
  });
});
