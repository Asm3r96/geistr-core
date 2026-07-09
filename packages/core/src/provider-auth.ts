import { AuthStorage, getAgentDir } from "@earendil-works/pi-coding-agent";
import type {
  OAuthAuthInfo,
  OAuthDeviceCodeInfo,
  OAuthLoginCallbacks,
  OAuthPrompt,
  OAuthSelectPrompt,
} from "@earendil-works/pi-ai/compat";

import { loginGoogle, refreshGoogleToken } from "./providers/google-oauth";
import { loginXaiOAuthDeviceCode, refreshXaiOAuthToken } from "./providers/xai-oauth";
import { PROVIDER_DISPLAY_NAME_OVERRIDES } from "./provider-selection";

export type CoreProviderAuthKind = "api-key" | "login";

export interface CoreProviderAuthStatus {
  provider: string;
  configured: boolean;
  source?: string;
  label?: string;
}

export interface CoreProviderAuthPromptRequest {
  message: string;
  placeholder?: string;
  allowEmpty?: boolean;
}

export interface CoreProviderAuthSelectRequest {
  message: string;
  options: { id: string; label: string }[];
}

export interface CoreProviderAuthEvent {
  type: "auth_url" | "device_code" | "progress";
  url?: string;
  instructions?: string;
  userCode?: string;
  verificationUri?: string;
  message?: string;
}

export interface CoreProviderLoginCallbacks {
  onEvent?: (event: CoreProviderAuthEvent) => void;
  onPrompt?: (prompt: CoreProviderAuthPromptRequest) => Promise<string>;
  onManualCodeInput?: () => Promise<string>;
  onSelect?: (prompt: CoreProviderAuthSelectRequest) => Promise<string | undefined>;
  signal?: AbortSignal;
}

/** Descriptor for a built-in login provider (Google, Anthropic, etc.). */
export interface BuiltinLoginProvider {
  id: string;
  name: string;
  usesCallbackServer: boolean;
  /** Log in and store the credential via the AuthStorage. */
  login(authStorage: AuthStorage, callbacks?: CoreProviderLoginCallbacks): Promise<void>;
}

const GOOGLE_PROVIDER: BuiltinLoginProvider = {
  id: "google-oauth",
  name: "Google OAuth",
  usesCallbackServer: true,

  async login(authStorage: AuthStorage, callbacks?: CoreProviderLoginCallbacks): Promise<void> {
    const cbs = callbacks ?? {};

    const result = await loginGoogle({
      onAuth: (info) => cbs.onEvent?.({ type: "auth_url", url: info.url, ...(info.instructions ? { instructions: info.instructions } : {}) }),
      onPrompt: (prompt) => cbs.onPrompt?.({ message: prompt.message, ...(prompt.placeholder ? { placeholder: prompt.placeholder } : {}) }) ?? Promise.resolve(""),
      onProgress: (message) => cbs.onEvent?.({ type: "progress", message }),
      ...(cbs.onManualCodeInput ? { onManualCodeInput: cbs.onManualCodeInput } : {}),
    });

    // Store the OAuth credential in Pi SDK's AuthStorage under the separate OAuth provider id.
    authStorage.set("google-oauth", {
      type: "oauth",
      refresh: result.refresh,
      access: result.access,
      expires: result.expires,
      ...(result.accountId !== undefined ? { accountId: result.accountId } : {}),
      ...(result.accountLabel !== undefined ? { accountLabel: result.accountLabel } : {}),
    });
  },
};

const XAI_OAUTH_PROVIDER: BuiltinLoginProvider = {
  id: "xai-oauth",
  name: "xAI OAuth",
  usesCallbackServer: false,

  async login(authStorage: AuthStorage, callbacks?: CoreProviderLoginCallbacks): Promise<void> {
    const cbs = callbacks ?? {};
    const result = await loginXaiOAuthDeviceCode({
      onDeviceCode: (info) => cbs.onEvent?.({ type: "device_code", userCode: info.userCode, verificationUri: info.verificationUri, url: info.verificationUri }),
      onProgress: (message) => cbs.onEvent?.({ type: "progress", message }),
      ...(cbs.signal ? { signal: cbs.signal } : {}),
    });

    authStorage.set("xai-oauth", {
      type: "oauth",
      refresh: result.refresh,
      access: result.access,
      expires: result.expires,
      ...(result.accountId !== undefined ? { accountId: result.accountId } : {}),
      ...(result.accountLabel !== undefined ? { accountLabel: result.accountLabel } : {}),
      ...(result.tokenEndpoint !== undefined ? { tokenEndpoint: result.tokenEndpoint } : {}),
      ...(result.deviceAuthorizationEndpoint !== undefined ? { deviceAuthorizationEndpoint: result.deviceAuthorizationEndpoint } : {}),
      ...(result.issuer !== undefined ? { issuer: result.issuer } : {}),
      ...(result.authFlow !== undefined ? { authFlow: result.authFlow } : {}),
    });
  },
};

/** Built-in login providers that are always available. */
const BUILTIN_LOGIN_PROVIDERS: BuiltinLoginProvider[] = [
  GOOGLE_PROVIDER,
  XAI_OAUTH_PROVIDER,
];

export interface CoreProviderAuthLayer {
  listStatuses(providers: string[]): Promise<CoreProviderAuthStatus[]>;
  saveApiKey(provider: string, apiKey: string): Promise<CoreProviderAuthStatus>;
  removeProviderAuth(provider: string): Promise<CoreProviderAuthStatus>;
  listLoginProviders(): Promise<{ id: string; name: string; usesCallbackServer: boolean }[]>;
  loginProvider(provider: string, callbacks?: CoreProviderLoginCallbacks): Promise<CoreProviderAuthStatus>;
}

export function createCoreProviderAuthLayer(authStorage: AuthStorage = createDefaultAuthStorage()): CoreProviderAuthLayer {
  return {
    async listStatuses(providers) {
      authStorage.reload();
      migrateLegacyGoogleOAuthCredential(authStorage);
      return providers.map((provider) => toStatus(provider, authStorage));
    },
    async saveApiKey(provider, apiKey) {
      const key = apiKey.trim();
      if (!key) throw new Error("API key is required.");
      authStorage.set(provider, { type: "api_key", key });
      return toStatus(provider, authStorage);
    },
    async removeProviderAuth(provider) {
      authStorage.remove(provider);
      return toStatus(provider, authStorage);
    },
    async listLoginProviders() {
      // Built-in Geistr login providers (Google OAuth, etc.)
      const builtin = BUILTIN_LOGIN_PROVIDERS.map((p) => ({
        id: p.id,
        name: p.name,
        usesCallbackServer: p.usesCallbackServer,
      }));

      // Also include Pi SDK's registered OAuth providers (Anthropic, GitHub Copilot, etc.)
      const piProviders = authStorage.getOAuthProviders().map((p) => ({
        id: p.id,
        name: p.name,
        usesCallbackServer: Boolean(p.usesCallbackServer),
      }));

      // Merge: Pi SDK providers take precedence for same id (e.g. "google" from Pi wins over builtin)
      const byId = new Map<string, { id: string; name: string; usesCallbackServer: boolean }>();
      for (const p of builtin) byId.set(p.id, p);
      for (const p of piProviders) byId.set(p.id, p);

      // Apply Geistr-friendly label overrides for specific providers (shared with model provider names).
      const result = [...byId.values()].map((p) => ({
        ...p,
        name: PROVIDER_DISPLAY_NAME_OVERRIDES[p.id] ?? p.name,
      }));
      return result;
    },
    async loginProvider(provider, callbacks = {}) {
      // Try built-in Geistr provider first
      const builtin = BUILTIN_LOGIN_PROVIDERS.find((p) => p.id === provider);
      if (builtin) {
        await builtin.login(authStorage, callbacks);
        return toStatus(provider, authStorage);
      }

      // Fall back to Pi SDK's OAuth system
      await authStorage.login(provider, toOAuthCallbacks(callbacks));
      return toStatus(provider, authStorage);
    },
  };
}

function createDefaultAuthStorage(): AuthStorage {
  return AuthStorage.create(`${getAgentDir()}/auth.json`);
}

function migrateLegacyGoogleOAuthCredential(authStorage: AuthStorage): void {
  const oauthCredential = authStorage.get("google-oauth");
  if (oauthCredential?.type === "oauth") return;

  const legacyCredential = authStorage.get("google");
  if (legacyCredential?.type !== "oauth") return;

  authStorage.set("google-oauth", legacyCredential);
  authStorage.remove("google");
}

function toStatus(provider: string, authStorage: AuthStorage): CoreProviderAuthStatus {
  const status = authStorage.getAuthStatus(provider);
  return {
    provider,
    configured: status.configured,
    ...(status.source ? { source: status.source } : {}),
    ...(status.label ? { label: status.label } : {}),
  };
}

function toOAuthCallbacks(callbacks: CoreProviderLoginCallbacks): OAuthLoginCallbacks {
  const oauthCallbacks: OAuthLoginCallbacks = {
    onAuth: (info: OAuthAuthInfo) => callbacks.onEvent?.({ type: "auth_url", ...info }),
    onDeviceCode: (info: OAuthDeviceCodeInfo) => callbacks.onEvent?.({ type: "device_code", ...info }),
    onProgress: (message: string) => callbacks.onEvent?.({ type: "progress", message }),
    onPrompt: (prompt: OAuthPrompt) => callbacks.onPrompt?.(prompt) ?? Promise.resolve(""),
    onSelect: (prompt: OAuthSelectPrompt) => callbacks.onSelect?.(prompt) ?? Promise.resolve(prompt.options[0]?.id),
  };
  if (callbacks.onManualCodeInput) oauthCallbacks.onManualCodeInput = callbacks.onManualCodeInput;
  if (callbacks.signal) oauthCallbacks.signal = callbacks.signal;
  return oauthCallbacks;
}

/** Invalidate/refresh an OAuth credential stored in AuthStorage. */
export async function refreshGoogleProviderAuth(authStorage: AuthStorage): Promise<void> {
  const cred = authStorage.get("google-oauth");
  if (!cred || cred.type !== "oauth") return;

  try {
    const result = await refreshGoogleToken(cred.refresh);
    authStorage.set("google-oauth", {
      ...cred,
      refresh: result.refresh,
      access: result.access,
      expires: result.expires,
    });
  } catch {
    // Token refresh failed; keep the old credential (will fail on next use)
  }
}

/** Invalidate/refresh an xAI OAuth credential stored in AuthStorage. */
export async function refreshXaiProviderAuth(authStorage: AuthStorage): Promise<void> {
  const cred = authStorage.get("xai-oauth");
  if (!cred || cred.type !== "oauth") return;

  try {
    const result = await refreshXaiOAuthToken(cred);
    authStorage.set("xai-oauth", {
      ...cred,
      ...result,
      type: "oauth",
    });
  } catch {
    // Token refresh failed; keep the old credential (will fail on next use)
  }
}
