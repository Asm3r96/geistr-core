import { afterEach, describe, expect, it } from "vitest";

import { getGoogleOAuthClientConfig, setGoogleOAuthClientConfig } from "./google-oauth";

const CLIENT_ID_ENV = "GEISTR_GOOGLE_OAUTH_CLIENT_ID";
const CLIENT_SECRET_ENV = "GEISTR_GOOGLE_OAUTH_CLIENT_SECRET";
const originalClientId = process.env[CLIENT_ID_ENV];
const originalClientSecret = process.env[CLIENT_SECRET_ENV];

afterEach(() => {
  if (originalClientId === undefined) delete process.env[CLIENT_ID_ENV];
  else process.env[CLIENT_ID_ENV] = originalClientId;

  if (originalClientSecret === undefined) delete process.env[CLIENT_SECRET_ENV];
  else process.env[CLIENT_SECRET_ENV] = originalClientSecret;

  // Reset the in-memory override
  setGoogleOAuthClientConfig({ clientId: "", clientSecret: "" });
});

describe("getGoogleOAuthClientConfig", () => {
  it("returns empty strings when nothing is configured", () => {
    delete process.env[CLIENT_ID_ENV];
    delete process.env[CLIENT_SECRET_ENV];

    const config = getGoogleOAuthClientConfig();

    expect(config.clientId).toBe("");
    expect(config.clientSecret).toBe("");
  });

  it("allows environment variables to provide values", () => {
    process.env[CLIENT_ID_ENV] = " custom-client-id ";
    process.env[CLIENT_SECRET_ENV] = " custom-client-secret ";

    expect(getGoogleOAuthClientConfig()).toEqual({
      clientId: "custom-client-id",
      clientSecret: "custom-client-secret",
    });
  });

  it("uses runtime override when env vars are not set", () => {
    delete process.env[CLIENT_ID_ENV];
    delete process.env[CLIENT_SECRET_ENV];

    setGoogleOAuthClientConfig({ clientId: "runtime-id", clientSecret: "runtime-secret" });

    expect(getGoogleOAuthClientConfig()).toEqual({
      clientId: "runtime-id",
      clientSecret: "runtime-secret",
    });
  });

  it("env vars take precedence over runtime override", () => {
    process.env[CLIENT_ID_ENV] = "env-id";
    process.env[CLIENT_SECRET_ENV] = "env-secret";

    setGoogleOAuthClientConfig({ clientId: "runtime-id", clientSecret: "runtime-secret" });

    expect(getGoogleOAuthClientConfig()).toEqual({
      clientId: "env-id",
      clientSecret: "env-secret",
    });
  });
});
