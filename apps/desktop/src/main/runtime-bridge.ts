import { SessionPersistenceStore, FilesystemArtifactStore, BackgroundLoopRunner, SkillRegistry, McpManager, createDefaultSkillRoots, createDefaultLoopCatalog, createLoopToolDefinitions, createMemoryToolDefinitions, createSessionCompactionRuntime, SESSION_COMPACTION_LOOP_ID, createCoreAgentRuntime, createCoreProviderAuthLayer, createCoreProviderLayer, createPostTurnJobScheduler, ProfileStore, buildRuntimePrompt, cacheAgentDocs, createProfileToolDefinitions, createSkillToolDefinitions, createControlledFileToolDefinitions, createWebToolDefinitions, DEFAULT_WEB_ACCESS_CONFIG, gateToolDefinition, normalizeProviderError, runSessionCompactionLoop, sanitizeAppConfig, getMemoryGraph, type AppConfig, type CoreAgentRuntime, type CoreModelSelection, type CoreProviderAuthEvent, type CoreProviderAuthLayer, type LoopEvent, type LoopModelRunner, type LoopSingleRequestInput, type PostTurnJobScheduler, type ArtifactStore, type LoopCatalog, type PendingLoopResult, type PendingToolApproval, type ToolPermissionAssessment, type ToolPermissionRequest, type MessageAttachment, type AppConfigWebAccess, type MemoryGraph, type GetMemoryGraphOptions } from "@geistr/core";
import { writeAppConfig } from "./app-config-storage.js";
import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { buildAttachmentPrompt } from "./attachment-prompt.js";
import { describeAuthEvent, extractRuntimeProviderFailure, extractRuntimeTextDelta, extractSimpleText, extractToolName, formatMcpPromptSection, formatPendingLoopResults, formatToolPermissionPrompt, getConnectedProviderIds, runtimeMessageEndedSuccessfully } from "./runtime-bridge-utils.js";
import { logSystemPromptSnapshot } from "./system-prompt-logger.js";
import { publishLoopProgressState, type LoopProgressPresenterState } from "./loop-progress-presenter.js";
import { RunUiManager } from "./run-ui-manager.js";
import type { DesktopChatMessage, DesktopChatState, DesktopModelSelection, DesktopProviderSettingsState, DesktopSkillDetails, DesktopSkillSummary, DesktopSkillsState } from "../shared/desktop-api";
export class DesktopRuntimeBridge {
  private runtimePromise: Promise<CoreAgentRuntime> | null = null;
  private activeSessionId: string | null = null;
  private messages: DesktopChatMessage[] = [];
  private listeners = new Set<(state: DesktopChatState) => void>();
  private lastAuthEvent: string | undefined;
  private loginInFlight: Promise<DesktopChatState> | null = null;
  private postTurnJobs: PostTurnJobScheduler;
  private appConfig: AppConfig | null = null;
  private pendingAssistantEventId: string | null = null;
  private readonly runUiManager = new RunUiManager(() => this.emit());
  private readonly loopProgressState: LoopProgressPresenterState = { loopProgress: null, clearTimer: null };
  private activeForegroundRun: { runtime: CoreAgentRuntime; cancelled: boolean } | null = null;
  private pendingRuntimeFailure: unknown | null = null;
  private pendingApproval: PendingToolApproval | null = null;
  private approvalWaiter: { id: string; resolve: (approved: boolean) => void } | null = null;
  private readonly artifactStore: ArtifactStore;
  private readonly loopCatalog: LoopCatalog;
  private readonly backgroundLoopRunner: BackgroundLoopRunner;
  private readonly skillRegistry: SkillRegistry;
  private readonly userSkillsDir: string | null;
  private mcpManager: McpManager | null = null;
  private readonly agentDocsDir: string;
  private readonly providerErrorLogPath: string;
  constructor(
    private readonly cwd: string,
    private readonly sessionStore: SessionPersistenceStore,
    /** Shared database path for profiles (same as session store DB). */
    private readonly profileStore: ProfileStore,
    private readonly auth: CoreProviderAuthLayer = createCoreProviderAuthLayer(),
    private readonly openExternalUrl: (url: string) => Promise<void> | void = () => undefined,
    artifactRootDir: string = path.join(cwd, "runtime-artifacts"),
    userSkillsDir?: string,
  ) {
    this.postTurnJobs = createPostTurnJobScheduler();
    this.userSkillsDir = userSkillsDir ?? null;
    this.skillRegistry = new SkillRegistry(createDefaultSkillRoots(userSkillsDir ? { userSkillsDir } : {}));
    this.artifactStore = new FilesystemArtifactStore({ rootDir: artifactRootDir });
    this.loopCatalog = createDefaultLoopCatalog();
    this.backgroundLoopRunner = new BackgroundLoopRunner({
      catalog: this.loopCatalog,
      sessionStore: this.sessionStore,
      artifactStore: this.artifactStore,
      starters: {
        "session-compaction": async ({ sessionKey, publish, input }) => {
          const runtime = await this.getRuntime();
          const model = await runtime.getModelSelectionState();
          const selected = model.selected;
          const compactionRuntime = createSessionCompactionRuntime({
            store: this.sessionStore,
            modelRunner: this.createCompactionModelRunner(selected?.provider ?? null, selected?.modelId ?? null),
            target: { sessionKey, scope: "core" },
            ...(input?.force === true ? { thresholdTokens: 1 } : {}),
            retainRecentMessages: 16,
            progressSink: { publish },
          });
          const run = await compactionRuntime.start(SESSION_COMPACTION_LOOP_ID, { target: { sessionKey, scope: "core" } });
          const result = run.artifacts.final as { compacted?: boolean; reason?: string } | undefined;
          const summary = result?.compacted === false ? result.reason ?? "No compaction needed" : result?.compacted === true ? "Session compacted" : undefined;
          return { run, ...(summary ? { summary } : {}) };
        },
      },
      onProgress: (event) => this.publishLoopProgress(event),
      onComplete: () => {
        if (this.activeSessionId) this.messages = this.sessionStore.openChat(this.activeSessionId).messages;
        this.emit();
      },
    });
    this.agentDocsDir = cacheAgentDocs(path.join(this.cwd, "agent-docs")); // cache agent docs for agent's read tool
    this.providerErrorLogPath = path.join(this.cwd, "logs", "provider-errors.jsonl");
  }
  setAppConfig(config: AppConfig): void {
    const permissionModeChanged = this.appConfig?.permissions.mode !== config.permissions.mode;
    const skillsChanged = (this.appConfig?.skills.disabledSkillNames ?? []).join("\0") !== config.skills.disabledSkillNames.join("\0");
    const mcpChanged = JSON.stringify(this.appConfig?.mcp.servers ?? []) !== JSON.stringify(config.mcp.servers);
    this.appConfig = config;
    if (mcpChanged && this.mcpManager) {
      void this.mcpManager.dispose().catch(() => undefined);
      this.mcpManager = null;
    }
    if ((permissionModeChanged || skillsChanged || mcpChanged) && this.runtimePromise) {
      void this.runtimePromise.then((runtime) => runtime.dispose()).catch(() => undefined);
      this.runtimePromise = null;
    }
  }
  async initialize(): Promise<void> {
    this.sessionStore.ensureReady();
    this.profileStore.seedDefaultsIfMissing();
    const current = this.sessionStore.getOrCreateCurrentChat();
    this.activeSessionId = current.sessionKey;
    this.messages = current.messages;
  }
  getMemoryGraph(options?: GetMemoryGraphOptions): MemoryGraph {
    return this.sessionStore.withReadonlyMemoryDatabase((db) => getMemoryGraph(db, options));
  }
  getSkillsState(): DesktopSkillsState {
    const disabled = new Set(this.appConfig?.skills.disabledSkillNames ?? []);
    const entries = this.skillRegistry.list().map((entry): DesktopSkillSummary => ({
      ...entry,
      active: !disabled.has(entry.name),
      ...(entry.source === "user" && this.userSkillsDir ? { folderPath: path.join(this.userSkillsDir, entry.name) } : {}),
    }));
    return {
      userSkillsDir: this.userSkillsDir ?? "",
      builtinSkills: entries.filter((entry) => entry.source === "builtin"),
      userSkills: entries.filter((entry) => entry.source === "user"),
    };
  }
  getSkillDetails(name: string): DesktopSkillDetails {
    const loaded = this.skillRegistry.load(name, { includeReferences: false });
    if ("error" in loaded) throw new Error(loaded.error);
    return {
      name: loaded.name,
      description: loaded.description ?? "",
      source: loaded.source,
      active: !(this.appConfig?.skills.disabledSkillNames ?? []).includes(loaded.name),
      ...(loaded.source === "user" && this.userSkillsDir ? { folderPath: path.join(this.userSkillsDir, loaded.name) } : {}),
      skillMarkdown: loaded.files.find((file) => file.path === "SKILL.md")?.content ?? "",
    };
  }
  deleteUserSkill(name: string): DesktopSkillsState {
    const entry = this.skillRegistry.list().find((skill) => skill.name === name);
    if (!entry || entry.source !== "user" || !this.userSkillsDir) throw new Error("Only installed user skills can be deleted.");
    const targetPath = path.join(this.userSkillsDir, name);
    const relative = path.relative(this.userSkillsDir, targetPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Invalid skill path.");
    rmSync(targetPath, { recursive: true, force: true });
    const current = new Set(this.appConfig?.skills.disabledSkillNames ?? []);
    current.delete(name);
    if (this.appConfig) this.appConfig = { ...this.appConfig, skills: { disabledSkillNames: [...current].sort() } };
    if (this.runtimePromise) {
      void this.runtimePromise.then((runtime) => runtime.dispose()).catch(() => undefined);
      this.runtimePromise = null;
    }
    return this.getSkillsState();
  }
  private getActiveSkillEntries(): DesktopSkillSummary[] {
    return [...this.getSkillsState().builtinSkills, ...this.getSkillsState().userSkills].filter((entry) => entry.active);
  }
  async getState(): Promise<DesktopChatState> {
    if (!this.activeSessionId) await this.initialize();
    const runtime = await this.getRuntime();
    const snapshot = runtime.getSnapshot();
    const model = await runtime.getModelSelectionState();
    const providers = await this.getProviderSettings(model.options);
    const connectedProviders = getConnectedProviderIds(providers);
    return {
      sessionId: snapshot.sessionId,
      activeSessionId: this.activeSessionId,
      chats: this.sessionStore.listChats(),
      messages: this.messages,
      status: {
        isStreaming: snapshot.isStreaming,
        label: snapshot.isStreaming ? "Geistr is thinking…" : "Ready",
      },
      runUi: this.runUiManager.getState(),
      loopProgress: this.loopProgressState.loopProgress,
      pendingApproval: this.pendingApproval,
      model: {
        ...model,
        options: model.options.filter((option) => connectedProviders.has(option.provider)),
      },
      settings: { providers },
    };
  }
  async createChat(): Promise<DesktopChatState> {
    const chat = this.sessionStore.createChat();
    this.activeSessionId = chat.id;
    this.messages = [];
    this.emit();
    return this.getState();
  }
  async openChat(sessionKey: string): Promise<DesktopChatState> {
    const chat = this.sessionStore.openChat(sessionKey);
    this.activeSessionId = chat.sessionKey;
    this.messages = chat.messages;
    this.emit();
    return this.getState();
  }
  async renameChat(sessionKey: string, title: string): Promise<DesktopChatState> {
    this.sessionStore.renameChat(sessionKey, title);
    this.emit();
    return this.getState();
  }
  async deleteChat(sessionKey: string): Promise<DesktopChatState> {
    this.sessionStore.deleteChat(sessionKey);
    if (this.activeSessionId === sessionKey) {
      const next = this.sessionStore.listChats()[0] ?? this.sessionStore.createChat();
      const opened = this.sessionStore.openChat(next.id);
      this.activeSessionId = opened.sessionKey;
      this.messages = opened.messages;
    }
    this.emit();
    return this.getState();
  }
  async resolveToolApproval(id: string, approved: boolean): Promise<DesktopChatState> {
    if (this.approvalWaiter?.id === id) {
      this.approvalWaiter.resolve(approved);
      this.approvalWaiter = null;
      this.pendingApproval = null;
      this.emit();
    }
    return this.getState();
  }
  async sendMessage(text: string, attachments?: MessageAttachment[]): Promise<DesktopChatState> {
    const trimmed = text.trim();
    if (!trimmed && (!attachments || attachments.length === 0)) return this.getState();
    if (!this.activeSessionId) await this.initialize();
    const sessionKey = this.activeSessionId!;
    if (trimmed === "/compact" || trimmed === "/compact!") {
      return this.runManualCompaction(sessionKey, trimmed === "/compact!");
    }
    return this.runAssistantTurn(sessionKey, trimmed, true, attachments);
  }
  async retryLastMessage(): Promise<DesktopChatState> {
    if (!this.activeSessionId) await this.initialize();
    const sessionKey = this.activeSessionId!;
    const lastUserMessage = [...this.messages].reverse().find((message) => message.role === "user");
    if (!lastUserMessage?.content.trim()) return this.getState();
    this.messages = this.messages.filter((message) => !message.error);
    this.emit();
    return this.runAssistantTurn(sessionKey, lastUserMessage.content, false);
  }
  private async runAssistantTurn(sessionKey: string, text: string, appendUserMessage: boolean, attachments?: MessageAttachment[], retryEmptyResponse = true): Promise<DesktopChatState> {
    const modelBeforeRun = await (await this.getRuntime()).getModelSelectionState();
    const selectedModel = modelBeforeRun.selected;
    if (appendUserMessage) {
      const userMessage = this.sessionStore.appendMessage({
        sessionKey, role: "user", content: text, providerId: selectedModel?.provider ?? null, modelId: selectedModel?.modelId ?? null,
        metadata: { source: "renderer", userTurn: true, hiddenFromChat: false }, ...(attachments?.length ? { attachments } : {}),
      });
      this.messages = [...this.messages, userMessage];
    }
    this.pendingAssistantEventId = null;
    this.pendingRuntimeFailure = null;
    this.runUiManager.start();
    this.emit();
    try {
      const runtime = await this.refreshRuntimeForNextRun(selectedModel ?? undefined);
      const run = { runtime, cancelled: false };
      this.activeForegroundRun = run;
      const assistantStartIndex = this.messages.length;
      const prompt = buildAttachmentPrompt(text, attachments);
      if (prompt.images?.length) {
        const promptRun = runtime.sendMessage(prompt.text, { images: prompt.images });
        promptRun.catch((error) => console.warn("[geistr] image prompt finished after fallback:", error));
        await Promise.race([promptRun, this.runUiManager.waitForImagePromptFallback()]);
      } else {
        await runtime.sendMessage(prompt.text);
      }
      if (run.cancelled) return this.getState();
      const assistantText = this.runUiManager.getState()?.finalText ?? this.messages.slice(assistantStartIndex).filter((message) => message.role === "assistant").map((message) => message.content).join("");
      if (this.pendingRuntimeFailure) {
        this.appendProviderFailureMessage(selectedModel, this.pendingRuntimeFailure);
      } else if (assistantText.trim().length > 0 && this.pendingAssistantEventId === null) {
        const modelAfterRun = await runtime.getModelSelectionState();
        const selected = modelAfterRun.selected;
        const assistantMessage = this.sessionStore.appendMessage({
          sessionKey,
          role: "assistant",
          content: assistantText,
          providerId: selected?.provider ?? null,
          modelId: selected?.modelId ?? null,
          metadata: { source: "runtime", hiddenFromChat: false },
        });
        this.pendingAssistantEventId = assistantMessage.id;
        const consumedLoopResults = this.sessionStore.listPendingLoopResults(sessionKey, 5);
        this.sessionStore.acknowledgeLoopResults(sessionKey, consumedLoopResults.map((result) => result.eventId));
        this.messages = this.sessionStore.openChat(sessionKey).messages;
        this.runUiManager.complete(assistantText, "completed");
        void this.schedulePostTurnJobs({
          sessionKey,
          userMessage: text,
          assistantMessage: assistantText,
          providerId: selected?.provider ?? null,
          modelId: selected?.modelId ?? null,
        }).catch(() => undefined);
      } else {
        const emptyResponseError = new Error("The model request finished without returning a response.");
        if (retryEmptyResponse && this.shouldAutoRetryEmptyResponse(selectedModel)) {
          this.runUiManager.setStatus("Empty response — retrying once…");
          run.runtime.dispose();
          this.activeForegroundRun = null;
          this.emit();
          return this.runAssistantTurn(sessionKey, text, false, attachments, false);
        }
        this.appendProviderFailureMessage(selectedModel, emptyResponseError);
      }
    } catch (error) {
      if (this.activeForegroundRun?.cancelled) return this.getState();
      this.appendProviderFailureMessage(selectedModel, error);
    }
    this.activeForegroundRun = null;
    this.emit();
    return this.getState();
  }
  private shouldAutoRetryEmptyResponse(selectedModel: CoreModelSelection | null): boolean {
    return selectedModel?.provider === "google-oauth";
  }
  private appendProviderFailureMessage(selectedModel: CoreModelSelection | null, error: unknown): void {
    const normalized = normalizeProviderError({ error, providerId: selectedModel?.provider ?? null, modelId: selectedModel?.modelId ?? null });
    console.error("[geistr] Provider run failed:", normalized.technicalDetails);
    this.appendProviderErrorLog(normalized);
    this.messages = [...this.messages, {
      id: `runtime-error:${crypto.randomUUID()}`,
      role: "assistant",
      content: normalized.title,
      createdAt: Date.now(),
      error: normalized,
    }];
    this.runUiManager.complete(normalized.title, "failed");
    this.pendingRuntimeFailure = null;
  }
  private appendProviderErrorLog(error: ReturnType<typeof normalizeProviderError>): void {
    try {
      mkdirSync(path.dirname(this.providerErrorLogPath), { recursive: true });
      appendFileSync(this.providerErrorLogPath, `${JSON.stringify({
        timestamp: new Date().toISOString(),
        sessionKey: this.activeSessionId,
        kind: error.kind,
        title: error.title,
        message: error.message,
        recoverable: error.recoverable,
        providerId: error.providerId ?? null,
        modelId: error.modelId ?? null,
        technicalDetails: error.technicalDetails,
      })}\n`, "utf8");
    } catch (logError) {
      console.warn("[geistr] Failed to write provider error log:", logError);
    }
  }
  async stopRun(): Promise<DesktopChatState> {
    const run = this.activeForegroundRun;
    if (!run) return this.getState();
    run.cancelled = true;
    try {
      await run.runtime.abort();
    } finally {
      run.runtime.dispose();
      if (this.runtimePromise) this.runtimePromise = null;
      this.activeForegroundRun = null;
      this.messages = this.messages.filter((message) => !message.isStreaming);
      this.runUiManager.complete("Stopped.", "cancelled");
      this.emit();
    }
    return this.getState();
  }
  async selectModel(selection: DesktopModelSelection): Promise<DesktopChatState> {
    // Persist the user-chosen model+thinking as lastUsed so it survives app restarts.
    // The explicit "default" in settings is only a fallback when nothing has been chosen yet.
    if (this.appConfig) {
      const updated = {
        ...this.appConfig,
        model: {
          ...this.appConfig.model,
          lastUsedProvider: selection.provider,
          lastUsedModelId: selection.modelId,
          lastUsedThinkingLevel: selection.thinkingLevel ?? null,
        },
      };
      const sanitized = sanitizeAppConfig(updated);
      await writeAppConfig(sanitized);
      this.appConfig = sanitized;
    }

    // Recreate the runtime instead of relying on AgentSession.setModel(), which
    // is optional in Pi and can leave the previous provider active.
    await this.refreshRuntimeForNextRun(selection);
    this.emit();
    return this.getState();
  }
  async saveProviderApiKey(provider: string, apiKey: string): Promise<DesktopChatState> {
    await this.auth.saveApiKey(provider, apiKey);
    this.lastAuthEvent = undefined;
    await this.resetRuntimeAfterProviderAuthChange();
    this.emit();
    return this.getState();
  }
  async removeProviderAuth(provider: string): Promise<DesktopChatState> {
    await this.auth.removeProviderAuth(provider);
    this.lastAuthEvent = undefined;
    await this.resetRuntimeAfterProviderAuthChange();
    this.emit();
    return this.getState();
  }
  async connectLoginProvider(provider: string): Promise<DesktopChatState> {
    if (this.loginInFlight) {
      this.lastAuthEvent = "Provider login is already in progress. Finish the browser window before starting another login.";
      this.emit();
      return this.getState();
    }
    this.loginInFlight = this.runProviderLogin(provider);
    try {
      return await this.loginInFlight;
    } finally {
      this.loginInFlight = null;
    }
  }
  subscribe(listener: (state: DesktopChatState) => void): () => void {
    this.listeners.add(listener);
    void this.getState().then(listener);
    return () => this.listeners.delete(listener);
  }
  private async runProviderLogin(provider: string): Promise<DesktopChatState> {
    try {
      await this.auth.loginProvider(provider, {
        onEvent: (event) => {
          if ((event.type === "auth_url" || event.type === "device_code") && event.url) void this.openExternalUrl(event.url);
          this.lastAuthEvent = describeAuthEvent(event);
          this.emit();
        },
        onPrompt: async (prompt) => prompt.allowEmpty ? "" : "",
        onSelect: async (prompt) => prompt.options[0]?.id,
      });
      this.lastAuthEvent = undefined;
      await this.resetRuntimeAfterProviderAuthChange();
    } catch (error) {
      this.lastAuthEvent = `Provider login failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    this.emit();
    return this.getState();
  }
  private async resetRuntimeAfterProviderAuthChange(): Promise<void> {
    if (!this.runtimePromise) return;
    const runtime = await this.runtimePromise.catch(() => null);
    runtime?.dispose();
    this.runtimePromise = null;
  }
  private async getProviderSettings(modelOptions: DesktopChatState["model"]["options"]): Promise<DesktopProviderSettingsState> {
    const providerNames = new Map(modelOptions.map((option) => [option.provider, option.providerName]));
    const loginProviders = await this.auth.listLoginProviders();
    const loginProviderIds = new Set(loginProviders.map((provider) => provider.id));
    const apiKeyProviderIds = [...providerNames.keys()].filter((provider) => !loginProviderIds.has(provider)).sort();
    const apiKeyStatuses = await this.auth.listStatuses(apiKeyProviderIds);
    const loginStatuses = await this.auth.listStatuses([...loginProviderIds]);
    const loginStatusByProvider = new Map(loginStatuses.map((status) => [status.provider, status]));
    return {
      apiKeyProviders: apiKeyStatuses.map((status) => ({ ...status, providerName: providerNames.get(status.provider) ?? status.provider })),
      loginProviders: loginProviders.map((provider) => ({
        ...provider,
        configured: loginStatusByProvider.get(provider.id)?.configured ?? false,
      })),
      ...(this.lastAuthEvent ? { lastAuthEvent: this.lastAuthEvent } : {}),
    };
  }
  private async requestToolApproval(request: ToolPermissionRequest, assessment: ToolPermissionAssessment): Promise<boolean> {
    const id = crypto.randomUUID();
    this.pendingApproval = { id, createdAt: Date.now(), ...request, ...assessment };
    this.emit();
    return new Promise((resolve) => {
      this.approvalWaiter = { id, resolve };
    });
  }
  private async getRuntime(): Promise<CoreAgentRuntime> {
    this.runtimePromise ??= this.createRuntime();
    return this.runtimePromise;
  }
  private async createRuntime(modelSelectionOverride?: CoreModelSelection): Promise<CoreAgentRuntime> {
    const initialModelSelection = modelSelectionOverride ?? await this.resolveDefaultModelSelection();
    // Read profiles and session continuity from the shared database before each runtime is created.
    const assistantProfile = this.profileStore.getAssistantProfile();
    const userProfile = this.profileStore.getUserProfile();
    const sessionSummary = this.activeSessionId ? this.sessionStore.getLatestSessionSummary(this.activeSessionId) : null;
    const recentMessages = this.activeSessionId ? this.sessionStore.openChat(this.activeSessionId).messages : [];
    const pendingLoopResults = this.activeSessionId ? this.sessionStore.listPendingLoopResults(this.activeSessionId, 5) : [];
    const memoryContext = this.activeSessionId
      ? this.sessionStore.getRelevantMemoryContext(recentMessages.slice(-8).map((message) => message.content).join("\n"), 8)
      : [];
    // Build profile-based runtime prompt sections
    const prompt = buildRuntimePrompt({
      assistantProfile: {
        assistantName: assistantProfile.assistantName,
        personaSummary: assistantProfile.personaSummary,
        tone: assistantProfile.tone,
        communicationStyle: assistantProfile.communicationStyle,
        soulPrompt: assistantProfile.soulPrompt,
        rolePrompt: assistantProfile.rolePrompt,
        stylePrompt: assistantProfile.stylePrompt,
        boundaryPrompt: assistantProfile.boundaryPrompt,
        memoryPrompt: assistantProfile.memoryPrompt,
        responseDepth: assistantProfile.responseDepth,
        warmth: assistantProfile.warmth,
        directness: assistantProfile.directness,
        agentBehaviorNotesJson: JSON.stringify(assistantProfile.agentBehaviorNotes),
      },
      userProfile: {
        displayName: userProfile.displayName,
        locale: userProfile.locale,
        languagePreferences: userProfile.languagePreferences,
        learningStyle: userProfile.learningStyle,
        activeGoals: userProfile.activeGoals,
        preferences: userProfile.preferences,
        constraints: userProfile.constraints,
      },
      memoryContext: memoryContext.map((memory) => ({ id: memory.id, content: memory.content, category: memory.category as "preference" | "profile" | "goal" | "fact", createdAt: memory.createdAt, updatedAt: memory.updatedAt })),
      sessionSummary,
      recentMessages,
      activeSkillCatalog: this.getActiveSkillEntries().map((entry) => `${entry.name}: ${entry.description}`),
      runtimeClock: null,
      timezone: userProfile.timezone || "UTC",
      agentDocsPath: this.agentDocsDir,
    });
    if (pendingLoopResults.length > 0) {
      prompt.sections.push({ tag: "pending_loop_results", content: formatPendingLoopResults(pendingLoopResults) });
    }
    const permissionMode = this.appConfig?.permissions.mode ?? "auto";
    prompt.sections.push({ tag: "tool_permissions", content: formatToolPermissionPrompt(permissionMode) });
    const builtinTools = permissionMode === "read-only"
      ? ["read", "profile_read", "profile_write", "loop_read", "loop_write", "memory_read", "memory_write", "skill_load"]
      : permissionMode === "ask-always" ? ["read", "profile_read", "profile_write", "loop_read", "loop_write", "memory_read", "memory_write", "skill_load", "file_write", "file_edit", "shell_run"]
      : ["read", "write", "edit", "bash", "profile_read", "profile_write", "loop_read", "loop_write", "memory_read", "memory_write", "skill_load"];
    const approvalGate = { approve: (request: ToolPermissionRequest, assessment: ToolPermissionAssessment) => this.requestToolApproval(request, assessment) };
    const fileToolDefs = permissionMode === "read-only" ? [] : createControlledFileToolDefinitions(this.cwd).map((tool) => gateToolDefinition(tool, { mode: permissionMode, gate: approvalGate }));
    const profileToolDefs = createProfileToolDefinitions(this.profileStore).map((tool) => gateToolDefinition(tool, { mode: permissionMode, gate: approvalGate }));
    const loopToolDefs = createLoopToolDefinitions({ catalog: this.loopCatalog, runner: this.backgroundLoopRunner, getSessionKey: () => this.activeSessionId, scope: "agent" }).map((tool) => gateToolDefinition(tool, { mode: permissionMode, gate: approvalGate }));
    const memoryToolDefs = createMemoryToolDefinitions(this.sessionStore, () => this.activeSessionId ?? "").map((tool) => gateToolDefinition(tool, { mode: permissionMode, gate: approvalGate }));
    const disabledSkillNames = this.appConfig?.skills.disabledSkillNames ?? [];
    const skillToolDefs = createSkillToolDefinitions(this.skillRegistry, { disabledSkillNames }).map((tool) => gateToolDefinition(tool, { mode: permissionMode, gate: approvalGate }));
    const webAccessConfig = this.appConfig?.webAccess ?? DEFAULT_WEB_ACCESS_CONFIG;
    const webToolDefs = createWebToolDefinitions(webAccessConfig).map((tool) => gateToolDefinition(tool, { mode: permissionMode, gate: approvalGate }));
    this.mcpManager = new McpManager(this.appConfig?.mcp.servers ?? []);
    await this.mcpManager.startEnabled();
    const mcpToolDefs = this.mcpManager.getToolDefinitions().map((tool) => gateToolDefinition(tool, { mode: permissionMode, gate: approvalGate }));
    const mcpStatuses = this.mcpManager.getStatuses().filter((status) => status.status !== "disabled");
    if (mcpToolDefs.length > 0 || mcpStatuses.some((status) => status.status === "failed")) {
      prompt.sections.push({ tag: "mcp_tools", content: formatMcpPromptSection(mcpStatuses) });
    }
    const runtime = await createCoreAgentRuntime({
      cwd: this.cwd,
      tools: [...builtinTools, ...mcpToolDefs.map((tool) => tool.name), ...webToolDefs.map((tool) => tool.name)],
      customTools: [...fileToolDefs, ...profileToolDefs, ...loopToolDefs, ...memoryToolDefs, ...skillToolDefs, ...webToolDefs, ...mcpToolDefs],
      prompt: { stableSections: prompt.sections },
      ...(initialModelSelection ? { modelSelection: initialModelSelection } : {}),
    });
    if (process.env.GEISTR_LOG_SYSTEM_PROMPT === "1") {
      const logPath = logSystemPromptSnapshot({
        rootDir: this.cwd,
        sessionKey: this.activeSessionId,
        modelSelection: initialModelSelection ?? null,
        sections: prompt.sections,
        systemPrompt: runtime.systemPrompt,
      });
      console.info(`[geistr] system prompt snapshot: ${logPath}`);
    }
    console.info(`[geistr] isolated Pi runtime: cwd=${this.cwd}; permissionMode=${permissionMode}; tools=${builtinTools.join(",")}; resources=disabled`);
    runtime.subscribe((event) => {
      this.ingestRuntimeEvent(event);
      this.emit();
    });
    return runtime;
  }
  private async resolveDefaultModelSelection(): Promise<CoreModelSelection | undefined> {
    const config = this.appConfig;
    if (!config) return undefined;

    const providerLayer = createCoreProviderLayer();
    const options = await providerLayer.listModelOptions({ configuredOnly: true });

    // Prefer the last-used selection (saved when user picks from the chat ModelPicker).
    // The settings "default" is only used as a fallback when no chat selection has ever been made
    // or the last-used one is no longer available (e.g. provider disconnected).
    const candidates: Array<{ provider: string | null; modelId: string | null; thinkingLevel: any }> = [
      {
        provider: config.model.lastUsedProvider,
        modelId: config.model.lastUsedModelId,
        thinkingLevel: config.model.lastUsedThinkingLevel,
      },
      {
        provider: config.model.defaultProvider,
        modelId: config.model.defaultModelId,
        thinkingLevel: config.model.defaultThinkingLevel,
      },
    ];

    for (const cand of candidates) {
      if (!cand.provider || !cand.modelId) continue;
      const match = options.find((option) => option.provider === cand.provider && option.modelId === cand.modelId);
      if (match) {
        return {
          provider: cand.provider,
          modelId: cand.modelId,
          ...(cand.thinkingLevel && match.thinkingLevels.includes(cand.thinkingLevel) ? { thinkingLevel: cand.thinkingLevel } : {}),
        };
      }
    }
    return undefined;
  }
  private ingestRuntimeEvent(event: unknown): void {
    if (!event || typeof event !== "object") return;
    const record = event as Record<string, unknown>;
    if (!this.runUiManager.getState()) this.runUiManager.start();
    const nested = record.assistantMessageEvent as Record<string, unknown> | undefined;
    const payload = nested && typeof nested === "object" ? nested : record;
    const type = String(payload.type ?? record.type ?? "");
    let eventFailure: Error | null = null;
    try {
      eventFailure = extractRuntimeProviderFailure(payload) ?? extractRuntimeProviderFailure(record);
    } catch {
      eventFailure = new Error("The provider request failed, but the error event could not be inspected safely.");
    }
    if (eventFailure) this.pendingRuntimeFailure = eventFailure;
    if (type === "auto_retry_start") {
      const attempt = typeof payload.attempt === "number" ? payload.attempt : undefined;
      const maxAttempts = typeof payload.maxAttempts === "number" ? payload.maxAttempts : undefined;
      this.runUiManager.setStatus(`Retrying${attempt && maxAttempts ? ` ${attempt}/${maxAttempts}` : ""}`);
      return;
    }
    if (type === "auto_retry_end") {
      if (payload.success === true) this.pendingRuntimeFailure = null;
      else if (typeof payload.finalError === "string") this.pendingRuntimeFailure = new Error(payload.finalError);
      this.runUiManager.setStatus(payload.success === true ? "Writing" : "Failed");
      return;
    }
    if (type === "message_start") {
      this.runUiManager.setStatus("Thinking");
      return;
    }
    if (type === "text_delta" && typeof payload.delta === "string") {
      this.runUiManager.appendFinalText(payload.delta);
      this.runUiManager.setStatus("Writing");
      return;
    }
    if (type === "thinking_delta" && typeof payload.delta === "string") {
      this.runUiManager.appendProgressText(payload.delta);
      this.runUiManager.setStatus("Thinking");
      return;
    }
    if (type.includes("tool") && (type.endsWith("start") || type.endsWith("delta") || type.endsWith("end"))) {
      this.runUiManager.moveFinalTextToProgress();
      const done = type.endsWith("end");
      if (done) this.runUiManager.appendToolSummary(extractToolName(payload));
      this.runUiManager.setStatus(done ? "Thinking" : "Running tool");
      return;
    }
    if (type === "message_end") {
      if (runtimeMessageEndedSuccessfully(payload) || runtimeMessageEndedSuccessfully(record)) this.pendingRuntimeFailure = null;
      this.runUiManager.setStatus(this.pendingRuntimeFailure ? "Failed" : "Finishing");
      return;
    }
    if (type === "agent_end") {
      this.runUiManager.setStatus(this.pendingRuntimeFailure ? "Failed" : "Finishing");
      return;
    }
    const text = extractSimpleText(event);
    if (text) this.runUiManager.appendFinalText(text);
  }
  private async schedulePostTurnJobs(input: {
    sessionKey: string;
    userMessage: string;
    assistantMessage: string;
    providerId: string | null;
    modelId: string | null;
  }): Promise<void> {
    const config = this.appConfig;
    if (!config) return;
    // Gather current message count from the session store
    const chatList = this.sessionStore.listChats();
    const chatInfo = chatList.find((c) => c.id === input.sessionKey);
    const messageCount = chatInfo?.messageCount ?? 0;
    const results = await this.postTurnJobs.runAll({
      sessionKey: input.sessionKey,
      userMessage: input.userMessage,
      assistantMessage: input.assistantMessage,
      providerId: input.providerId,
      modelId: input.modelId,
      turnId: "post-turn",
      messageCount,
      config: {
        memoryEnabled: config.memory.enabled,
        compactionEnabled: config.sessions.compaction.enabled,
        compactionThresholdTokens: 15000,
      },
      store: this.sessionStore,
      compactionModelRunner: this.createCompactionModelRunner(input.providerId, input.modelId),
      memoryModelRunner: this.createCompactionModelRunner(input.providerId, input.modelId),
      loopProgressSink: { publish: (event) => this.publishLoopProgress(event) },
    });
    // Log job results but never surface to the user
    for (const result of results) {
      if (result.error) {
        console.error(`[geistr] Post-turn job "${result.jobName}" failed:`, result.error);
      } else if (result.acted) {
        console.debug(`[geistr] Post-turn job "${result.jobName}": ${result.details}`);
      }
    }
  }
  private async runManualCompaction(sessionKey: string, force: boolean): Promise<DesktopChatState> {
    console.info(`[geistr] Manual compaction command received: session=${sessionKey}; force=${force}`);
    void this.finishManualCompaction(sessionKey, force).catch((error) => {
      console.error("[geistr] Manual compaction failed:", error);
    });
    return this.getState();
  }
  private async finishManualCompaction(sessionKey: string, force: boolean): Promise<void> {
    const runtime = await this.getRuntime();
    const model = await runtime.getModelSelectionState();
    const selected = model.selected;
    const result = await runSessionCompactionLoop({
      store: this.sessionStore,
      modelRunner: this.createCompactionModelRunner(selected?.provider ?? null, selected?.modelId ?? null),
      target: { sessionKey, scope: "core" },
      thresholdTokens: force ? 1 : 15000,
      retainRecentMessages: force ? 1 : 16,
      progressSink: { publish: (event) => {
        console.info(`[geistr] Manual compaction ${event.type}: ${event.summary ?? event.nodeLabel ?? ""}`);
        this.publishLoopProgress(event);
      } },
    });
    console.info(`[geistr] Manual compaction result: ${JSON.stringify(result)}`);
    this.messages = this.sessionStore.openChat(sessionKey).messages;
    await this.refreshRuntimeForNextRun();
    this.emit();
  }
  private async refreshRuntimeForNextRun(modelSelectionOverride?: CoreModelSelection): Promise<CoreAgentRuntime> {
    const old = this.runtimePromise ? await this.runtimePromise.catch(() => null) : null;
    old?.dispose();
    if (this.mcpManager) await this.mcpManager.dispose().catch(() => undefined);
    this.mcpManager = null;
    this.runtimePromise = this.createRuntime(modelSelectionOverride);
    return this.runtimePromise;
  }
  private createCompactionModelRunner(providerId: string | null, modelId: string | null): LoopModelRunner {
    return {
      runAgentSession: async (request) => this.runCompactionSingleRequest(request),
      runSingleRequest: async (request) => this.runCompactionSingleRequest({ ...request, model: request.model ?? (providerId && modelId ? { provider: providerId, modelId } : undefined) }),
    };
  }
  private async runCompactionSingleRequest(request: LoopSingleRequestInput) {
    let modelSelection: CoreModelSelection | undefined;
    if (request.model?.provider && request.model.modelId) {
      modelSelection = { provider: request.model.provider, modelId: request.model.modelId };
      if (request.model.thinkingLevel) modelSelection = { ...modelSelection, thinkingLevel: request.model.thinkingLevel as NonNullable<CoreModelSelection["thinkingLevel"]> };
    }
    const runtime = await createCoreAgentRuntime({
      cwd: this.cwd,
      noTools: "all",
      prompt: { stableSections: [{ tag: "compaction_system", content: request.node.instruction ?? "Summarize session continuity as strict JSON." }] },
      ...(modelSelection ? { modelSelection } : {}),
    });
    let text = "";
    const unsubscribe = runtime.subscribe((event) => { text += extractRuntimeTextDelta(event) ?? ""; });
    try {
      await runtime.sendMessage(request.prompt);
      console.info(`[geistr] Compaction model returned ${text.trim().length} character(s)`);
      return { status: "completed" as const, summary: text.trim(), artifacts: { summary: text.trim() }, confidence: "medium" as const };
    } catch (error) {
      return { status: "failed" as const, summary: "Compaction model request failed", error: error instanceof Error ? error.message : String(error) };
    } finally {
      unsubscribe();
      runtime.dispose();
    }
  }
  private publishLoopProgress(event: LoopEvent): void {
    publishLoopProgressState(this.loopProgressState, event, () => this.emit());
  }
  private emit(): void {
    void this.getState().then((state) => {
      for (const listener of this.listeners) listener(state);
    });
  }
}
