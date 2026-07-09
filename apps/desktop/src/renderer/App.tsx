import { ArrowLeft, ArrowRight, ArrowUp, CirclePlus, Clock3, Copy, Edit3, KeyRound, Monitor, MoreVertical, Orbit, Palette, PanelLeft, Sliders, Sparkles, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent } from "react";

import type { AppConfig, MessageAttachment } from "@geistr/core";
import type { DesktopChatState, DesktopLoopProgress, DesktopModelSelection } from "../shared/desktop-api";
import type { GeistrThinkingLevel } from "@geistr/core";

import { MessageAttachments, PendingAttachments } from "./MediaAttachments";
import { ModelPicker } from "./ModelPicker";
import { RunTranscriptBlock } from "./RunTranscriptBlock";
import { McpServersScreen } from "./McpServersScreen";
import { SkillsScreen } from "./SkillsScreen";
import { AgentSettings, GeneralSettings, ModelSettings, ProvidersSettings, ThemeSettings } from "./settings";
import { ApprovalWidget, ErrorCard, LoopProgressWidget, McpIcon, PermissionModePicker, PlaceholderPage, arraysEqual, copyText, formatTime, getInitials, renderMarkdown, visibleMessagesForRun } from "./app-support";
import { MemoryPage } from "./memory/MemoryPage";

const fallbackState: DesktopChatState = {
  sessionId: null,
  activeSessionId: null,
  chats: [],
  messages: [],
  status: { label: "Connecting…", isStreaming: false },
  runUi: null,
  loopProgress: null,
  pendingApproval: null,
  model: { selected: null, options: [] },
  settings: { providers: { apiKeyProviders: [], loginProviders: [] } },
};

export type SettingsPage = "theme" | "providers" | "model" | "general" | "agent" | "skills" | "mcp";

export function App() {
  const api = window.geistr;
  const [state, setState] = useState<DesktopChatState>(fallbackState);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [favoriteModelKeys, setFavoriteModelKeys] = useState<Set<string>>(() => new Set());
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [activeScreen, setActiveScreen] = useState<"app" | "settings">("app");
  const [activeAppPage, setActiveAppPage] = useState<"chat" | "scheduled" | "memory">("chat");
  const [activeSettingsPage, setActiveSettingsPage] = useState<SettingsPage>("providers");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [userDisplayName, setUserDisplayName] = useState<string>("");
  const [sidebarWidth, setSidebarWidth] = useState<number | null>(null);
  const [openChatMenuFor, setOpenChatMenuFor] = useState<string | null>(null);
  const [chatDialog, setChatDialog] = useState<{ type: "rename" | "delete"; sessionKey: string; title: string } | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<MessageAttachment[]>([]);

  // ── Navigation stack ───────────────────────────────────────────
  type NavEntry =
    | { screen: "app"; page: "chat" }
    | { screen: "app"; page: "scheduled" }
    | { screen: "app"; page: "memory" }
    | { screen: "settings"; page: SettingsPage };

  const [navHistory, setNavHistory] = useState<NavEntry[]>([]);
  const [navForward, setNavForward] = useState<NavEntry[]>([]);

  /**
   * Navigate to a new destination, pushing the current location onto the
   * back-stack and clearing the forward-stack.
   */
  function navigateTo(to: NavEntry) {
    const current: NavEntry = activeScreen === "settings"
      ? { screen: "settings", page: activeSettingsPage }
      : { screen: "app", page: activeAppPage };

    // Don't push if we're already at the destination
    if (current.screen === to.screen && current.page === to.page) return;

    setNavHistory((prev) => [...prev, current]);
    setNavForward([]);

    if (to.screen === "settings") {
      setActiveSettingsPage(to.page);
      setActiveScreen("settings");
    } else {
      setActiveAppPage(to.page);
      setActiveScreen("app");
    }
  }

  function goBack() {
    if (navHistory.length === 0) return;
    const entry = navHistory[navHistory.length - 1]!;
    setNavHistory((prev) => prev.slice(0, -1));

    const current: NavEntry = activeScreen === "settings"
      ? { screen: "settings", page: activeSettingsPage }
      : { screen: "app", page: activeAppPage };
    setNavForward((prev) => [...prev, current]);

    if (entry.screen === "settings") {
      setActiveSettingsPage(entry.page);
      setActiveScreen("settings");
    } else if (entry.screen === "app") {
      setActiveAppPage(entry.page);
      setActiveScreen("app");
    }
  }

  function goForward() {
    if (navForward.length === 0) return;
    const entry = navForward[navForward.length - 1]!;
    setNavForward((prev) => prev.slice(0, -1));

    const current: NavEntry = activeScreen === "settings"
      ? { screen: "settings", page: activeSettingsPage }
      : { screen: "app", page: activeAppPage };
    setNavHistory((prev) => [...prev, current]);

    if (entry.screen === "settings") {
      setActiveSettingsPage(entry.page);
      setActiveScreen("settings");
    } else if (entry.screen === "app") {
      setActiveAppPage(entry.page);
      setActiveScreen("app");
    }
  }
  const sidebarRef = useRef<HTMLElement>(null);
  const chatMenuRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef(false);
  const messageListRef = useRef<HTMLElement>(null);
  const previousUserMessageCountRef = useRef(0);
  const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

  useEffect(() => {
    if (!openChatMenuFor) return;
    function handlePointerDown(event: PointerEvent) {
      if (!chatMenuRef.current?.contains(event.target as Node)) setOpenChatMenuFor(null);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [openChatMenuFor]);

  useEffect(() => {
    let isMounted = true;
    void api?.getInitialState().then((next) => {
      if (isMounted) setState(next);
    });
    const unsubscribe = api?.onStateChanged(setState);
    return () => {
      isMounted = false;
      unsubscribe?.();
    };
  }, [api]);

  // Load app config and user profile on mount
  useEffect(() => {
    void api?.getAppConfig().then((next) => {
      setConfig(next);
    });
    void api?.getUserProfile().then((profile) => {
      setUserDisplayName(profile.displayName);
    });
  }, [api]);

  // Apply appearance theme mode via data attribute on <html>
  useEffect(() => {
    const root = document.documentElement;
    const mode = config?.appearance.themeMode ?? "system";
    if (mode === "system") {
      root.removeAttribute("data-geistr-theme-mode");
    } else {
      root.setAttribute("data-geistr-theme-mode", mode);
    }
  }, [config?.appearance.themeMode]);

  const runInProgress = state.status.isStreaming || isSending;
  const canSend = useMemo(() => Boolean(api && (draft.trim() || pendingAttachments.length > 0) && !runInProgress), [api, draft, runInProgress, pendingAttachments]);

  async function handleUpload() {
    if (!api?.pickAndUploadMedia || !state.activeSessionId) return;
    try {
      const files = await api.pickAndUploadMedia(state.activeSessionId);
      if (files.length > 0) setPendingAttachments((prev) => [...prev, ...files]);
    } catch (err) { console.error("[geistr] Upload failed:", err); }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item?.type.startsWith("image/")) continue;
      event.preventDefault();
      const file = item.getAsFile();
      if (!file) continue;
      const reader = new FileReader();
      reader.onload = async () => {
        if (!api?.savePastedMedia || !state.activeSessionId || typeof reader.result !== "string") return;
        try {
          const attachment = await api.savePastedMedia(state.activeSessionId, reader.result, file.name || "pasted-image.png");
          setPendingAttachments((prev) => [...prev, attachment]);
        } catch (err) { console.error("[geistr] Paste save failed:", err); }
      };
      reader.readAsDataURL(file);
      break;
    }
  }

  function removeAttachment(id: string) { setPendingAttachments((prev) => prev.filter((a) => a.id !== id)); }

  async function sendMessage() {
    if (!api) return;
    const text = draft;
    const attachments = pendingAttachments.length > 0 ? pendingAttachments : undefined;
    setDraft("");
    setPendingAttachments([]);
    setIsSending(true);
    try {
      setState(await (attachments ? api.sendMessage(text, attachments) : api.sendMessage(text)));
    } finally {
      setIsSending(false);
    }
  }

  async function stopRun() {
    if (!api || !runInProgress) return;
    setState(await api.stopRun());
    setIsSending(false);
  }

  async function retryLastMessage() {
    if (!api || runInProgress) return;
    setIsSending(true);
    try {
      setState(await api.retryLastMessage());
    } finally {
      setIsSending(false);
    }
  }

  function openProviderSettings() {
    navigateTo({ screen: "settings", page: "providers" });
  }

  async function createChat() {
    if (!api) return;
    setState(await api.createChat());
  }

  async function openChat(sessionKey: string) {
    if (!api) return;
    setOpenChatMenuFor(null);
    setState(await api.openChat(sessionKey));
  }

  function requestRenameChat(sessionKey: string, currentTitle: string) {
    setOpenChatMenuFor(null);
    setRenameDraft(currentTitle);
    setChatDialog({ type: "rename", sessionKey, title: currentTitle });
  }

  function requestDeleteChat(sessionKey: string, title: string) {
    setOpenChatMenuFor(null);
    setChatDialog({ type: "delete", sessionKey, title });
  }

  async function confirmChatDialog() {
    if (!api || !chatDialog) return;
    const dialog = chatDialog;
    setChatDialog(null);
    if (dialog.type === "rename") {
      if (!renameDraft.trim()) return;
      setState(await api.renameChat(dialog.sessionKey, renameDraft));
      return;
    }
    setState(await api.deleteChat(dialog.sessionKey));
  }

  const connectedModelOptions = useMemo(
    () => state.model.options.filter((option) => option.configured),
    [state.model.options],
  );

  async function selectModel(provider: string, modelId: string, thinkingLevel?: GeistrThinkingLevel) {
    if (!api) return;
    setState(await api.selectModel({ provider, modelId, ...(thinkingLevel ? { thinkingLevel } : {}) }));
  }

  async function selectThinkingLevel(thinkingLevel: DesktopModelSelection["thinkingLevel"]) {
    if (!api || !state.model.selected || !thinkingLevel) return;
    setState(await api.selectModel({ ...state.model.selected, thinkingLevel }));
  }

  function toggleFavoriteModel(key: string) {
    setFavoriteModelKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Persist favorite models to app config
  useEffect(() => {
    if (!api || !config) return;
    const keys = [...favoriteModelKeys];
    if (arraysEqual(keys, config.model.favoriteModels)) return;
    void api.updateAppConfig({ model: { ...config.model, favoriteModels: keys } }).then(setConfig);
  }, [favoriteModelKeys, api, config]);

  // Sync favorite model keys from config when it loads
  useEffect(() => {
    if (config && config.model.favoriteModels.length > 0 && favoriteModelKeys.size === 0) {
      setFavoriteModelKeys(new Set(config.model.favoriteModels));
    }
  }, [config]);

  function handleSidebarResizeStart(event: React.MouseEvent) {
    event.preventDefault();
    isResizingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const startX = event.clientX;
    const startWidth = sidebarWidth ?? sidebarRef.current?.offsetWidth ?? 292;

    function handleMouseMove(e: MouseEvent) {
      if (!isResizingRef.current) return;
      const newWidth = Math.max(180, Math.min(500, startWidth + (e.clientX - startX)));
      setSidebarWidth(newWidth);
    }

    function handleMouseUp() {
      isResizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    }

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }

  useEffect(() => {
    const el = messageListRef.current;
    if (!el) return;

    const userMessageCount = state.messages.filter((message) => message.role === "user").length;
    const userMessageWasAdded = userMessageCount > previousUserMessageCountRef.current;
    previousUserMessageCountRef.current = userMessageCount;

    if (userMessageWasAdded) {
      const userMessages = el.querySelectorAll<HTMLElement>(".message.user");
      const lastUserMessage = userMessages[userMessages.length - 1];
      if (!lastUserMessage) return;
      const desiredOffset = el.clientHeight * 0.25;
      el.scrollTo?.({ top: Math.max(0, lastUserMessage.offsetTop - desiredOffset), behavior: "smooth" });
      return;
    }

    const lastMessage = state.messages.at(-1);
    if (lastMessage?.role === "assistant" && lastMessage.isStreaming) {
      el.scrollTo?.({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [state.messages]);

  return (
    <div className={`${isSidebarCollapsed ? "appFrame sidebarCollapsed" : "appFrame"} ${isMac ? "platformMac" : "platformWindows"}`}>
      <div className="appTopBar">
        <button className="topBarButton" type="button" aria-label={isSidebarCollapsed ? "Open sidebar" : "Close sidebar"} onClick={() => setIsSidebarCollapsed((collapsed) => !collapsed)}>
          <PanelLeft size={16} />
        </button>
        <button className="topBarButton" type="button" aria-label="Back" disabled={navHistory.length === 0} onClick={goBack}>
          <ArrowLeft size={16} />
        </button>
        <button className={`topBarButton${navForward.length === 0 ? " muted" : ""}`} type="button" aria-label="Forward" disabled={navForward.length === 0} onClick={goForward}>
          <ArrowRight size={16} />
        </button>
      </div>

      <div className={activeScreen === "settings" ? "shell settingsShell" : "shell"} style={sidebarWidth && !isSidebarCollapsed ? { "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties : undefined}>
      {activeScreen === "app" ? (
        <>
        <aside className="sidebar" aria-label="Geistr navigation" ref={sidebarRef}>
          <button className="navButton" type="button" onClick={() => { navigateTo({ screen: "app", page: "chat" }); void createChat(); }}>
            <Edit3 size={17} />
            <span>New chat</span>
          </button>
          <button className={activeAppPage === "scheduled" ? "navButton selected" : "navButton"} type="button" onClick={() => navigateTo({ screen: "app", page: "scheduled" })}>
            <Clock3 size={17} />
            <span>Scheduled</span>
          </button>
          <button className={activeAppPage === "memory" ? "navButton selected" : "navButton"} type="button" onClick={() => navigateTo({ screen: "app", page: "memory" })}>
            <Orbit size={17} />
            <span>Memory</span>
          </button>
          <button className="navButton" type="button" onClick={() => navigateTo({ screen: "settings", page: "skills" })}>
            <Sparkles size={17} />
            <span>Skills</span>
          </button>
          <button className="navButton" type="button" onClick={() => navigateTo({ screen: "settings", page: "mcp" })}>
            <McpIcon className="navIconImage" />
            <span>MCP Servers</span>
          </button>
          <div className="sectionLabel">Chats</div>
          <div className="chatHistoryList" aria-label="Chat history">
            {state.chats.length === 0 ? (
              <div className="chatHistoryEmpty">No chats yet</div>
            ) : (
              state.chats.map((chat) => (
                <div className={chat.id === state.activeSessionId ? "chatHistoryItem selected" : "chatHistoryItem"} key={chat.id} aria-current={chat.id === state.activeSessionId ? "page" : undefined}>
                  <button className="chatHistoryOpen" type="button" onClick={() => { navigateTo({ screen: "app", page: "chat" }); void openChat(chat.id); }}>
                    <span>{chat.title}</span>
                  </button>
                  <div className="chatMenuWrap" ref={openChatMenuFor === chat.id ? chatMenuRef : undefined}>
                    <button className="chatMenuButton" type="button" aria-label={`Options for ${chat.title}`} onClick={() => setOpenChatMenuFor((current) => current === chat.id ? null : chat.id)}><MoreVertical size={15} /></button>
                    {openChatMenuFor === chat.id ? (
                      <div className="chatMenu" role="menu">
                        <button type="button" role="menuitem" onClick={() => requestRenameChat(chat.id, chat.title)}>Rename session</button>
                        <button className="dangerMenuItem" type="button" role="menuitem" onClick={() => requestDeleteChat(chat.id, chat.title)}>Delete session</button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="spacer" />
          <button className="profile" aria-label="Open Settings" onClick={() => navigateTo({ screen: "settings", page: "providers" })}><span className="avatar">{getInitials(userDisplayName)}</span><span className="profileText">{userDisplayName || "User"}<br /><small>Settings</small></span></button>
          {!isSidebarCollapsed ? <div className="sidebarResizeHandle" onMouseDown={handleSidebarResizeStart} /> : null}
        </aside>
        </>
      ) : null}

      {chatDialog ? (
        <div className="dialogOverlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setChatDialog(null); }}>
          <section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="chat-dialog-title">
            <button className="dialogClose" type="button" aria-label="Close dialog" onClick={() => setChatDialog(null)}>×</button>
            {chatDialog.type === "delete" ? (
              <>
                <h2 id="chat-dialog-title">Delete session?</h2>
                <p>Message content will be removed and this session will disappear from your sidebar.</p>
              </>
            ) : (
              <>
                <h2 id="chat-dialog-title">Rename session</h2>
                <p>Choose a short name for this chat.</p>
                <input className="dialogInput" value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} autoFocus />
              </>
            )}
            <div className="dialogActions">
              <button className="dialogSecondary" type="button" onClick={() => setChatDialog(null)}>Cancel</button>
              <button className={chatDialog.type === "delete" ? "dialogDanger" : "dialogPrimary"} type="button" onClick={() => void confirmChatDialog()}>{chatDialog.type === "delete" ? "Delete" : "Rename"}</button>
            </div>
          </section>
        </div>
      ) : null}

      {activeScreen === "settings" ? (
        <main className="settingsScreen">
          <aside className="settingsNav" aria-label="Settings navigation">
            <button className="backToApp" type="button" onClick={() => navigateTo({ screen: "app", page: "chat" })}><ArrowLeft size={16} /> Back to app</button>
            <div className="settingsNavGroup">
              <div className="settingsNavLabel">App</div>
              <button className={activeSettingsPage === "general" ? "settingsNavItem selected" : "settingsNavItem"} type="button" onClick={() => navigateTo({ screen: "settings", page: "general" })}><Sliders size={16} /> General</button>
              <button className={activeSettingsPage === "theme" ? "settingsNavItem selected" : "settingsNavItem"} type="button" onClick={() => navigateTo({ screen: "settings", page: "theme" })}><Palette size={16} /> Theme</button>
            </div>
            <div className="settingsNavGroup">
              <div className="settingsNavLabel">Agent</div>
              <button className={activeSettingsPage === "providers" ? "settingsNavItem selected" : "settingsNavItem"} type="button" onClick={() => navigateTo({ screen: "settings", page: "providers" })}><KeyRound size={16} /> Providers</button>
              <button className={activeSettingsPage === "model" ? "settingsNavItem selected" : "settingsNavItem"} type="button" onClick={() => navigateTo({ screen: "settings", page: "model" })}><Monitor size={16} /> Model</button>
              <button className={activeSettingsPage === "agent" ? "settingsNavItem selected" : "settingsNavItem"} type="button" onClick={() => navigateTo({ screen: "settings", page: "agent" })}><span className="settingsNavIcon">✦</span> Agent</button>
            </div>
            <div className="settingsNavGroup">
              <div className="settingsNavLabel">Extensions</div>
              <button className={activeSettingsPage === "skills" ? "settingsNavItem selected" : "settingsNavItem"} type="button" onClick={() => navigateTo({ screen: "settings", page: "skills" })}><Sparkles size={16} /> Skills</button>
              <button className={activeSettingsPage === "mcp" ? "settingsNavItem selected" : "settingsNavItem"} type="button" onClick={() => navigateTo({ screen: "settings", page: "mcp" })}><McpIcon className="settingsNavIconImage" /> MCP Servers</button>
            </div>
          </aside>
          <section className="settingsPage">
            {activeSettingsPage === "theme" && config && api ? (
              <ThemeSettings config={config} api={api} onConfigChange={setConfig} />
            ) : null}
            {activeSettingsPage === "providers" && api ? (
              <ProvidersSettings state={state} api={api} onStateChange={setState} />
            ) : null}
            {activeSettingsPage === "model" && config && api ? (
              <ModelSettings config={config} api={api} onConfigChange={setConfig} connectedModelOptions={connectedModelOptions} />
            ) : null}
            {activeSettingsPage === "general" && config && api ? (
              <GeneralSettings config={config} api={api} onConfigChange={setConfig} />
            ) : null}
            {activeSettingsPage === "agent" && api ? (
              <AgentSettings api={api} />
            ) : null}
            {activeSettingsPage === "skills" && api ? (
              <SkillsScreen api={api} />
            ) : null}
            {activeSettingsPage === "mcp" && api ? (
              <McpServersScreen api={api} />
            ) : null}
          </section>
        </main>
      ) : activeAppPage === "scheduled" ? (
        <main className="settingsPage appPage"><PlaceholderPage title="Scheduled" text="Scheduled tasks are not available yet. This area will manage recurring agent tasks and background jobs." /></main>
      ) : activeAppPage === "memory" && api ? (
        <MemoryPage api={api} />
      ) : (
      <main className="chatPanel">
        <LoopProgressWidget progress={state.loopProgress} />
        <section ref={messageListRef} className="messageList" aria-label="Message list">
          <div className="messageListInner">
          {state.messages.length === 0 && !state.runUi ? (
            <div className="emptyState">
              <h2>What should Geistr help with?</h2>
              <p>Start with a simple message. The desktop shell keeps the UI focused while the core runtime owns agent behavior.</p>
            </div>
          ) : (
            visibleMessagesForRun(state.messages, state.runUi).map((message) => (
              <article className={`message ${message.role}${message.isStreaming ? " streaming" : ""}`} key={message.id}>
                {message.isStreaming ? (
                  <div className="messageActivityCard" aria-label="Assistant activity">
                    <div className="messageActivityHeader">
                      <span className="messageActivityPulse" />
                      <span>{message.content ? "Working" : "Thinking"}</span>
                    </div>
                    {message.thinkingContent ? (
                      <div className="messageThinking">{message.thinkingContent}</div>
                    ) : null}
                    {message.toolActivities?.length ? (
                      <div className="messageToolList" aria-label="Tool activity">
                        {message.toolActivities.map((activity, index) => (
                          <div className="messageToolItem" key={`${activity}-${index}`}>
                            <span className="messageToolIcon">↳</span>
                            <span className="messageActivityText">{activity}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {message.role === "user" && message.attachments ? <MessageAttachments attachments={message.attachments} /> : null}
                {message.error ? (
                  <ErrorCard
                    error={message.error}
                    onRetry={() => void retryLastMessage()}
                    onChangeModel={() => { navigateTo({ screen: "settings", page: "model" }); }}
                    onProviderSettings={openProviderSettings}
                  />
                ) : message.content ? (
                  <div
                    className="messageContent"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
                  />
                ) : null}
                {message.role !== "user" && message.attachments ? <MessageAttachments attachments={message.attachments} /> : null}
                <div className="messageMeta">
                  <span className="messageTime">{formatTime(message.createdAt)}</span>
                  <button
                    className="copyButton"
                    type="button"
                    onClick={() => copyText(message.content)}
                    aria-label="Copy message"
                  >
                    <Copy size={14} />
                  </button>
                </div>
              </article>
            ))
          )}
          {state.runUi ? <RunTranscriptBlock run={state.runUi} renderMarkdown={renderMarkdown} copyText={(text) => void copyText(text)} /> : null}
        </div>
        </section>

        <ApprovalWidget approval={state.pendingApproval} onResolve={(id, approved) => api?.resolveToolApproval(id, approved).then(setState)} />

        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void sendMessage();
          }}
        >
          <PendingAttachments attachments={pendingAttachments} onRemove={removeAttachment} />
          <textarea
            aria-label="Message Geistr"
            placeholder="Message Geistr…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onPaste={handlePaste}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
          />
          <div className="composerActions">
            <button className="iconButton" type="button" aria-label="Add attachment" title="Upload file or image" onClick={() => void handleUpload()}>
              <CirclePlus size={20} />
            </button>
            <ModelPicker
              selected={state.model.selected}
              options={state.model.options}
              favoriteModelKeys={favoriteModelKeys}
              onSelectModel={selectModel}
              onToggleFavorite={toggleFavoriteModel}
              onSelectThinkingLevel={selectThinkingLevel}
            />
            {config && api ? (
              <PermissionModePicker
                mode={config.permissions.mode}
                onSelect={(mode) => void api.updateAppConfig({ permissions: { mode } }).then(setConfig)}
              />
            ) : null}
            <button
              className="sendButton"
              type={runInProgress ? "button" : "submit"}
              disabled={runInProgress ? !api : !canSend}
              aria-label={runInProgress ? "Stop run" : "Send message"}
              onClick={runInProgress ? () => void stopRun() : undefined}
            >
              {runInProgress ? <Square size={14} fill="currentColor" /> : <ArrowUp size={22} />}
            </button>
          </div>
        </form>
      </main>
      )}
      </div>
    </div>
  );
}
