export type ProviderErrorKind =
  | "auth_required"
  | "invalid_api_key"
  | "rate_limited"
  | "quota_exceeded"
  | "model_unavailable"
  | "network"
  | "timeout"
  | "provider_error"
  | "tool_error"
  | "empty_response"
  | "unknown";

export interface NormalizedProviderError {
  kind: ProviderErrorKind;
  title: string;
  message: string;
  recoverable: boolean;
  providerId?: string;
  modelId?: string;
  technicalDetails: string;
}

export interface NormalizeProviderErrorInput {
  error: unknown;
  providerId?: string | null;
  modelId?: string | null;
}

export function normalizeProviderError(input: NormalizeProviderErrorInput): NormalizedProviderError {
  const technicalDetails = formatTechnicalDetails(input.error);
  const kind = classifyProviderError(input.error, technicalDetails);
  const friendly = friendlyErrorCopy(kind);
  return {
    kind,
    ...friendly,
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.modelId ? { modelId: input.modelId } : {}),
    technicalDetails,
  };
}

export function classifyProviderError(error: unknown, details = formatTechnicalDetails(error)): ProviderErrorKind {
  const status = getNumericField(error, ["status", "statusCode", "code"]);
  const lower = details.toLowerCase();
  if (/(tool|function).*(failed|error)|toolcall|tool_call/.test(lower)) return "tool_error";
  if (status === 401 || status === 403 || /unauthorized|forbidden|auth required|authentication required|not authenticated|login required/.test(lower)) {
    if (/invalid.*(api key|token|credential)|api key.*invalid|incorrect api key|expired.*(api key|token|credential)/.test(lower)) return "invalid_api_key";
    return "auth_required";
  }
  if (/invalid.*(api key|token|credential)|api key.*invalid|incorrect api key/.test(lower)) return "invalid_api_key";
  if (status === 429 || /rate limit|too many requests|retry-after/.test(lower)) return "rate_limited";
  if (/quota|insufficient credits|credit balance|billing hard limit|usage limit/.test(lower)) return "quota_exceeded";
  if (status === 404 || /model.*(not found|not available|unavailable|unsupported)|unsupported model|unknown model|does not exist/.test(lower)) return "model_unavailable";
  if (/timeout|timed out|etimedout|aborterror/.test(lower)) return "timeout";
  if (/network|offline|enotfound|econnreset|econnrefused|eai_again|fetch failed|socket|dns/.test(lower)) return "network";
  if (/empty response|without returning a response|finished without returning/.test(lower)) return "empty_response";
  if (status && status >= 500) return "provider_error";
  if (/provider|sdk|api error|internal server error|bad gateway|service unavailable/.test(lower)) return "provider_error";
  return "unknown";
}

function friendlyErrorCopy(kind: ProviderErrorKind): Pick<NormalizedProviderError, "title" | "message" | "recoverable"> {
  switch (kind) {
    case "auth_required": return { title: "The model request failed.", message: "This provider needs to be connected before Geistr can use it.", recoverable: true };
    case "invalid_api_key": return { title: "The model request failed.", message: "The provider API key looks invalid. Update it in provider settings.", recoverable: true };
    case "rate_limited": return { title: "The model request failed.", message: "The provider rate limit was reached. Wait a moment, then retry.", recoverable: true };
    case "quota_exceeded": return { title: "The model request failed.", message: "The provider quota or credit limit was reached.", recoverable: true };
    case "model_unavailable": return { title: "The model request failed.", message: "The selected model is unavailable or unsupported. Choose another model.", recoverable: true };
    case "network": return { title: "The model request failed.", message: "Geistr could not reach the provider. Check your connection and retry.", recoverable: true };
    case "timeout": return { title: "The model request failed.", message: "The provider request timed out. Retry when the connection is stable.", recoverable: true };
    case "provider_error": return { title: "The model request failed.", message: "The provider returned an internal error. Retry or choose another model.", recoverable: true };
    case "tool_error": return { title: "The assistant run failed.", message: "A tool or runtime step failed during the assistant turn.", recoverable: true };
    case "empty_response": return { title: "Got an empty response.", message: "Try rephrasing or sending again.", recoverable: true };
    default: return { title: "The model request failed.", message: "Something went wrong while contacting the model provider.", recoverable: true };
  }
}

function formatTechnicalDetails(error: unknown): string {
  if (error instanceof Error) return error.stack || error.message;
  try { return JSON.stringify(error, null, 2); } catch { return String(error); }
}

function getNumericField(error: unknown, fields: string[]): number | null {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "number") return value;
    if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  }
  return null;
}
