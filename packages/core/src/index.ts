export type {
  WebAccessConfig,
  WebSearchInput,
  WebFetchInput,
} from "./web-tools";
export {
  DEFAULT_WEB_ACCESS_CONFIG,
  createWebToolDefinitions,
} from "./web-tools";

export type {
  CoreAgentImageInput,
  CoreAgentPromptConfig,
  CoreAgentRuntime,
  CoreAgentRuntimeOptions,
  CoreAgentSendOptions,
  CoreAgentSnapshot,
  GeistrAgentEvent,
} from "./agent-runtime";
export type {
  GeistrAppendMessageInput,
  GeistrAppendTurnInput,
  GeistrAppendTurnResult,
  GeistrChatListItem,
  GeistrChatMessage,
  GeistrChatRole,
  GeistrOpenChatResult,
  GeistrTranscriptEventType,
  MessageAttachment,
  SaveSessionSummaryInput,
  SaveLoopResultInput,
  PendingLoopResult,
  MemoryAction,
  MemoryCandidate,
  MemoryDecision,
  MemoryIndexingPreparedBatch,
  MemoryIndexingPreparedEvent,
  MemoryIndexingResult,
  MemoryLinkType,
  MemoryRecord,
  MemoryType,
  SessionCompactionPreparedContext,
  SessionCompactionPreparedEvent,
  SessionCompactionPrepareOptions,
} from "./session-persistence";
export {
  SessionPersistenceStore,
  createGeistrSessionKey,
  createGeistrTranscriptId,
  ensureSessionSchema,
  geistrTurnEventIds,
  countUnindexedMessages,
  countGlobalUnindexedMessages,
  markEventsIndexed,
  updateSessionCompaction,
  getUnsummarizedEventCount,
  getLatestSessionSummary,
  prepareSessionCompaction,
  saveSessionSummary,
  saveLoopResult,
  listPendingLoopResults,
  acknowledgeLoopResults,
} from "./session-persistence";
export {
  prepareMemoryIndexingBatch,
  prepareGlobalMemoryIndexingBatch,
  markMemoryIndexingEventsIndexed,
  listMemoryItems,
  searchMemoryItems,
  recallMemoryNeighborhoods,
  applyMemoryDecisions,
  linkRelatedMemories,
} from "./memory-persistence";
export { createMemoryToolDefinitions, executeMemoryRead, executeMemoryWrite } from "./memory-tools";
export type { GetMemoryGraphOptions, MemoryGraph, MemoryGraphLink, MemoryGraphNode, MemoryGraphStats } from "./memory-graph";
export { getMemoryGraph } from "./memory-graph";
export type { LoadedSkill, SkillCatalogEntry, SkillLoadError, SkillRoot, SkillSource } from "./skills";
export { SkillRegistry, createDefaultSkillRoots, createSkillLoadToolDefinition, createSkillToolDefinitions } from "./skills";
export { createControlledFileToolDefinitions } from "./controlled-file-tools";
export type { MemoryToolError, MemoryWriteResult, MemoryWriteSuccess } from "./memory-tools";
export { createCoreAgentRuntime } from "./agent-runtime";
export type { NormalizedProviderError, NormalizeProviderErrorInput, ProviderErrorKind } from "./provider-errors";
export { classifyProviderError, normalizeProviderError } from "./provider-errors";
export type {
  CoreModelOption,
  CoreModelSelection,
  CoreModelSelectionState,
  CoreProviderLayer,
  GeistrThinkingLevel,
} from "./provider-selection";
export { clampToSupportedThinkingLevel, createCoreProviderLayer, registerXaiOAuthModels, toModelOption } from "./provider-selection";
export type {
  CoreProviderAuthEvent,
  CoreProviderAuthLayer,
  CoreProviderAuthPromptRequest,
  CoreProviderAuthSelectRequest,
  CoreProviderAuthStatus,
  CoreProviderLoginCallbacks,
} from "./provider-auth";
export { createCoreProviderAuthLayer, refreshGoogleProviderAuth, refreshXaiProviderAuth } from "./provider-auth";
export type { AssembleSystemPromptInput, SystemPromptSection } from "./system-prompt";
export { assembleSystemPrompt } from "./system-prompt";
export type {
  AppConfig,
  AppConfigAppearance,
  AppConfigMemory,
  AppConfigModel,
  AppConfigPermissionMode,
  AppConfigPermissions,
  AppConfigSessions,
  AppConfigUpdate,
  AppConfigWebAccess,
  McpServerConfig,
  McpTransportType,
  ThemeMode,
} from "./app-config";
export {
  APP_CONFIG_VERSION,
  DEFAULT_APP_CONFIG,
  mergeAppConfig,
  sanitizeAppConfig,
} from "./app-config";
export type { McpRuntimeTool, McpServerRuntimeStatus } from "./mcp-manager";
export { McpManager, toRuntimeToolName } from "./mcp-manager";
export type {
  PendingToolApproval,
  ToolApprovalGate,
  ToolPermissionAssessment,
  ToolPermissionDecision,
  ToolPermissionMode,
  ToolPermissionRequest,
  ToolPermissionTier,
} from "./tool-permissions";
export {
  classifyBashCommand,
  classifyToolPermission,
  decideToolPermission,
  gateToolDefinition,
} from "./tool-permissions";

// Runtime context assembly
export type {
  MemoryContextItem,
  ProfileIdentity,
  RuntimeContextInput,
  RuntimeContextResult,
} from "./runtime-context";
export { assembleRuntimeContext } from "./runtime-context";

// Post-turn background jobs
export type {
  PostTurnJob,
  PostTurnJobConfig,
  PostTurnJobContext,
  PostTurnJobResult,
  PostTurnJobScheduler,
} from "./post-turn-jobs";
export { createPostTurnJobScheduler, isSessionCompactionRunning } from "./post-turn-jobs";

// Session compaction loop
export type {
  CompactionEvent,
  CompactionSummaryArtifact,
  PreparedCompactionContext,
  RunSessionCompactionInput,
  SessionCompactionResult,
  SessionCompactionTarget,
} from "./session-compaction-loop";
export {
  DEFAULT_COMPACTION_THRESHOLD_TOKENS,
  DEFAULT_RETAIN_RECENT_MESSAGES,
  SESSION_COMPACTION_LOOP_ID,
  SUMMARY_VERSION,
  createSessionCompactionLoopDefinition,
  createSessionCompactionRuntime,
  runSessionCompactionLoop,
} from "./session-compaction-loop";

export type { RunMemoryIndexingLoopInput } from "./memory-indexing-loop";
export {
  DEFAULT_MEMORY_INDEX_BATCH_SIZE,
  DEFAULT_MEMORY_INDEX_THRESHOLD,
  MEMORY_INDEXING_LOOP_ID,
  createMemoryIndexingLoopDefinition,
  createMemoryIndexingRuntime,
  runMemoryIndexingLoop,
} from "./memory-indexing-loop";

// ── Profile system ─────────────────────────────────────────────

export type { AssistantProfile, AssistantProfileUpdateInput } from "./assistant-profile";
export {
  createDefaultAssistantProfile,
  ensureAssistantProfileSchema,
  readAssistantProfile,
  insertAssistantProfileIfMissing,
  updateAssistantProfile,
} from "./assistant-profile";

export type { UserProfile, UserProfileUpdateInput } from "./user-profile";
export {
  createDefaultUserProfile,
  ensureUserProfileSchema,
  readUserProfile,
  insertUserProfileIfMissing,
  updateUserProfile,
} from "./user-profile";

export type { ConfigItem, ConfigValueType } from "./profile-config";
export {
  ensureProfileConfigSchema,
  readConfigValue,
  readAllConfigValues,
  writeConfigValue,
  seedDefaultProfileConfig,
  DEFAULT_CONFIG_DEFINITIONS,
} from "./profile-config";

export { ProfileStore } from "./profile-store";

// ── Runtime prompt assembly ────────────────────────────────────

export type {
  PromptMemoryItem,
  PromptRuntimeClock,
  RuntimePromptInput,
  RuntimePromptResult,
} from "./runtime-prompt";
export { buildRuntimePrompt, PROMPT_RECENT_MESSAGE_LIMIT } from "./runtime-prompt";

// ── Agent documentation locator ──────────────────────────────────

export { resolveAgentDocsDir, agentDocsAvailable, cacheAgentDocs, readAgentDoc, listAgentDocNames } from "./agent-docs-locator";

// ── Profile tools (agent-editable) ──────────────────────────────

export type {
  ProfileToolDomain,
  ProfileToolError,
  ProfileToolSuccess,
  ProfileToolResult,
} from "./profile-tools";
export {
  createProfileToolDefinitions,
  executeProfileRead,
  executeProfileWrite,
} from "./profile-tools";

// ── Generic loop runtime ───────────────────────────────────────

export type * from "./artifacts";
export { FilesystemArtifactStore, sanitizeMetadata } from "./artifacts";
export type * from "./loop-catalog";
export { LoopCatalog, SESSION_COMPACTION_CATALOG_ENTRY, createDefaultLoopCatalog, createLoopToolDefinitions } from "./loop-catalog";
export type * from "./background-loop-runner";
export { BackgroundLoopRunner } from "./background-loop-runner";
export type * from "./loops";
export {
  LoopRegistry,
  LoopRuntime,
  InMemoryLoopStateStore,
  selectLoopArtifacts,
  mergeLoopArtifacts,
  formatLoopArtifactsForPrompt,
  buildLoopNodePrompt,
  recordLoopSteering,
} from "./loops";

// ── Subscription OAuth Providers ─────────────────────────────

export { registerGoogleOAuthProvider, googleOAuthProvider, loginGoogle, refreshGoogleToken } from "./providers/google-oauth";
export { XAI_GROK_OAUTH_BASE_URL, XAI_OAUTH_MODELS, XAI_OAUTH_PROVIDER_ID, XAI_OAUTH_PROVIDER_NAME, isTrustedXaiOAuthEndpoint, loginXaiOAuthDeviceCode, refreshXaiOAuthToken, registerXaiOAuthProvider, streamXaiOAuth, xaiOAuthProvider } from "./providers/xai-oauth";
