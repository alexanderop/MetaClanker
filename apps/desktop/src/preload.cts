import electron = require("electron");

const bridge = Object.freeze({
  platform: process.platform,
  version: process.env["npm_package_version"] ?? "0.0.0",
  selectProjectDirectory: () => electron.ipcRenderer.invoke("desktop:select-project-directory"),
});

electron.contextBridge.exposeInMainWorld("metaClankerDesktop", bridge);
