import { contextBridge, ipcRenderer } from "electron";

import type { AppConfig } from "@geistr/core";
import type { DesktopApi, DesktopChatState } from "../shared/desktop-api";

const api: DesktopApi = {
  getInitialState: () => ipcRenderer.invoke("geistr:get-state") as Promise<DesktopChatState>,
  retryLastMessage: () => ipcRenderer.invoke("geistr:retry-last-message") as Promise<DesktopChatState>,
  stopRun: () => ipcRenderer.invoke("geistr:stop-run") as Promise<DesktopChatState>,
  resolveToolApproval: (id, approved) => ipcRenderer.invoke("geistr:resolve-tool-approval", id, approved) as Promise<DesktopChatState>,
  createChat: () => ipcRenderer.invoke("geistr:create-chat") as Promise<DesktopChatState>,
  openChat: (sessionKey) => ipcRenderer.invoke("geistr:open-chat", sessionKey) as Promise<DesktopChatState>,
  renameChat: (sessionKey, title) => ipcRenderer.invoke("geistr:rename-chat", sessionKey, title) as Promise<DesktopChatState>,
  deleteChat: (sessionKey) => ipcRenderer.invoke("geistr:delete-chat", sessionKey) as Promise<DesktopChatState>,
  selectModel: (selection) => ipcRenderer.invoke("geistr:select-model", selection) as Promise<DesktopChatState>,
  saveProviderApiKey: (provider, apiKey) => ipcRenderer.invoke("geistr:save-provider-api-key", provider, apiKey) as Promise<DesktopChatState>,
  removeProviderAuth: (provider) => ipcRenderer.invoke("geistr:remove-provider-auth", provider) as Promise<DesktopChatState>,
  connectLoginProvider: (provider) => ipcRenderer.invoke("geistr:connect-login-provider", provider) as Promise<DesktopChatState>,
  getAppConfig: () => ipcRenderer.invoke("geistr:get-app-config") as Promise<AppConfig>,
  updateAppConfig: (partial) => ipcRenderer.invoke("geistr:update-app-config", partial) as Promise<AppConfig>,
  getMemoryGraph: (options) => ipcRenderer.invoke("geistr:get-memory-graph", options) as Promise<import("@geistr/core").MemoryGraph>,
  getSkillsState: () => ipcRenderer.invoke("geistr:get-skills-state") as Promise<import("../shared/desktop-api").DesktopSkillsState>,
  getSkillDetails: (name) => ipcRenderer.invoke("geistr:get-skill-details", name) as Promise<import("../shared/desktop-api").DesktopSkillDetails>,
  setSkillActive: (name, active) => ipcRenderer.invoke("geistr:set-skill-active", name, active) as Promise<import("../shared/desktop-api").DesktopSkillsState>,
  deleteUserSkill: (name) => ipcRenderer.invoke("geistr:delete-user-skill", name) as Promise<import("../shared/desktop-api").DesktopSkillsState>,
  openPath: (targetPath) => ipcRenderer.invoke("geistr:open-path", targetPath) as Promise<void>,
  getAssistantProfile: () => ipcRenderer.invoke("geistr:get-assistant-profile") as Promise<import("../shared/desktop-api").DesktopAssistantProfile>,
  updateAssistantProfile: (profile) => ipcRenderer.invoke("geistr:update-assistant-profile", profile) as Promise<import("../shared/desktop-api").DesktopAssistantProfile>,
  getUserProfile: () => ipcRenderer.invoke("geistr:get-user-profile") as Promise<import("../shared/desktop-api").DesktopUserProfile>,
  pickAndUploadMedia: (sessionKey) => ipcRenderer.invoke("geistr:pick-upload-media", sessionKey) as Promise<import("@geistr/core").MessageAttachment[]>,
  savePastedMedia: (sessionKey, dataUrl, fileName) => ipcRenderer.invoke("geistr:save-pasted-media", sessionKey, dataUrl, fileName) as Promise<import("@geistr/core").MessageAttachment>,
  listAllMedia: () => ipcRenderer.invoke("geistr:list-all-media") as Promise<{ sessionKey: string; files: import("@geistr/core").MessageAttachment[] }[]>,
  deleteMedia: (filePath) => ipcRenderer.invoke("geistr:delete-media", filePath) as Promise<void>,
  getMediaStats: () => ipcRenderer.invoke("geistr:get-media-stats") as Promise<{ totalSize: number; fileCount: number }>,
  sendMessage: (text, attachments) => ipcRenderer.invoke("geistr:send-message", text, attachments) as Promise<DesktopChatState>,
  onStateChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: DesktopChatState) => listener(state);
    ipcRenderer.on("geistr:state-changed", handler);
    return () => ipcRenderer.off("geistr:state-changed", handler);
  },
};

contextBridge.exposeInMainWorld("geistr", api);
