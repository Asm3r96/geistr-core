import type { AppConfig, GeistrChatListItem, GeistrThinkingLevel, GetMemoryGraphOptions, MemoryGraph, MessageAttachment, NormalizedProviderError, PendingToolApproval } from "@geistr/core";

export type DesktopChatRole = "user" | "assistant" | "system" | "tool";

export interface DesktopChatMessage {
  id: string;
  role: DesktopChatRole;
  content: string;
  createdAt?: number;
  /** Thinking/reasoning text shown only during streaming, never persisted */
  thinkingContent?: string;
  /** Live tool activity log shown during streaming, never persisted */
  toolActivities?: string[];
  /** True while this message is still being streamed from the model */
  isStreaming?: boolean;
  /** Structured provider/runtime failure. Renderers must not parse raw thrown errors. */
  error?: NormalizedProviderError;
  /** Attached media files (images, documents, etc.) */
  attachments?: MessageAttachment[];
  /** True while a steering message is queued in Pi and has not yet been delivered to the agent. */
  isPendingSteering?: boolean;
}

export interface DesktopRuntimeStatus {
  label: string;
  isStreaming: boolean;
}

export type DesktopRunProgressItem =
  | { type: "progress_text"; id: string; text: string }
  | { type: "tool_summary"; id: string; label: string; count?: number; details?: string[] }
  | { type: "status"; id: string; label: string };

export interface DesktopRunUiState {
  runId: string;
  startedAt: string;
  elapsedMs: number;
  status: "running" | "completed" | "failed" | "cancelled";
  progressItems: DesktopRunProgressItem[];
  currentStatusLabel?: string;
  finalText?: string;
}

export interface DesktopLoopProgress {
  runId: string;
  loopId: string;
  loopLabel: string;
  status: string;
  nodeLabel?: string;
  stepIndex?: number;
  totalSteps?: number;
  summary?: string;
  updatedAt: string;
}

export interface DesktopModelOption {
  provider: string;
  providerName: string;
  modelId: string;
  modelName: string;
  configured: boolean;
  reasoning: boolean;
  thinkingLevels: GeistrThinkingLevel[];
}

export interface DesktopModelSelection {
  provider: string;
  modelId: string;
  thinkingLevel?: GeistrThinkingLevel;
}

export interface DesktopProviderAuthStatus {
  provider: string;
  providerName: string;
  configured: boolean;
  source?: string;
  label?: string;
}

export interface DesktopLoginProviderOption {
  id: string;
  name: string;
  usesCallbackServer: boolean;
  configured: boolean;
}

export interface DesktopProviderSettingsState {
  apiKeyProviders: DesktopProviderAuthStatus[];
  loginProviders: DesktopLoginProviderOption[];
  lastAuthEvent?: string;
}

export interface DesktopSkillSummary {
  name: string;
  description: string;
  source: "builtin" | "user" | "workspace";
  active: boolean;
  folderPath?: string;
}

export interface DesktopSkillDetails extends DesktopSkillSummary {
  skillMarkdown: string;
}

export interface DesktopSkillsState {
  userSkillsDir: string;
  builtinSkills: DesktopSkillSummary[];
  userSkills: DesktopSkillSummary[];
}

export type DesktopChatListItem = GeistrChatListItem;

// ── Profile types for the Agent settings page ──

/** Assistant profile data exposed to the UI. */
export interface DesktopAssistantProfile {
  assistantName: string;
  personaSummary: string;
  soulPrompt: string;
  rolePrompt: string;
  stylePrompt: string;
  boundaryPrompt: string;
  memoryPrompt: string;
  tone: string;
  communicationStyle: string;
  responseDepth: string;
  warmth: string;
  directness: string;
  agentBehaviorNotesJson: string;
  updatedAt: number;
}

/** User profile data exposed to the UI. */
export interface DesktopUserProfile {
  displayName: string;
  locale: string;
  timezone: string;
  languagePreferences: string;
}

export interface DesktopChatState {
  sessionId: string | null;
  activeSessionId: string | null;
  chats: DesktopChatListItem[];
  messages: DesktopChatMessage[];
  status: DesktopRuntimeStatus;
  runUi: DesktopRunUiState | null;
  loopProgress: DesktopLoopProgress | null;
  pendingApproval: PendingToolApproval | null;
  model: {
    selected: DesktopModelSelection | null;
    options: DesktopModelOption[];
  };
  settings: {
    providers: DesktopProviderSettingsState;
  };
}

export interface DesktopApi {
  getInitialState(): Promise<DesktopChatState>;
  sendMessage(text: string, attachments?: MessageAttachment[]): Promise<DesktopChatState>;
  retryLastMessage(): Promise<DesktopChatState>;
  stopRun(): Promise<DesktopChatState>;
  resolveToolApproval(id: string, approved: boolean): Promise<DesktopChatState>;
  createChat(): Promise<DesktopChatState>;
  openChat(sessionKey: string): Promise<DesktopChatState>;
  renameChat(sessionKey: string, title: string): Promise<DesktopChatState>;
  deleteChat(sessionKey: string): Promise<DesktopChatState>;
  selectModel(selection: DesktopModelSelection): Promise<DesktopChatState>;
  saveProviderApiKey(provider: string, apiKey: string): Promise<DesktopChatState>;
  removeProviderAuth(provider: string): Promise<DesktopChatState>;
  connectLoginProvider(provider: string): Promise<DesktopChatState>;
  saveGoogleOAuthConfig(config: { clientId: string; clientSecret: string }): Promise<{ ok: boolean }>;
  getGoogleOAuthConfig(): Promise<{ clientId: string; clientSecret: string }>;
  getAppConfig(): Promise<AppConfig>;
  updateAppConfig(partial: DeepPartial<AppConfig>): Promise<AppConfig>;
  getMemoryGraph(options?: GetMemoryGraphOptions): Promise<MemoryGraph>;
  getSkillsState(): Promise<DesktopSkillsState>;
  getSkillDetails(name: string): Promise<DesktopSkillDetails>;
  setSkillActive(name: string, active: boolean): Promise<DesktopSkillsState>;
  deleteUserSkill(name: string): Promise<DesktopSkillsState>;
  openPath(path: string): Promise<void>;
  getAssistantProfile(): Promise<DesktopAssistantProfile>;
  updateAssistantProfile(profile: Partial<DesktopAssistantProfile>): Promise<DesktopAssistantProfile>;
  getUserProfile(): Promise<DesktopUserProfile>;
  /** Open native file picker, save to media store, return attachment info */
  pickAndUploadMedia?(sessionKey: string): Promise<MessageAttachment[]>;
  /** Save pasted clipboard file data to media store */
  savePastedMedia?(sessionKey: string, dataUrl: string, fileName: string): Promise<MessageAttachment>;
  /** List all media across all sessions for management */
  listAllMedia?(): Promise<{ sessionKey: string; files: MessageAttachment[] }[]>;
  /** Delete a media file */
  deleteMedia?(filePath: string): Promise<void>;
  /** Get media storage stats */
  getMediaStats?(): Promise<{ totalSize: number; fileCount: number }>;
  onStateChanged(listener: (state: DesktopChatState) => void): () => void;
}

/** Recursive partial for deep-merge API calls. */
export type DeepPartial<T> = T extends (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [P in keyof T]?: DeepPartial<T[P]> }
    : T;

declare global {
  interface Window {
    geistr?: DesktopApi;
  }
}
