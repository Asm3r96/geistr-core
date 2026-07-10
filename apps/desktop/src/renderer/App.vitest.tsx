import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { RunTranscriptBlock } from "./RunTranscriptBlock";
import type { AppConfig } from "@geistr/core";
import type { DesktopApi, DesktopChatState } from "../shared/desktop-api";

const readyState: DesktopChatState = {
  sessionId: "session-1",
  activeSessionId: "chat:session-1",
  chats: [
    { id: "chat:session-1", title: "First persisted chat", createdAt: 1000, updatedAt: 1000, messageCount: 0, preview: null },
  ],
  messages: [],
  status: { label: "Ready", isStreaming: false },
  runUi: null,
  loopProgress: null,
  pendingApproval: null,
  model: {
    selected: null,
    options: [
      {
        provider: "anthropic",
        providerName: "Anthropic",
        modelId: "claude-test",
        modelName: "Claude Test",
        configured: true,
        reasoning: true,
        thinkingLevels: ["low", "medium", "high"],
      },
      {
        provider: "anthropic",
        providerName: "Anthropic",
        modelId: "claude-fast",
        modelName: "Claude Fast",
        configured: true,
        reasoning: false,
        thinkingLevels: [],
      },
      {
        provider: "openai",
        providerName: "OpenAI",
        modelId: "gpt-test",
        modelName: "GPT Test",
        configured: false,
        reasoning: false,
        thinkingLevels: [],
      },
      {
        provider: "google",
        providerName: "Google",
        modelId: "gemini-test",
        modelName: "Gemini Test",
        configured: true,
        reasoning: false,
        thinkingLevels: [],
      },
    ],
  },
  settings: {
    providers: {
      apiKeyProviders: [{ provider: "anthropic", providerName: "Anthropic", configured: false }],
      loginProviders: [{ id: "openai-codex", name: "openai codex", usesCallbackServer: true, configured: false }],
    },
  },
};

const defaultConfig: AppConfig = {
  version: 1,
  appearance: { themeMode: "system", themeId: "geistr-default" },
  model: {
    defaultProvider: null,
    defaultModelId: null,
    defaultThinkingLevel: null,
    lastUsedProvider: null,
    lastUsedModelId: null,
    lastUsedThinkingLevel: null,
    favoriteModels: [],
  },
  sessions: { compaction: { enabled: true } },
  memory: { enabled: false },
  permissions: { mode: "auto" },
  skills: { disabledSkillNames: [] },
  mcp: { servers: [] },
  webAccess: { enabled: true, searchEnabled: true, fetchEnabled: true, provider: "exa" },
};

afterEach(() => {
  vi.restoreAllMocks();
  delete window.geistr;
  document.documentElement.removeAttribute("data-geistr-theme-mode");
});

describe("App", () => {
  it("loads desktop runtime state and sends trimmed chat text through the bridge", async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn(async (text: string) => ({
      ...readyState,
      messages: [{ id: "m1", role: "user" as const, content: text.trim() }],
    }));
    window.geistr = fakeApi({ sendMessage });

    render(<App />);

    expect(await screen.findByText("What should Geistr help with?")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Message Geistr"), "  hello desktop  ");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(sendMessage).toHaveBeenCalledWith("  hello desktop  ");
    expect(await screen.findByText("hello desktop")).toBeInTheDocument();
  });

  it("shows a stop button during a run and calls the desktop stop API", async () => {
    const user = userEvent.setup();
    const stopRun = vi.fn(async () => readyState);
    window.geistr = fakeApi({
      stopRun,
      getInitialState: vi.fn(async () => ({
        ...readyState,
        status: { label: "Geistr is thinking…", isStreaming: true },
      })),
    });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Stop run" }));

    expect(stopRun).toHaveBeenCalledTimes(1);
  });

  it("lets the user submit a steering message while a run is active", async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn(async (text: string) => ({
      ...readyState,
      status: { label: "Geistr is thinking…", isStreaming: true },
      messages: [{ id: "steer-1", role: "user" as const, content: text.trim(), isPendingSteering: true }],
    }));
    window.geistr = fakeApi({
      sendMessage,
      getInitialState: vi.fn(async () => ({
        ...readyState,
        status: { label: "Geistr is thinking…", isStreaming: true },
      })),
    });

    render(<App />);

    await user.type(await screen.findByLabelText("Message Geistr"), "change direction");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(sendMessage).toHaveBeenCalledWith("change direction");
    const steeringMessage = await screen.findByText("change direction");
    expect(steeringMessage).toBeInTheDocument();
    expect(steeringMessage.closest("article")).toHaveClass("pendingSteering");
  });

  it("removes the steering queue indicator once the agent has consumed the message", async () => {
    window.geistr = fakeApi({
      getInitialState: vi.fn(async () => ({
        ...readyState,
        status: { label: "Geistr is thinking…", isStreaming: true },
        messages: [{ id: "steer-1", role: "user" as const, content: "change direction", isPendingSteering: false }],
      })),
    });

    render(<App />);

    const steeringMessage = await screen.findByText("change direction");
    expect(steeringMessage).toBeInTheDocument();
    expect(steeringMessage.closest("article")).not.toHaveClass("pendingSteering");
  });

  it("streams the final answer inside the stable run transcript while the assistant is running", async () => {
    window.geistr = fakeApi({
      getInitialState: vi.fn(async () => ({
        ...readyState,
        messages: [{ id: "u1", role: "user" as const, content: "Please work" }],
        status: { label: "Geistr is thinking…", isStreaming: true },
        runUi: {
          runId: "run-1",
          startedAt: new Date(Date.now() - 9000).toISOString(),
          elapsedMs: 9000,
          status: "running" as const,
          currentStatusLabel: "Running tool",
          progressItems: [
            { type: "progress_text" as const, id: "p1", text: "Let me check — yep, I can see them now!" },
            { type: "tool_summary" as const, id: "t1", label: "Ran 3 commands", count: 3 },
          ],
          finalText: "Draft text",
        },
      })),
    });

    render(<App />);

    expect(await screen.findByText("Working for 9s")).toBeInTheDocument();
    expect(screen.getByText("Running tool")).toBeInTheDocument();
    expect(screen.getByText("Let me check — yep, I can see them now!")).toBeInTheDocument();
    expect(screen.getByText("Ran 3 commands")).toBeInTheDocument();
    expect(screen.getByText("Draft text")).toBeInTheDocument();
  });

  it("opens each new active run transcript even after the previous run collapsed", async () => {
    const renderMarkdown = (text: string) => text;
    const copyText = vi.fn();
    const { rerender } = render(
      <RunTranscriptBlock
        run={{ runId: "run-1", startedAt: new Date().toISOString(), elapsedMs: 1000, status: "running", currentStatusLabel: "Thinking", progressItems: [{ type: "progress_text", id: "p1", text: "First work" }], finalText: "" }}
        renderMarkdown={renderMarkdown}
        copyText={copyText}
      />,
    );

    expect(screen.getByText("First work")).toBeInTheDocument();
    rerender(
      <RunTranscriptBlock
        run={{ runId: "run-1", startedAt: new Date().toISOString(), elapsedMs: 2000, status: "completed", currentStatusLabel: "Done", progressItems: [{ type: "progress_text", id: "p1", text: "First work" }], finalText: "Final" }}
        renderMarkdown={renderMarkdown}
        copyText={copyText}
      />,
    );
    expect(screen.queryByText("First work")).not.toBeInTheDocument();

    rerender(
      <RunTranscriptBlock
        run={{ runId: "run-2", startedAt: new Date().toISOString(), elapsedMs: 1000, status: "running", currentStatusLabel: "Thinking", progressItems: [{ type: "progress_text", id: "p2", text: "Second work" }], finalText: "" }}
        renderMarkdown={renderMarkdown}
        copyText={copyText}
      />,
    );

    expect(screen.getByText("Second work")).toBeInTheDocument();
  });

  it("shows completed work details collapsed above the final answer", async () => {
    window.geistr = fakeApi({
      getInitialState: vi.fn(async () => ({
        ...readyState,
        messages: [
          { id: "u1", role: "user" as const, content: "Please work" },
          { id: "a1", role: "assistant" as const, content: "Final answer" },
        ],
        runUi: {
          runId: "run-1",
          startedAt: new Date(Date.now() - 29000).toISOString(),
          elapsedMs: 29000,
          status: "completed" as const,
          currentStatusLabel: "Done",
          progressItems: [{ type: "tool_summary" as const, id: "t1", label: "Ran 3 commands", count: 3 }],
          finalText: "Final answer",
        },
      })),
    });

    render(<App />);

    expect(await screen.findByText("Worked for 29s")).toBeInTheDocument();
    expect(screen.getByText("Final answer")).toBeInTheDocument();
    expect(screen.queryByText("Ran 3 commands")).not.toBeInTheDocument();
  });

  it("shows loop progress above the message list while a background loop is running", async () => {
    window.geistr = fakeApi({
      getInitialState: vi.fn(async () => ({
        ...readyState,
        loopProgress: {
          runId: "run-1",
          loopId: "session-compaction",
          loopLabel: "Compacting session",
          status: "running",
          nodeLabel: "Summarizing continuity",
          stepIndex: 2,
          totalSteps: 4,
          updatedAt: "2026-07-07T00:00:00.000Z",
        },
      })),
    });

    render(<App />);

    expect(await screen.findByText("Compacting session")).toBeInTheDocument();
    expect(screen.getByText("Step 2/4 · Summarizing continuity")).toBeInTheDocument();
  });

  it("shows composer permission mode icon menu and saves selected mode", async () => {
    const user = userEvent.setup();
    const updateAppConfig = vi.fn(async (partial: Partial<AppConfig>) => ({ ...defaultConfig, ...partial, permissions: { ...defaultConfig.permissions, ...(partial.permissions ?? {}) } }));
    window.geistr = fakeApi({ updateAppConfig });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Permission mode: Default" }));
    expect(screen.getByRole("menuitemradio", { name: /Default/ })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("menuitemradio", { name: /Full access/ }));
    expect(updateAppConfig).toHaveBeenCalledWith({ permissions: { mode: "full-access" } });
  });

  it("shows a friendly error card with details hidden and retry action", async () => {
    const user = userEvent.setup();
    const retryLastMessage = vi.fn(async () => readyState);
    window.geistr = fakeApi({
      retryLastMessage,
      getInitialState: vi.fn(async () => ({
        ...readyState,
        messages: [{
          id: "e1",
          role: "assistant" as const,
          content: "The model request failed.",
          error: {
            kind: "invalid_api_key" as const,
            title: "The model request failed.",
            message: "The provider API key looks invalid. Update it in provider settings.",
            recoverable: true,
            providerId: "anthropic",
            modelId: "claude-test",
            technicalDetails: "Error: invalid API key\n    at provider.sdk.request (/secret/path.ts:10:1)",
          },
        }],
      })),
    });

    render(<App />);

    expect(await screen.findByRole("alert", { name: "Assistant error" })).toBeInTheDocument();
    expect(screen.getByText("The model request failed.")).toBeInTheDocument();
    expect(screen.getByText(/API key looks invalid/)).toBeInTheDocument();
    expect(screen.queryByText(/secret\/path/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByText(/secret\/path/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(retryLastMessage).toHaveBeenCalledTimes(1);
  });

  it("shows pending tool approval and resolves approve/deny through desktop API", async () => {
    const user = userEvent.setup();
    const resolveToolApproval = vi.fn(async () => ({ ...readyState, pendingApproval: null }));
    window.geistr = fakeApi({
      resolveToolApproval,
      getInitialState: vi.fn(async () => ({
        ...readyState,
        pendingApproval: {
          id: "approval-1",
          toolName: "bash",
          command: "git push",
          tier: "dangerous" as const,
          decision: "ask" as const,
          reason: "Command can mutate git state.",
          createdAt: 1000,
        },
      })),
    });

    render(<App />);

    expect(await screen.findByRole("alertdialog", { name: "Tool approval required" })).toBeInTheDocument();
    expect(screen.getByText("Approve bash?")).toBeInTheDocument();
    expect(screen.getByText("git push")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(resolveToolApproval).toHaveBeenCalledWith("approval-1", true);
  });

  it("sends model and thinking selections through the desktop API", async () => {
    const user = userEvent.setup();
    const selectModel = vi.fn(async (selection) => ({ ...readyState, model: { ...readyState.model, selected: selection } }));
    window.geistr = fakeApi({ selectModel });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Choose model" }));
    expect(screen.getByText("Anthropic")).toBeInTheDocument();
    expect(screen.getByText("Google")).toBeInTheDocument();
    expect(screen.queryByText("OpenAI")).not.toBeInTheDocument();
    expect(screen.queryByText("GPT Test")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Google.*1 model/ }));
    await user.click(screen.getByRole("button", { name: "Add Gemini Test to favorites" }));
    expect(screen.getAllByRole("region", { name: "Favorite models" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Remove Gemini Test from favorites" }).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Back to providers" }));
    await user.click(screen.getByRole("button", { name: /Anthropic.*2 models/ }));
    await user.type(screen.getByLabelText("Search models"), "claude");
    expect(screen.queryByText("Gemini Test")).not.toBeInTheDocument();
    const claudeMatches = screen.getAllByRole("menuitemradio", { name: /Claude Test/ });
    await user.click(claudeMatches.at(-1)!);
    expect(selectModel).toHaveBeenLastCalledWith({ provider: "anthropic", modelId: "claude-test", thinkingLevel: "high" });

    await user.click(screen.getByRole("button", { name: "Thinking level" }));
    await user.click(screen.getByRole("menuitemradio", { name: "low" }));
    expect(selectModel).toHaveBeenLastCalledWith({ provider: "anthropic", modelId: "claude-test", thinkingLevel: "low" });
  });

  // ── Config / Theme ──────────────────────────────────

  it("loads app config on mount and applies theme mode data attribute", async () => {
    window.geistr = fakeApi();

    render(<App />);

    // Config is loaded (System is the default theme mode)
    // With "system", no data attribute is set
    await waitFor(() => {
      expect(document.documentElement.hasAttribute("data-geistr-theme-mode")).toBe(false);
    });
  });

  it("shows theme mode radio buttons in Settings and switches the active mode", async () => {
    const user = userEvent.setup();
    const updateAppConfig = vi.fn(async (partial: Partial<AppConfig>) => ({
      ...defaultConfig,
      ...partial,
      appearance: { ...defaultConfig.appearance, ...(partial.appearance ?? {}) },
    }));
    window.geistr = fakeApi({ updateAppConfig });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Open Settings" }));
    await user.click(screen.getByRole("button", { name: "Theme" }));

    // System is the default
    expect(screen.getByLabelText("System")).toBeChecked();

    // Select Dark
    await user.click(screen.getByLabelText("Dark"));
    expect(updateAppConfig).toHaveBeenCalledWith({ appearance: { themeMode: "dark" } });
    expect(screen.getByLabelText("Dark")).toBeChecked();
    expect(screen.getByLabelText("System")).not.toBeChecked();

    // data attribute is applied
    expect(document.documentElement.getAttribute("data-geistr-theme-mode")).toBe("dark");

    // Select Light
    await user.click(screen.getByLabelText("Light"));
    expect(updateAppConfig).toHaveBeenCalledWith({ appearance: { themeMode: "light" } });
    expect(screen.getByLabelText("Light")).toBeChecked();
    expect(document.documentElement.getAttribute("data-geistr-theme-mode")).toBe("light");
  });

  it("removes data attribute when switching back to system theme", async () => {
    const user = userEvent.setup();
    const updateAppConfig = vi.fn(async (partial: Partial<AppConfig>) => ({
      ...defaultConfig,
      ...partial,
      appearance: { ...defaultConfig.appearance, ...(partial.appearance ?? {}) },
    }));
    window.geistr = fakeApi({ updateAppConfig });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Open Settings" }));
    await user.click(screen.getByRole("button", { name: "Theme" }));

    // Start in system mode (no attribute)
    expect(document.documentElement.hasAttribute("data-geistr-theme-mode")).toBe(false);

    // Switch to dark
    await user.click(screen.getByLabelText("Dark"));
    expect(document.documentElement.getAttribute("data-geistr-theme-mode")).toBe("dark");

    // Switch back to system
    await user.click(screen.getByLabelText("System"));
    expect(document.documentElement.hasAttribute("data-geistr-theme-mode")).toBe(false);
  });

  // ── Existing behavior ───────────────────────────────

  it("opens settings from the sidebar and saves provider setup actions", async () => {
    const user = userEvent.setup();
    const saveProviderApiKey = vi.fn(async () => readyState);
    const connectLoginProvider = vi.fn(async () => readyState);
    window.geistr = fakeApi({ saveProviderApiKey, connectLoginProvider });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Open Settings" }));
    expect(screen.queryByRole("navigation", { name: "Geistr navigation" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Settings navigation")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Providers" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("Search providers"), "codex");
    expect(screen.queryByLabelText("Anthropic API key")).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("Search providers"));

    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(connectLoginProvider).toHaveBeenCalledWith("openai-codex");

    await user.type(screen.getByLabelText("Anthropic API key"), "sk-test");
    await user.click(screen.getByRole("button", { name: "Save key" }));
    expect(saveProviderApiKey).toHaveBeenCalledWith("anthropic", "sk-test");

    await user.click(screen.getByRole("button", { name: "Theme" }));
    expect(screen.getByText(/choose how geistr looks/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back to app" }));
    expect(screen.getByText("What should Geistr help with?")).toBeInTheDocument();
  });

  // ── Default Model settings ──────────────────────────

  it("shows Model settings page and saves default provider/model to config", async () => {
    const user = userEvent.setup();
    const updateAppConfig = vi.fn(async (partial: Partial<AppConfig>) => ({
      ...defaultConfig,
      ...partial,
      appearance: { ...defaultConfig.appearance, ...(partial.appearance ?? {}) },
      model: { ...defaultConfig.model, ...(partial.model ?? {}) },
      sessions: { ...defaultConfig.sessions, ...(partial.sessions ?? {}), compaction: { ...defaultConfig.sessions.compaction, ...(partial.sessions?.compaction ?? {}) } },
      memory: { ...defaultConfig.memory, ...(partial.memory ?? {}) },
    }));
    window.geistr = fakeApi({ updateAppConfig });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Open Settings" }));
    await user.click(screen.getByRole("button", { name: "Model" }));

    // Should show default model controls
    expect(screen.getByText("Default Model")).toBeInTheDocument();
    expect(screen.getByLabelText("Default provider")).toBeInTheDocument();
    expect(screen.getByLabelText("Default model")).toBeInTheDocument();

    // Change provider to Google (which has gemini-test configured)
    await user.click(screen.getByLabelText("Default provider"));
    await user.click(await screen.findByRole("option", { name: "Google" }));
    expect(updateAppConfig).toHaveBeenCalledWith({
      model: expect.objectContaining({
        defaultProvider: "google",
        defaultModelId: "gemini-test",
      }),
    });
  });

  it("shows connect-a-provider message in Model settings when no connected models exist", async () => {
    const user = userEvent.setup();
    const disconnectedState: DesktopChatState = {
      ...readyState,
      model: { selected: null, options: [] },
    };
    window.geistr = fakeApi({
      getInitialState: vi.fn(async () => disconnectedState),
    });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Open Settings" }));
    await user.click(screen.getByRole("button", { name: "Model" }));

    expect(screen.getByText(/Connect a provider in Settings/)).toBeInTheDocument();
  });

  // ── General settings (foundation toggles) ────────────

  it("shows General settings with session compaction and memory toggles", async () => {
    const user = userEvent.setup();
    const updateAppConfig = vi.fn(async (partial: Partial<AppConfig>) => ({
      ...defaultConfig,
      ...partial,
      appearance: { ...defaultConfig.appearance, ...(partial.appearance ?? {}) },
      model: { ...defaultConfig.model, ...(partial.model ?? {}) },
      sessions: { ...defaultConfig.sessions, ...(partial.sessions ?? {}), compaction: { ...defaultConfig.sessions.compaction, ...(partial.sessions?.compaction ?? {}) } },
      memory: { ...defaultConfig.memory, ...(partial.memory ?? {}) },
    }));
    window.geistr = fakeApi({ updateAppConfig });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Open Settings" }));
    await user.click(screen.getByRole("button", { name: "General" }));

    expect(screen.getByText("Session history compaction")).toBeInTheDocument();
    expect(screen.getByText("Cross‑session memory")).toBeInTheDocument();

    // Toggle memory off — it starts off (false) in the default config
    const memoryToggle = screen.getByLabelText("Enable memory");
    expect(memoryToggle).not.toBeChecked();

    // Toggle it on
    await user.click(memoryToggle);
    expect(updateAppConfig).toHaveBeenCalledWith({ memory: { enabled: true } });

    // Toggle compaction off (starts on)
    const compactionToggle = screen.getByLabelText("Enable session compaction");
    expect(compactionToggle).toBeChecked();
    await user.click(compactionToggle);
    expect(updateAppConfig).toHaveBeenCalledWith({ sessions: { compaction: { enabled: false } } });
  });

  it("shows sidebar Skills and MCP entry points without fake Search or Plugins", async () => {
    window.geistr = fakeApi();

    render(<App />);

    expect(await screen.findByRole("button", { name: /Skills/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /MCP Servers/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Search/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Plugins/ })).not.toBeInTheDocument();
  });

  it("opens the Memory galaxy page from the sidebar", async () => {
    const user = userEvent.setup();
    window.geistr = fakeApi();

    render(<App />);

    await user.click(await screen.findByRole("button", { name: /^Memory$/ }));
    expect(await screen.findByRole("heading", { name: "Memory" })).toBeInTheDocument();
    expect(screen.getByText(/Explore what Geistr remembers/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No memories in view" })).toBeInTheDocument();
  });

  it("opens sidebar placeholder pages for Scheduled and MCP Servers", async () => {
    const user = userEvent.setup();
    window.geistr = fakeApi();

    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Scheduled/ }));
    expect(screen.getByRole("heading", { name: "Scheduled" })).toBeInTheDocument();
    expect(screen.getByText(/Scheduled tasks are not available yet/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /MCP Servers/ }));
    expect(screen.getByRole("heading", { name: "MCP Servers" })).toBeInTheDocument();
    expect(screen.getByText(/MCP servers are not configured yet/)).toBeInTheDocument();
  });

  it("opens the Skills settings page and lists built-in and installed skills", async () => {
    const user = userEvent.setup();
    window.geistr = fakeApi();

    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Skills/ }));

    expect(await screen.findByRole("heading", { name: "Skills" })).toBeInTheDocument();
    expect(screen.getByText("Built-in skills")).toBeInTheDocument();
    expect(screen.getByText("Installed skills")).toBeInTheDocument();
    expect(screen.getByText("writing-great-skills")).toBeInTheDocument();
    expect(screen.getByText("my-skill")).toBeInTheDocument();
    expect(screen.queryByText(/AppData\/Roaming\/.*\/skills/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open folder" })).not.toBeInTheDocument();
  });

  it("creates and opens persisted chats from the sidebar", async () => {
    const user = userEvent.setup();
    const secondState: DesktopChatState = {
      ...readyState,
      activeSessionId: "chat:session-2",
      chats: [
        { id: "chat:session-2", title: "Second chat", createdAt: 2000, updatedAt: 2000, messageCount: 0, preview: null },
        ...readyState.chats,
      ],
      messages: [],
    };
    const openedState: DesktopChatState = {
      ...readyState,
      messages: [{ id: "m1", role: "user", content: "Persisted hello" }],
    };
    const createChat = vi.fn(async () => secondState);
    const openChat = vi.fn(async () => openedState);
    window.geistr = fakeApi({ createChat, openChat });

    render(<App />);

    expect(await screen.findByText("First persisted chat")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New chat" }));
    expect(createChat).toHaveBeenCalled();
    expect(await screen.findByText("Second chat")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "First persisted chat" }));
    expect(openChat).toHaveBeenCalledWith("chat:session-1");
    expect(await screen.findByText("Persisted hello")).toBeInTheDocument();
  });

  it("subscribes to bridge state updates for streaming/status display", async () => {
    let listener: ((state: DesktopChatState) => void) | undefined;
    window.geistr = fakeApi({
      onStateChanged: (next) => {
        listener = next;
        return vi.fn();
      },
    });

    render(<App />);
    expect(await screen.findByText("What should Geistr help with?")).toBeInTheDocument();

    act(() => {
      listener?.({
        ...readyState,
        status: { label: "Geistr is thinking…", isStreaming: true },
        messages: [{ id: "a1", role: "assistant", content: "Working on it." }],
      });
    });

    expect(await screen.findByText("Working on it.")).toBeInTheDocument();
  });
});

function fakeApi(overrides: Partial<DesktopApi> = {}): DesktopApi {
  return {
    getInitialState: vi.fn(async () => readyState),
    sendMessage: vi.fn(async () => readyState),
    retryLastMessage: vi.fn(async () => readyState),
    stopRun: vi.fn(async () => readyState),
    resolveToolApproval: vi.fn(async () => readyState),
    selectModel: vi.fn(async () => readyState),
    saveProviderApiKey: vi.fn(async () => readyState),
    removeProviderAuth: vi.fn(async () => readyState),
    connectLoginProvider: vi.fn(async () => readyState),
    saveGoogleOAuthConfig: vi.fn(async () => ({ ok: true })),
    getGoogleOAuthConfig: vi.fn(async () => ({ clientId: "", clientSecret: "" })),
    createChat: vi.fn(async () => readyState),
    openChat: vi.fn(async () => readyState),
    renameChat: vi.fn(async () => readyState),
    deleteChat: vi.fn(async () => readyState),
    getAppConfig: vi.fn(async () => ({ ...defaultConfig })),
    getMemoryGraph: vi.fn(async () => ({
      nodes: [],
      links: [],
      stats: { totalMemories: 0, activeCount: 0, coldCount: 0, linkCount: 0 },
    })),
    getSkillsState: vi.fn(async () => ({
      userSkillsDir: "C:/Users/moham/AppData/Roaming/@geistr/desktop/skills",
      builtinSkills: [{ name: "writing-great-skills", description: "Helps write better skills", source: "builtin" as const, active: true }],
      userSkills: [{ name: "my-skill", description: "A user skill", source: "user" as const, active: true, folderPath: "C:/Users/moham/AppData/Roaming/@geistr/desktop/skills/my-skill" }],
    })),
    getSkillDetails: vi.fn(async (name: string) => ({
      name,
      description: "Helps write better skills",
      source: "builtin" as const,
      active: true,
      skillMarkdown: `---\nname: ${name}\n---\n\nSkill body`,
    })),
    setSkillActive: vi.fn(async (_name: string, _active: boolean) => ({
      userSkillsDir: "C:/Users/moham/AppData/Roaming/@geistr/desktop/skills",
      builtinSkills: [{ name: "writing-great-skills", description: "Helps write better skills", source: "builtin" as const, active: true }],
      userSkills: [{ name: "my-skill", description: "A user skill", source: "user" as const, active: false, folderPath: "C:/Users/moham/AppData/Roaming/@geistr/desktop/skills/my-skill" }],
    })),
    deleteUserSkill: vi.fn(async (_name: string) => ({
      userSkillsDir: "C:/Users/moham/AppData/Roaming/@geistr/desktop/skills",
      builtinSkills: [{ name: "writing-great-skills", description: "Helps write better skills", source: "builtin" as const, active: true }],
      userSkills: [],
    })),
    openPath: vi.fn(async () => undefined),
    updateAppConfig: vi.fn(async (partial: Partial<AppConfig>) => ({
      ...defaultConfig,
      ...partial,
      appearance: { ...defaultConfig.appearance, ...(partial.appearance ?? {}) },
      model: { ...defaultConfig.model, ...(partial.model ?? {}) },
      sessions: { ...defaultConfig.sessions, ...(partial.sessions ?? {}), compaction: { ...defaultConfig.sessions.compaction, ...(partial.sessions?.compaction ?? {}) } },
      memory: { ...defaultConfig.memory, ...(partial.memory ?? {}) },
      permissions: { ...defaultConfig.permissions, ...(partial.permissions ?? {}) },
      skills: { ...defaultConfig.skills, ...(partial.skills ?? {}) },
    })),
    getAssistantProfile: vi.fn(async () => ({
      assistantName: "",
      personaSummary: "",
      soulPrompt: "",
      rolePrompt: "",
      stylePrompt: "",
      boundaryPrompt: "",
      memoryPrompt: "",
      tone: "",
      communicationStyle: "",
      responseDepth: "balanced",
      warmth: "medium",
      directness: "medium",
      agentBehaviorNotesJson: "[]",
      updatedAt: 0,
    })),
    updateAssistantProfile: vi.fn(async (profile) => ({
      assistantName: profile.assistantName ?? "",
      personaSummary: profile.personaSummary ?? "",
      soulPrompt: profile.soulPrompt ?? "",
      rolePrompt: profile.rolePrompt ?? "",
      stylePrompt: profile.stylePrompt ?? "",
      boundaryPrompt: profile.boundaryPrompt ?? "",
      memoryPrompt: profile.memoryPrompt ?? "",
      tone: profile.tone ?? "",
      communicationStyle: profile.communicationStyle ?? "",
      responseDepth: profile.responseDepth ?? "balanced",
      warmth: profile.warmth ?? "medium",
      directness: profile.directness ?? "medium",
      agentBehaviorNotesJson: "[]",
      updatedAt: Date.now(),
    })),
    getUserProfile: vi.fn(async () => ({ displayName: "", locale: "en-US", timezone: "UTC", languagePreferences: "English" })),
    onStateChanged: vi.fn(() => vi.fn()),
    ...overrides,
  };
}
