import { getSupportedThinkingLevels, type Api, type Model, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import { AuthStorage, getAgentDir, ModelRegistry } from "@earendil-works/pi-coding-agent";

import { GOOGLE_ANTIGRAVITY_API, GOOGLE_ANTIGRAVITY_MODELS, streamGoogleAntigravity } from "./providers/google-antigravity-provider";
import { googleOAuthProvider } from "./providers/google-oauth";
import { XAI_GROK_OAUTH_BASE_URL, XAI_OAUTH_MODELS, streamXaiOAuth, xaiOAuthProvider } from "./providers/xai-oauth";

// Friendly display name overrides for providers (used in model picker, settings, etc.)
export const PROVIDER_DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  "openai-codex": "openai codex",
  "google-oauth": "Google OAuth",
  "xai-oauth": "xAI OAuth",
};

export type GeistrThinkingLevel = ModelThinkingLevel;

export interface CoreModelSelection {
  provider: string;
  modelId: string;
  thinkingLevel?: GeistrThinkingLevel;
}

export interface CoreModelOption {
  provider: string;
  providerName: string;
  modelId: string;
  modelName: string;
  configured: boolean;
  reasoning: boolean;
  thinkingLevels: GeistrThinkingLevel[];
}

export interface CoreModelSelectionState {
  selected: CoreModelSelection | null;
  options: CoreModelOption[];
}

export interface CoreProviderRegistry {
  refresh(): void | Promise<void>;
  getAll(): Model<Api>[];
  getAvailable(): Model<Api>[];
  find(provider: string, modelId: string): Model<Api> | undefined;
  getProviderDisplayName(provider: string): string;
}

export interface CoreProviderLayer {
  listModelOptions(options?: { configuredOnly?: boolean }): Promise<CoreModelOption[]>;
  resolveModelSelection(selection: CoreModelSelection): Promise<{ model: Model<Api>; thinkingLevel?: GeistrThinkingLevel }>;
}

export function createCoreProviderLayer(registry: CoreProviderRegistry = createDefaultModelRegistry()): CoreProviderLayer {
  return {
    async listModelOptions(options = {}) {
      await registry.refresh();
      const configuredKeys = new Set(registry.getAvailable().map(modelKey));
      const models = options.configuredOnly ? registry.getAvailable() : registry.getAll();
      return models.map((model) => toModelOption(model, registry, configuredKeys));
    },
    async resolveModelSelection(selection) {
      await registry.refresh();
      const model = registry.find(selection.provider, selection.modelId);
      if (!model) {
        throw new Error(`Unknown model selection: ${selection.provider}/${selection.modelId}`);
      }
      return {
        model,
        ...(selection.thinkingLevel ? { thinkingLevel: clampToSupportedThinkingLevel(model, selection.thinkingLevel) } : {}),
      };
    },
  };
}

export function toModelOption(
  model: Model<Api>,
  registry: Pick<CoreProviderRegistry, "getProviderDisplayName">,
  configuredKeys: ReadonlySet<string> = new Set(),
): CoreModelOption {
  return {
    provider: model.provider,
    providerName: registry.getProviderDisplayName(model.provider),
    modelId: model.id,
    modelName: model.name,
    configured: configuredKeys.has(modelKey(model)),
    reasoning: model.reasoning,
    thinkingLevels: getSupportedThinkingLevels(model),
  };
}

export function clampToSupportedThinkingLevel(model: Model<Api>, requested: GeistrThinkingLevel): GeistrThinkingLevel {
  const supported = getSupportedThinkingLevels(model);
  if (supported.includes(requested)) return requested;
  return supported.at(-1) ?? "off";
}

function createDefaultModelRegistry(): CoreProviderRegistry {
  const agentDir = getAgentDir();
  const authStorage = AuthStorage.create();
  migrateLegacyGoogleOAuthCredential(authStorage);
  const piRegistry = ModelRegistry.create(authStorage, `${agentDir}/models.json`);
  registerGoogleOAuthModels(piRegistry);
  registerXaiOAuthModels(piRegistry);

  // Wrap the registry so we can apply Geistr-friendly provider display names
  // (the underlying Pi ModelRegistry may report long names like "ChatGPT Plus/Pro (Codex Subscription)")
  const registry: CoreProviderRegistry = {
    refresh: () => (piRegistry as any).refresh?.(),
    getAll: () => (piRegistry as any).getAll(),
    getAvailable: () => (piRegistry as any).getAvailable(),
    find: (provider, modelId) => (piRegistry as any).find(provider, modelId),
    getProviderDisplayName(provider: string): string {
      const baseName = (piRegistry as any).getProviderDisplayName?.(provider) ?? provider;
      return PROVIDER_DISPLAY_NAME_OVERRIDES[provider] ?? baseName;
    },
  };
  return registry;
}

function migrateLegacyGoogleOAuthCredential(authStorage: AuthStorage): void {
  const oauthCredential = authStorage.get("google-oauth");
  if (oauthCredential?.type === "oauth") return;

  const legacyCredential = authStorage.get("google");
  if (legacyCredential?.type !== "oauth") return;

  authStorage.set("google-oauth", legacyCredential);
  authStorage.remove("google");
}

function registerGoogleOAuthModels(registry: ModelRegistry): void {
  const { id: _id, ...oauth } = googleOAuthProvider;
  registry.registerProvider("google-oauth", {
    name: "Google OAuth",
    baseUrl: "https://cloudcode-pa.googleapis.com",
    api: GOOGLE_ANTIGRAVITY_API,
    authHeader: true,
    oauth,
    streamSimple: streamGoogleAntigravity as never,
    models: GOOGLE_ANTIGRAVITY_MODELS,
  });
}

export function registerXaiOAuthModels(registry: ModelRegistry): void {
  const { id: _id, ...oauth } = xaiOAuthProvider;
  registry.registerProvider("xai-oauth", {
    name: "xAI OAuth",
    baseUrl: XAI_GROK_OAUTH_BASE_URL,
    api: "openai-responses",
    oauth,
    streamSimple: streamXaiOAuth as never,
    models: XAI_OAUTH_MODELS,
  });
}

function modelKey(model: Pick<Model<Api>, "provider" | "id">): string {
  return `${model.provider}/${model.id}`;
}
