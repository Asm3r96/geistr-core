import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { createCoreProviderAuthLayer } from "../src/index";

describe("core provider auth", () => {
  it("saves API keys through Pi AuthStorage and reports status without exposing secrets", async () => {
    const auth = AuthStorage.inMemory();
    const layer = createCoreProviderAuthLayer(auth);

    await expect(layer.listStatuses(["anthropic"])).resolves.toEqual([
      { provider: "anthropic", configured: false },
    ]);

    await expect(layer.saveApiKey("anthropic", "  sk-test  ")).resolves.toMatchObject({
      provider: "anthropic",
      configured: true,
      source: "stored",
    });
    expect(await auth.getApiKey("anthropic", { includeFallback: false })).toBe("sk-test");
    expect(await layer.listStatuses(["anthropic"])).toEqual([
      expect.not.objectContaining({ key: expect.any(String) }),
    ]);
  });

  it("lists Pi OAuth login providers for subscription-style setup", async () => {
    const layer = createCoreProviderAuthLayer(AuthStorage.inMemory());

    await expect(layer.listLoginProviders()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: expect.any(String), name: expect.any(String) }),
      ]),
    );
  });
});
