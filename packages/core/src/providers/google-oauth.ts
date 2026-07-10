/**
 * Google OAuth provider for Gemini API access.
 *
 * Uses Google's OAuth 2.0 with PKCE to obtain an access token that
 * works with the Google Gemini API (generativelanguage.googleapis.com).
 *
 * Registered via `registerGoogleOAuthProvider()` so it shows up in the
 * provider settings UI and the token is resolved by AuthStorage for
 * existing Gemini models.
 *
 * Inspired by the Anthropic OAuth flow in Pi SDK and the antigravity
 * implementation from the reference denkr-desktop app.
 */
import { randomBytes, createHash } from "node:crypto";
import { createServer } from "node:http";

import { registerOAuthProvider, type OAuthLoginCallbacks, type OAuthProviderInterface, type OAuthCredentials } from "@earendil-works/pi-ai/oauth";

const GOOGLE_OAUTH_CLIENT_ID_ENV = "GEISTR_GOOGLE_OAUTH_CLIENT_ID";
const GOOGLE_OAUTH_CLIENT_SECRET_ENV = "GEISTR_GOOGLE_OAUTH_CLIENT_SECRET";

let googleOAuthOverride: { clientId: string; clientSecret: string } | null = null;

/** Set Google OAuth client config at runtime (from user-provided values in Settings). */
export function setGoogleOAuthClientConfig(config: { clientId: string; clientSecret: string }): void {
  googleOAuthOverride = { clientId: config.clientId.trim(), clientSecret: config.clientSecret.trim() };
}

/** Get Google OAuth client config: env vars first, then runtime override, then empty. */
export function getGoogleOAuthClientConfig(): { clientId: string; clientSecret: string } {
  const clientId = process.env[GOOGLE_OAUTH_CLIENT_ID_ENV]?.trim() || googleOAuthOverride?.clientId || "";
  const clientSecret = process.env[GOOGLE_OAUTH_CLIENT_SECRET_ENV]?.trim() || googleOAuthOverride?.clientSecret || "";
  return { clientId, clientSecret };
}

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo?alt=json";

const CALLBACK_HOST = "127.0.0.1";
const CALLBACK_PORT = 51121;
const CALLBACK_PATH = "/oauth-callback";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;

const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
].join(" ");

// ── Helpers ────────────────────────────────────────────────────

function base64Url(bytes: Buffer): string {
  return bytes
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(64));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function buildQueryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function buildUrl(baseUrl: string, params: Record<string, string>): string {
  return `${baseUrl}?${buildQueryString(params)}`;
}

function parseAuthorizationInput(input: string): { code?: string; state?: string } {
  const value = input.trim();
  if (!value) return {};
  try {
    const url = new URL(value);
    return {
      ...(url.searchParams.get("code") ? { code: url.searchParams.get("code")! } : {}),
      ...(url.searchParams.get("state") ? { state: url.searchParams.get("state")! } : {}),
    };
  } catch {
    // Not a URL — might be just the code
  }
  if (value.includes("code=") || value.includes("state=")) {
    const params = new URLSearchParams(value);
    return {
      ...(params.get("code") ? { code: params.get("code")! } : {}),
      ...(params.get("state") ? { state: params.get("state")! } : {}),
    };
  }
  return { code: value };
}

// ── OAuth Server ────────────────────────────────────────────────

type CallbackResult = { code: string; state: string } | null;

function startCallbackServer(
  expectedState: string,
): Promise<{
  server: ReturnType<typeof createServer>;
  waitForCode: () => Promise<CallbackResult>;
  cancelWait: () => void;
}> {
  return new Promise((resolve, reject) => {
    let settle: ((value: CallbackResult) => void) | null = null;
    const settled = { current: false };

    const waitForCodePromise = new Promise<CallbackResult>((resolveWait) => {
      settle = (value) => {
        if (settled.current) return;
        settled.current = true;
        resolveWait(value);
      };
    });

    const server = createServer((req, res) => {
      try {
        const url = new URL(req.url ?? "", "http://localhost");
        if (url.pathname !== CALLBACK_PATH) {
          res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
          res.end("Not found");
          return;
        }

        const searchCode = url.searchParams.get("code");
        const searchState = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<html><body>Google sign-in failed: ${error}</body></html>`);
          settle?.(null);
          return;
        }

        if (!searchCode || !searchState) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end("Missing code or state parameter.");
          return;
        }

        if (searchState !== expectedState) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end("State mismatch.");
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          "<html><body>Google sign-in complete. You can close this window.</body></html>",
        );
        settle?.({ code: searchCode, state: searchState });
      } catch {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Internal error");
      }
    });

    server.on("error", (err: Error) => {
      reject(err);
    });

    server.listen(CALLBACK_PORT, CALLBACK_HOST, () => {
      resolve({
        server,
        waitForCode: () => waitForCodePromise,
        cancelWait: () => settle?.(null),
      });
    });
  });
}

// ── Token Operations ────────────────────────────────────────────

async function exchangeToken(
  body: Record<string, string>,
): Promise<{ accessToken: string; refreshToken: string | null; expiresIn: number }> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      Accept: "*/*",
    },
    body: buildQueryString(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google token exchange failed (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const accessToken =
    typeof payload.access_token === "string" ? payload.access_token.trim() : "";
  const refreshToken =
    typeof payload.refresh_token === "string" ? payload.refresh_token.trim() : null;
  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 3600;

  if (!accessToken) {
    throw new Error("Google token response missing access_token.");
  }

  return { accessToken, refreshToken, expiresIn };
}

async function getUserInfo(
  accessToken: string,
): Promise<{ email: string | null; name: string | null }> {
  try {
    const response = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return { email: null, name: null };
    const payload = (await response.json()) as Record<string, unknown>;
    return {
      email:
        typeof payload.email === "string" ? payload.email.trim() || "" : "",
      name:
        typeof payload.name === "string" ? payload.name.trim() || "" : "",
    };
  } catch {
    return { email: "", name: "" };
  }
}

// ── Login Flow ─────────────────────────────────────────────────

/**
 * Login with Google OAuth (authorization code + PKCE).
 *
 * Starts a local callback server, constructs the Google authorization URL,
 * exchanges the authorization code for tokens, and returns credentials.
 */
export async function loginGoogle(options: {
  onAuth: (info: { url: string; instructions?: string }) => void;
  onPrompt: (prompt: { message: string; placeholder?: string }) => Promise<string>;
  onProgress?: (message: string) => void;
  onManualCodeInput?: () => Promise<string>;
}): Promise<OAuthCredentials & { accountId?: string; accountLabel?: string }> {
  const { clientId, clientSecret } = getGoogleOAuthClientConfig();
  const { verifier, challenge } = generatePKCE();

  const server = await startCallbackServer(verifier);

  const authUrl = buildUrl(AUTHORIZE_URL, {
    client_id: clientId,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: verifier,
    access_type: "offline",
    prompt: "consent",
  });

  let code: string | undefined;
  let state: string | undefined;
  let redirectUriForExchange = REDIRECT_URI;

  try {
    options.onAuth({
      url: authUrl,
      ...({ instructions: "Complete Google sign-in in your browser. If the browser is on another machine, paste the final redirect URL here." } as { instructions?: string }),
    });

    if (options.onManualCodeInput) {
      const result = await server.waitForCode();
      if (result?.code) {
        code = result.code;
        state = result.state;
      } else {
        const input = await options.onManualCodeInput();
        const parsed = parseAuthorizationInput(input);
        if (parsed.state && parsed.state !== verifier) {
          throw new Error("OAuth state mismatch");
        }
        code = parsed.code;
        state = parsed.state ?? verifier;
      }
    } else {
      const result = await server.waitForCode();
      if (result?.code) {
        code = result.code;
        state = result.state;
      }
    }

    if (!code) {
      const input = await options.onPrompt({
        message: "Paste the authorization code or full redirect URL:",
        placeholder: REDIRECT_URI,
      });
      const parsed = parseAuthorizationInput(input);
      if (parsed.state && parsed.state !== verifier) {
        throw new Error("OAuth state mismatch");
      }
      code = parsed.code;
      state = parsed.state ?? verifier;
    }

    if (!code) {
      throw new Error("Missing authorization code");
    }

    options.onProgress?.("Exchanging authorization code for tokens...");

    const exchanged = await exchangeToken({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUriForExchange,
      code_verifier: verifier,
    });

    const userInfo = await getUserInfo(exchanged.accessToken);
    const name = userInfo.name || userInfo.email || "";
    const accountLabel = name ? name : "Google account";

    return {
      refresh: exchanged.refreshToken ?? "",
      access: exchanged.accessToken,
      expires: Date.now() + exchanged.expiresIn * 1000 - 5 * 60 * 1000,
      ...(userInfo.email ? { accountId: userInfo.email } : {}),
      ...(accountLabel ? { accountLabel } : {}),
    };
  } finally {
    server.server.close();
  }
}

// ── Token Refresh ──────────────────────────────────────────────

/**
 * Refresh a Google OAuth token.
 * Returns new credentials with the updated access token.
 */
export async function refreshGoogleToken(
  refreshToken: string,
): Promise<{ refresh: string; access: string; expires: number }> {
  const { clientId, clientSecret } = getGoogleOAuthClientConfig();
  const exchanged = await exchangeToken({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  return {
    refresh: exchanged.refreshToken ?? refreshToken,
    access: exchanged.accessToken,
    expires: Date.now() + exchanged.expiresIn * 1000 - 5 * 60 * 1000,
  };
}



// ── OAuthProviderInterface (legacy compat) ──────────────────────

/**
 * Legacy OAuth provider interface used by Pi SDK's AuthStorage.
 *
 * Registered via `registerOAuthProvider()` so the provider appears in the
 * provider settings UI and tokens are resolved by `AuthStorage.getApiKey("google")`.
 */
export const googleOAuthProvider: OAuthProviderInterface = {
  id: "google-oauth",
  name: "Google OAuth",
  usesCallbackServer: true,

  async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
    const result = await loginGoogle({
      onAuth: callbacks.onAuth,
      onPrompt: (prompt: { message: string; placeholder?: string }) =>
        callbacks.onPrompt({
          message: prompt.message,
          ...(prompt.placeholder ? { placeholder: prompt.placeholder } : {}),
        } as Parameters<OAuthLoginCallbacks["onPrompt"]>[0]),
      ...(callbacks.onProgress ? { onProgress: (msg: string) => { callbacks.onProgress!(msg); } } : {}),
      ...(callbacks.onManualCodeInput ? { onManualCodeInput: callbacks.onManualCodeInput } : {}),
    });

    return {
      refresh: result.refresh,
      access: result.access,
      expires: result.expires,
      ...(result.accountId !== undefined ? { accountId: result.accountId } : {}),
      ...(result.accountLabel !== undefined ? { accountLabel: result.accountLabel } : {}),
    };
  },

  async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
    const result = await refreshGoogleToken(credentials.refresh);
    return {
      refresh: result.refresh,
      access: result.access,
      expires: result.expires,
      ...(credentials.accountId !== undefined ? { accountId: credentials.accountId as string } : {}),
      ...(credentials.accountLabel !== undefined ? { accountLabel: credentials.accountLabel as string } : {}),
    };
  },

  getApiKey(credentials: OAuthCredentials): string {
    return credentials.access;
  },
};

// ── Registration ────────────────────────────────────────────────

/**
 * Register the Google OAuth provider with Pi SDK's OAuth system.
 *
 * Call this once during app initialization. After registration:
 * - The provider appears in the provider settings UI under "Subscription / login providers"
 * - `AuthStorage.getApiKey("google-oauth")` resolves the OAuth access token
 * - Token refresh happens automatically via AuthStorage
 */
export function registerGoogleOAuthProvider(): void {
  registerOAuthProvider(googleOAuthProvider);
}
