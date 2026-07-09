import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  type AgentSessionEvent,
  type CreateAgentSessionResult,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

import {
  createCoreProviderLayer,
  type CoreModelSelection,
  type CoreModelSelectionState,
  type CoreProviderLayer,
  type GeistrThinkingLevel,
} from "./provider-selection";
import { assembleSystemPrompt, type SystemPromptSection } from "./system-prompt";

export type GeistrAgentEvent = AgentSessionEvent;

export interface CoreAgentPromptConfig {
  stableSections?: readonly SystemPromptSection[];
  dynamicSections?: readonly SystemPromptSection[];
}

export interface CoreAgentRuntimeOptions {
  cwd: string;
  agentDir?: string;
  prompt: CoreAgentPromptConfig;
  tools?: readonly string[];
  customTools?: readonly ToolDefinition[];
  noTools?: "all" | "builtin";
  modelSelection?: CoreModelSelection;
  sessionPersistence?: "memory";
}

export interface CoreAgentSnapshot {
  sessionId: string;
  isStreaming: boolean;
  messageCount: number;
}

export interface CoreAgentImageInput { type: "image"; mimeType: string; data: string }
export interface CoreAgentSendOptions { images?: CoreAgentImageInput[] }

export interface CoreAgentRuntime {
  readonly sessionId: string;
  readonly systemPrompt: string;
  getSnapshot(): CoreAgentSnapshot;
  getModelSelectionState(): Promise<CoreModelSelectionState>;
  selectModel(selection: CoreModelSelection): Promise<CoreModelSelectionState>;
  sendMessage(text: string, options?: CoreAgentSendOptions): Promise<void>;
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;
  subscribe(listener: (event: GeistrAgentEvent) => void): () => void;
  abort(): Promise<void>;
  dispose(): void;
}

interface PiAgentSession {
  readonly sessionId: string;
  readonly isStreaming: boolean;
  readonly messages: readonly unknown[];
  readonly model?: { provider: string; id: string };
  setModel?(model: unknown): Promise<void>;
  setThinkingLevel?(level: GeistrThinkingLevel): void;
  prompt(text: string, options?: CoreAgentSendOptions): Promise<void>;
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;
  subscribe(listener: (event: GeistrAgentEvent) => void): () => void;
  abort(): Promise<void>;
  dispose(): void;
}

interface PiResourceLoader {
  reload(): Promise<void>;
}

interface PiRuntimeAdapter {
  getAgentDir(): string;
  createInMemorySessionManager(cwd: string): unknown;
  createResourceLoader(options: { cwd: string; agentDir: string; systemPrompt: string }): PiResourceLoader;
  createAgentSession(options: {
    cwd: string;
    agentDir: string;
    tools?: readonly string[];
    customTools?: readonly ToolDefinition[];
    noTools?: "all" | "builtin";
    resourceLoader: PiResourceLoader;
    sessionManager: unknown;
    model?: unknown;
    thinkingLevel?: GeistrThinkingLevel;
  }): Promise<{ session: PiAgentSession }>;
  createProviderLayer(): CoreProviderLayer;
}

const defaultPiRuntimeAdapter: PiRuntimeAdapter = {
  getAgentDir,
  createInMemorySessionManager: (cwd) => SessionManager.inMemory(cwd),
  createResourceLoader: ({ cwd, agentDir, systemPrompt }) =>
    new DefaultResourceLoader({
      cwd,
      agentDir,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPromptOverride: () => systemPrompt,
      appendSystemPromptOverride: () => [],
      skillsOverride: () => ({ skills: [], diagnostics: [] }),
      agentsFilesOverride: () => ({ agentsFiles: [] }),
      extensionsOverride: (base) => ({ ...base, extensions: [], diagnostics: [] }),
    }),
  createAgentSession: async (options) => {
    const result: CreateAgentSessionResult = await createAgentSession({
      cwd: options.cwd,
      agentDir: options.agentDir,
      ...(options.tools ? { tools: [...options.tools] } : {}),
      ...(options.customTools ? { customTools: [...options.customTools] } : {}),
      ...(options.noTools ? { noTools: options.noTools } : {}),
      ...(options.model ? { model: options.model as never } : {}),
      ...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel as never } : {}),
      resourceLoader: options.resourceLoader as DefaultResourceLoader,
      sessionManager: options.sessionManager as ReturnType<typeof SessionManager.inMemory>,
    });

    return { session: result.session as PiAgentSession };
  },
  createProviderLayer: () => createCoreProviderLayer(),
};

export async function createCoreAgentRuntime(
  options: CoreAgentRuntimeOptions,
  adapter: PiRuntimeAdapter = defaultPiRuntimeAdapter,
): Promise<CoreAgentRuntime> {
  const systemPrompt = assembleSystemPrompt({
    ...(options.prompt.stableSections ? { stableSections: options.prompt.stableSections } : {}),
    ...(options.prompt.dynamicSections ? { dynamicSections: options.prompt.dynamicSections } : {}),
  });
  const agentDir = options.agentDir ?? adapter.getAgentDir();
  const resourceLoader = adapter.createResourceLoader({ cwd: options.cwd, agentDir, systemPrompt });
  await resourceLoader.reload();

  const providerLayer = adapter.createProviderLayer();
  const resolvedSelection = options.modelSelection ? await providerLayer.resolveModelSelection(options.modelSelection) : undefined;

  const { session } = await adapter.createAgentSession({
    cwd: options.cwd,
    agentDir,
    ...(options.tools ? { tools: options.tools } : {}),
    ...(options.customTools ? { customTools: [...options.customTools] } : {}),
    ...(options.noTools ? { noTools: options.noTools } : {}),
    ...(resolvedSelection?.model ? { model: resolvedSelection.model } : {}),
    ...(resolvedSelection?.thinkingLevel ? { thinkingLevel: resolvedSelection.thinkingLevel } : {}),
    resourceLoader,
    sessionManager: adapter.createInMemorySessionManager(options.cwd),
  });

  let selectedModel: CoreModelSelection | null = options.modelSelection ?? modelToSelection(session.model);

  async function modelSelectionState(): Promise<CoreModelSelectionState> {
    return { selected: selectedModel, options: await providerLayer.listModelOptions() };
  }

  return {
    sessionId: session.sessionId,
    systemPrompt,
    getSnapshot: () => ({
      sessionId: session.sessionId,
      isStreaming: session.isStreaming,
      messageCount: session.messages.length,
    }),
    getModelSelectionState: modelSelectionState,
    selectModel: async (selection) => {
      const resolved = await providerLayer.resolveModelSelection(selection);
      await session.setModel?.(resolved.model);
      if (resolved.thinkingLevel) session.setThinkingLevel?.(resolved.thinkingLevel);
      selectedModel = { ...selection, ...(resolved.thinkingLevel ? { thinkingLevel: resolved.thinkingLevel } : {}) };
      return modelSelectionState();
    },
    sendMessage: (text, options) => session.prompt(text, options),
    steer: (text) => session.steer(text),
    followUp: (text) => session.followUp(text),
    subscribe: (listener) => session.subscribe(listener),
    abort: () => session.abort(),
    dispose: () => session.dispose(),
  };
}

function modelToSelection(model: PiAgentSession["model"]): CoreModelSelection | null {
  if (!model) return null;
  return { provider: model.provider, modelId: model.id };
}
