import { createAssistantMessageEventStream, type Api, type AssistantMessage, type AssistantMessageEvent, type Context, type Model, type OAuthCredentials, type OAuthLoginCallbacks, type OAuthProviderInterface, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { registerOAuthProvider } from "@earendil-works/pi-ai/oauth";

export const XAI_OAUTH_PROVIDER_ID = "xai-oauth";
export const XAI_OAUTH_PROVIDER_NAME = "xAI OAuth";
export const XAI_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const XAI_OAUTH_SCOPE = "openid profile email offline_access grok-cli:access api:access";
export const XAI_OAUTH_ISSUER = "https://auth.x.ai";
export const XAI_OAUTH_DISCOVERY_URL = `${XAI_OAUTH_ISSUER}/.well-known/openid-configuration`;
export const XAI_API_BASE_URL = "https://api.x.ai/v1";
export const XAI_GROK_OAUTH_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
export const XAI_GROK_CLIENT_VERSION = "0.2.16";

const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
const FETCH_TIMEOUT_MS = 30_000;
const XAI_OAUTH_USER_AGENT = "geistr/0.1";
const DEFAULT_DEVICE_CODE_INTERVAL_MS = 5_000;
const DEVICE_CODE_SLOW_DOWN_INCREMENT_MS = 5_000;
const TOKEN_EXPIRY_SKEW_MS = 5 * 60 * 1000;

export interface XaiOAuthTokenResult {
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
  accountLabel?: string;
  tokenEndpoint?: string;
  deviceAuthorizationEndpoint?: string;
  issuer?: string;
  authFlow?: "device-code";
}

interface XaiOAuthFetchOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  signal?: AbortSignal;
}

interface XaiDeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresInMs: number;
  intervalMs: number;
}

const UNKNOWN_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export const XAI_OAUTH_MODELS = [
  xaiModel("grok-4.5", "Grok 4.5", true, ["text", "image"], 500_000, 131_072, { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 }),
  xaiModel("grok-4.3", "Grok 4.3", true, ["text", "image"], 1_000_000, 131_072, { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 }),
  xaiModel("grok-build", "Grok Build", true, ["text", "image"], 512_000, 30_000, { input: 1, output: 2, cacheRead: 0.2, cacheWrite: 0.2 }),
  xaiModel("grok-composer-2.5-fast", "Composer 2.5 Fast", false, ["text", "image"], 200_000, 30_000, { input: 3, output: 15, cacheRead: 0.5, cacheWrite: 0 }),
  xaiModel("grok-4.20-0309-reasoning", "Grok 4.20 Reasoning", true, ["text", "image"], 2_000_000, 131_072, { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 }),
  xaiModel("grok-4.20-0309-non-reasoning", "Grok 4.20 Non-Reasoning", false, ["text", "image"], 2_000_000, 131_072, { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 }),
  xaiModel("grok-4.20-multi-agent-0309", "Grok 4.20 Multi-Agent", true, ["text", "image"], 2_000_000, 131_072, { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 }),
] satisfies NonNullable<Parameters<import("@earendil-works/pi-coding-agent").ModelRegistry["registerProvider"]>[1]["models"]>;

function xaiModel(
  id: string,
  name: string,
  reasoning: boolean,
  input: ("text" | "image")[],
  contextWindow: number,
  maxTokens: number,
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number } = UNKNOWN_COST,
) {
  return {
    id,
    name,
    api: "openai-responses" as const,
    reasoning,
    input,
    cost,
    contextWindow,
    maxTokens,
    compat: { sendSessionIdHeader: false, supportsLongCacheRetention: false },
    ...(reasoning ? { thinkingLevelMap: { off: null, minimal: "low", low: "low", medium: "medium", high: "high", xhigh: null } } : { thinkingLevelMap: { off: "none", minimal: null, low: null, medium: null, high: null, xhigh: null } }),
  };
}

function fetchWithTimeout(fetchImpl: typeof fetch, url: string, init: RequestInit, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  return fetchImpl(url, { ...init, signal });
}

function toFormUrlEncoded(body: Record<string, string>): string {
  return new URLSearchParams(body).toString();
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function withSignal(init: Omit<RequestInit, "signal">, signal?: AbortSignal): RequestInit {
  return signal ? { ...init, signal } : init;
}

function xaiOAuthRequestHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { Accept: "application/json", "User-Agent": XAI_OAUTH_USER_AGENT, ...extra };
}

function withOptionalSignal<T extends object>(options: T, signal?: AbortSignal): T & { signal?: AbortSignal } {
  return signal ? { ...options, signal } : options;
}

async function readJson(response: Response, context: string): Promise<Record<string, unknown>> {
  const text = await response.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { json = null; }
  const record = readRecord(json);
  if (!response.ok) {
    const message = typeof record.error_description === "string" ? record.error_description : typeof record.error === "string" ? record.error : text.slice(0, 500);
    throw new Error(`${context} failed (${response.status})${message ? `: ${message}` : ""}`);
  }
  return record;
}

export function isTrustedXaiOAuthEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && (url.hostname === "x.ai" || url.hostname.endsWith(".x.ai"));
  } catch {
    return false;
  }
}

function requireTrustedXaiOAuthEndpoint(endpoint: string, label: string): string {
  if (!isTrustedXaiOAuthEndpoint(endpoint)) throw new Error(`xAI OAuth discovery returned untrusted ${label}`);
  return endpoint;
}

async function fetchDiscovery(options: XaiOAuthFetchOptions = {}): Promise<{ tokenEndpoint: string; deviceAuthorizationEndpoint: string }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const json = await readJson(await fetchWithTimeout(fetchImpl, XAI_OAUTH_DISCOVERY_URL, withSignal({ headers: xaiOAuthRequestHeaders() }, options.signal)), "xAI OAuth discovery");
  const tokenEndpoint = typeof json.token_endpoint === "string" ? json.token_endpoint : "";
  const deviceAuthorizationEndpoint = typeof json.device_authorization_endpoint === "string" ? json.device_authorization_endpoint : "";
  if (!tokenEndpoint || !deviceAuthorizationEndpoint) throw new Error("xAI OAuth discovery response is missing device-code endpoints");
  return {
    tokenEndpoint: requireTrustedXaiOAuthEndpoint(tokenEndpoint, "token endpoint"),
    deviceAuthorizationEndpoint: requireTrustedXaiOAuthEndpoint(deviceAuthorizationEndpoint, "device authorization endpoint"),
  };
}

async function requestDeviceCode(endpoint: string, options: XaiOAuthFetchOptions): Promise<XaiDeviceCodeResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const json = await readJson(await fetchWithTimeout(fetchImpl, requireTrustedXaiOAuthEndpoint(endpoint, "device authorization endpoint"), withSignal({
    method: "POST",
    headers: xaiOAuthRequestHeaders({ "Content-Type": "application/x-www-form-urlencoded" }),
    body: toFormUrlEncoded({ client_id: XAI_OAUTH_CLIENT_ID, scope: XAI_OAUTH_SCOPE }),
  }, options.signal)), "xAI device code request");
  const deviceCode = typeof json.device_code === "string" ? json.device_code : "";
  const userCode = typeof json.user_code === "string" ? json.user_code : "";
  const verificationUri = typeof json.verification_uri === "string" ? json.verification_uri : "";
  const verificationUriComplete = typeof json.verification_uri_complete === "string" ? json.verification_uri_complete : undefined;
  if (!deviceCode || !userCode || !verificationUri) throw new Error("xAI device code response is missing device_code, user_code, or verification_uri");
  return {
    deviceCode,
    userCode,
    verificationUri: requireTrustedXaiOAuthEndpoint(verificationUri, "device verification URI"),
    ...(verificationUriComplete ? { verificationUriComplete: requireTrustedXaiOAuthEndpoint(verificationUriComplete, "complete device verification URI") } : {}),
    expiresInMs: Math.max(1, Number(json.expires_in) || 300) * 1000,
    intervalMs: Math.max(1, Number(json.interval) || DEFAULT_DEVICE_CODE_INTERVAL_MS / 1000) * 1000,
  };
}

function parseTokenPayload(json: Record<string, unknown>, now: () => number, requireRefresh: boolean): XaiOAuthTokenResult & { idToken?: string } {
  const access = typeof json.access_token === "string" ? json.access_token : "";
  const refresh = typeof json.refresh_token === "string" ? json.refresh_token : "";
  if (!access) throw new Error("xAI OAuth token response is missing access_token");
  if (requireRefresh && !refresh) throw new Error("xAI OAuth token response is missing refresh_token");
  const expiresIn = Number(json.expires_in) || 3600;
  const idToken = typeof json.id_token === "string" ? json.id_token : undefined;
  return {
    access,
    refresh,
    expires: now() + expiresIn * 1000 - TOKEN_EXPIRY_SKEW_MS,
    ...(idToken ? { idToken } : {}),
  };
}

async function exchangeToken(params: { tokenEndpoint: string; body: Record<string, string>; context: string; requireRefresh?: boolean } & XaiOAuthFetchOptions): Promise<XaiOAuthTokenResult & { idToken?: string }> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const response = await fetchWithTimeout(fetchImpl, requireTrustedXaiOAuthEndpoint(params.tokenEndpoint, "token endpoint"), withSignal({
    method: "POST",
    headers: xaiOAuthRequestHeaders({ "Content-Type": "application/x-www-form-urlencoded" }),
    body: toFormUrlEncoded(params.body),
  }, params.signal));
  return parseTokenPayload(await readJson(response, params.context), params.now ?? Date.now, params.requireRefresh === true);
}

function decodeJwtPayload(token: string | undefined): Record<string, unknown> {
  if (!token) return {};
  const payload = token.split(".")[1];
  if (!payload) return {};
  try { return readRecord(JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))); } catch { return {}; }
}

function identityFromToken(token: string | undefined): { accountId?: string; accountLabel?: string } {
  const payload = decodeJwtPayload(token);
  const email = typeof payload.email === "string" ? payload.email : undefined;
  const name = typeof payload.name === "string" ? payload.name : undefined;
  const sub = typeof payload.sub === "string" ? payload.sub : undefined;
  const identity: { accountId?: string; accountLabel?: string } = {};
  const accountId = email ?? sub;
  const accountLabel = name ?? email;
  if (accountId) identity.accountId = accountId;
  if (accountLabel) identity.accountLabel = accountLabel;
  return identity;
}

async function pollDeviceCodeToken(params: { tokenEndpoint: string; deviceCode: string; expiresInMs: number; intervalMs: number } & XaiOAuthFetchOptions): Promise<XaiOAuthTokenResult & { idToken?: string }> {
  const deadline = Date.now() + params.expiresInMs;
  let intervalMs = params.intervalMs;
  while (Date.now() < deadline) {
    const fetchImpl = params.fetchImpl ?? fetch;
    const response = await fetchWithTimeout(fetchImpl, requireTrustedXaiOAuthEndpoint(params.tokenEndpoint, "token endpoint"), withSignal({
      method: "POST",
      headers: xaiOAuthRequestHeaders({ "Content-Type": "application/x-www-form-urlencoded" }),
      body: toFormUrlEncoded({ grant_type: DEVICE_CODE_GRANT_TYPE, client_id: XAI_OAUTH_CLIENT_ID, device_code: params.deviceCode }),
    }, params.signal));
    const text = await response.text();
    const json = readRecord(safeJson(text));
    if (response.ok) return parseTokenPayload(json, params.now ?? Date.now, true);
    const error = typeof json.error === "string" ? json.error : "";
    if (error === "authorization_pending" || error === "slow_down") {
      if (error === "slow_down") intervalMs += DEVICE_CODE_SLOW_DOWN_INCREMENT_MS;
      await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, Math.max(0, deadline - Date.now()))));
      continue;
    }
    if (error === "access_denied" || error === "authorization_denied") throw new Error("xAI device authorization was denied");
    if (error === "expired_token") throw new Error("xAI device code expired. Re-run the login.");
    throw new Error(`xAI device token exchange failed (${response.status})${error ? `: ${error}` : ""}`);
  }
  throw new Error("xAI device authorization timed out");
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

export async function loginXaiOAuthDeviceCode(callbacks: Pick<OAuthLoginCallbacks, "onDeviceCode" | "onProgress" | "signal">, options: XaiOAuthFetchOptions = {}): Promise<XaiOAuthTokenResult> {
  callbacks.onProgress?.("Starting xAI OAuth...");
  const signal = callbacks.signal ?? options.signal;
  const discovery = await fetchDiscovery(withOptionalSignal(options, signal));
  callbacks.onProgress?.("Requesting xAI OAuth device code...");
  const deviceCode = await requestDeviceCode(discovery.deviceAuthorizationEndpoint, withOptionalSignal(options, signal));
  callbacks.onDeviceCode({
    userCode: deviceCode.userCode,
    verificationUri: deviceCode.verificationUriComplete ?? deviceCode.verificationUri,
    intervalSeconds: Math.round(deviceCode.intervalMs / 1000),
    expiresInSeconds: Math.round(deviceCode.expiresInMs / 1000),
  });
  callbacks.onProgress?.("Waiting for xAI device authorization...");
  const tokens = await pollDeviceCodeToken(withOptionalSignal({
    ...options,
    tokenEndpoint: discovery.tokenEndpoint,
    deviceCode: deviceCode.deviceCode,
    expiresInMs: deviceCode.expiresInMs,
    intervalMs: deviceCode.intervalMs,
  }, signal));
  return {
    ...tokens,
    ...identityFromToken(tokens.idToken ?? tokens.access),
    tokenEndpoint: discovery.tokenEndpoint,
    deviceAuthorizationEndpoint: discovery.deviceAuthorizationEndpoint,
    issuer: XAI_OAUTH_ISSUER,
    authFlow: "device-code",
  };
}

export async function refreshXaiOAuthToken(credentials: OAuthCredentials, options: XaiOAuthFetchOptions = {}): Promise<OAuthCredentials> {
  const refresh = credentials.refresh;
  if (!refresh) throw new Error("xAI OAuth credential is missing refresh token");
  const tokenEndpoint = typeof credentials.tokenEndpoint === "string" && credentials.tokenEndpoint ? credentials.tokenEndpoint : (await fetchDiscovery(options)).tokenEndpoint;
  const tokens = await exchangeToken({
    ...options,
    tokenEndpoint,
    context: "xAI OAuth refresh",
    body: { grant_type: "refresh_token", client_id: XAI_OAUTH_CLIENT_ID, refresh_token: refresh },
  });
  return {
    ...credentials,
    access: tokens.access,
    refresh: tokens.refresh || refresh,
    expires: tokens.expires,
    tokenEndpoint,
    issuer: XAI_OAUTH_ISSUER,
    ...identityFromToken(tokens.idToken ?? tokens.access),
  };
}

export const xaiOAuthProvider: OAuthProviderInterface = {
  id: XAI_OAUTH_PROVIDER_ID,
  name: XAI_OAUTH_PROVIDER_NAME,
  usesCallbackServer: false,
  async login(callbacks) {
    const result = await loginXaiOAuthDeviceCode(callbacks);
    return {
      refresh: result.refresh,
      access: result.access,
      expires: result.expires,
      ...(result.accountId ? { accountId: result.accountId } : {}),
      ...(result.accountLabel ? { accountLabel: result.accountLabel } : {}),
      ...(result.tokenEndpoint ? { tokenEndpoint: result.tokenEndpoint } : {}),
      ...(result.deviceAuthorizationEndpoint ? { deviceAuthorizationEndpoint: result.deviceAuthorizationEndpoint } : {}),
      ...(result.issuer ? { issuer: result.issuer } : {}),
      ...(result.authFlow ? { authFlow: result.authFlow } : {}),
    };
  },
  refreshToken: refreshXaiOAuthToken,
  getApiKey(credentials) {
    return credentials.access;
  },
};

export function registerXaiOAuthProvider(): void {
  registerOAuthProvider(xaiOAuthProvider);
}

const XAI_REASONING_ENCRYPTED_CONTENT_INCLUDE = "reasoning.encrypted_content";
const TOOL_RESULT_IMAGE_REPLAY_TEXT = "Attached image(s) from tool result:";

type XaiPayloadRewriteOptions = SimpleStreamOptions & { cwd?: string; sessionId?: string };

function normalizedXaiModelId(modelId: string): string {
  return (modelId || "").toLowerCase().split("/").pop() || "";
}

function isGrokCliProxyModel(modelId: string): boolean {
  const normalized = normalizedXaiModelId(modelId);
  return normalized === "grok-build" || normalized === "grok-build-0.1" || normalized === "grok-composer-2.5-fast";
}

function xaiBaseUrlForModel(modelId: string): string {
  return isGrokCliProxyModel(modelId) ? XAI_GROK_OAUTH_BASE_URL : XAI_API_BASE_URL;
}

function xaiModelRequestHeaders(modelId: string, sessionId?: string): Record<string, string> {
  if (!isGrokCliProxyModel(modelId)) return {};
  const headers: Record<string, string> = {
    "x-grok-client-identifier": "geistr-xai-oauth",
    "x-grok-client-version": XAI_GROK_CLIENT_VERSION,
    "x-xai-token-auth": "xai-grok-cli",
    "x-grok-model-override": normalizedXaiModelId(modelId),
  };
  if (sessionId) headers["x-grok-conv-id"] = sessionId;
  return headers;
}

function grokSupportsReasoningEffort(modelId: string): boolean {
  const normalized = normalizedXaiModelId(modelId);
  return normalized.startsWith("grok-3-mini") || normalized.startsWith("grok-4.20-multi-agent") || normalized.startsWith("grok-4.3") || normalized.startsWith("grok-4.5");
}

function stripUnsupportedStrictFlag(tool: unknown): unknown {
  if (!tool || typeof tool !== "object") return tool;
  const record = tool as Record<string, unknown>;
  const fn = record.function;
  if (!fn || typeof fn !== "object") return tool;
  const functionRecord = fn as Record<string, unknown>;
  if (typeof functionRecord.strict !== "boolean") return tool;
  const nextFunction = { ...functionRecord };
  delete nextFunction.strict;
  return { ...record, function: nextFunction };
}

function textFromResponsesContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const item = part as { type?: unknown; text?: unknown };
      const type = typeof item.type === "string" ? item.type : "";
      return ["text", "input_text", "output_text"].includes(type) && typeof item.text === "string" ? item.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function supportsExplicitImageInput(model: Pick<Model<Api>, "input">): boolean {
  return Array.isArray(model.input) && model.input.includes("image");
}

function isResponsesInputImagePart(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && (value as Record<string, unknown>).type === "input_image";
}

function textForFunctionCallOutput(output: unknown): string {
  if (typeof output === "string") return output;
  if (!Array.isArray(output)) return output === undefined || output === null ? "" : JSON.stringify(output);
  const chunks: string[] = [];
  let imageCount = 0;
  for (const part of output) {
    if (isResponsesInputImagePart(part)) {
      imageCount += 1;
      continue;
    }
    const text = textFromResponsesContent([part]).trim();
    if (text) chunks.push(text);
  }
  if (imageCount > 0) chunks.push(`[${imageCount} image${imageCount === 1 ? "" : "s"} attached in the following user message]`);
  return chunks.join("\n") || (imageCount > 0 ? `[${imageCount} image${imageCount === 1 ? "" : "s"} attached]` : "");
}

function normalizeXaiResponsesToolResultPayload(input: unknown[], model: Pick<Model<Api>, "input">): unknown[] {
  const supportsImages = supportsExplicitImageInput(model);
  const rewritten: unknown[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object" || (item as Record<string, unknown>).type !== "function_call_output" || !Array.isArray((item as Record<string, unknown>).output)) {
      rewritten.push(item);
      continue;
    }
    const record = item as Record<string, unknown>;
    const outputParts = record.output as unknown[];
    const imageParts = outputParts.filter(isResponsesInputImagePart);
    const outputText = textForFunctionCallOutput(outputParts);
    rewritten.push({ ...record, output: outputText || "(tool returned no text output)" });
    if (supportsImages && imageParts.length > 0) {
      rewritten.push({
        role: "user",
        content: [{ type: "input_text", text: TOOL_RESULT_IMAGE_REPLAY_TEXT }, ...imageParts],
      });
    }
  }
  return rewritten;
}

export function rewriteXaiOAuthResponsesPayload(payload: unknown, model: Model<Api>, options?: XaiPayloadRewriteOptions): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const body: Record<string, any> = { ...(payload as Record<string, any>) };
  const modelId = String(body.model || model.id);
  const usesGrokCliProxy = isGrokCliProxyModel(modelId);

  if (Array.isArray(body.tools)) body.tools = body.tools.map(stripUnsupportedStrictFlag);

  if (Array.isArray(body.input)) {
    let input = normalizeXaiResponsesToolResultPayload([...body.input], model) as Record<string, any>[];
    const instructionParts: string[] = [];
    if (usesGrokCliProxy) {
      input = input.filter((item) => {
        if (!item || typeof item !== "object") return true;
        if (item.type === "reasoning") return false;
        if (typeof item.content === "string" && item.content.length === 0) return false;
        if (item.role !== "developer" && item.role !== "system") return true;
        const text = textFromResponsesContent(item.content).trim();
        if (text) instructionParts.push(text);
        return false;
      });
    } else {
      while (input.length > 0) {
        const first = input[0];
        if (!first || typeof first !== "object" || (first.role !== "developer" && first.role !== "system")) break;
        const text = textFromResponsesContent(first.content).trim();
        if (text) instructionParts.push(text);
        input.shift();
      }
    }
    if (instructionParts.length > 0) body.instructions = [body.instructions, ...instructionParts].filter((part) => typeof part === "string" && part).join("\n\n");
    body.input = input;
  }

  if (body.response_format && !body.text) {
    body.text = { format: body.response_format };
    delete body.response_format;
  }

  if (body.reasoning && typeof body.reasoning === "object") {
    const effort = body.reasoning.effort;
    if (typeof effort === "string" && effort !== "none" && grokSupportsReasoningEffort(modelId)) body.reasoning = { effort: effort === "minimal" ? "low" : effort };
    else delete body.reasoning;
  }
  delete body.reasoningEffort;
  delete body.reasoning_effort;

  if (usesGrokCliProxy && Array.isArray(body.include)) {
    body.include = body.include.filter((item: unknown) => item !== XAI_REASONING_ENCRYPTED_CONTENT_INCLUDE);
    if (body.include.length === 0) delete body.include;
  }

  delete body.prompt_cache_retention;
  const cacheKey = (typeof body.prompt_cache_key === "string" && body.prompt_cache_key.trim()) || (typeof options?.sessionId === "string" && options.sessionId.trim()) || "";
  if (cacheKey) body.prompt_cache_key = cacheKey;
  else delete body.prompt_cache_key;

  return body;
}

function streamErrorMessage(model: Model<Api>, error: unknown): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "error",
    errorMessage: error instanceof Error ? error.message : String(error),
    timestamp: Date.now(),
  };
}

export function streamXaiOAuth(model: Model<Api>, context: Context, options?: SimpleStreamOptions): import("@earendil-works/pi-ai").AssistantMessageEventStream {
  const sessionId = typeof (options as { sessionId?: unknown } | undefined)?.sessionId === "string" ? (options as { sessionId: string }).sessionId : undefined;
  const streamModel = {
    ...model,
    baseUrl: xaiBaseUrlForModel(model.id),
    headers: { ...(model.headers ?? {}), ...xaiModelRequestHeaders(model.id, sessionId) },
  } as Model<Api>;
  const headers = { ...((options as { headers?: Record<string, string> } | undefined)?.headers ?? {}) };
  if (sessionId && !headers["x-grok-conv-id"] && isGrokCliProxyModel(model.id)) headers["x-grok-conv-id"] = sessionId;

  const stream = createAssistantMessageEventStream();
  const { sessionId: _omitSessionId, ...restOptions } = options ?? {};
  void (async () => {
    try {
      const { streamSimple } = await import("@earendil-works/pi-ai/api/openai-responses");
      const result = restOptions as Record<string, unknown>;
      const rawContext = context as unknown as Record<string, unknown>;
      const payloadCwd = typeof result.cwd === "string" ? String(result.cwd) : typeof rawContext.cwd === "string" ? String(rawContext.cwd) : undefined;
      const innerOptions: import("@earendil-works/pi-ai").SimpleStreamOptions & { sessionId?: string } = {
        ...restOptions,
        headers,
        onPayload: async (payload: unknown, payloadModel: Model<Api>) => {
          const payloadOpts: import("@earendil-works/pi-ai").SimpleStreamOptions & { cwd?: string; sessionId?: string } = { ...restOptions };
          if (payloadCwd) payloadOpts.cwd = payloadCwd;
          if (sessionId) payloadOpts.sessionId = sessionId;
          const rewritten = rewriteXaiOAuthResponsesPayload(payload, payloadModel ?? streamModel, payloadOpts);
          const userRewritten = await options?.onPayload?.(rewritten, payloadModel ?? streamModel);
          return userRewritten === undefined ? rewritten : userRewritten;
        },
      };
      if (sessionId) innerOptions.sessionId = sessionId;
      const inner = streamSimple(streamModel as Model<"openai-responses">, context, innerOptions);
      for await (const event of inner as AsyncIterable<AssistantMessageEvent>) stream.push(event);
      stream.end();
    } catch (error) {
      const message = streamErrorMessage(model, error);
      stream.push({ type: "error", reason: "error", error: message });
      stream.end(message);
    }
  })();
  return stream;
}
