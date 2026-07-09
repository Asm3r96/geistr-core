import { app, BrowserWindow, Menu, ipcMain, nativeTheme, shell, dialog, protocol, net } from "electron";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ProfileStore, SessionPersistenceStore, mergeAppConfig, sanitizeAppConfig, registerGoogleOAuthProvider } from "@geistr/core";
import type { AppConfig, AppConfigUpdate, MessageAttachment } from "@geistr/core";

import { readAppConfig, writeAppConfig } from "./app-config-storage.js";
import { getDesktopWindowTheme } from "./desktop-window-theme.js";
import { DesktopRuntimeBridge } from "./runtime-bridge.js";
import { MediaManager } from "./media-manager.js";
import { getSessionDatabasePath } from "./session-storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.PI_OAUTH_CALLBACK_HOST ??= "localhost";
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
protocol.registerSchemesAsPrivileged([{ scheme: "geistr-media", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let bridge: DesktopRuntimeBridge | null = null;
let mediaManager: MediaManager | null = null;
let currentAppConfig: AppConfig | null = null;

function getMediaManager(): MediaManager {
  if (!mediaManager) {
    const userDataDir = app.getPath("userData");
    const mediaDir = path.join(userDataDir, "runtime-workspace", "media");
    mkdirSync(mediaDir, { recursive: true });
    mediaManager = new MediaManager(mediaDir);
  }
  return mediaManager;
}

registerGoogleOAuthProvider();

function getBridge(): DesktopRuntimeBridge {
  if (!bridge) {
    const userDataDir = app.getPath("userData");
    const runtimeWorkspace = path.join(userDataDir, "runtime-workspace");
    const userSkillsDir = path.join(userDataDir, "skills");
    mkdirSync(runtimeWorkspace, { recursive: true });
    mkdirSync(userSkillsDir, { recursive: true });
    const sessionDbPath = getSessionDatabasePath();
    bridge = new DesktopRuntimeBridge(
      runtimeWorkspace,
      new SessionPersistenceStore(sessionDbPath),
      new ProfileStore(sessionDbPath),
      undefined,
      (url) => shell.openExternal(url),
      undefined,
      userSkillsDir,
    );
  }
  return bridge;
}

async function readAndApplyConfig(): Promise<void> {
  const appConfig = await readAppConfig();
  currentAppConfig = appConfig;
  getBridge().setAppConfig(appConfig);
}

function registerMediaProtocol(): void {
  const mediaRoot = path.join(app.getPath("userData"), "runtime-workspace", "media");
  protocol.handle("geistr-media", (request) => {
    const url = new URL(request.url);
    const requested = url.searchParams.get("path");
    if (!requested) return new Response("Missing path", { status: 400 });
    const resolved = path.resolve(requested);
    if (!resolved.startsWith(path.resolve(mediaRoot)) || !existsSync(resolved)) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(resolved).toString());
  });
}

function resolveWindowTheme() {
  return getDesktopWindowTheme(currentAppConfig?.appearance.themeMode ?? "system", nativeTheme.shouldUseDarkColors);
}

function applyWindowTheme(config: AppConfig): void {
  currentAppConfig = config;
  getBridge().setAppConfig(config);
  const theme = resolveWindowTheme();
  for (const window of BrowserWindow.getAllWindows()) {
    window.setBackgroundColor(theme.backgroundColor);
    if (process.platform !== "darwin") {
      window.setTitleBarOverlay({
        color: theme.backgroundColor,
        symbolColor: theme.titleBarSymbolColor,
        height: theme.titleBarHeight,
      });
    }
  }
}

function registerWindowReloadShortcuts(window: BrowserWindow): void {
  window.webContents.on("before-input-event", (event, input) => {
    const isReloadKey = input.key.toLowerCase() === "r";
    const hasPlatformModifier = process.platform === "darwin" ? input.meta : input.control;
    if (!isReloadKey || !hasPlatformModifier) return;

    event.preventDefault();
    if (input.shift) window.webContents.reloadIgnoringCache();
    else window.webContents.reload();
  });
}

function createWindow(): void {
  const theme = resolveWindowTheme();
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 0,
    minHeight: 520,
    title: "",
    autoHideMenuBar: true,
    backgroundColor: theme.backgroundColor,
    titleBarStyle: "hidden",
    trafficLightPosition: theme.trafficLightPosition,
    titleBarOverlay: process.platform === "darwin" ? false : {
      color: theme.backgroundColor,
      symbolColor: theme.titleBarSymbolColor,
      height: theme.titleBarHeight,
    },
    icon: path.join(__dirname, "../../resources/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.setMenu(null);
  window.setMenuBarVisibility(false);
  registerWindowReloadShortcuts(window);

  if (isDev) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL!);
  } else {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  registerMediaProtocol();
  await readAndApplyConfig();
  const runtimeBridge = getBridge();
  await runtimeBridge.initialize();
  ipcMain.handle("geistr:get-user-profile", () => {
    const store = new ProfileStore(getSessionDatabasePath());
    store.seedDefaultsIfMissing();
    const profile = store.getUserProfile();
    return {
      displayName: profile.displayName,
      locale: profile.locale,
      timezone: profile.timezone,
      languagePreferences: profile.languagePreferences,
    };
  });
  ipcMain.handle("geistr:get-assistant-profile", () => {
    const store = new ProfileStore(getSessionDatabasePath());
    store.seedDefaultsIfMissing();
    const profile = store.getAssistantProfile();
    return {
      assistantName: profile.assistantName,
      personaSummary: profile.personaSummary,
      soulPrompt: profile.soulPrompt,
      rolePrompt: profile.rolePrompt,
      stylePrompt: profile.stylePrompt,
      boundaryPrompt: profile.boundaryPrompt,
      memoryPrompt: profile.memoryPrompt,
      tone: profile.tone,
      communicationStyle: profile.communicationStyle,
      responseDepth: profile.responseDepth,
      warmth: profile.warmth,
      directness: profile.directness,
      agentBehaviorNotesJson: JSON.stringify(profile.agentBehaviorNotes),
      updatedAt: Date.now(),
    };
  });
  ipcMain.handle("geistr:update-assistant-profile", (_event, input) => {
    const store = new ProfileStore(getSessionDatabasePath());
    store.seedDefaultsIfMissing();
    const profile = store.updateAssistantProfile(input);
    return {
      assistantName: profile.assistantName,
      personaSummary: profile.personaSummary,
      soulPrompt: profile.soulPrompt,
      rolePrompt: profile.rolePrompt,
      stylePrompt: profile.stylePrompt,
      boundaryPrompt: profile.boundaryPrompt,
      memoryPrompt: profile.memoryPrompt,
      tone: profile.tone,
      communicationStyle: profile.communicationStyle,
      responseDepth: profile.responseDepth,
      warmth: profile.warmth,
      directness: profile.directness,
      agentBehaviorNotesJson: JSON.stringify(profile.agentBehaviorNotes),
      updatedAt: Date.now(),
    };
  });
  ipcMain.handle("geistr:get-state", () => runtimeBridge.getState());
  ipcMain.handle("geistr:get-memory-graph", (_event, options) => runtimeBridge.getMemoryGraph(options));
  ipcMain.handle("geistr:get-skills-state", () => runtimeBridge.getSkillsState());
  ipcMain.handle("geistr:get-skill-details", (_event, name: string) => runtimeBridge.getSkillDetails(name));
  ipcMain.handle("geistr:set-skill-active", async (_event, name: string, active: boolean) => {
    const current = await readAppConfig();
    const disabled = new Set(current.skills.disabledSkillNames);
    if (active) disabled.delete(name);
    else disabled.add(name);
    const sanitized = sanitizeAppConfig(mergeAppConfig(current, { skills: { disabledSkillNames: [...disabled].sort() } }));
    await writeAppConfig(sanitized);
    applyWindowTheme(sanitized);
    return runtimeBridge.getSkillsState();
  });
  ipcMain.handle("geistr:delete-user-skill", async (_event, name: string) => {
    const next = runtimeBridge.deleteUserSkill(name);
    const current = await readAppConfig();
    const sanitized = sanitizeAppConfig(mergeAppConfig(current, { skills: { disabledSkillNames: current.skills.disabledSkillNames.filter((skillName) => skillName !== name) } }));
    await writeAppConfig(sanitized);
    applyWindowTheme(sanitized);
    return next;
  });
  ipcMain.handle("geistr:open-path", (_event, targetPath: string) => shell.openPath(targetPath).then((error) => {
    if (error) throw new Error(error);
  }));
  ipcMain.handle("geistr:send-message", (_event, text: string, attachments?: MessageAttachment[]) => runtimeBridge.sendMessage(text, attachments));
  ipcMain.handle("geistr:retry-last-message", () => runtimeBridge.retryLastMessage());
  ipcMain.handle("geistr:stop-run", () => runtimeBridge.stopRun());
  ipcMain.handle("geistr:resolve-tool-approval", (_event, id: string, approved: boolean) => runtimeBridge.resolveToolApproval(id, approved));
  ipcMain.handle("geistr:create-chat", () => runtimeBridge.createChat());
  ipcMain.handle("geistr:open-chat", (_event, sessionKey: string) => runtimeBridge.openChat(sessionKey));
  ipcMain.handle("geistr:rename-chat", (_event, sessionKey: string, title: string) => runtimeBridge.renameChat(sessionKey, title));
  ipcMain.handle("geistr:delete-chat", (_event, sessionKey: string) => runtimeBridge.deleteChat(sessionKey));
  ipcMain.handle("geistr:select-model", (_event, selection) => runtimeBridge.selectModel(selection));
  ipcMain.handle("geistr:save-provider-api-key", (_event, provider: string, apiKey: string) => runtimeBridge.saveProviderApiKey(provider, apiKey));
  ipcMain.handle("geistr:remove-provider-auth", (_event, provider: string) => runtimeBridge.removeProviderAuth(provider));
  ipcMain.handle("geistr:connect-login-provider", (_event, provider: string) => runtimeBridge.connectLoginProvider(provider));

  // ── Media (file upload / paste) IPC handlers ──
  ipcMain.handle("geistr:pick-upload-media", async (_event, sessionKey: string) => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "All supported", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "pdf", "txt", "md", "json", "csv", "html", "xml", "yaml", "yml", "js", "ts", "py"] },
        { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] },
        { name: "Documents", extensions: ["pdf", "txt", "md", "json", "csv", "html", "xml"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (result.canceled || !result.filePaths.length) return [];
    const manager = getMediaManager();
    return result.filePaths.map((filePath) => manager.saveFile(sessionKey, filePath));
  });
  ipcMain.handle("geistr:save-pasted-media", async (_event, sessionKey: string, dataUrl: string, fileName: string) => {
    return getMediaManager().saveDataUrl(sessionKey, dataUrl, fileName);
  });
  ipcMain.handle("geistr:list-all-media", async () => {
    return getMediaManager().listAll();
  });
  ipcMain.handle("geistr:delete-media", async (_event, filePath: string) => {
    getMediaManager().delete(filePath);
  });
  ipcMain.handle("geistr:get-media-stats", async () => {
    return getMediaManager().getStats();
  });
  ipcMain.handle("geistr:get-app-config", async () => {
    return await readAppConfig();
  });
  ipcMain.handle("geistr:update-app-config", async (_event, partial: AppConfigUpdate) => {
    const current = await readAppConfig();
    const merged = mergeAppConfig(current, partial);
    const sanitized = sanitizeAppConfig(merged);
    await writeAppConfig(sanitized);
    applyWindowTheme(sanitized);
    return sanitized;
  });

  nativeTheme.on("updated", () => {
    if (currentAppConfig?.appearance.themeMode === "system") {
      applyWindowTheme(currentAppConfig);
    }
  });

  runtimeBridge.subscribe((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("geistr:state-changed", state);
    }
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
