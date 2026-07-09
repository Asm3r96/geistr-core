import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { createCoreProviderAuthLayer, isTrustedXaiOAuthEndpoint, refreshXaiOAuthToken, registerXaiOAuthModels } from "../src/index";

describe("xAI OAuth provider", () => {
  it("lists xAI OAuth as a subscription login provider", async () => {
    const layer = createCoreProviderAuthLayer(AuthStorage.inMemory());

    await expect(layer.listLoginProviders()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "xai-oauth", name: "xAI OAuth", usesCallbackServer: false }),
      ]),
    );
  });

  it("accepts only trusted xAI OAuth endpoints", () => {
    expect(isTrustedXaiOAuthEndpoint("https://auth.x.ai/oauth2/token")).toBe(true);
    expect(isTrustedXaiOAuthEndpoint("https://accounts.x.ai/oauth2/token")).toBe(true);
    expect(isTrustedXaiOAuthEndpoint("http://auth.x.ai/oauth2/token")).toBe(false);
    expect(isTrustedXaiOAuthEndpoint("https://x.ai.evil.test/oauth2/token")).toBe(false);
    expect(isTrustedXaiOAuthEndpoint("not a url")).toBe(false);
  });

  it("refreshes OAuth credentials through the trusted xAI token endpoint", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(init?.body)).toContain("grant_type=refresh_token");
      expect(String(init?.body)).toContain("client_id=b1a00492-073a-47ea-816f-4c329264a828");
      expect(String(init?.body)).toContain("refresh_token=old-refresh");
      return new Response(JSON.stringify({ access_token: "new-access", expires_in: 3600 }), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(refreshXaiOAuthToken(
      { refresh: "old-refresh", access: "old-access", expires: 1, tokenEndpoint: "https://auth.x.ai/oauth2/token" },
      { fetchImpl, now: () => 1_000_000 },
    )).resolves.toMatchObject({
      refresh: "old-refresh",
      access: "new-access",
      expires: 4_300_000,
      tokenEndpoint: "https://auth.x.ai/oauth2/token",
      issuer: "https://auth.x.ai",
    });
  });

  it("registers a separate OAuth-backed Grok model provider", async () => {
    const auth = AuthStorage.inMemory({
      "xai-oauth": { type: "oauth", refresh: "refresh", access: "access", expires: Date.now() + 60_000 },
    });
    const registry = ModelRegistry.inMemory(auth);

    registerXaiOAuthModels(registry);

    const model = registry.find("xai-oauth", "grok-4.3");
    expect(model).toMatchObject({
      provider: "xai-oauth",
      id: "grok-4.3",
      api: "openai-responses",
      baseUrl: "https://cli-chat-proxy.grok.com/v1",
      reasoning: true,
    });
    expect(registry.getAvailable().map((entry) => `${entry.provider}/${entry.id}`)).toContain("xai-oauth/grok-4.3");
  });
});
