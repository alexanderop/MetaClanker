import electron = require("electron");

const bridge = Object.freeze({
  platform: process.platform,
  version: process.env["npm_package_version"] ?? "0.0.0",
  initialSidebarCollapsed: process.argv.includes("--metaclanker-sidebar-collapsed=true"),
  selectProjectDirectory: () => electron.ipcRenderer.invoke("desktop:select-project-directory"),
  setSidebarCollapsed: (collapsed: boolean) =>
    electron.ipcRenderer.invoke("desktop:set-sidebar-collapsed", collapsed),
  readConversationDrafts: () => electron.ipcRenderer.invoke("desktop:read-conversation-drafts"),
  setConversationDrafts: (serialized: string) =>
    electron.ipcRenderer.invoke("desktop:set-conversation-drafts", serialized),
});

electron.contextBridge.exposeInMainWorld("metaClankerDesktop", bridge);
