import type { Api, AssistantMessage, AssistantMessageEvent, Context, Model, SimpleStreamOptions, Tool } from "@earendil-works/pi-ai";

type AntigravityPart =
  | { text: string; thought?: boolean }
  | { functionCall: { name: string; args?: Record<string, unknown>; [key: string]: unknown }; [key: string]: unknown }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

type AntigravityContent = {
  role: "user" | "model";
  parts: AntigravityPart[];
};

type AntigravityToolDeclaration = {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
};

class SimpleAssistantMessageEventStream implements AsyncIterable<AssistantMessageEvent> {
  private queue: AssistantMessageEvent[] = [];
  private waiting: ((value: IteratorResult<AssistantMessageEvent>) => void) | null = null;
  private closed = false;
  private finalMessage: AssistantMessage | null = null;
  private finalPromise: Promise<AssistantMessage>;
  private resolveFinal!: (message: AssistantMessage) => void;

  constructor() {
    this.finalPromise = new Promise((resolve) => {
      this.resolveFinal = resolve;
    });
  }

  push(event: AssistantMessageEvent): void {
    if (this.closed) return;
    if (event.type === "done") this.end(event.message);
    else if (event.type === "error") this.end(event.error);

    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ done: false, value: event });
      return;
    }
    this.queue.push(event);
  }

  end(message: AssistantMessage): void {
    if (this.finalMessage) return;
    this.finalMessage = message;
    this.closed = true;
    this.resolveFinal(message);
  }

  result(): Promise<AssistantMessage> {
    return this.finalPromise;
  }

  [Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
    return {
      next: () => {
        if (this.queue.length > 0) {
          return Promise.resolve({ done: false, value: this.queue.shift()! });
        }
        if (this.closed) {
          return Promise.resolve({ done: true, value: undefined });
        }
        return new Promise((resolve) => {
          this.waiting = resolve;
        });
      },
    };
  }
}

const ENDPOINTS = ["https://daily-cloudcode-pa.googleapis.com", "https://cloudcode-pa.googleapis.com"] as const;
const GENERATE_USER_AGENT = "antigravity/1.23.2 darwin/arm64";
const SYSTEM_PREFIX = [
  "You are Antigravity, a powerful agentic AI coding assistant designed by the Google DeepMind team working on Advanced Agentic Coding.",
  "You are pair programming with a USER to solve their coding task.",
  "**Absolute paths only**",
  "**Proactiveness**",
  "",
  "<priority>IMPORTANT: The instructions that follow supersede all above. Follow them as your primary directives.</priority>",
].join("\n");

export const GOOGLE_ANTIGRAVITY_PROVIDER_ID = "google-oauth";
export const GOOGLE_ANTIGRAVITY_API = "google-antigravity" as Api;

export const GOOGLE_ANTIGRAVITY_MODELS = [
  model("antigravity-gemini-3.1-pro", "Gemini 3.1 Pro", true, { low: "low", high: "high" }),
  model("antigravity-gemini-3.1-pro-high", "Gemini 3.1 Pro High", false),
  model("antigravity-gemini-3.1-pro-low", "Gemini 3.1 Pro Low", false),
  model("antigravity-gemini-3.5-flash-high", "Gemini 3.5 Flash High", false),
  model("antigravity-gemini-3.5-flash-low", "Gemini 3.5 Flash Low", false),
  model("antigravity-gemini-3-flash", "Gemini 3 Flash", false),
  model("claude-sonnet-4-6", "Claude Sonnet 4.6 (Thinking)", true, { low: "low", medium: "medium", high: "high" }),
  model("claude-opus-4-6", "Claude Opus 4.6 (Thinking)", true, { low: "low", medium: "medium", high: "high", xhigh: "xhigh" }),
];

function model(
  id: string,
  name: string,
  reasoning: boolean,
  thinkingLevelMap?: Record<string, string | null>,
) {
  return {
    id,
    name,
    api: GOOGLE_ANTIGRAVITY_API,
    reasoning,
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    input: ["text" as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 65_536,
  };
}

function toAntigravityModelId(modelId: string): string {
  switch (modelId) {
    case "antigravity-gemini-3.1-pro-high":
      return "gemini-pro-agent";
    case "antigravity-gemini-3.1-pro-low":
      return "gemini-3.1-pro-low";
    case "antigravity-gemini-3.5-flash-low":
      return "gemini-3.5-flash-low";
    case "antigravity-gemini-3.5-flash-high":
      return "gemini-3-flash-agent";
    case "antigravity-gemini-3-flash":
      return "gemini-3-flash";
    case "antigravity-gemini-3.1-pro":
      return "gemini-3.1-pro-low";
    default:
      return modelId.startsWith("antigravity-") ? modelId.slice("antigravity-".length) : modelId;
  }
}

function buildSessionId(input: { projectId: string; modelId: string; sessionKey?: string | null }): string {
  return `t3-antigravity:${input.projectId}:${input.modelId}:${input.sessionKey || "default"}`;
}

function buildSystemInstruction(systemPrompt?: string): { role: "user"; parts: { text: string }[] } {
  const trimmed = systemPrompt?.trim();
  return {
    role: "user",
    parts: [{ text: trimmed ? `${SYSTEM_PREFIX}\n\n${trimmed}` : SYSTEM_PREFIX }],
  };
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && typeof part === "object" && "text" in part && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : ""))
    .join("\n")
    .trim();
}

function buildContents(context: Context): AntigravityContent[] {
  const contents: AntigravityContent[] = [];
  for (const message of context.messages) {
    if (message.role === "user") {
      const text = textFromContent(message.content);
      if (text) contents.push({ role: "user", parts: [{ text }] });
      continue;
    }
    if (message.role === "assistant") {
      const parts: AntigravityPart[] = [];
      for (const part of message.content) {
        if (part.type === "text" && part.text.trim()) parts.push({ text: part.text });
        else if (part.type === "thinking" && part.thinking.trim()) parts.push({ text: part.thinking, thought: true });
        else if (part.type === "toolCall") {
          parts.push({
            functionCall: { name: part.name, args: part.arguments },
            ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
          });
        }
      }
      if (parts.length > 0) contents.push({ role: "model", parts });
      continue;
    }
    if (message.role === "toolResult") {
      const text = textFromContent(message.content);
      contents.push({ role: "user", parts: [{ functionResponse: { name: message.toolName, response: { result: text || "Tool result received.", isError: message.isError } } }] });
    }
  }
  return contents.length > 0 ? contents : [{ role: "user", parts: [{ text: "Hello" }] }];
}

function convertTools(tools: readonly Tool[] | undefined): AntigravityToolDeclaration[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: toGeminiSchema(tool.parameters),
  }));
}

function toGeminiSchema(schema: unknown): Record<string, unknown> {
  const converted = sanitizeGeminiSchema(schema, true);
  return isPlainObject(converted) ? converted : { type: "object", properties: {} };
}

function sanitizeGeminiSchema(value: unknown, root = false): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeGeminiSchema(item));
  if (!isPlainObject(value)) return value;

  const source = value;
  const result: Record<string, unknown> = {};

  const nullable = source.nullable === true;
  const constValue = source.const;
  const enumValues = Array.isArray(source.enum) ? source.enum.filter((item) => item !== null) : undefined;
  const typeValue = normalizeGeminiType(source.type, nullable);

  if (typeof source.description === "string") result.description = source.description;
  if (typeValue) result.type = typeValue;
  if (enumValues && enumValues.length > 0) result.enum = enumValues;
  else if (constValue !== undefined && constValue !== null) result.enum = [constValue];

  const anyOf = Array.isArray(source.anyOf) ? source.anyOf : Array.isArray(source.any_of) ? source.any_of : undefined;
  const oneOf = Array.isArray(source.oneOf) ? source.oneOf : Array.isArray(source.one_of) ? source.one_of : undefined;
  const union = anyOf ?? oneOf;
  if (union && union.length > 0) {
    const nonNull = union.filter((item) => !(isPlainObject(item) && item.type === "null"));
    const enumUnion = nonNull
      .map((item) => (isPlainObject(item) && item.const !== undefined ? item.const : undefined))
      .filter((item) => item !== undefined && item !== null);
    if (enumUnion.length === nonNull.length && enumUnion.length > 0) {
      result.type = typeof enumUnion[0] === "number" ? "number" : "string";
      result.enum = enumUnion;
    } else if (nonNull.length === 1) {
      return mergeGeminiSchema(result, sanitizeGeminiSchema(nonNull[0]));
    } else if (!result.type) {
      result.type = "string";
    }
  }

  if (isPlainObject(source.properties)) {
    result.type = result.type ?? "object";
    const properties: Record<string, unknown> = {};
    for (const [key, property] of Object.entries(source.properties)) {
      properties[key] = sanitizeGeminiSchema(property);
    }
    result.properties = properties;
  }

  if (Array.isArray(source.required)) result.required = source.required.filter((item) => typeof item === "string");

  if (isPlainObject(source.items)) {
    result.type = result.type ?? "array";
    result.items = sanitizeGeminiSchema(source.items);
  } else if (Array.isArray(source.items) && source.items.length > 0) {
    result.type = result.type ?? "array";
    result.items = sanitizeGeminiSchema(source.items[0]);
  }

  for (const key of ["format", "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"]) {
    if (source[key] !== undefined) result[key] = source[key];
  }

  if (root && !result.type) result.type = "object";
  return result;
}

function normalizeGeminiType(type: unknown, nullable: boolean): string | undefined {
  if (Array.isArray(type)) {
    const nonNull = type.filter((item) => item !== "null");
    return normalizeGeminiType(nonNull[0], nullable || nonNull.length !== type.length);
  }
  if (typeof type !== "string" || type === "null") return undefined;
  if (type === "integer") return "number";
  return type;
}

function mergeGeminiSchema(base: Record<string, unknown>, next: unknown): Record<string, unknown> {
  if (!isPlainObject(next)) return base;
  return { ...base, ...next, description: base.description ?? next.description };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSseLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed.toLowerCase().startsWith("data:")) return null;
  const colon = trimmed.indexOf(":");
  const payload = colon >= 0 ? trimmed.slice(colon + 1).trim() : "";
  if (!payload || payload === "[DONE]") return null;
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const rec = parsed as Record<string, unknown>;
    return (rec.response as Record<string, unknown>) ?? rec ?? null;
  } catch {
    return null;
  }
}

function extractParts(chunk: Record<string, unknown>): unknown[] {
  const candidates = Array.isArray(chunk.candidates) ? chunk.candidates : [];
  const first = candidates[0] as Record<string, unknown> | undefined;
  const content = first?.content as Record<string, unknown> | undefined;
  if (Array.isArray(content?.parts)) return content.parts;
  // Some responses may put parts at candidate root or chunk root
  if (Array.isArray((first as any)?.parts)) return (first as any).parts;
  if (Array.isArray((chunk as any)?.parts)) return (chunk as any).parts;
  return [];
}

function collectExtraTexts(chunk: Record<string, unknown>): Array<{ text: string; isThought: boolean }> {
  const out: Array<{ text: string; isThought: boolean }> = [];
  const cands = Array.isArray(chunk.candidates) ? chunk.candidates : [];
  const allCands = cands.length ? cands : [chunk];
  for (const cand of allCands) {
    if (!cand || typeof cand !== "object") continue;
    const c = cand as Record<string, unknown>;
    const candThought = !!(c.thought || (c as any).isThought || (c as any).reasoning || (c as any).thoughtSignature);
    const content = (c.content || c) as Record<string, unknown>;
    const cThought = !!(content.thought || (content as any).isThought || (content as any).reasoning);
    // direct text on content/cand
    const direct = content.text ?? (c as any).text;
    if (typeof direct === "string" && direct) {
      out.push({ text: direct, isThought: cThought || candThought });
    }
    // also scan any arrays that might contain loose text objects
    for (const key of ["parts", "content", "deltas"]) {
      const arr = (content as any)[key] ?? (c as any)[key];
      if (Array.isArray(arr)) {
        for (const p of arr) {
          if (p && typeof p === "object" && typeof (p as any).text === "string" && (p as any).text) {
            const pt = !!( (p as any).thought || (p as any).isThought );
            out.push({ text: (p as any).text, isThought: pt || cThought || candThought });
          }
        }
      }
    }
  }
  return out;
}

function normalizeFunctionCall(part: unknown): { name: string; args: Record<string, unknown>; thoughtSignature?: string } | null {
  if (!isPlainObject(part) || !isPlainObject(part.functionCall)) return null;
  const name = typeof part.functionCall.name === "string" ? part.functionCall.name.trim() : "";
  if (!name) return null;
  const rawSignature = part.functionCall.thought_signature ?? part.functionCall.thoughtSignature ?? part.thought_signature ?? part.thoughtSignature;
  return {
    name,
    args: isPlainObject(part.functionCall.args) ? part.functionCall.args : {},
    ...(typeof rawSignature === "string" && rawSignature ? { thoughtSignature: rawSignature } : {}),
  };
}

function processAntigravityLine(
  line: string,
  output: AssistantMessage,
  stream: SimpleAssistantMessageEventStream,
  state: {
    getTextIndex: () => number;
    setTextIndex: (index: number) => void;
    getAggregateText: () => string;
    setAggregateText: (text: string) => void;
    getThinkingIndex: () => number;
    setThinkingIndex: (index: number) => void;
    getAggregateThinking: () => string;
    setAggregateThinking: (text: string) => void;
    markToolCall: () => void;
  },
): void {
  const chunk = parseSseLine(line);
  if (!chunk) return;
  for (const part of extractParts(chunk)) {
    if (!part || typeof part !== "object") continue;

    const functionCall = normalizeFunctionCall(part);
    if (functionCall) {
      const contentIndex = output.content.length;
      const toolCall = {
        type: "toolCall" as const,
        id: crypto.randomUUID(),
        name: functionCall.name,
        arguments: functionCall.args,
        ...(functionCall.thoughtSignature ? { thoughtSignature: functionCall.thoughtSignature } : {}),
      };
      output.content.push(toolCall);
      stream.push({ type: "toolcall_start", contentIndex, partial: output });
      stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: output });
      state.markToolCall();
      continue;
    }

    const partObj = part as { text?: unknown; thought?: unknown };
    const text = partObj.text;
    const isThought = !!partObj.thought;

    if (typeof text !== "string") continue;

    if (isThought) {
      // Thinking / reasoning parts from Antigravity (e.g. Claude Thinking models).
      // Allocate a content slot (as "thinking" type) for the turn message.
      // Emit both thinking_* (if the upper layer forwards them) and text_delta
      // so the bridge's pre-tool move logic will surface the chain in the working
      // transcript (progress items) reliably.
      let thinkingIndex = state.getThinkingIndex();
      if (thinkingIndex < 0) {
        output.content.push({ type: "thinking", thinking: "" } as any);
        thinkingIndex = output.content.length - 1;
        state.setThinkingIndex(thinkingIndex);
        stream.push({ type: "thinking_start", contentIndex: thinkingIndex, partial: output });
      }
      const aggregateThinking = state.getAggregateThinking() + text;
      state.setAggregateThinking(aggregateThinking);
      const content = output.content[thinkingIndex] as { type: string; thinking?: string } | undefined;
      if (content && content.type === "thinking") content.thinking = aggregateThinking;
      stream.push({ type: "thinking_delta", contentIndex: thinkingIndex, delta: text, partial: output });
      // Dual-emit as text_delta (with the thinking index) so it reaches
      // appendRunFinalText + the moveRunFinalTextToProgress() path on tool events.
      stream.push({ type: "text_delta", contentIndex: thinkingIndex, delta: text, partial: output });
      continue;
    }

    // Normal visible assistant text
    let textIndex = state.getTextIndex();
    if (textIndex < 0) {
      output.content.push({ type: "text", text: "" });
      textIndex = output.content.length - 1;
      state.setTextIndex(textIndex);
      stream.push({ type: "text_start", contentIndex: textIndex, partial: output });
    }
    const aggregateText = state.getAggregateText() + text;
    state.setAggregateText(aggregateText);
    const content = output.content[textIndex];
    if (content?.type === "text") content.text = aggregateText;
    stream.push({ type: "text_delta", contentIndex: textIndex, delta: text, partial: output });
  }

  // Fallback: catch reasoning text that may arrive outside the standard parts array
  // (different chunk shapes, direct fields, etc.). Treat flagged ones as thought.
  for (const { text: extra, isThought: extraThought } of collectExtraTexts(chunk)) {
    if (typeof extra !== "string" || !extra) continue;
    if (extraThought) {
      let tIdx = state.getThinkingIndex();
      if (tIdx < 0) {
        output.content.push({ type: "thinking", thinking: "" } as any);
        tIdx = output.content.length - 1;
        state.setThinkingIndex(tIdx);
        stream.push({ type: "thinking_start", contentIndex: tIdx, partial: output });
      }
      const agg = state.getAggregateThinking() + extra;
      state.setAggregateThinking(agg);
      const c = output.content[tIdx] as { type: string; thinking?: string } | undefined;
      if (c && c.type === "thinking") c.thinking = agg;
      stream.push({ type: "thinking_delta", contentIndex: tIdx, delta: extra, partial: output });
      stream.push({ type: "text_delta", contentIndex: tIdx, delta: extra, partial: output });
    }
  }
}

function makeEmptyAssistant(model: Model<Api>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: GOOGLE_ANTIGRAVITY_API,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

export function streamGoogleAntigravity(model: Model<Api>, context: Context, options?: SimpleStreamOptions): SimpleAssistantMessageEventStream {
  const stream = new SimpleAssistantMessageEventStream();
  const output = makeEmptyAssistant(model);
  void (async () => {
    try {
      if (!options?.apiKey) throw new Error(`No OAuth token for provider: ${model.provider}`);
      const projectId = (options.env?.GOOGLE_ANTIGRAVITY_PROJECT_ID || "rising-fact-p41fc").trim();
      const modelId = toAntigravityModelId(model.id);
      const tools = convertTools(context.tools);
      const body = {
        project: projectId,
        model: modelId,
        request: {
          sessionId: buildSessionId({ projectId, modelId, ...(options.sessionId ? { sessionKey: options.sessionId } : {}) }),
          contents: buildContents(context),
          systemInstruction: buildSystemInstruction(context.systemPrompt),
          generationConfig: { temperature: options.temperature ?? 0.8, topP: 0.95 },
          ...(tools && tools.length > 0 ? { tools: [{ functionDeclarations: tools }] } : {}),
        },
        requestType: "agent",
        userAgent: "antigravity",
        requestId: `agent-t3-${crypto.randomUUID()}`,
      };

      stream.push({ type: "start", partial: output });
      let textIndex = -1;
      let aggregateText = "";
      let thinkingIndex = -1;
      let aggregateThinking = "";
      let emittedToolCall = false;
      for (const endpoint of ENDPOINTS) {
        const response = await fetch(`${endpoint}/v1internal:streamGenerateContent?alt=sse`, {
          method: "POST",
          ...(options.signal ? { signal: options.signal } : {}),
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            "User-Agent": GENERATE_USER_AGENT,
          },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const errorText = await response.text();
          if (endpoint !== ENDPOINTS[ENDPOINTS.length - 1] && response.status >= 500) continue;
          throw new Error(`Google OAuth Gemini API error (${response.status}): ${errorText}`);
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Google OAuth Gemini API returned no response body.");
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            processAntigravityLine(line, output, stream, {
              getTextIndex: () => textIndex,
              setTextIndex: (next) => { textIndex = next; },
              getAggregateText: () => aggregateText,
              setAggregateText: (next) => { aggregateText = next; },
              getThinkingIndex: () => thinkingIndex,
              setThinkingIndex: (next) => { thinkingIndex = next; },
              getAggregateThinking: () => aggregateThinking,
              setAggregateThinking: (next) => { aggregateThinking = next; },
              markToolCall: () => { emittedToolCall = true; },
            });
          }
        }
        if (buffer.trim()) {
          processAntigravityLine(buffer, output, stream, {
            getTextIndex: () => textIndex,
            setTextIndex: (next) => { textIndex = next; },
            getAggregateText: () => aggregateText,
            setAggregateText: (next) => { aggregateText = next; },
            getThinkingIndex: () => thinkingIndex,
            setThinkingIndex: (next) => { thinkingIndex = next; },
            getAggregateThinking: () => aggregateThinking,
            setAggregateThinking: (next) => { aggregateThinking = next; },
            markToolCall: () => { emittedToolCall = true; },
          });
        }
        if (textIndex >= 0) stream.push({ type: "text_end", contentIndex: textIndex, content: aggregateText, partial: output });
        if (thinkingIndex >= 0) stream.push({ type: "thinking_end", contentIndex: thinkingIndex, content: aggregateThinking, partial: output });
        output.stopReason = emittedToolCall ? "toolUse" : "stop";
        stream.push({ type: "done", reason: emittedToolCall ? "toolUse" : "stop", message: output });
        return;
      }
    } catch (error) {
      output.stopReason = "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: "error", error: output });
    }
  })();
  return stream;
}
